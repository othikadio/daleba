'use strict';
/**
 * KADIO — Programme de fidélité clients
 * Cahier des charges Kadio Network — Section 6
 *
 * 1$ dépensé = 1 point. 450 points = 20$ cash ou crédit (crédit applicable
 * sur la prochaine réservation). SMS/courriel automatique à la fin d'un
 * RDV (à l'heure / en avance / en retard).
 *
 * Étend kadio_gestion_clients (créée par gestion-routes.js) plutôt que de
 * dupliquer une table clients séparée.
 *
 * Routes admin (gestion) sous /api/fidelite (JWT business_admin) +
 * une route publique de consultation de solde par téléphone (voir la
 * limite de sécurité documentée plus bas, même compromis que
 * noter-coiffeur.html : pas de compte client complet dans ce projet).
 */

const express = require('express');
const router  = express.Router();
const { requireAuth, requireRole, ROLES } = require('../middleware/auth');

const LOG = '[FIDELITE]';
const POINTS_REQUIS = 450;
const CREDIT_PAR_PALIER = 20;

let pool = null, DEMO_MODE = true;
try { const db = require('../memory/db'); pool = db.pool; DEMO_MODE = db.DEMO_MODE; } catch (e) {}

let sendSMS = null;
try { sendSMS = require('../services/twilio').sendSMS; } catch (e) {}

let gestionDbReady = Promise.resolve();
try { gestionDbReady = require('./gestion-routes').dbReady || Promise.resolve(); } catch (e) {}

async function sms(to, body) {
  if (!to) return;
  if (sendSMS) { try { await sendSMS(to, body); } catch (e) { console.error(`${LOG} SMS échec: ${e.message}`); } }
  else console.log(`${LOG} [SMS-DEMO] → ${to}: ${body}`);
}

function normalizePhone(phone = '') {
  let p = phone.replace(/[^\d+]/g, '');
  if (!p.startsWith('+') && p.length === 10) p = '+1' + p;
  else if (!p.startsWith('+') && p.length === 11 && p.startsWith('1')) p = '+' + p;
  return p;
}

// ── Crédite des points pour un montant dépensé, débloque le crédit tous les
// 450 points (peut franchir plusieurs paliers en un seul achat) ────────────
async function crediterPoints(clientId, montant) {
  const points = Math.floor(montant);
  if (points <= 0) return null;

  const r = await pool.query(`
    UPDATE kadio_gestion_clients SET points_fidelite = points_fidelite + $1, updated_at = NOW()
    WHERE id = $2 RETURNING *
  `, [points, clientId]);
  const client = r.rows[0];
  if (!client) return null;

  let creditsDebloques = 0;
  while (client.points_fidelite >= POINTS_REQUIS) {
    client.points_fidelite -= POINTS_REQUIS;
    creditsDebloques += 1;
  }
  if (creditsDebloques > 0) {
    const montantCredit = creditsDebloques * CREDIT_PAR_PALIER;
    const upd = await pool.query(`
      UPDATE kadio_gestion_clients SET points_fidelite = $1, credit_disponible = credit_disponible + $2
      WHERE id = $3 RETURNING *
    `, [client.points_fidelite, montantCredit, clientId]);
    await sms(upd.rows[0].telephone, `🎉 Félicitations ${upd.rows[0].nom} ! Vous avez débloqué ${montantCredit}$ de crédit fidélité chez Kadio Coiffure — applicable sur votre prochaine réservation.`);
    return upd.rows[0];
  }
  return client;
}

router.use(requireAuth, requireRole(ROLES.BUSINESS_ADMIN));

// ── POST /ajouter-points — enregistre un achat/service et crédite les points
router.post('/ajouter-points', async (req, res) => {
  const { clientId, montant } = req.body || {};
  if (!clientId || !montant || montant <= 0) return res.status(400).json({ error: 'clientId et montant (>0) requis' });
  if (!pool || DEMO_MODE) return res.json({ success: true, demo: true });
  try {
    const client = await crediterPoints(clientId, montant);
    if (!client) return res.status(404).json({ error: 'Client introuvable' });
    res.json({ success: true, client });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── POST /rdv-termine — SMS auto fin de RDV (à l'heure / avance / retard) + points
router.post('/rdv-termine', async (req, res) => {
  const { clientId, montant, statut } = req.body || {};
  if (!clientId || !['a_temps', 'avance', 'retard'].includes(statut)) {
    return res.status(400).json({ error: 'clientId et statut (a_temps|avance|retard) requis' });
  }
  if (!pool || DEMO_MODE) return res.json({ success: true, demo: true });
  try {
    const r = await pool.query(`SELECT * FROM kadio_gestion_clients WHERE id=$1`, [clientId]);
    const client = r.rows[0];
    if (!client) return res.status(404).json({ error: 'Client introuvable' });

    const MESSAGES = {
      a_temps: `Merci pour votre visite chez Kadio Coiffure, ${client.nom} ! Votre rendez-vous s'est terminé à l'heure prévue.`,
      avance: `Merci pour votre visite chez Kadio Coiffure, ${client.nom} ! Votre rendez-vous s'est terminé plus tôt que prévu.`,
      retard: `Merci pour votre patience, ${client.nom}. Votre rendez-vous chez Kadio Coiffure s'est terminé avec un peu de retard — nous nous excusons pour l'attente.`,
    };
    await sms(client.telephone, MESSAGES[statut]);

    let updated = client;
    if (montant && montant > 0) updated = await crediterPoints(clientId, montant) || client;

    res.json({ success: true, client: updated });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── GET /solde/:clientId — admin
router.get('/solde/:clientId', async (req, res) => {
  if (!pool || DEMO_MODE) return res.json({ demo: true });
  try {
    const r = await pool.query(`SELECT id, nom, telephone, points_fidelite, credit_disponible FROM kadio_gestion_clients WHERE id=$1`, [req.params.clientId]);
    if (!r.rows[0]) return res.status(404).json({ error: 'Client introuvable' });
    res.json({ client: r.rows[0], pointsRequisProchainPalier: POINTS_REQUIS - (r.rows[0].points_fidelite % POINTS_REQUIS) });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── POST /utiliser-credit — applique le crédit sur une réservation (admin, au moment du paiement)
router.post('/utiliser-credit', async (req, res) => {
  const { clientId, montant } = req.body || {};
  if (!clientId || !montant || montant <= 0) return res.status(400).json({ error: 'clientId et montant (>0) requis' });
  if (!pool || DEMO_MODE) return res.json({ success: true, demo: true });
  try {
    const r = await pool.query(`SELECT credit_disponible FROM kadio_gestion_clients WHERE id=$1`, [clientId]);
    if (!r.rows[0]) return res.status(404).json({ error: 'Client introuvable' });
    if (parseFloat(r.rows[0].credit_disponible) < montant) return res.status(400).json({ error: 'Crédit insuffisant' });
    const upd = await pool.query(`
      UPDATE kadio_gestion_clients SET credit_disponible = credit_disponible - $1 WHERE id=$2 RETURNING *
    `, [montant, clientId]);
    res.json({ success: true, client: upd.rows[0] });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

module.exports = router;
module.exports.crediterPoints = crediterPoints;

// ── Route publique de consultation de solde (pas d'authentification) ──────
// Limite de sécurité assumée : accessible à quiconque connaît le numéro de
// téléphone exact du client, comme noter-coiffeur.html (Module 5) — ce
// projet ne construit pas de compte client complet avec mot de passe.
// À restreindre si un vrai espace client authentifié est ajouté plus tard.
const publicRouter = express.Router();
publicRouter.get('/solde-public', async (req, res) => {
  const { telephone } = req.query;
  if (!telephone) return res.status(400).json({ error: 'telephone requis' });
  if (!pool || DEMO_MODE) return res.json({ demo: true });
  try {
    const r = await pool.query(`
      SELECT nom, points_fidelite, credit_disponible FROM kadio_gestion_clients WHERE telephone=$1
    `, [normalizePhone(telephone)]);
    if (!r.rows[0]) return res.status(404).json({ error: 'Aucun profil fidélité trouvé pour ce numéro' });
    const c = r.rows[0];
    res.json({
      nom: c.nom, points: c.points_fidelite, credit: c.credit_disponible,
      pointsRequisProchainPalier: POINTS_REQUIS - (c.points_fidelite % POINTS_REQUIS),
      progressionPct: Math.round(((c.points_fidelite % POINTS_REQUIS) / POINTS_REQUIS) * 100),
    });
  } catch (e) { res.status(500).json({ error: e.message }); }
});
module.exports.publicRouter = publicRouter;
module.exports.dbReady = gestionDbReady;
