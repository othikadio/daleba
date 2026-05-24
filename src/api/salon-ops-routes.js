'use strict';
/**
 * DALEBA — Salon Ops (V35)
 * POST /api/salon/arrival-confirm  — Protocole Arrivée VIP
 * POST /api/salon/rate-client      — Note coiffeur → client
 * POST /api/salon/rate-service     — Note client → service (bouclier Google)
 * GET  /api/salon/ratings          — Liste des notes
 * GET  /api/salon/ratings/summary  — Résumé global
 */

const express = require('express');
const router  = express.Router();

const LOG = '[SALON-OPS]';

// ── DB ─────────────────────────────────────────────────────────────────────
let pool = null, DEMO_MODE = true;
try { const db = require('../memory/db'); pool = db.pool; DEMO_MODE = db.DEMO_MODE; } catch(e) {}

// ── Twilio ─────────────────────────────────────────────────────────────────
let sendSMS = null;
try { sendSMS = require('../services/twilio').sendSMS; } catch(e) {}

async function sms(to, body) {
  if (!sendSMS) { console.log(`${LOG} [SMS-DEMO] → ${to}: ${body}`); return; }
  try { await sendSMS(to, body); } catch(e) { console.error(`${LOG} SMS error: ${e.message}`); }
}

// ── Init tables ─────────────────────────────────────────────────────────────
async function initTables() {
  if (!pool) return;
  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS kadio_ratings (
        id              SERIAL PRIMARY KEY,
        appointment_id  INT NOT NULL,
        client_phone    VARCHAR(20),
        client_name     VARCHAR(100),
        staff_id        INT,
        staff_name      VARCHAR(100),
        client_rating   INT CHECK (client_rating BETWEEN 1 AND 5),
        client_comment  TEXT,
        staff_rating    INT CHECK (staff_rating BETWEEN 1 AND 5),
        staff_comment   TEXT,
        google_sms_sent BOOLEAN DEFAULT FALSE,
        alert_sent      BOOLEAN DEFAULT FALSE,
        created_at      TIMESTAMP DEFAULT NOW()
      );
    `);
    console.log(`${LOG} Table kadio_ratings OK`);
  } catch(e) { console.warn(`${LOG} initTables: ${e.message}`); }
}
initTables();

// ── Messages ────────────────────────────────────────────────────────────────
const WELCOME_SMS =
  `Bienvenue chez Kadio Coiffure & Esthétique. Votre maître coiffeur est informé de votre arrivée et vous installe dans un instant. Pendant votre attente, notre bar à plantes et nos rafraîchissements vous sont gracieusement offerts : eau, jus, café, chocolat chaud, vin ou bière. Les commodités sont à votre disposition au fond à droite du salon. Passez un excellent moment de détente.`;

const ARRIVAL_NOTIFY = (clientName, staffName) =>
  `[Kadio] Arrivée confirmée : ${clientName} est arrivé(e). Coiffeur : ${staffName || 'N/A'}.`;

const WALKIN_SMS = (estimatedWait) =>
  `Vous êtes bien inscrit dans notre file d'attente express Kadio. Temps d'attente estimé : environ ${estimatedWait} minutes. Installez-vous et détendez-vous.`;

const RATING_ALERT = (clientName, rating, staffName, comment) =>
  `ALERTE QUALITÉ KADIO : Le client ${clientName} vient de laisser une note de ${rating}/5 pour sa prestation avec ${staffName || 'votre équipe'}. Motif/Commentaire : ${comment || 'Aucun commentaire'}. Veuillez intervenir en privé.`;

// ── POST /api/salon/arrival-confirm ─────────────────────────────────────────
router.post('/arrival-confirm', async (req, res) => {
  const { appointmentId, staffId, clientPhone, clientName, staffName } = req.body;

  if (!appointmentId || !clientPhone || !clientName) {
    return res.status(400).json({ error: 'appointmentId, clientPhone, clientName requis' });
  }

  // 1. Mettre à jour le statut en DB
  if (pool && !DEMO_MODE) {
    try {
      await pool.query(
        `UPDATE appointments SET status='in_progress', updated_at=NOW() WHERE id=$1`,
        [appointmentId]
      );
    } catch(e) { console.warn(`${LOG} DB update: ${e.message}`); }
  }

  // 2. SMS bienvenue au client
  await sms(clientPhone, WELCOME_SMS);

  // 3. Notification à Ulrich
  const ulrichPhone = process.env.ULRICH_PHONE_NUMBER || '+15149845970';
  await sms(ulrichPhone, ARRIVAL_NOTIFY(clientName, staffName));

  console.log(`${LOG} Arrivée VIP confirmée — ${clientName} (appt:${appointmentId})`);
  res.json({ success: true, smsSent: true, appointmentId, clientName });
});

// ── POST /api/salon/rate-client (coiffeur → client) ─────────────────────────
router.post('/rate-client', async (req, res) => {
  const { appointmentId, staffId, staffName, clientPhone, clientName, rating, comment } = req.body;

  if (!appointmentId || !rating) {
    return res.status(400).json({ error: 'appointmentId, rating requis' });
  }
  if (rating < 1 || rating > 5) {
    return res.status(400).json({ error: 'rating doit être entre 1 et 5' });
  }

  let row = null;
  if (pool && !DEMO_MODE) {
    try {
      // Upsert staff rating
      const r = await pool.query(`
        INSERT INTO kadio_ratings (appointment_id, client_phone, client_name, staff_id, staff_name, staff_rating, staff_comment)
        VALUES ($1, $2, $3, $4, $5, $6, $7)
        ON CONFLICT (appointment_id)
        DO UPDATE SET staff_rating=$6, staff_comment=$7, staff_id=$4, staff_name=$5
        RETURNING *
      `, [appointmentId, clientPhone, clientName, staffId, staffName, rating, comment]);
      row = r.rows[0];
    } catch(e) {
      // Table may not have unique constraint on appointment_id yet — use INSERT
      try {
        const r = await pool.query(`
          INSERT INTO kadio_ratings (appointment_id, client_phone, client_name, staff_id, staff_name, staff_rating, staff_comment)
          VALUES ($1, $2, $3, $4, $5, $6, $7)
          RETURNING *
        `, [appointmentId, clientPhone, clientName, staffId, staffName, rating, comment]);
        row = r.rows[0];
      } catch(e2) { console.warn(`${LOG} rate-client DB: ${e2.message}`); }
    }
  }

  console.log(`${LOG} Note coiffeur→client: ${rating}/5 — appt:${appointmentId}`);
  res.json({ success: true, staffRating: rating, appointmentId });
});

// ── POST /api/salon/rate-service (client → service) — BOUCLIER GOOGLE ───────
router.post('/rate-service', async (req, res) => {
  const { appointmentId, clientPhone, clientName, rating, comment } = req.body;

  if (!appointmentId || !rating) {
    return res.status(400).json({ error: 'appointmentId et rating requis' });
  }
  if (rating < 1 || rating > 5) {
    return res.status(400).json({ error: 'rating doit être entre 1 et 5' });
  }

  const googlePlaceId = process.env.GOOGLE_PLACE_ID || 'CwVGb0-S7xEAAAQvFbH8bg';
  const ulrichPhone   = process.env.ULRICH_PHONE_NUMBER || '+15149845970';
  const googleLink    = `https://g.page/r/${googlePlaceId}/review`;

  let googleSmsSent = false, alertSent = false;

  if (rating >= 4) {
    // Bonne note → lien Google Review
    const msgGoogle = `Merci pour votre visite chez Kadio Coiffure ! Votre satisfaction est notre fierté. Partagez votre expérience sur Google : ${googleLink}`;
    await sms(clientPhone, msgGoogle);
    googleSmsSent = true;
  } else {
    // Mauvaise note → alerte interne, PAS de lien Google
    const nameStr = clientName || 'Client';
    await sms(ulrichPhone, RATING_ALERT(nameStr, rating, req.body.staffName, req.body.comment));
    alertSent = true;
  }

  // Sauvegarder en DB
  if (pool && !DEMO_MODE) {
    try {
      await pool.query(`
        INSERT INTO kadio_ratings (appointment_id, client_phone, client_name, client_rating, client_comment, google_sms_sent, alert_sent)
        VALUES ($1, $2, $3, $4, $5, $6, $7)
      `, [appointmentId, clientPhone, clientName, rating, comment, googleSmsSent, alertSent]);
    } catch(e) { console.warn(`${LOG} rate-service DB: ${e.message}`); }
  }

  console.log(`${LOG} Note client: ${rating}/5 — googleSMS:${googleSmsSent} alerte:${alertSent}`);
  res.json({ success: true, clientRating: rating, googleSmsSent, alertSent, appointmentId });
});

// ── GET /api/salon/ratings ───────────────────────────────────────────────────
router.get('/ratings', async (req, res) => {
  const { staffId, limit = 20 } = req.query;

  if (!pool || DEMO_MODE) {
    return res.json({ ratings: [], demo: true });
  }

  try {
    let query = 'SELECT * FROM kadio_ratings';
    const params = [];
    if (staffId) { query += ' WHERE staff_id=$1'; params.push(staffId); }
    query += ` ORDER BY created_at DESC LIMIT $${params.length + 1}`;
    params.push(parseInt(limit));
    const r = await pool.query(query, params);
    res.json({ ratings: r.rows, total: r.rows.length });
  } catch(e) {
    res.status(500).json({ error: e.message });
  }
});

// ── GET /api/salon/ratings/summary ──────────────────────────────────────────
router.get('/ratings/summary', async (req, res) => {
  if (!pool || DEMO_MODE) {
    return res.json({ averageClientRating: 0, averageStaffRating: 0, googleSmsSent: 0, alertsSent: 0, total: 0, demo: true });
  }

  try {
    const r = await pool.query(`
      SELECT
        ROUND(AVG(client_rating), 2) AS avg_client_rating,
        ROUND(AVG(staff_rating),  2) AS avg_staff_rating,
        COUNT(*) FILTER (WHERE google_sms_sent = true) AS google_sms_sent,
        COUNT(*) FILTER (WHERE alert_sent = true)      AS alerts_sent,
        COUNT(*) AS total
      FROM kadio_ratings
    `);
    const d = r.rows[0];
    res.json({
      averageClientRating: parseFloat(d.avg_client_rating) || 0,
      averageStaffRating:  parseFloat(d.avg_staff_rating)  || 0,
      googleSmsSent:       parseInt(d.google_sms_sent)     || 0,
      alertsSent:          parseInt(d.alerts_sent)          || 0,
      total:               parseInt(d.total)                || 0,
    });
  } catch(e) {
    res.status(500).json({ error: e.message });
  }
});

// ── POST /api/salon/walkin — Entrée Express ─────────────────────────────────
router.post('/walkin', async (req, res) => {
  const { name, phone } = req.body;
  if (!name || !phone) {
    return res.status(400).json({ error: 'name et phone requis' });
  }

  // Normalisation E.164
  let normalPhone = phone.replace(/[^\d+]/g, '');
  if (!normalPhone.startsWith('+') && normalPhone.length === 10) normalPhone = '+1' + normalPhone;
  else if (!normalPhone.startsWith('+') && normalPhone.length === 11 && normalPhone.startsWith('1')) normalPhone = '+' + normalPhone;

  // Compter combien de walk-ins actifs pour estimer l'attente
  let queueCount = 1;
  let walkinId   = null;

  if (pool && !DEMO_MODE) {
    try {
      const countRes = await pool.query(
        `SELECT COUNT(*) FROM kadio_walkins WHERE status='waiting' AND created_at > NOW() - INTERVAL '3 hours'`
      );
      queueCount = parseInt(countRes.rows[0].count) + 1;
    } catch(_) {}

    try {
      const ins = await pool.query(
        `INSERT INTO kadio_walkins (client_name, client_phone, status, created_at)
         VALUES ($1, $2, 'waiting', NOW()) RETURNING id`,
        [name, normalPhone]
      );
      walkinId = ins.rows[0]?.id;
    } catch(e) {
      // Table peut ne pas exister encore — créer
      try {
        await pool.query(`
          CREATE TABLE IF NOT EXISTS kadio_walkins (
            id SERIAL PRIMARY KEY,
            client_name VARCHAR(100),
            client_phone VARCHAR(20),
            status VARCHAR(20) DEFAULT 'waiting',
            staff_assigned VARCHAR(100),
            created_at TIMESTAMP DEFAULT NOW(),
            served_at TIMESTAMP
          )
        `);
        const ins2 = await pool.query(
          `INSERT INTO kadio_walkins (client_name, client_phone, status) VALUES ($1, $2, 'waiting') RETURNING id`,
          [name, normalPhone]
        );
        walkinId = ins2.rows[0]?.id;
      } catch(e2) { console.warn(`${LOG} walkin DB: ${e2.message}`); }
    }
  } else {
    walkinId = Date.now();
  }

  // Temps d'attente estimé : 30 min par personne avant soi
  const estimatedWait = Math.max(10, (queueCount - 1) * 30);

  // SMS au client
  await sms(normalPhone, WALKIN_SMS(estimatedWait));

  // Notif Ulrich
  const ulrichPhone = process.env.ULRICH_PHONE_NUMBER || '+15149845970';
  await sms(ulrichPhone, `[Kadio Walk-in] ${name} (${normalPhone}) ajouté à la file. Attente estimée : ${estimatedWait} min.`);

  console.log(`${LOG} Walk-in enregistré : ${name} (${normalPhone}) — attente ~${estimatedWait}min`);
  res.json({ success: true, walkinId, clientName: name, clientPhone: normalPhone, estimatedWait });
});

// ── POST /api/salon/close-appointment ─────────────────────────────────────────
router.post('/close-appointment', async (req, res) => {
  const { appointmentId, clientPhone, clientName, staffName, staffId } = req.body;
  if (!appointmentId || !clientPhone) {
    return res.status(400).json({ error: 'appointmentId et clientPhone requis' });
  }

  const BASE_URL = process.env.BASE_URL || 'https://daleba.vercel.app';

  // Générer un token d'évaluation (encodage simple base64 signé)
  const jwt = require('jsonwebtoken');
  const JWT_SECRET = process.env.JWT_SECRET || 'daleba-secret-change-in-prod';
  const ratingToken = jwt.sign(
    { appointmentId, clientPhone, clientName, staffName, staffId, iat: Date.now() },
    JWT_SECRET,
    { expiresIn: '48h' }
  );

  const ratingLink = `${BASE_URL}/noter-service.html?token=${ratingToken}`;

  // Marquer comme clôturé en DB
  if (pool && !DEMO_MODE) {
    try {
      await pool.query(
        `UPDATE appointments SET status='completed', updated_at=NOW() WHERE id=$1`,
        [appointmentId]
      );
    } catch(e) { console.warn(`${LOG} close-appointment DB: ${e.message}`); }
  }

  // SMS au client avec lien de notation
  const ratingMsg = `Merci pour votre visite chez Kadio Coiffure & Esthétique ! Votre coiffeur a terminé votre prestation. Donnez-nous votre avis en toute discrétion (30 secondes) : ${ratingLink}`;
  await sms(clientPhone, ratingMsg);

  console.log(`${LOG} Prestation clôturée — appt:${appointmentId}, lien envoyé → ${clientPhone}`);
  res.json({ success: true, smsSent: true, appointmentId, ratingLink });
});

module.exports = router;
