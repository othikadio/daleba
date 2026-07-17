'use strict';
/**
 * KADIO RH — Administration (admin uniquement)
 * Gestion des employés RH (fiche, horaire, PIN) + consultation pointages/pauses/alertes.
 * Sert de base au futur Module 9 (tableau de bord propriétaire).
 */

const express = require('express');
const router  = express.Router();
const { requireAuth, requireRole, ROLES } = require('../middleware/auth');

const LOG = '[RH-ADMIN]';

let pool = null, DEMO_MODE = true;
try { const db = require('../memory/db'); pool = db.pool; DEMO_MODE = db.DEMO_MODE; } catch (e) {}

let sendSMS = null;
try { sendSMS = require('../services/twilio').sendSMS; } catch (e) {}
const OWNER_PHONE = process.env.OWNER_PHONE_NUMBER || '+15149195970';
async function alertOwner(message) {
  if (sendSMS) { try { await sendSMS(OWNER_PHONE, message); } catch (e) { console.error(`${LOG} SMS échec: ${e.message}`); } }
  else console.log(`${LOG} [SMS-DEMO] → propriétaire: ${message}`);
}

let computeScoreMensuel = async () => ({ total: 0, partiel: true, composantsDisponibles: [], composantsManquants: [] });
let ECHELONS = [];
try {
  const rhEmploye = require('./rh-employe-routes');
  computeScoreMensuel = rhEmploye.computeScoreMensuel;
  ECHELONS = rhEmploye.ECHELONS;
} catch (e) {}

let creerNotationEnAttente = null;
try { creerNotationEnAttente = require('./rh-notations-routes').creerNotationEnAttente; } catch (e) {}

router.use(requireAuth, requireRole(ROLES.BUSINESS_ADMIN));

function normalizePhone(phone = '') {
  let p = phone.replace(/[^\d+]/g, '');
  if (!p.startsWith('+') && p.length === 10) p = '+1' + p;
  else if (!p.startsWith('+') && p.length === 11 && p.startsWith('1')) p = '+' + p;
  return p;
}

// ═══════════════════════ EMPLOYÉS RH ═══════════════════════════════════════
router.get('/employes', async (req, res) => {
  if (!pool || DEMO_MODE) return res.json({ employes: [], demo: true });
  try {
    const r = await pool.query(`
      SELECT id, prenom, nom, telephone, poste, heure_debut_quart, heure_fin_quart,
             echelon, date_embauche, date_probation_fin, actif, video_vue_at, reglement_signe_at, created_at
      FROM kadio_rh_employes ORDER BY created_at DESC
    `);
    res.json({ employes: r.rows });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.post('/employes', async (req, res) => {
  const { prenom, nom, telephone, pin, poste, heureDebutQuart, heureFinQuart } = req.body || {};
  if (!prenom || !telephone || !pin) return res.status(400).json({ error: 'prenom, telephone et pin requis' });
  if (!/^\d{4}$/.test(pin)) return res.status(400).json({ error: 'pin doit être 4 chiffres' });
  if (!pool || DEMO_MODE) return res.json({ success: true, demo: true });
  try {
    const r = await pool.query(`
      INSERT INTO kadio_rh_employes (prenom, nom, telephone, pin, poste, heure_debut_quart, heure_fin_quart)
      VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id, prenom, nom, telephone, poste, heure_debut_quart, heure_fin_quart, echelon, actif
    `, [prenom, nom || null, normalizePhone(telephone), pin, poste || null,
        heureDebutQuart || '09:00', heureFinQuart || '17:00']);
    res.status(201).json({ success: true, employe: r.rows[0] });
  } catch (e) {
    if (e.code === '23505') return res.status(409).json({ error: 'Ce numéro de téléphone est déjà utilisé' });
    res.status(500).json({ error: e.message });
  }
});

router.put('/employes/:id', async (req, res) => {
  const { prenom, nom, telephone, pin, poste, heureDebutQuart, heureFinQuart, echelon, actif } = req.body || {};
  if (pin && !/^\d{4}$/.test(pin)) return res.status(400).json({ error: 'pin doit être 4 chiffres' });
  if (!pool || DEMO_MODE) return res.json({ success: true, demo: true });
  try {
    const r = await pool.query(`
      UPDATE kadio_rh_employes SET
        prenom=COALESCE($1,prenom), nom=COALESCE($2,nom),
        telephone=COALESCE($3,telephone), pin=COALESCE($4,pin), poste=COALESCE($5,poste),
        heure_debut_quart=COALESCE($6,heure_debut_quart), heure_fin_quart=COALESCE($7,heure_fin_quart),
        echelon=COALESCE($8,echelon), actif=COALESCE($9,actif)
      WHERE id=$10 RETURNING id, prenom, nom, telephone, poste, heure_debut_quart, heure_fin_quart, echelon, actif
    `, [prenom, nom, telephone ? normalizePhone(telephone) : null, pin, poste,
        heureDebutQuart, heureFinQuart, echelon, actif, req.params.id]);
    if (!r.rows[0]) return res.status(404).json({ error: 'Employé introuvable' });
    res.json({ success: true, employe: r.rows[0] });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ═══════════════════════ POINTAGES / PAUSES / ALERTES ══════════════════════
router.get('/pointages', async (req, res) => {
  if (!pool || DEMO_MODE) return res.json({ pointages: [], demo: true });
  try {
    const { employeId, limit = 100 } = req.query;
    let q = `SELECT p.*, e.prenom FROM kadio_rh_pointages p JOIN kadio_rh_employes e ON e.id=p.employe_id`;
    const params = [];
    if (employeId) { q += ` WHERE p.employe_id=$1`; params.push(employeId); }
    q += ` ORDER BY p.heure_reelle DESC LIMIT $${params.length + 1}`;
    params.push(parseInt(limit, 10));
    const r = await pool.query(q, params);
    res.json({ pointages: r.rows });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.get('/pauses', async (req, res) => {
  if (!pool || DEMO_MODE) return res.json({ pauses: [], demo: true });
  try {
    const r = await pool.query(`
      SELECT p.*, e.prenom FROM kadio_rh_pauses p JOIN kadio_rh_employes e ON e.id=p.employe_id
      ORDER BY p.debut DESC LIMIT 100
    `);
    res.json({ pauses: r.rows });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.get('/alertes', async (req, res) => {
  if (!pool || DEMO_MODE) return res.json({ alertes: [], demo: true });
  try {
    const { traitee } = req.query;
    let q = `SELECT a.*, e.prenom FROM kadio_rh_alertes a LEFT JOIN kadio_rh_employes e ON e.id=a.employe_id`;
    const params = [];
    if (traitee !== undefined) { q += ` WHERE a.traitee=$1`; params.push(traitee === 'true'); }
    q += ` ORDER BY a.created_at DESC LIMIT 200`;
    const r = await pool.query(q, params);
    res.json({ alertes: r.rows });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.patch('/alertes/:id', async (req, res) => {
  if (!pool || DEMO_MODE) return res.json({ success: true, demo: true });
  try {
    const r = await pool.query(`UPDATE kadio_rh_alertes SET traitee=TRUE WHERE id=$1 RETURNING *`, [req.params.id]);
    if (!r.rows[0]) return res.status(404).json({ error: 'Alerte introuvable' });
    res.json({ success: true, alerte: r.rows[0] });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ═══════════════════════ TÂCHES MÉNAGÈRES (lecture) ════════════════════════
// L'écriture (bouton "Cocher comme fait") et les vérifications automatiques
// vivent dans rh-taches-routes.js (Module 4) — ici, lecture seule pour le dashboard.
const { TACHES_QUOTIDIENNES } = require('./rh-taches-constants');

router.get('/taches-jour', async (req, res) => {
  if (!pool || DEMO_MODE) {
    return res.json({ taches: TACHES_QUOTIDIENNES.map(nom => ({ nom, faite: false })), demo: true });
  }
  try {
    const doneRes = await pool.query(`
      SELECT t.tache_nom, t.coche_at, e.prenom FROM kadio_rh_taches_log t
      JOIN kadio_rh_employes e ON e.id = t.coche_par_employe_id
      WHERE t.date_tache = CURRENT_DATE AND t.frequence = 'quotidienne'
    `);
    const doneMap = {};
    doneRes.rows.forEach(r => { doneMap[r.tache_nom] = r; });
    const taches = TACHES_QUOTIDIENNES.map(nom => ({
      nom, faite: !!doneMap[nom], par: doneMap[nom]?.prenom || null, heure: doneMap[nom]?.coche_at || null,
    }));
    res.json({ taches, nonCompletees: taches.filter(t => !t.faite).length });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ═══════════════════════ SANCTIONS (moteur 3 paliers) ══════════════════════
// Le moteur lui-même vit dans rh-sanctions-core.js (évite un require
// circulaire avec pointage-routes.js, qui déclenche aussi des sanctions
// automatiques — retards, pauses trop longues — voir Module 3).
const { creerSanction, descendreEchelon } = require('./rh-sanctions-core');

router.get('/sanctions', async (req, res) => {
  if (!pool || DEMO_MODE) return res.json({ sanctions: [], demo: true });
  try {
    const r = await pool.query(`
      SELECT s.*, e.prenom FROM kadio_rh_sanctions s JOIN kadio_rh_employes e ON e.id = s.employe_id
      ORDER BY s.created_at DESC
    `);
    res.json({ sanctions: r.rows });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.post('/sanctions', async (req, res) => {
  const { employeId, motif, type } = req.body || {};
  if (!employeId || !motif) return res.status(400).json({ error: 'employeId et motif requis' });
  if (!pool || DEMO_MODE) return res.json({ success: true, demo: true });
  try {
    const sanction = await creerSanction(employeId, motif, type || 'manuelle');
    res.status(201).json({ success: true, sanction });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ═══════════════════════ EMPLOYÉ DU MOIS ═══════════════════════════════════
router.get('/employe-du-mois', async (req, res) => {
  if (!pool || DEMO_MODE) return res.json({ classement: [], historique: [], demo: true });
  try {
    const employesRes = await pool.query(`SELECT id, prenom FROM kadio_rh_employes WHERE actif=TRUE`);
    const classement = [];
    for (const e of employesRes.rows) {
      const score = await computeScoreMensuel(e.id);
      classement.push({ employeId: e.id, prenom: e.prenom, score: score.total, partiel: score.partiel });
    }
    classement.sort((a, b) => b.score - a.score);

    const histRes = await pool.query(`
      SELECT r.*, e.prenom FROM kadio_rh_recompenses r JOIN kadio_rh_employes e ON e.id = r.employe_id
      WHERE r.type = 'employe_du_mois' ORDER BY r.created_at DESC
    `);
    res.json({ classement, historique: histRes.rows });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.post('/employe-du-mois/confirmer', async (req, res) => {
  const { employeId } = req.body || {};
  if (!employeId) return res.status(400).json({ error: 'employeId requis' });
  if (!pool || DEMO_MODE) return res.json({ success: true, demo: true });
  try {
    const empRes = await pool.query(`SELECT prenom FROM kadio_rh_employes WHERE id=$1`, [employeId]);
    if (!empRes.rows[0]) return res.status(404).json({ error: 'Employé introuvable' });
    const moisLabel = new Date().toLocaleDateString('fr-CA', { month: 'long', year: 'numeric' });
    const r = await pool.query(`
      INSERT INTO kadio_rh_recompenses (employe_id, type, montant, description)
      VALUES ($1,'employe_du_mois',50,$2) RETURNING *
    `, [employeId, `Employé du mois de ${moisLabel}`]);
    await pool.query(`INSERT INTO kadio_rh_alertes (niveau, message, employe_id, type) VALUES ('info',$1,$2,'employe_du_mois')`,
      [`${empRes.rows[0].prenom} est l'employé(e) du mois de ${moisLabel} ! 🏆`, employeId]);
    res.status(201).json({ success: true, recompense: r.rows[0] });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ═══════════════════════ FICHES EMPLOYÉS DÉTAILLÉES ════════════════════════
router.get('/employes-detail', async (req, res) => {
  if (!pool || DEMO_MODE) return res.json({ employes: [], demo: true });
  try {
    const employesRes = await pool.query(`SELECT * FROM kadio_rh_employes WHERE actif=TRUE ORDER BY prenom`);
    const out = [];
    for (const e of employesRes.rows) {
      const score = await computeScoreMensuel(e.id);

      const arrivalRes = await pool.query(`SELECT 1 FROM kadio_rh_pointages WHERE employe_id=$1 AND type='arrivee' AND heure_reelle::date=CURRENT_DATE`, [e.id]);
      const departRes = await pool.query(`SELECT 1 FROM kadio_rh_pointages WHERE employe_id=$1 AND type='depart' AND heure_reelle::date=CURRENT_DATE`, [e.id]);
      const pauseRes = await pool.query(`SELECT 1 FROM kadio_rh_pauses WHERE employe_id=$1 AND fin IS NULL`, [e.id]);
      let presence = 'absent';
      if (departRes.rows.length) presence = 'parti';
      else if (arrivalRes.rows.length) presence = pauseRes.rows.length ? 'en_pause' : 'present';

      const retardsRes = await pool.query(`
        SELECT COUNT(*) FROM kadio_rh_pointages WHERE employe_id=$1 AND type='arrivee' AND retard_minutes>0
        AND date_trunc('month', heure_reelle) = date_trunc('month', NOW())
      `, [e.id]);
      const sanctionsRes = await pool.query(`SELECT COUNT(*) FROM kadio_rh_sanctions WHERE employe_id=$1`, [e.id]);

      out.push({
        id: e.id, prenom: e.prenom, nom: e.nom, poste: e.poste, echelon: e.echelon,
        presence, score: score.total, scorePartiel: score.partiel,
        retardsMois: parseInt(retardsRes.rows[0].count, 10),
        sanctionsTotal: parseInt(sanctionsRes.rows[0].count, 10),
      });
    }
    res.json({ employes: out });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ═══════════════════════ INDICATEURS TEMPS RÉEL ════════════════════════════
router.get('/indicateurs', async (req, res) => {
  if (!pool || DEMO_MODE) return res.json({ demo: true, totalEmployes: 0, presents: 0, retardsJour: 0, noteMoyenneJour: null, alertesActives: 0 });
  try {
    const totalRes = await pool.query(`SELECT COUNT(*) FROM kadio_rh_employes WHERE actif=TRUE`);
    const presentsRes = await pool.query(`
      SELECT COUNT(DISTINCT employe_id) FROM kadio_rh_pointages
      WHERE type='arrivee' AND heure_reelle::date = CURRENT_DATE
        AND employe_id NOT IN (SELECT employe_id FROM kadio_rh_pointages WHERE type='depart' AND heure_reelle::date = CURRENT_DATE)
    `);
    const retardsRes = await pool.query(`SELECT COUNT(*) FROM kadio_rh_pointages WHERE type='arrivee' AND retard_minutes>0 AND heure_reelle::date=CURRENT_DATE`);
    const notesRes = await pool.query(`SELECT AVG((accueil+qualite+proprete+ambiance)/4.0) AS avg FROM kadio_rh_notations_client WHERE created_at::date = CURRENT_DATE`);
    const alertesRes = await pool.query(`SELECT COUNT(*) FROM kadio_rh_alertes WHERE traitee=FALSE`);

    res.json({
      totalEmployes: parseInt(totalRes.rows[0].count, 10),
      presents: parseInt(presentsRes.rows[0].count, 10),
      retardsJour: parseInt(retardsRes.rows[0].count, 10),
      noteMoyenneJour: notesRes.rows[0].avg ? Math.round(parseFloat(notesRes.rows[0].avg) * 10) / 10 : null,
      alertesActives: parseInt(alertesRes.rows[0].count, 10),
    });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ═══════════════════════ NOTATIONS (Module 5) ══════════════════════════════
// Déclenche l'envoi du lien SMS au client après un service (à appeler
// manuellement pour l'instant, ou depuis une future intégration Square —
// le webhook Square lui-même n'est pas câblé dans cette PR).
router.post('/notations/declencher', async (req, res) => {
  const { employeId, clientNom, clientTelephone } = req.body || {};
  if (!employeId || !clientTelephone) return res.status(400).json({ error: 'employeId et clientTelephone requis' });
  if (!pool || DEMO_MODE || !creerNotationEnAttente) return res.json({ success: true, demo: true });
  try {
    const { token, lien } = await creerNotationEnAttente(employeId, clientNom, clientTelephone);
    if (sendSMS) {
      try { await sendSMS(clientTelephone, `Merci pour votre visite chez Kadio Coiffure ! Notez votre expérience (30 secondes) : ${lien}`); }
      catch (e) { console.error(`${LOG} SMS déclenchement échec: ${e.message}`); }
    } else {
      console.log(`${LOG} [SMS-DEMO] → ${clientTelephone}: lien notation ${lien}`);
    }
    res.status(201).json({ success: true, token, lien });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Vue admin des deux sens de notation (le client et les collègues n'y ont jamais accès)
router.get('/notations/client', async (req, res) => {
  if (!pool || DEMO_MODE) return res.json({ notations: [], demo: true });
  try {
    const r = await pool.query(`
      SELECT n.*, e.prenom AS employe_prenom FROM kadio_rh_notations_client n
      JOIN kadio_rh_employes e ON e.id = n.employe_id
      WHERE n.soumis_at IS NOT NULL ORDER BY n.soumis_at DESC LIMIT 200
    `);
    res.json({ notations: r.rows });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.get('/notations/coiffeur', async (req, res) => {
  if (!pool || DEMO_MODE) return res.json({ notations: [], demo: true });
  try {
    const r = await pool.query(`
      SELECT n.*, e.prenom AS employe_prenom FROM kadio_rh_notations_coiffeur n
      JOIN kadio_rh_employes e ON e.id = n.employe_id
      ORDER BY n.created_at DESC LIMIT 200
    `);
    res.json({ notations: r.rows });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

module.exports = router;
module.exports.creerSanction = creerSanction;
module.exports.descendreEchelon = descendreEchelon;
module.exports.alertOwner = alertOwner;
