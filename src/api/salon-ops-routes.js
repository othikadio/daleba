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
const WELCOME_SMS = (clientName) =>
  `Bienvenue chez Kadio Coiffure & Esthétique, ${clientName} ! ` +
  `Installez-vous confortablement. Nous avons le plaisir de vous offrir une boisson : ` +
  `eau, jus, café, chocolat chaud, ou un verre de vin ou une bière pour relaxer, ` +
  `accompagnés de petites grignotines. ` +
  `Les toilettes se trouvent au fond à droite du salon. Bonne séance ! — Équipe Kadio`;

const ARRIVAL_NOTIFY = (clientName, staffName) =>
  `[Kadio] Arrivée confirmée : ${clientName} est arrivé(e). Coiffeur : ${staffName || 'N/A'}.`;

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
  await sms(clientPhone, WELCOME_SMS(clientName));

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

  if (!appointmentId || !clientPhone || !rating) {
    return res.status(400).json({ error: 'appointmentId, clientPhone, rating requis' });
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
    const msgGoogle = `Merci pour votre visite chez Kadio Coiffure ! Votre avis compte beaucoup pour nous. Laissez-nous une note Google ici : ${googleLink} — Merci !`;
    await sms(clientPhone, msgGoogle);
    googleSmsSent = true;
  } else {
    // Mauvaise note → alerte interne, PAS de lien Google
    const nameStr = clientName || clientPhone;
    const msgAlert = `ALERTE AVIS — Client ${nameStr} a noté ${rating}/5. Contact requis avant avis public. Tél: ${clientPhone}`;
    await sms(ulrichPhone, msgAlert);
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

module.exports = router;
