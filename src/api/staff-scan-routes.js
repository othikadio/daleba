'use strict';
/**
 * DALEBA — Routes scan QR staff (V31-AUTH)
 * POST /api/staff/scan — vérifie un QR abonné en < 200ms
 */

const express = require('express');
const router  = express.Router();
const jwt     = require('jsonwebtoken');
const { verifyRotatingHMAC } = require('./qr-routes');

const JWT_SECRET = process.env.JWT_SECRET || 'daleba-secret-change-in-prod';

// ── Middleware auth JWT (staff ou owner) ──────────────────────────────────────
function requireStaff(req, res, next) {
  const auth  = req.headers.authorization;
  const token = auth?.startsWith('Bearer ') ? auth.slice(7) : null;
  if (!token) return res.status(401).json({ error: 'Token requis' });
  try {
    const user = jwt.verify(token, JWT_SECRET);
    if (!['staff', 'owner'].includes(user.role)) {
      return res.status(403).json({ error: 'Accès réservé au staff' });
    }
    req.user = user;
    next();
  } catch (_) {
    return res.status(401).json({ error: 'Token invalide ou expiré' });
  }
}

// ── DB helpers ────────────────────────────────────────────────────────────────
let pool = null, DEMO_MODE = true;
try { const db = require('../memory/db'); pool = db.pool; DEMO_MODE = db.DEMO_MODE; } catch(e) {}

async function checkSubscriptionDB(phone, subscriptionId) {
  if (!pool || DEMO_MODE) {
    // Démo — retourner actif
    return {
      active:           true,
      subscriptionType: 'Forfait Premium',
      expiresAt:        new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(),
    };
  }
  try {
    const r = await pool.query(`
      SELECT s.plan_name, s.end_date, s.status
      FROM subscriptions s
      WHERE s.id = $1
      LIMIT 1
    `, [subscriptionId]);
    if (r.rows.length === 0) return { active: false };
    const row = r.rows[0];
    const active = row.status === 'active' && new Date(row.end_date) >= new Date();
    return {
      active,
      subscriptionType: row.plan_name || 'Abonnement',
      expiresAt:        row.end_date?.toISOString(),
    };
  } catch (_) {
    return { active: false };
  }
}

// ── POST /api/staff/scan ──────────────────────────────────────────────────────
router.post('/scan', requireStaff, async (req, res) => {
  const start = Date.now();
  const { qrPayload } = req.body || {};

  if (!qrPayload) {
    return res.status(400).json({ valid: false, status: 'INVALID', error: 'qrPayload requis' });
  }

  let parsed;
  try {
    parsed = JSON.parse(qrPayload);
  } catch (_) {
    return res.json({ valid: false, status: 'INVALID', subscriberName: null });
  }

  const { type, phone, name, subscriptionId, validUntil, token: hmacToken } = parsed;

  // Validation basique
  if (type !== 'kadio-member' || !phone || !subscriptionId || !hmacToken) {
    return res.json({ valid: false, status: 'INVALID', subscriberName: null });
  }

  // Vérifier l'HMAC rotatif
  const hmacValid = verifyRotatingHMAC(phone, subscriptionId, hmacToken);
  if (!hmacValid) {
    return res.json({ valid: false, status: 'INVALID', subscriberName: name || null });
  }

  // Vérifier l'abonnement en DB
  const subInfo = await checkSubscriptionDB(phone, subscriptionId);

  const elapsed = Date.now() - start;
  console.log(`[SCAN] ${phone} → ${subInfo.active ? 'ACTIVE' : 'EXPIRED'} (${elapsed}ms)`);

  if (!subInfo.active) {
    return res.json({
      valid:            false,
      status:           'EXPIRED',
      subscriberName:   name || null,
      subscriptionType: subInfo.subscriptionType,
      expiresAt:        subInfo.expiresAt,
    });
  }

  return res.json({
    valid:            true,
    status:           'ACTIVE',
    subscriberName:   name || null,
    subscriptionType: subInfo.subscriptionType,
    expiresAt:        subInfo.expiresAt,
  });
});

module.exports = router;
