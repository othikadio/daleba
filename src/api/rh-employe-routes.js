'use strict';
/**
 * KADIO RH — Module 7 : Page employé numérique personnelle
 * Cahier des charges Kadio Coiffure & Esthétique — Section 9
 *
 * Auth : téléphone + PIN personnel (distinct du code kiosque rotatif).
 * Chaque employé ne voit que ses propres données.
 *
 * Certaines sections (notes clients, tâches, sanctions, récompenses,
 * checklist service) dépendent des Modules 2/3/4/5/6/8, pas encore
 * construits — les tables existent déjà (lecture prête) mais restent
 * vides tant que ces modules n'écrivent pas dedans. Le score du mois
 * se calcule uniquement sur les composantes disponibles (voir
 * computeScoreMensuel) plutôt que de pénaliser à tort avec des zéros.
 */

const express = require('express');
const router  = express.Router();
const { generateToken, verifyToken } = require('../middleware/auth');

const LOG = '[RH-EMPLOYE]';

let pool = null, DEMO_MODE = true;
try { const db = require('../memory/db'); pool = db.pool; DEMO_MODE = db.DEMO_MODE; } catch (e) {}

// kadio_rh_employes est créée par pointage-routes.js — plusieurs tables ici ont
// une clé étrangère dessus, donc on attend qu'elle existe avant de créer les nôtres.
let pointageDbReady = Promise.resolve();
try { pointageDbReady = require('./pointage-routes').dbReady || Promise.resolve(); } catch (e) {}

const REGLEMENT_INTERIEUR = `RÈGLEMENT INTÉRIEUR — KADIO COIFFURE & ESTHÉTIQUE
En vigueur depuis le 15 juin 2026

Règle 1 — Arrivée 5 minutes avant
Chaque employé doit arriver 5 minutes AVANT son heure officielle de prise de poste, pour :
allumer la musique/télévision, s'assurer que le salon sent bon, vérifier que les postes de
travail sont propres et prêts, préparer les boissons et grignotines, se préparer à recevoir les clients.
Arriver exactement à l'heure officielle = retard. Arriver 5 minutes avant = la norme.

Règle 2 — Pause de 60 minutes
Chaque employé a droit à une pause de 60 minutes par jour (un droit, pas un privilège).
La pause se déclare dans le système. Les employés s'organisent pour que le salon ne soit
jamais vide. Une pause de plus de 70 minutes sans autorisation déclenche une alerte au
propriétaire. Au-delà de 60 minutes sans autorisation, le temps supplémentaire n'est pas rémunéré.

Règle 3 — Comportement général
Téléphone personnel interdit quand un client est dans la chaise. Tenue propre, soignée et
professionnelle chaque jour. Aucun commentaire négatif en zone client. Le salon doit toujours
sentir bon. Musique ou télévision allumée avant l'arrivée du premier client.

Règle 4 — Esprit d'équipe
Les tâches ménagères sont collectives — si elles ne sont pas faites, toute l'équipe est
sanctionnée. Les employés s'entraident — si un collègue est en retard, l'équipe couvre en attendant.

Système de sanctions progressif (3 paliers) :
1re sanction → avertissement écrit + descente d'un échelon.
2e sanction → 1 journée sans salaire + avertissement écrit + descente d'un échelon supplémentaire.
3e sanction → fin d'emploi.
Au Québec, les retenues salariales à titre de pénalité sont encadrées par la Loi sur les
normes du travail. Ce règlement doit être signé avant application.`;

// ── Init tables (Modules 2/3/5/6/8 — schémas prêts, logique à venir) ───────
async function initTables() {
  if (!pool) return;
  await pointageDbReady.catch(() => {});
  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS kadio_rh_notations_client (
        id             SERIAL PRIMARY KEY,
        employe_id     INT REFERENCES kadio_rh_employes(id) ON DELETE CASCADE,
        client_nom     VARCHAR(150),
        client_telephone VARCHAR(20),
        accueil        INT CHECK (accueil BETWEEN 1 AND 5),
        qualite        INT CHECK (qualite BETWEEN 1 AND 5),
        proprete       INT CHECK (proprete BETWEEN 1 AND 5),
        ambiance       INT CHECK (ambiance BETWEEN 1 AND 5),
        commentaire    TEXT,
        google_sms_type VARCHAR(20),
        created_at     TIMESTAMP DEFAULT NOW()
      );
      CREATE TABLE IF NOT EXISTS kadio_rh_notations_coiffeur (
        id            SERIAL PRIMARY KEY,
        employe_id    INT REFERENCES kadio_rh_employes(id) ON DELETE CASCADE,
        client_nom    VARCHAR(150),
        ponctualite   INT CHECK (ponctualite BETWEEN 1 AND 5),
        comportement  INT CHECK (comportement BETWEEN 1 AND 5),
        respect       INT CHECK (respect BETWEEN 1 AND 5),
        commentaire   TEXT,
        created_at    TIMESTAMP DEFAULT NOW()
      );
      CREATE TABLE IF NOT EXISTS kadio_rh_sanctions (
        id              SERIAL PRIMARY KEY,
        employe_id      INT REFERENCES kadio_rh_employes(id) ON DELETE CASCADE,
        palier          INT NOT NULL,
        motif           TEXT NOT NULL,
        type            VARCHAR(40),
        echelon_avant   VARCHAR(20),
        echelon_apres   VARCHAR(20),
        created_at      TIMESTAMP DEFAULT NOW()
      );
      CREATE TABLE IF NOT EXISTS kadio_rh_recompenses (
        id            SERIAL PRIMARY KEY,
        employe_id    INT REFERENCES kadio_rh_employes(id) ON DELETE CASCADE,
        type          VARCHAR(40) NOT NULL,
        montant       NUMERIC(8,2),
        description   TEXT,
        created_at    TIMESTAMP DEFAULT NOW()
      );
      CREATE TABLE IF NOT EXISTS kadio_rh_taches_log (
        id                    SERIAL PRIMARY KEY,
        tache_nom             VARCHAR(150) NOT NULL,
        frequence             VARCHAR(20),
        date_tache            DATE NOT NULL DEFAULT CURRENT_DATE,
        coche_par_employe_id  INT REFERENCES kadio_rh_employes(id) ON DELETE SET NULL,
        coche_at              TIMESTAMP DEFAULT NOW()
      );
      CREATE TABLE IF NOT EXISTS kadio_rh_checklist_service (
        id            SERIAL PRIMARY KEY,
        employe_id    INT REFERENCES kadio_rh_employes(id) ON DELETE CASCADE,
        accueil_sourire      BOOLEAN DEFAULT FALSE,
        guide_place          BOOLEAN DEFAULT FALSE,
        boisson_proposee     BOOLEAN DEFAULT FALSE,
        grignotines_proposees BOOLEAN DEFAULT FALSE,
        attente_annoncee     BOOLEAN DEFAULT FALSE,
        telephone_range      BOOLEAN DEFAULT FALSE,
        created_at    TIMESTAMP DEFAULT NOW()
      );
    `);
    console.log(`${LOG} Tables OK`);
  } catch (e) { console.warn(`${LOG} initTables: ${e.message}`); }
}
const dbReady = initTables();

function normalizePhone(phone = '') {
  let p = phone.replace(/[^\d+]/g, '');
  if (!p.startsWith('+') && p.length === 10) p = '+1' + p;
  else if (!p.startsWith('+') && p.length === 11 && p.startsWith('1')) p = '+' + p;
  return p;
}

// ── Auth téléphone + PIN ─────────────────────────────────────────────────
router.post('/connexion', async (req, res) => {
  const { telephone, pin } = req.body || {};
  if (!telephone || !pin) return res.status(400).json({ error: 'telephone et pin requis' });

  if (!pool || DEMO_MODE) {
    const token = generateToken({ employeId: 0, role: 'employe_rh', prenom: 'Démo' }, '12h');
    return res.json({ success: true, demo: true, token, employe: { id: 0, prenom: 'Démo', echelon: 'bronze' } });
  }

  const r = await pool.query(
    `SELECT * FROM kadio_rh_employes WHERE telephone=$1 AND pin=$2 AND actif=TRUE`,
    [normalizePhone(telephone), pin]
  );
  const employe = r.rows[0];
  if (!employe) return res.status(401).json({ error: 'Téléphone ou code PIN incorrect' });

  const token = generateToken({ employeId: employe.id, role: 'employe_rh', prenom: employe.prenom }, '12h');
  res.json({
    success: true, token,
    employe: { id: employe.id, prenom: employe.prenom, nom: employe.nom, echelon: employe.echelon,
      video_vue: !!employe.video_vue_at, reglement_signe: !!employe.reglement_signe_at },
  });
});

// ── Middleware : session employé (auto-accès uniquement à ses données) ────
function requireEmploye(req, res, next) {
  const authHeader = req.headers.authorization;
  const token = authHeader?.startsWith('Bearer ') ? authHeader.slice(7) : null;
  if (!token) return res.status(401).json({ error: 'Token requis' });
  try {
    const decoded = verifyToken(token);
    if (decoded.role !== 'employe_rh') return res.status(403).json({ error: 'Accès réservé aux employés' });
    req.employeId = decoded.employeId;
    next();
  } catch (e) { return res.status(401).json({ error: 'Session expirée — reconnectez-vous' }); }
}
router.use(requireEmploye);

// ── Échelons — infos statiques (progression automatique = Module 2) ───────
const ECHELONS = [
  { cle: 'bronze', label: '🥉 Bronze', suivant: 'argent',
    condition: 'Point de départ — tout le monde commence ici.' },
  { cle: 'argent', label: '🥈 Argent', suivant: 'or',
    condition: '3 semaines consécutives sans sanction + note clients moyenne ≥ 4/5.' },
  { cle: 'or', label: '🥇 Or', suivant: 'platine',
    condition: '6 semaines consécutives de constance, aucune sanction, note clients ≥ 4/5.' },
  { cle: 'platine', label: '💎 Platine', suivant: null,
    condition: 'Maintien de l\'Or pendant 2 mois complets + avoir été Employé du Mois au moins une fois.' },
];

// ── Score du mois — uniquement sur les composantes disponibles ────────────
async function computeScoreMensuel(employeId, ref = new Date()) {
  if (!pool || DEMO_MODE) return { total: 0, demo: true, composantsDisponibles: [], composantsManquants: ['tout'] };

  const notesRes = await pool.query(`
    SELECT AVG((accueil+qualite+proprete+ambiance)/4.0) AS avg, COUNT(*) AS n
    FROM kadio_rh_notations_client
    WHERE employe_id=$1 AND date_trunc('month', created_at) = date_trunc('month', $2::timestamp)
  `, [employeId, ref]);
  const noteAvg = parseInt(notesRes.rows[0].n, 10) > 0 ? parseFloat(notesRes.rows[0].avg) : null;

  const arrRes = await pool.query(`
    SELECT COUNT(*) FILTER (WHERE retard_minutes = 0) AS a_temps, COUNT(*) AS total
    FROM kadio_rh_pointages
    WHERE employe_id=$1 AND type='arrivee' AND date_trunc('month', heure_reelle) = date_trunc('month', $2::timestamp)
  `, [employeId, ref]);
  const totalArr = parseInt(arrRes.rows[0].total, 10);
  const aTemps = parseInt(arrRes.rows[0].a_temps, 10);

  const checklistRes = await pool.query(`
    SELECT
      AVG(CASE WHEN accueil_sourire AND guide_place AND boisson_proposee
               AND grignotines_proposees AND attente_annoncee AND telephone_range
          THEN 100.0 ELSE (
            (accueil_sourire::int + guide_place::int + boisson_proposee::int +
             grignotines_proposees::int + attente_annoncee::int + telephone_range::int) / 6.0 * 100
          ) END) AS avg,
      COUNT(*) AS n
    FROM kadio_rh_checklist_service
    WHERE employe_id=$1 AND date_trunc('month', created_at) = date_trunc('month', $2::timestamp)
  `, [employeId, ref]);
  const checklistAvg = parseInt(checklistRes.rows[0].n, 10) > 0 ? parseFloat(checklistRes.rows[0].avg) : null;

  // Tâches ménagères : collectives (équipe), pas encore de calcul individuel formalisé (Module 4).
  const composants = [];
  if (noteAvg !== null) composants.push({ nom: 'notes_clients', poids: 0.35, valeur: (noteAvg / 5) * 100 });
  if (totalArr > 0) composants.push({ nom: 'ponctualite', poids: 0.25, valeur: (aTemps / totalArr) * 100 });
  if (checklistAvg !== null) composants.push({ nom: 'checklist_service', poids: 0.20, valeur: checklistAvg });

  const tousComposants = ['notes_clients', 'ponctualite', 'taches_menageres', 'checklist_service'];
  const poidsTotal = composants.reduce((s, c) => s + c.poids, 0);
  const total = poidsTotal > 0 ? composants.reduce((s, c) => s + c.poids * c.valeur, 0) / poidsTotal : 0;

  return {
    total: Math.round(total * 10) / 10,
    partiel: poidsTotal < 1,
    composantsDisponibles: composants.map(c => ({ nom: c.nom, score: Math.round(c.valeur * 10) / 10 })),
    composantsManquants: tousComposants.filter(n => !composants.some(c => c.nom === n)),
  };
}

// ── Profil ────────────────────────────────────────────────────────────────
router.get('/moi', async (req, res) => {
  if (!pool || DEMO_MODE) {
    return res.json({ employe: { id: 0, prenom: 'Démo', echelon: 'bronze' }, demo: true });
  }
  const r = await pool.query(`SELECT * FROM kadio_rh_employes WHERE id=$1`, [req.employeId]);
  const employe = r.rows[0];
  if (!employe) return res.status(404).json({ error: 'Employé introuvable' });
  const echelonInfo = ECHELONS.find(e => e.cle === employe.echelon) || ECHELONS[0];
  res.json({
    employe: {
      id: employe.id, prenom: employe.prenom, nom: employe.nom, poste: employe.poste,
      echelon: employe.echelon, date_embauche: employe.date_embauche,
      date_probation_fin: employe.date_probation_fin,
      video_vue: !!employe.video_vue_at, reglement_signe: !!employe.reglement_signe_at,
    },
    echelonActuel: echelonInfo,
    prochainEchelon: ECHELONS.find(e => e.cle === echelonInfo.suivant) || null,
  });
});

// ── Pointages de la semaine ───────────────────────────────────────────────
router.get('/pointages-semaine', async (req, res) => {
  if (!pool || DEMO_MODE) return res.json({ pointages: [], pauses: [], demo: true });
  const pointages = await pool.query(`
    SELECT * FROM kadio_rh_pointages WHERE employe_id=$1 AND heure_reelle > NOW() - INTERVAL '7 days'
    ORDER BY heure_reelle DESC
  `, [req.employeId]);
  const pauses = await pool.query(`
    SELECT * FROM kadio_rh_pauses WHERE employe_id=$1 AND debut > NOW() - INTERVAL '7 days'
    ORDER BY debut DESC
  `, [req.employeId]);
  res.json({ pointages: pointages.rows, pauses: pauses.rows });
});

// ── Score du mois + classement ────────────────────────────────────────────
router.get('/score-mois', async (req, res) => {
  try {
    const score = await computeScoreMensuel(req.employeId);
    res.json(score);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.get('/classement', async (req, res) => {
  if (!pool || DEMO_MODE) return res.json({ rang: 1, total: 1, demo: true });
  try {
    const employes = await pool.query(`SELECT id FROM kadio_rh_employes WHERE actif=TRUE`);
    const scores = [];
    for (const e of employes.rows) {
      const s = await computeScoreMensuel(e.id);
      scores.push({ employeId: e.id, total: s.total });
    }
    scores.sort((a, b) => b.total - a.total);
    const rang = scores.findIndex(s => s.employeId === req.employeId) + 1;
    res.json({ rang: rang || null, total: scores.length, classement: scores });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── Notes clients reçues ──────────────────────────────────────────────────
router.get('/notes', async (req, res) => {
  if (!pool || DEMO_MODE) return res.json({ notes: [], demo: true });
  const r = await pool.query(`
    SELECT * FROM kadio_rh_notations_client WHERE employe_id=$1 ORDER BY created_at DESC LIMIT 100
  `, [req.employeId]);
  res.json({ notes: r.rows });
});

// ── Tâches cochées par cet employé ────────────────────────────────────────
router.get('/taches', async (req, res) => {
  if (!pool || DEMO_MODE) return res.json({ taches: [], demo: true });
  const r = await pool.query(`
    SELECT * FROM kadio_rh_taches_log WHERE coche_par_employe_id=$1 ORDER BY coche_at DESC LIMIT 100
  `, [req.employeId]);
  res.json({ taches: r.rows });
});

// ── Sanctions et récompenses ───────────────────────────────────────────────
router.get('/sanctions', async (req, res) => {
  if (!pool || DEMO_MODE) return res.json({ sanctions: [], demo: true });
  const r = await pool.query(`
    SELECT * FROM kadio_rh_sanctions WHERE employe_id=$1 ORDER BY created_at DESC
  `, [req.employeId]);
  res.json({ sanctions: r.rows });
});

router.get('/recompenses', async (req, res) => {
  if (!pool || DEMO_MODE) return res.json({ recompenses: [], demo: true });
  const r = await pool.query(`
    SELECT * FROM kadio_rh_recompenses WHERE employe_id=$1 ORDER BY created_at DESC
  `, [req.employeId]);
  res.json({ recompenses: r.rows });
});

// ── Règlement intérieur ────────────────────────────────────────────────────
router.get('/reglement', async (req, res) => {
  if (!pool || DEMO_MODE) return res.json({ texte: REGLEMENT_INTERIEUR, signe: false, demo: true });
  const r = await pool.query(`SELECT reglement_signe_at FROM kadio_rh_employes WHERE id=$1`, [req.employeId]);
  res.json({ texte: REGLEMENT_INTERIEUR, signe: !!r.rows[0]?.reglement_signe_at, signeAt: r.rows[0]?.reglement_signe_at || null });
});

router.post('/reglement/signer', async (req, res) => {
  if (!pool || DEMO_MODE) return res.json({ success: true, demo: true });
  await pool.query(`
    UPDATE kadio_rh_employes SET reglement_signe_at = COALESCE(reglement_signe_at, NOW()) WHERE id=$1
  `, [req.employeId]);
  res.json({ success: true });
});

// ── Vidéo explicative ───────────────────────────────────────────────────────
// URL réelle à fournir (RH_VIDEO_URL) — aucune vidéo n'a été fournie avec le
// cahier des charges, donc pas de contenu inventé ici, seulement le mécanisme.
router.get('/video', async (req, res) => {
  const url = process.env.RH_VIDEO_URL || null;
  if (!pool || DEMO_MODE) return res.json({ url, vue: false, demo: true });
  const r = await pool.query(`SELECT video_vue_at FROM kadio_rh_employes WHERE id=$1`, [req.employeId]);
  res.json({ url, vue: !!r.rows[0]?.video_vue_at, vueAt: r.rows[0]?.video_vue_at || null });
});

router.post('/video/vue', async (req, res) => {
  if (!pool || DEMO_MODE) return res.json({ success: true, demo: true });
  await pool.query(`
    UPDATE kadio_rh_employes SET video_vue_at = COALESCE(video_vue_at, NOW()) WHERE id=$1
  `, [req.employeId]);
  res.json({ success: true });
});

module.exports = router;
module.exports.computeScoreMensuel = computeScoreMensuel;
module.exports.ECHELONS = ECHELONS;
module.exports.dbReady = dbReady;
