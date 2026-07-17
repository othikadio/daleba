'use strict';
/**
 * KADIO RH — Module 1 : Système de pointage (kiosque salon)
 * Cahier des charges Kadio Coiffure & Esthétique — Section 3
 *
 * Routes publiques (kiosque physique au salon — aucune authentification JWT,
 * le contrôle d'accès est la présence physique dans le salon).
 *
 * GET  /api/pointage/code-actuel        — code 4 chiffres affiché à l'écran (rotation 5 min)
 * POST /api/pointage/verifier-employe   — { telephone, prenom }
 * POST /api/pointage/arrivee            — { telephone, prenom, code, raison? }
 * POST /api/pointage/depart             — { telephone, prenom, code }
 * POST /api/pointage/pause/debut        — { telephone, prenom }
 * POST /api/pointage/pause/fin          — { telephone, prenom }
 */

const express = require('express');
const router  = express.Router();
const crypto  = require('crypto');

const LOG = '[POINTAGE]';
const CODE_WINDOW_MS = 5 * 60 * 1000; // 5 minutes

let pool = null, DEMO_MODE = true;
try { const db = require('../memory/db'); pool = db.pool; DEMO_MODE = db.DEMO_MODE; } catch (e) {}

let sendSMS = null;
try { sendSMS = require('../services/twilio').sendSMS; } catch (e) {}

// Module 3 — déclenchement automatique des sanctions (retards, pauses longues)
let declencherSanctionRetard = async () => {}, declencherSanctionPauseLongue = async () => {};
try {
  const auto = require('./rh-sanctions-auto');
  declencherSanctionRetard = auto.declencherSanctionRetard;
  declencherSanctionPauseLongue = auto.declencherSanctionPauseLongue;
} catch (e) {}

const OWNER_PHONE = process.env.OWNER_PHONE_NUMBER || '+15149195970';

async function alertOwner(message, employeId = null, type = 'info', niveau = 'attention') {
  if (sendSMS) {
    try { await sendSMS(OWNER_PHONE, message); } catch (e) { console.error(`${LOG} SMS échec: ${e.message}`); }
  } else {
    console.log(`${LOG} [SMS-DEMO] → propriétaire: ${message}`);
  }
  if (pool && !DEMO_MODE) {
    try {
      await pool.query(`
        INSERT INTO kadio_rh_alertes (niveau, message, employe_id, type) VALUES ($1,$2,$3,$4)
      `, [niveau, message, employeId, type]);
    } catch (e) { console.warn(`${LOG} alerte insert: ${e.message}`); }
  }
}

// ── Init tables ───────────────────────────────────────────────────────────
async function initTables() {
  if (!pool) return;
  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS kadio_rh_employes (
        id                  SERIAL PRIMARY KEY,
        prenom              VARCHAR(100) NOT NULL,
        nom                 VARCHAR(100),
        telephone           VARCHAR(20) NOT NULL UNIQUE,
        pin                 CHAR(4) NOT NULL DEFAULT '0000',
        poste               VARCHAR(100),
        heure_debut_quart   TIME DEFAULT '09:00',
        heure_fin_quart     TIME DEFAULT '17:00',
        echelon             VARCHAR(20) DEFAULT 'bronze',
        date_echelon_depuis TIMESTAMP DEFAULT NOW(),
        date_embauche       DATE DEFAULT CURRENT_DATE,
        date_probation_fin  DATE DEFAULT '2026-08-15',
        actif               BOOLEAN DEFAULT TRUE,
        video_vue_at        TIMESTAMP,
        reglement_signe_at  TIMESTAMP,
        created_at          TIMESTAMP DEFAULT NOW()
      );
      CREATE TABLE IF NOT EXISTS kadio_rh_kiosk_codes (
        id            SERIAL PRIMARY KEY,
        bucket_key    VARCHAR(40) UNIQUE NOT NULL,
        code          CHAR(4) NOT NULL,
        generated_at  TIMESTAMP NOT NULL,
        expires_at    TIMESTAMP NOT NULL
      );
      CREATE TABLE IF NOT EXISTS kadio_rh_pointages (
        id                        SERIAL PRIMARY KEY,
        employe_id                INT REFERENCES kadio_rh_employes(id) ON DELETE CASCADE,
        type                      VARCHAR(10) CHECK (type IN ('arrivee','depart')),
        heure_prevue              TIMESTAMP,
        heure_reelle              TIMESTAMP NOT NULL DEFAULT NOW(),
        retard_minutes            INT DEFAULT 0,
        raison_retard             TEXT,
        depart_premature_minutes  INT DEFAULT 0,
        created_at                TIMESTAMP DEFAULT NOW()
      );
      CREATE TABLE IF NOT EXISTS kadio_rh_pauses (
        id               SERIAL PRIMARY KEY,
        employe_id       INT REFERENCES kadio_rh_employes(id) ON DELETE CASCADE,
        debut            TIMESTAMP NOT NULL DEFAULT NOW(),
        fin              TIMESTAMP,
        duree_minutes    INT,
        alerte_envoyee   BOOLEAN DEFAULT FALSE,
        created_at       TIMESTAMP DEFAULT NOW()
      );
      CREATE TABLE IF NOT EXISTS kadio_rh_alertes (
        id          SERIAL PRIMARY KEY,
        niveau      VARCHAR(10) DEFAULT 'attention',
        message     TEXT NOT NULL,
        employe_id  INT REFERENCES kadio_rh_employes(id) ON DELETE SET NULL,
        type        VARCHAR(40),
        traitee     BOOLEAN DEFAULT FALSE,
        created_at  TIMESTAMP DEFAULT NOW()
      );
    `);
    console.log(`${LOG} Tables OK`);
  } catch (e) { console.warn(`${LOG} initTables: ${e.message}`); }
}
const dbReady = initTables();

// ── Cron : alertes proactives (pause > 70 min, absent non pointé) ──────────
// Grace period avant "absent" : 15 min après l'heure officielle sans pointage.
// Limite connue : ne tient pas compte des jours de fermeture du salon —
// à affiner avec un calendrier d'ouverture si des faux positifs apparaissent.
const ABSENCE_GRACE_MINUTES = 15;
let cronStarted = false;

async function checkAlertesProactives() {
  if (!pool || DEMO_MODE) return;
  try {
    const longPauses = await pool.query(`
      SELECT p.*, e.prenom FROM kadio_rh_pauses p
      JOIN kadio_rh_employes e ON e.id = p.employe_id
      WHERE p.fin IS NULL AND p.debut < NOW() - INTERVAL '70 minutes' AND p.alerte_envoyee = FALSE
    `);
    for (const p of longPauses.rows) {
      const dureeMinutes = Math.round((Date.now() - new Date(p.debut).getTime()) / 60000);
      await alertOwner(`${p.prenom} est en pause depuis ${dureeMinutes} minutes.`, p.employe_id, 'pause_longue', 'attention');
      await pool.query(`UPDATE kadio_rh_pauses SET alerte_envoyee=TRUE WHERE id=$1`, [p.id]);
    }

    const now = new Date();
    const employes = await pool.query(`SELECT * FROM kadio_rh_employes WHERE actif=TRUE`);
    for (const emp of employes.rows) {
      const [h, m] = (emp.heure_debut_quart || '09:00:00').split(':').map(Number);
      const officiel = new Date(now); officiel.setHours(h, m, 0, 0);
      const minutesApres = Math.round((now - officiel) / 60000);
      if (minutesApres < ABSENCE_GRACE_MINUTES) continue;

      const arrivedToday = await pool.query(`
        SELECT 1 FROM kadio_rh_pointages WHERE employe_id=$1 AND type='arrivee' AND heure_reelle::date = CURRENT_DATE
      `, [emp.id]);
      if (arrivedToday.rows.length) continue;

      const alreadyAlerted = await pool.query(`
        SELECT 1 FROM kadio_rh_alertes WHERE employe_id=$1 AND type='absent' AND created_at::date = CURRENT_DATE
      `, [emp.id]);
      if (alreadyAlerted.rows.length) continue;

      await alertOwner(`${emp.prenom} n'a pas pointé depuis ${minutesApres} min après son heure prévue.`, emp.id, 'absent', 'urgent');
    }
  } catch (e) { console.warn(`${LOG} checkAlertesProactives: ${e.message}`); }
}

function startCron() {
  if (cronStarted || !pool) return;
  cronStarted = true;
  setInterval(checkAlertesProactives, 5 * 60 * 1000);
  console.log(`${LOG} Cron alertes proactives démarré (scan 5 min)`);
}
startCron();

// ── Code kiosque — dérivé du créneau de 5 minutes courant, stateless-safe ──
// (Vercel = serverless : pas de setInterval persistant entre invocations,
// donc le code est recalculé/persisté par créneau plutôt que minuté en mémoire.)
function currentBucket() {
  const now = Date.now();
  const startMs = Math.floor(now / CODE_WINDOW_MS) * CODE_WINDOW_MS;
  const start = new Date(startMs);
  return { start, expires: new Date(startMs + CODE_WINDOW_MS), key: start.toISOString() };
}

async function getCurrentKioskCode() {
  const { start, expires, key } = currentBucket();
  const dateStr = key.slice(0, 10);

  if (!pool || DEMO_MODE) {
    // Mode démo : dérivation déterministe sans DB (pas de garantie d'unicité journalière)
    const h = crypto.createHash('sha256').update(key).digest();
    const code = String(h.readUInt16BE(0) % 10000).padStart(4, '0');
    return { code, expiresAt: expires };
  }

  const existing = await pool.query(`SELECT code, expires_at FROM kadio_rh_kiosk_codes WHERE bucket_key=$1`, [key]);
  if (existing.rows[0]) return { code: existing.rows[0].code, expiresAt: existing.rows[0].expires_at };

  let code, tries = 0, dup;
  do {
    code = String(crypto.randomInt(0, 10000)).padStart(4, '0');
    tries++;
    dup = await pool.query(`SELECT 1 FROM kadio_rh_kiosk_codes WHERE code=$1 AND bucket_key LIKE $2`, [code, dateStr + '%']);
  } while (dup.rows.length && tries < 50);

  await pool.query(`
    INSERT INTO kadio_rh_kiosk_codes (bucket_key, code, generated_at, expires_at)
    VALUES ($1,$2,$3,$4) ON CONFLICT (bucket_key) DO NOTHING
  `, [key, code, start, expires]);

  const row = await pool.query(`SELECT code, expires_at FROM kadio_rh_kiosk_codes WHERE bucket_key=$1`, [key]);
  return { code: row.rows[0].code, expiresAt: row.rows[0].expires_at };
}

router.get('/code-actuel', async (req, res) => {
  try {
    const { code, expiresAt } = await getCurrentKioskCode();
    res.json({ code, expiresAt });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── Identification employé ───────────────────────────────────────────────
function normalizePhone(phone = '') {
  let p = phone.replace(/[^\d+]/g, '');
  if (!p.startsWith('+') && p.length === 10) p = '+1' + p;
  else if (!p.startsWith('+') && p.length === 11 && p.startsWith('1')) p = '+' + p;
  return p;
}

async function findEmploye(telephone, prenom) {
  if (!pool || DEMO_MODE) return null;
  const tel = normalizePhone(telephone);
  const r = await pool.query(
    `SELECT * FROM kadio_rh_employes WHERE telephone=$1 AND actif=TRUE AND lower(prenom)=lower($2)`,
    [tel, (prenom || '').trim()]
  );
  return r.rows[0] || null;
}

router.post('/verifier-employe', async (req, res) => {
  const { telephone, prenom } = req.body || {};
  if (!telephone || !prenom) return res.status(400).json({ error: 'telephone et prenom requis' });

  if (!pool || DEMO_MODE) return res.json({ found: true, demo: true, employeId: 0, prenom });

  const employe = await findEmploye(telephone, prenom);
  if (!employe) return res.status(404).json({ error: 'Employé introuvable. Vérifiez le numéro et le prénom.' });
  res.json({ found: true, employeId: employe.id, prenom: employe.prenom });
});

function monthsAlertLabel(count) {
  return `Retard #${count} ce mois.`;
}

// ── Arrivée ───────────────────────────────────────────────────────────────
router.post('/arrivee', async (req, res) => {
  const { telephone, prenom, code, raison } = req.body || {};
  if (!telephone || !prenom || !code) return res.status(400).json({ error: 'telephone, prenom et code requis' });

  const { code: currentCode } = await getCurrentKioskCode();
  if (code !== currentCode) return res.status(401).json({ error: 'Code invalide ou expiré. Regardez l\'écran pour le code actuel.' });

  if (!pool || DEMO_MODE) {
    return res.json({ success: true, demo: true, message: `Bonjour ${prenom}, pointage enregistré (mode démo).` });
  }

  const employe = await findEmploye(telephone, prenom);
  if (!employe) return res.status(404).json({ error: 'Employé introuvable.' });

  const now = new Date();
  const [h, m] = (employe.heure_debut_quart || '09:00:00').split(':').map(Number);
  const officiel = new Date(now); officiel.setHours(h, m, 0, 0);

  const enRetard = now.getTime() >= officiel.getTime();
  const retardMinutes = enRetard ? Math.max(0, Math.round((now - officiel) / 60000)) : 0;

  if (enRetard && !raison) {
    return res.json({ success: false, retard: true, minutes: retardMinutes, needsReason: true,
      message: `Vous êtes en retard de ${retardMinutes} minute(s). Écrivez la raison avant de valider.` });
  }

  const r = await pool.query(`
    INSERT INTO kadio_rh_pointages (employe_id, type, heure_prevue, heure_reelle, retard_minutes, raison_retard)
    VALUES ($1,'arrivee',$2,$3,$4,$5) RETURNING *
  `, [employe.id, officiel, now, retardMinutes, enRetard ? raison : null]);

  if (enRetard) {
    const countRes = await pool.query(`
      SELECT COUNT(*) FROM kadio_rh_pointages
      WHERE employe_id=$1 AND type='arrivee' AND retard_minutes > 0
        AND date_trunc('month', heure_reelle) = date_trunc('month', NOW())
    `, [employe.id]);
    const n = parseInt(countRes.rows[0].count, 10);
    await alertOwner(
      `${employe.prenom} est arrivé(e) avec ${retardMinutes} min de retard. Raison : ${raison}. ${monthsAlertLabel(n)}`,
      employe.id, 'retard', 'attention'
    );
    await declencherSanctionRetard(employe, n);
  }

  res.json({
    success: true,
    pointage: r.rows[0],
    message: enRetard
      ? `Retard enregistré (${retardMinutes} min). Merci ${employe.prenom}.`
      : `Bonjour ${employe.prenom}, vous êtes arrivé(e) à l'heure.`,
  });
});

// ── Départ ────────────────────────────────────────────────────────────────
router.post('/depart', async (req, res) => {
  const { telephone, prenom, code } = req.body || {};
  if (!telephone || !prenom || !code) return res.status(400).json({ error: 'telephone, prenom et code requis' });

  const { code: currentCode } = await getCurrentKioskCode();
  if (code !== currentCode) return res.status(401).json({ error: 'Code invalide ou expiré. Regardez l\'écran pour le code actuel.' });

  if (!pool || DEMO_MODE) {
    return res.json({ success: true, demo: true, message: `Départ enregistré pour ${prenom} (mode démo).` });
  }

  const employe = await findEmploye(telephone, prenom);
  if (!employe) return res.status(404).json({ error: 'Employé introuvable.' });

  const now = new Date();
  const [h, m] = (employe.heure_fin_quart || '17:00:00').split(':').map(Number);
  const officiel = new Date(now); officiel.setHours(h, m, 0, 0);

  const departPrematureMinutes = Math.max(0, Math.round((officiel - now) / 60000));
  const departPremature = departPrematureMinutes > 60;

  const r = await pool.query(`
    INSERT INTO kadio_rh_pointages (employe_id, type, heure_prevue, heure_reelle, depart_premature_minutes)
    VALUES ($1,'depart',$2,$3,$4) RETURNING *
  `, [employe.id, officiel, now, departPrematureMinutes]);

  if (departPremature) {
    await alertOwner(
      `${employe.prenom} a pointé son départ ${Math.round(departPrematureMinutes / 60)}h avant la fin prévue.`,
      employe.id, 'depart_premature', 'attention'
    );
  }

  res.json({ success: true, pointage: r.rows[0], message: `Bonne route, ${employe.prenom} !` });
});

// ── Pauses ────────────────────────────────────────────────────────────────
router.post('/pause/debut', async (req, res) => {
  const { telephone, prenom } = req.body || {};
  if (!telephone || !prenom) return res.status(400).json({ error: 'telephone et prenom requis' });

  if (!pool || DEMO_MODE) return res.json({ success: true, demo: true });

  const employe = await findEmploye(telephone, prenom);
  if (!employe) return res.status(404).json({ error: 'Employé introuvable.' });

  const r = await pool.query(`
    INSERT INTO kadio_rh_pauses (employe_id, debut) VALUES ($1, NOW()) RETURNING *
  `, [employe.id]);

  res.json({ success: true, pause: r.rows[0], message: `Bonne pause, ${employe.prenom}.` });
});

router.post('/pause/fin', async (req, res) => {
  const { telephone, prenom } = req.body || {};
  if (!telephone || !prenom) return res.status(400).json({ error: 'telephone et prenom requis' });

  if (!pool || DEMO_MODE) return res.json({ success: true, demo: true });

  const employe = await findEmploye(telephone, prenom);
  if (!employe) return res.status(404).json({ error: 'Employé introuvable.' });

  const open = await pool.query(`
    SELECT * FROM kadio_rh_pauses WHERE employe_id=$1 AND fin IS NULL ORDER BY debut DESC LIMIT 1
  `, [employe.id]);
  if (!open.rows[0]) return res.status(400).json({ error: 'Aucune pause en cours.' });

  const dureeMinutes = Math.max(0, Math.round((Date.now() - new Date(open.rows[0].debut).getTime()) / 60000));
  const r = await pool.query(`
    UPDATE kadio_rh_pauses SET fin=NOW(), duree_minutes=$1 WHERE id=$2 RETURNING *
  `, [dureeMinutes, open.rows[0].id]);

  if (dureeMinutes > 70) {
    await alertOwner(`${employe.prenom} est en pause depuis ${dureeMinutes} minutes.`, employe.id, 'pause_longue', 'attention');
    await declencherSanctionPauseLongue(employe.id, `Pause de ${dureeMinutes} min (limite 60 min, autorisation non confirmée)`);
  }

  res.json({ success: true, pause: r.rows[0], message: `Bon retour, ${employe.prenom}. Pause de ${dureeMinutes} min.` });
});

module.exports = router;
module.exports.dbReady = dbReady;
