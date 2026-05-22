'use strict';
/**
 * DALEBA — Routes OTP Auth (V31-AUTH)
 * POST /api/auth/request-otp
 * POST /api/auth/verify-otp
 */

const express = require('express');
const router  = express.Router();
const jwt     = require('jsonwebtoken');
const { sendOTP, verifyOTP } = require('../services/otp-auth');

const JWT_SECRET    = process.env.JWT_SECRET || 'daleba-secret-change-in-prod';
const OWNER_PHONE   = process.env.OWNER_PHONE || '+15149845970';
const TENANT_ID     = 'kadio-coiffure';

// ── DB helpers ────────────────────────────────────────────────────────────────
let pool = null, DEMO_MODE = true;
try { const db = require('../memory/db'); pool = db.pool; DEMO_MODE = db.DEMO_MODE; } catch(e) {}

/**
 * Détermine le rôle d'un numéro de téléphone.
 * owner > staff > client
 */
async function resolveRole(phone) {
  // Propriétaire
  const normalised = phone.replace(/\s/g, '');
  if (normalised === OWNER_PHONE.replace(/\s/g, '')) return 'owner';

  // Staff (cherche dans staff_profiles ou staff_members)
  if (pool && !DEMO_MODE) {
    try {
      const r = await pool.query(
        `SELECT id FROM staff_profiles WHERE phone = $1 LIMIT 1`,
        [normalised]
      );
      if (r.rows.length > 0) return 'staff';
    } catch (_) {
      // Table inexistante — fallback
    }
    try {
      const r = await pool.query(
        `SELECT id FROM staff_members WHERE phone = $1 LIMIT 1`,
        [normalised]
      );
      if (r.rows.length > 0) return 'staff';
    } catch (_) {}
  }

  return 'client';
}

/**
 * Récupère ou crée un profil client minimal.
 * Retourne { id, phone, name }
 */
async function getOrCreateSubscriber(phone, role) {
  if (!pool || DEMO_MODE) {
    return { id: null, phone, name: null, subscriptionActive: false };
  }

  // Chercher dans clients / subscribers
  try {
    const r = await pool.query(
      `SELECT id, name FROM clients WHERE phone = $1 LIMIT 1`,
      [phone]
    );
    if (r.rows.length > 0) {
      // Vérifier abonnement actif
      let subscriptionActive = false;
      try {
        const sr = await pool.query(
          `SELECT id FROM subscriptions WHERE client_id = $1 AND status='active' AND end_date >= NOW() LIMIT 1`,
          [r.rows[0].id]
        );
        subscriptionActive = sr.rows.length > 0;
      } catch (_) {}
      return { id: r.rows[0].id, phone, name: r.rows[0].name, subscriptionActive };
    }
  } catch (_) {}

  // Créer un enregistrement minimal
  try {
    const ins = await pool.query(
      `INSERT INTO clients (phone, name, created_at) VALUES ($1, $2, NOW()) RETURNING id, name`,
      [phone, null]
    );
    return { id: ins.rows[0].id, phone, name: null, subscriptionActive: false };
  } catch (_) {}

  return { id: null, phone, name: null, subscriptionActive: false };
}

// ── POST /api/auth/request-otp ────────────────────────────────────────────────
router.post('/request-otp', async (req, res) => {
  const { phone } = req.body || {};
  if (!phone) return res.status(400).json({ success: false, error: 'phone requis' });

  try {
    await sendOTP(phone);
    return res.json({ success: true, message: 'Code envoyé' });
  } catch (err) {
    console.error('[OTP] request-otp error:', err.message);
    return res.status(500).json({ success: false, error: 'Erreur envoi SMS' });
  }
});

// ── POST /api/auth/verify-otp ─────────────────────────────────────────────────
router.post('/verify-otp', async (req, res) => {
  const { phone, code } = req.body || {};
  if (!phone || !code) {
    return res.status(400).json({ success: false, error: 'phone et code requis' });
  }

  const result = verifyOTP(phone, code);
  if (!result.valid) {
    return res.status(401).json({ success: false, error: result.reason });
  }

  try {
    const role       = await resolveRole(phone);
    const subscriber = await getOrCreateSubscriber(phone, role);

    const payload = {
      phone,
      role,
      tenantId:     TENANT_ID,
      subscriberId: subscriber.id,
      iat:          Math.floor(Date.now() / 1000),
    };

    const token = jwt.sign(payload, JWT_SECRET, { expiresIn: '24h' });

    return res.json({
      success: true,
      token,
      role,
      profile: {
        phone,
        name:               subscriber.name,
        subscriptionActive: subscriber.subscriptionActive,
      },
    });
  } catch (err) {
    console.error('[OTP] verify-otp error:', err.message);
    return res.status(500).json({ success: false, error: 'Erreur serveur' });
  }
});

module.exports = router;
