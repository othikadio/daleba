'use strict';
/**
 * DALEBA — Portail Client (SMS OTP)
 * POST /api/client-portal/send-otp
 * POST /api/client-portal/verify-otp
 * GET  /api/client-portal/profile
 */

const express = require('express');
const router = express.Router();
const crypto = require('crypto');

const LOG = '[CLIENT-PORTAL]';

let pool = null, DEMO_MODE = true;
try { const db = require('../memory/db'); pool = db.pool; DEMO_MODE = db.DEMO_MODE; } catch(e) {}

// Twilio
let twilioClient = null;
try {
  const twilio = require('twilio');
  twilioClient = twilio(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN);
} catch(e) {}

const TWILIO_FROM = process.env.TWILIO_PHONE_NUMBER || '+13022328291';

// OTP store: { phone -> { code, expiresAt, attempts } }
const otpStore = new Map();

// ─── INIT TABLE SESSIONS ──────────────────────────────────────────────────────
async function initTable() {
  if (!pool) return;
  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS daleba_client_sessions (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        client_phone VARCHAR(20) NOT NULL,
        token VARCHAR(64) UNIQUE NOT NULL,
        expires_at TIMESTAMP NOT NULL,
        created_at TIMESTAMP DEFAULT NOW()
      );
    `);
  } catch(e) {}
}
initTable();

// ─── POST /send-otp ───────────────────────────────────────────────────────────
router.post('/send-otp', async (req, res) => {
  const { phone } = req.body;
  if (!phone) return res.status(400).json({ error: 'phone requis' });

  // Rate limit: max 3 OTP par heure par numéro
  const existing = otpStore.get(phone);
  if (existing && existing.attempts >= 3 && Date.now() < existing.lockUntil) {
    return res.status(429).json({ error: 'Trop de tentatives. Réessayez dans 1h.' });
  }

  const code = String(Math.floor(100000 + Math.random() * 900000)); // 6 chiffres
  const expiresAt = Date.now() + 120_000; // 2 minutes
  otpStore.set(phone, { code, expiresAt, attempts: (existing?.attempts||0) + 1, lockUntil: Date.now() + 3_600_000 });

  const msg = `Votre code d'accès Kadio Coiffure : ${code}\n(Valide 2 minutes — ne pas partager)`;

  if (DEMO_MODE || !twilioClient) {
    console.log(`${LOG} [DEMO] OTP ${code} → ${phone}`);
    return res.json({ success: true, demo: true });
  }

  try {
    await twilioClient.messages.create({ body: msg, from: TWILIO_FROM, to: phone });
    console.log(`${LOG} OTP envoyé → ${phone}`);
    res.json({ success: true });
  } catch(err) {
    console.error(`${LOG} Erreur Twilio: ${err.message}`);
    res.status(500).json({ error: 'Impossible d\'envoyer le SMS. Réessayez.' });
  }
});

// ─── POST /verify-otp ────────────────────────────────────────────────────────
router.post('/verify-otp', async (req, res) => {
  const { phone, code } = req.body;
  if (!phone || !code) return res.status(400).json({ error: 'phone et code requis' });

  const stored = otpStore.get(phone);
  if (!stored) return res.status(401).json({ error: 'Aucun code envoyé à ce numéro' });
  if (Date.now() > stored.expiresAt) { otpStore.delete(phone); return res.status(401).json({ error: 'Code expiré' }); }
  if (stored.code !== String(code).trim()) return res.status(401).json({ error: 'Code incorrect' });

  otpStore.delete(phone); // invalider après usage

  // Chercher le client dans la DB
  let clientData = null;
  if (pool && !DEMO_MODE) {
    try {
      const r = await pool.query(
        'SELECT * FROM daleba_loyalty WHERE client_phone=$1 ORDER BY created_at DESC LIMIT 1',
        [phone]
      );
      if (r.rows[0]) {
        const sub = r.rows[0];
        // Chercher les RDVs
        let appts = [];
        try {
          const ra = await pool.query(
            'SELECT * FROM daleba_reminders_queue WHERE client_phone=$1 ORDER BY appointment_datetime DESC LIMIT 10',
            [phone]
          );
          appts = ra.rows.map(a => ({
            service: a.service_name,
            date: new Date(a.appointment_datetime).toLocaleDateString('fr-CA'),
            time: new Date(a.appointment_datetime).toLocaleTimeString('fr-CA',{hour:'2-digit',minute:'2-digit'}),
            staffName: a.staff_name,
            status: new Date(a.appointment_datetime) > new Date() ? 'upcoming' : 'done',
          }));
        } catch(e) {}
        clientData = {
          clientName: sub.client_name,
          status: sub.status || 'active',
          forfaitName: sub.forfait_name || sub.forfait_id,
          scanCode: sub.scan_code,
          weeklyWashUsed: sub.weekly_wash_used || false,
          nextBilling: sub.next_billing_date,
          appointments: appts,
        };
      }
    } catch(e) { console.error(`${LOG} DB error: ${e.message}`); }
  }

  // Demo fallback
  if (!clientData) {
    clientData = {
      clientName: 'Client ' + phone.slice(-4),
      status: 'active',
      forfaitName: 'Locs Illimité',
      scanCode: 'KC' + phone.slice(-6).replace(/\D/g,'').substring(0,6).toUpperCase(),
      weeklyWashUsed: false,
      nextBilling: '2026-06-15',
      appointments: [],
    };
  }

  // Créer token session
  const token = crypto.randomBytes(32).toString('hex');
  if (pool && !DEMO_MODE) {
    try {
      await pool.query(
        'INSERT INTO daleba_client_sessions (client_phone, token, expires_at) VALUES ($1,$2,$3)',
        [phone, token, new Date(Date.now() + 86_400_000)] // 24h
      );
    } catch(e) {}
  }

  res.json({ success: true, token, ...clientData });
});

// ─── GET /profile ─────────────────────────────────────────────────────────────
router.get('/profile', async (req, res) => {
  const auth = req.headers.authorization || '';
  const token = auth.replace('Bearer ', '').trim();

  // En mode démo on renvoie un profil fictif
  let clientPhone = null;
  if (pool && !DEMO_MODE && token) {
    try {
      const r = await pool.query(
        'SELECT client_phone FROM daleba_client_sessions WHERE token=$1 AND expires_at > NOW()',
        [token]
      );
      if (r.rows[0]) clientPhone = r.rows[0].client_phone;
    } catch(e) {}
  }

  if (!clientPhone) {
    // Demo mode
    return res.json({
      clientName: 'Client Démo',
      status: 'active',
      forfaitName: 'Locs Illimité',
      notes: [],
      appointments: [],
    });
  }

  let profile = { clientName: `Client ${clientPhone.slice(-4)}`, status: 'active', forfaitName: null, notes: [], appointments: [] };
  try {
    const sub = await pool.query(
      'SELECT * FROM daleba_loyalty WHERE client_phone=$1 ORDER BY created_at DESC LIMIT 1',
      [clientPhone]
    );
    if (sub.rows[0]) {
      profile.clientName = sub.rows[0].client_name || profile.clientName;
      profile.status     = sub.rows[0].status || 'active';
      profile.forfaitName = sub.rows[0].forfait_name || sub.rows[0].forfait_id;
    }

    const appts = await pool.query(
      'SELECT * FROM daleba_reminders_queue WHERE client_phone=$1 ORDER BY appointment_datetime DESC LIMIT 10',
      [clientPhone]
    );
    profile.appointments = appts.rows.map(a => ({
      service: a.service_name,
      date: new Date(a.appointment_datetime).toLocaleDateString('fr-CA'),
      time: new Date(a.appointment_datetime).toLocaleTimeString('fr-CA',{hour:'2-digit',minute:'2-digit'}),
      staffName: a.staff_name,
      status: new Date(a.appointment_datetime) > new Date() ? 'upcoming' : 'done',
    }));

    const notes = await pool.query(
      `SELECT staff_comment AS comment, TO_CHAR(created_at,'DD/MM/YYYY') AS date
       FROM kadio_ratings WHERE client_phone=$1 AND staff_comment IS NOT NULL
       ORDER BY created_at DESC LIMIT 5`,
      [clientPhone]
    );
    profile.notes = notes.rows;
  } catch(e) { console.warn('[CLIENT-PORTAL] /profile:', e.message); }

  res.json(profile);
});

module.exports = router;
