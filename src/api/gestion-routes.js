'use strict';
/**
 * DALEBA — Gestion Salon (kadio-gestion)
 * Admin uniquement — Clients, Employés, Parrainages, Références, Notations
 * POST /api/gestion/notations : note ≤3 → SMS alerte staff | note ≥4 → SMS lien avis Google
 */

const express = require('express');
const router  = express.Router();
const { requireAuth, requireRole, ROLES } = require('../middleware/auth');

const LOG = '[GESTION]';

// ── DB ─────────────────────────────────────────────────────────────────────
let pool = null, DEMO_MODE = true;
try { const db = require('../memory/db'); pool = db.pool; DEMO_MODE = db.DEMO_MODE; } catch (e) {}

// ── Twilio (compte + numéro déjà configurés via env, voir src/services/twilio.js) ──
let sendSMS = null;
try { sendSMS = require('../services/twilio').sendSMS; } catch (e) {}

// Numéros d'alerte staff (note ≤3) — 514-919-5970 / 514-984-5970
const ALERT_PHONES = (process.env.GESTION_ALERT_PHONES || '+15149195970,+15149845970')
  .split(',').map(s => s.trim()).filter(Boolean);

const GOOGLE_REVIEW_LINK = process.env.GESTION_GOOGLE_REVIEW_LINK
  || 'https://g.page/r/CekIGz7Cw580EBE/review';

async function sms(to, body, type, notationId = null) {
  let status = 'demo', sid = null, erreur = null;
  if (sendSMS) {
    try {
      const r = await sendSMS(to, body);
      status = r?.status || 'envoye';
      sid = r?.sid || null;
    } catch (e) {
      status = 'echec';
      erreur = e.message;
      console.error(`${LOG} SMS error → ${to}: ${e.message}`);
    }
  } else {
    console.log(`${LOG} [SMS-DEMO] → ${to}: ${body}`);
  }

  if (pool && !DEMO_MODE) {
    try {
      await pool.query(`
        INSERT INTO kadio_gestion_sms_log (destinataire, message, type, notation_id, twilio_sid, statut, erreur)
        VALUES ($1,$2,$3,$4,$5,$6,$7)
      `, [to, body, type, notationId, sid, status, erreur]);
    } catch (e) { console.warn(`${LOG} sms_log insert: ${e.message}`); }
  }

  return { status, sid, erreur };
}

// ── Init tables ───────────────────────────────────────────────────────────
async function initTables() {
  if (!pool) return;
  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS kadio_gestion_clients (
        id          SERIAL PRIMARY KEY,
        nom         VARCHAR(150) NOT NULL,
        telephone   VARCHAR(20),
        email       VARCHAR(150),
        notes       TEXT,
        actif       BOOLEAN DEFAULT TRUE,
        created_at  TIMESTAMP DEFAULT NOW(),
        updated_at  TIMESTAMP DEFAULT NOW()
      );
      CREATE TABLE IF NOT EXISTS kadio_gestion_employes (
        id          SERIAL PRIMARY KEY,
        nom         VARCHAR(150) NOT NULL,
        telephone   VARCHAR(20),
        email       VARCHAR(150),
        poste       VARCHAR(100),
        actif       BOOLEAN DEFAULT TRUE,
        created_at  TIMESTAMP DEFAULT NOW()
      );
      CREATE TABLE IF NOT EXISTS kadio_gestion_parrainages (
        id                  SERIAL PRIMARY KEY,
        parrain_client_id   INT REFERENCES kadio_gestion_clients(id) ON DELETE SET NULL,
        filleul_nom         VARCHAR(150),
        filleul_telephone   VARCHAR(20),
        filleul_client_id   INT REFERENCES kadio_gestion_clients(id) ON DELETE SET NULL,
        recompense          VARCHAR(150),
        statut              VARCHAR(20) DEFAULT 'en_attente',
        created_at          TIMESTAMP DEFAULT NOW()
      );
      CREATE TABLE IF NOT EXISTS kadio_gestion_references (
        id             SERIAL PRIMARY KEY,
        employe_id     INT REFERENCES kadio_gestion_employes(id) ON DELETE CASCADE,
        nom_reference  VARCHAR(150),
        telephone      VARCHAR(20),
        relation       VARCHAR(100),
        commentaire    TEXT,
        created_at     TIMESTAMP DEFAULT NOW()
      );
      CREATE TABLE IF NOT EXISTS kadio_gestion_notations (
        id                SERIAL PRIMARY KEY,
        client_id         INT REFERENCES kadio_gestion_clients(id) ON DELETE SET NULL,
        client_nom        VARCHAR(150),
        client_telephone  VARCHAR(20),
        employe_id        INT REFERENCES kadio_gestion_employes(id) ON DELETE SET NULL,
        note              INT CHECK (note BETWEEN 1 AND 5),
        commentaire       TEXT,
        sms_type          VARCHAR(20),
        created_at        TIMESTAMP DEFAULT NOW()
      );
      CREATE TABLE IF NOT EXISTS kadio_gestion_sms_log (
        id            SERIAL PRIMARY KEY,
        destinataire  VARCHAR(20),
        message       TEXT,
        type          VARCHAR(30),
        notation_id   INT REFERENCES kadio_gestion_notations(id) ON DELETE SET NULL,
        twilio_sid    VARCHAR(60),
        statut        VARCHAR(20),
        erreur        TEXT,
        created_at    TIMESTAMP DEFAULT NOW()
      );
    `);
    console.log(`${LOG} Tables OK`);
  } catch (e) { console.warn(`${LOG} initTables: ${e.message}`); }
}
initTables();

// ── Auth : admin uniquement (business_admin ou super_admin) ────────────────
router.use(requireAuth, requireRole(ROLES.BUSINESS_ADMIN));

// ═══════════════════════ CLIENTS ═══════════════════════════════════════════
router.get('/clients', async (req, res) => {
  if (!pool || DEMO_MODE) return res.json({ clients: [], demo: true });
  try {
    const r = await pool.query(`SELECT * FROM kadio_gestion_clients ORDER BY created_at DESC LIMIT 500`);
    res.json({ clients: r.rows });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.post('/clients', async (req, res) => {
  const { nom, telephone, email, notes } = req.body;
  if (!nom) return res.status(400).json({ error: 'nom requis' });
  if (!pool || DEMO_MODE) return res.json({ success: true, demo: true });
  try {
    const r = await pool.query(`
      INSERT INTO kadio_gestion_clients (nom, telephone, email, notes) VALUES ($1,$2,$3,$4) RETURNING *
    `, [nom, telephone || null, email || null, notes || null]);
    res.status(201).json({ success: true, client: r.rows[0] });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.put('/clients/:id', async (req, res) => {
  const { nom, telephone, email, notes, actif } = req.body;
  if (!pool || DEMO_MODE) return res.json({ success: true, demo: true });
  try {
    const r = await pool.query(`
      UPDATE kadio_gestion_clients SET
        nom=COALESCE($1,nom), telephone=COALESCE($2,telephone), email=COALESCE($3,email),
        notes=COALESCE($4,notes), actif=COALESCE($5,actif), updated_at=NOW()
      WHERE id=$6 RETURNING *
    `, [nom, telephone, email, notes, actif, req.params.id]);
    if (!r.rows[0]) return res.status(404).json({ error: 'Client introuvable' });
    res.json({ success: true, client: r.rows[0] });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.delete('/clients/:id', async (req, res) => {
  if (!pool || DEMO_MODE) return res.json({ success: true, demo: true });
  try {
    await pool.query(`DELETE FROM kadio_gestion_clients WHERE id=$1`, [req.params.id]);
    res.json({ success: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ═══════════════════════ EMPLOYÉS ══════════════════════════════════════════
router.get('/employes', async (req, res) => {
  if (!pool || DEMO_MODE) return res.json({ employes: [], demo: true });
  try {
    const r = await pool.query(`SELECT * FROM kadio_gestion_employes ORDER BY created_at DESC LIMIT 500`);
    res.json({ employes: r.rows });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.post('/employes', async (req, res) => {
  const { nom, telephone, email, poste } = req.body;
  if (!nom) return res.status(400).json({ error: 'nom requis' });
  if (!pool || DEMO_MODE) return res.json({ success: true, demo: true });
  try {
    const r = await pool.query(`
      INSERT INTO kadio_gestion_employes (nom, telephone, email, poste) VALUES ($1,$2,$3,$4) RETURNING *
    `, [nom, telephone || null, email || null, poste || null]);
    res.status(201).json({ success: true, employe: r.rows[0] });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.put('/employes/:id', async (req, res) => {
  const { nom, telephone, email, poste, actif } = req.body;
  if (!pool || DEMO_MODE) return res.json({ success: true, demo: true });
  try {
    const r = await pool.query(`
      UPDATE kadio_gestion_employes SET
        nom=COALESCE($1,nom), telephone=COALESCE($2,telephone), email=COALESCE($3,email),
        poste=COALESCE($4,poste), actif=COALESCE($5,actif)
      WHERE id=$6 RETURNING *
    `, [nom, telephone, email, poste, actif, req.params.id]);
    if (!r.rows[0]) return res.status(404).json({ error: 'Employé introuvable' });
    res.json({ success: true, employe: r.rows[0] });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.delete('/employes/:id', async (req, res) => {
  if (!pool || DEMO_MODE) return res.json({ success: true, demo: true });
  try {
    await pool.query(`DELETE FROM kadio_gestion_employes WHERE id=$1`, [req.params.id]);
    res.json({ success: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ═══════════════════════ PARRAINAGES ═══════════════════════════════════════
router.get('/parrainages', async (req, res) => {
  if (!pool || DEMO_MODE) return res.json({ parrainages: [], demo: true });
  try {
    const r = await pool.query(`SELECT * FROM kadio_gestion_parrainages ORDER BY created_at DESC LIMIT 500`);
    res.json({ parrainages: r.rows });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.post('/parrainages', async (req, res) => {
  const { parrainClientId, filleulNom, filleulTelephone, recompense } = req.body;
  if (!parrainClientId || !filleulNom) return res.status(400).json({ error: 'parrainClientId et filleulNom requis' });
  if (!pool || DEMO_MODE) return res.json({ success: true, demo: true });
  try {
    const r = await pool.query(`
      INSERT INTO kadio_gestion_parrainages (parrain_client_id, filleul_nom, filleul_telephone, recompense)
      VALUES ($1,$2,$3,$4) RETURNING *
    `, [parrainClientId, filleulNom, filleulTelephone || null, recompense || null]);
    res.status(201).json({ success: true, parrainage: r.rows[0] });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.patch('/parrainages/:id', async (req, res) => {
  const { statut, filleulClientId } = req.body;
  if (!pool || DEMO_MODE) return res.json({ success: true, demo: true });
  try {
    const r = await pool.query(`
      UPDATE kadio_gestion_parrainages SET
        statut=COALESCE($1,statut), filleul_client_id=COALESCE($2,filleul_client_id)
      WHERE id=$3 RETURNING *
    `, [statut, filleulClientId, req.params.id]);
    if (!r.rows[0]) return res.status(404).json({ error: 'Parrainage introuvable' });
    res.json({ success: true, parrainage: r.rows[0] });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ═══════════════════════ RÉFÉRENCES (employés) ═════════════════════════════
router.get('/references', async (req, res) => {
  if (!pool || DEMO_MODE) return res.json({ references: [], demo: true });
  try {
    const { employeId } = req.query;
    let query = `SELECT * FROM kadio_gestion_references`;
    const params = [];
    if (employeId) { query += ` WHERE employe_id=$1`; params.push(employeId); }
    query += ` ORDER BY created_at DESC LIMIT 500`;
    const r = await pool.query(query, params);
    res.json({ references: r.rows });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.post('/references', async (req, res) => {
  const { employeId, nomReference, telephone, relation, commentaire } = req.body;
  if (!employeId || !nomReference) return res.status(400).json({ error: 'employeId et nomReference requis' });
  if (!pool || DEMO_MODE) return res.json({ success: true, demo: true });
  try {
    const r = await pool.query(`
      INSERT INTO kadio_gestion_references (employe_id, nom_reference, telephone, relation, commentaire)
      VALUES ($1,$2,$3,$4,$5) RETURNING *
    `, [employeId, nomReference, telephone || null, relation || null, commentaire || null]);
    res.status(201).json({ success: true, reference: r.rows[0] });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ═══════════════════════ NOTATIONS (+ SMS auto) ════════════════════════════
// note ≤3 → SMS alerte vers les numéros staff configurés
// note ≥4 → SMS lien avis Google au client
router.get('/notations', async (req, res) => {
  if (!pool || DEMO_MODE) return res.json({ notations: [], demo: true });
  try {
    const r = await pool.query(`SELECT * FROM kadio_gestion_notations ORDER BY created_at DESC LIMIT 500`);
    res.json({ notations: r.rows });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.post('/notations', async (req, res) => {
  const { clientId, clientNom, clientTelephone, employeId, note, commentaire } = req.body;
  const n = parseInt(note, 10);
  if (!n || n < 1 || n > 5) return res.status(400).json({ error: 'note doit être entre 1 et 5' });

  const smsType = n >= 4 ? 'google' : 'alerte';

  let notationRow = { id: null, client_nom: clientNom, note: n };
  if (pool && !DEMO_MODE) {
    try {
      const r = await pool.query(`
        INSERT INTO kadio_gestion_notations (client_id, client_nom, client_telephone, employe_id, note, commentaire, sms_type)
        VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *
      `, [clientId || null, clientNom || null, clientTelephone || null, employeId || null, n, commentaire || null, smsType]);
      notationRow = r.rows[0];
    } catch (e) { console.warn(`${LOG} notations insert: ${e.message}`); }
  }

  const smsResults = [];
  if (n >= 4) {
    if (clientTelephone) {
      const msg = `Merci pour votre visite chez Kadio Coiffure ! Votre satisfaction est notre fierté. Partagez votre expérience sur Google : ${GOOGLE_REVIEW_LINK}`;
      smsResults.push({ to: clientTelephone, ...(await sms(clientTelephone, msg, 'demande_avis_google', notationRow.id)) });
    }
  } else {
    const nameStr = clientNom || 'Client';
    const msg = `ALERTE QUALITÉ KADIO : ${nameStr} a laissé une note de ${n}/5. Commentaire : "${(commentaire || 'Aucun commentaire').slice(0, 120)}". Veuillez intervenir en privé rapidement.`;
    for (const phone of ALERT_PHONES) {
      smsResults.push({ to: phone, ...(await sms(phone, msg, 'alerte_note_basse', notationRow.id)) });
    }
  }

  console.log(`${LOG} Notation ${n}/5 — type:${smsType} — SMS envoyés:${smsResults.length}`);
  res.status(201).json({ success: true, notation: notationRow, smsType, smsResults });
});

// ═══════════════════════ SMS LOG ═══════════════════════════════════════════
router.get('/sms-log', async (req, res) => {
  if (!pool || DEMO_MODE) return res.json({ smsLog: [], demo: true });
  try {
    const r = await pool.query(`SELECT * FROM kadio_gestion_sms_log ORDER BY created_at DESC LIMIT 500`);
    res.json({ smsLog: r.rows });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

module.exports = router;
