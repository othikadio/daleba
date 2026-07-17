'use strict';
/**
 * KADIO RH — Module 5 : Notation bidirectionnelle + Avis Google
 * Cahier des charges Kadio Coiffure & Esthétique — Section 7
 *
 * Routes publiques (le client accède via le lien SMS reçu, sans compte) :
 * GET  /api/rh-notations/client/:token       — infos pour afficher le formulaire
 * POST /api/rh-notations/client/:token       — soumission de la note (4 critères)
 *
 * Le déclenchement de l'envoi SMS (POST /api/rh/notations/declencher) et la
 * notation privée du coiffeur → client (POST /api/rh-employe/notations/client-prive)
 * vivent respectivement dans rh-admin-routes.js et rh-employe-routes.js —
 * ici uniquement le parcours public du client.
 */

const express = require('express');
const router  = express.Router();
const crypto  = require('crypto');

const LOG = '[RH-NOTATIONS]';

let pool = null, DEMO_MODE = true;
try { const db = require('../memory/db'); pool = db.pool; DEMO_MODE = db.DEMO_MODE; } catch (e) {}

let sendSMS = null;
try { sendSMS = require('../services/twilio').sendSMS; } catch (e) {}

// kadio_rh_notations_client est créée par rh-employe-routes.js — on attend
// avant d'y ajouter les colonnes token/soumis_at (ALTER TABLE) ci-dessous.
let employeDbReady = Promise.resolve();
try { employeDbReady = require('./rh-employe-routes').dbReady || Promise.resolve(); } catch (e) {}

const OWNER_PHONE = process.env.OWNER_PHONE_NUMBER || '+15149195970';
const GOOGLE_REVIEW_LINK = process.env.GESTION_GOOGLE_REVIEW_LINK || 'https://g.page/r/CekIGz7Cw580EBE/review';

async function sms(to, body) {
  if (sendSMS) { try { await sendSMS(to, body); } catch (e) { console.error(`${LOG} SMS échec: ${e.message}`); } }
  else console.log(`${LOG} [SMS-DEMO] → ${to}: ${body}`);
}
async function alertOwner(message, niveau, employeId) {
  await sms(OWNER_PHONE, message);
  if (pool && !DEMO_MODE) {
    try { await pool.query(`INSERT INTO kadio_rh_alertes (niveau, message, employe_id, type) VALUES ($1,$2,$3,'notation_client')`,
      [niveau, message, employeId]); } catch (e) { console.warn(`${LOG} alerte insert: ${e.message}`); }
  }
}

// ── Table du token de notation (lien court envoyé par SMS) ─────────────────
async function initTables() {
  if (!pool) return;
  await employeDbReady.catch(() => {});
  try {
    await pool.query(`
      ALTER TABLE kadio_rh_notations_client ADD COLUMN IF NOT EXISTS token VARCHAR(40) UNIQUE;
      ALTER TABLE kadio_rh_notations_client ADD COLUMN IF NOT EXISTS soumis_at TIMESTAMP;
    `);
    console.log(`${LOG} Colonnes token OK`);
  } catch (e) { console.warn(`${LOG} initTables: ${e.message}`); }
}
const dbReady = initTables();

const APP_URL = process.env.APP_URL || 'https://daleba.vercel.app';

// ── Crée la ligne "en attente" + génère le lien court envoyé par SMS ───────
async function creerNotationEnAttente(employeId, clientNom, clientTelephone) {
  const token = crypto.randomBytes(12).toString('hex');
  await pool.query(`
    INSERT INTO kadio_rh_notations_client (employe_id, client_nom, client_telephone, token)
    VALUES ($1,$2,$3,$4)
  `, [employeId, clientNom || null, clientTelephone || null, token]);
  return { token, lien: `${APP_URL}/noter-coiffeur/${token}` };
}

// ── Formulaire (lecture) ─────────────────────────────────────────────────
router.get('/client/:token', async (req, res) => {
  if (!pool || DEMO_MODE) return res.json({ demo: true, employePrenom: 'Démo', clientNom: 'Client démo', dejaSoumis: false });
  try {
    const r = await pool.query(`
      SELECT n.client_nom, n.soumis_at, e.prenom AS employe_prenom
      FROM kadio_rh_notations_client n JOIN kadio_rh_employes e ON e.id = n.employe_id
      WHERE n.token = $1
    `, [req.params.token]);
    if (!r.rows[0]) return res.status(404).json({ error: 'Lien invalide ou expiré' });
    res.json({
      employePrenom: r.rows[0].employe_prenom, clientNom: r.rows[0].client_nom,
      dejaSoumis: !!r.rows[0].soumis_at,
    });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── Soumission de la note ────────────────────────────────────────────────
router.post('/client/:token', async (req, res) => {
  const { accueil, qualite, proprete, ambiance, commentaire } = req.body || {};
  const notes = { accueil, qualite, proprete, ambiance };
  for (const [k, v] of Object.entries(notes)) {
    if (!Number.isInteger(v) || v < 1 || v > 5) return res.status(400).json({ error: `${k} doit être un entier entre 1 et 5` });
  }

  if (!pool || DEMO_MODE) return res.json({ success: true, demo: true, moyenne: (accueil + qualite + proprete + ambiance) / 4 });

  const existing = await pool.query(`
    SELECT n.*, e.prenom AS employe_prenom FROM kadio_rh_notations_client n
    JOIN kadio_rh_employes e ON e.id = n.employe_id WHERE n.token = $1
  `, [req.params.token]);
  const row = existing.rows[0];
  if (!row) return res.status(404).json({ error: 'Lien invalide ou expiré' });
  if (row.soumis_at) return res.status(409).json({ error: 'Cette note a déjà été soumise' });

  const moyenne = (accueil + qualite + proprete + ambiance) / 4;
  const noteArrondie = Math.round(moyenne);

  let googleSmsType = null, redirectUrl = null;
  if (noteArrondie === 5) {
    await sms(row.client_telephone, `Merci pour votre visite ! Vous avez adoré ? Partagez votre expérience sur Google : ${GOOGLE_REVIEW_LINK}`);
    googleSmsType = 'google_5'; redirectUrl = GOOGLE_REVIEW_LINK;
  } else if (noteArrondie === 4) {
    await sms(row.client_telephone, `Merci de votre visite ! Votre avis nous aide à grandir : ${GOOGLE_REVIEW_LINK}`);
    googleSmsType = 'google_4'; redirectUrl = GOOGLE_REVIEW_LINK;
  } else if (noteArrondie === 3) {
    googleSmsType = 'alerte_privee';
    await alertOwner(`Note 3/5 reçue pour ${row.employe_prenom} (${row.client_nom || 'client'}). Commentaire : ${commentaire || 'Aucun commentaire'}.`, 'attention', row.employe_id);
  } else {
    googleSmsType = 'alerte_urgente';
    await alertOwner(`ATTENTION — Note ${noteArrondie}/5 reçue pour ${row.employe_prenom}. Commentaire : ${commentaire || 'Aucun commentaire'}. Action requise.`, 'urgent', row.employe_id);
  }

  await pool.query(`
    UPDATE kadio_rh_notations_client SET
      accueil=$1, qualite=$2, proprete=$3, ambiance=$4, commentaire=$5,
      google_sms_type=$6, soumis_at=NOW()
    WHERE token=$7
  `, [accueil, qualite, proprete, ambiance, commentaire || null, googleSmsType, req.params.token]);

  res.json({ success: true, moyenne, redirectUrl });
});

module.exports = router;
module.exports.dbReady = dbReady;
module.exports.GOOGLE_REVIEW_LINK = GOOGLE_REVIEW_LINK;
module.exports.creerNotationEnAttente = creerNotationEnAttente;
