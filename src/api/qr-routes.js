'use strict';
/**
 * DALEBA — Routes QR Code abonnés (V31-AUTH)
 * GET  /api/qr/generate — génère un QR dynamique pour abonné actif
 */

const express = require('express');
const router  = express.Router();
const crypto  = require('crypto');
const jwt     = require('jsonwebtoken');

const JWT_SECRET = process.env.JWT_SECRET || 'daleba-secret-change-in-prod';
const HMAC_KEY   = process.env.QR_HMAC_KEY || 'kadio-qr-hmac-secret-2024';

// QR rotate toutes les 30 secondes
const QR_TTL_SECONDS = 30;

// ── Middleware auth léger (JWT Bearer) ────────────────────────────────────────
function requireJWT(req, res, next) {
  const auth  = req.headers.authorization;
  const token = auth?.startsWith('Bearer ') ? auth.slice(7) : null;
  if (!token) return res.status(401).json({ error: 'Token requis' });
  try {
    req.user = jwt.verify(token, JWT_SECRET);
    next();
  } catch (_) {
    return res.status(401).json({ error: 'Token invalide ou expiré' });
  }
}

// ── DB helpers ────────────────────────────────────────────────────────────────
let pool = null, DEMO_MODE = true;
try { const db = require('../memory/db'); pool = db.pool; DEMO_MODE = db.DEMO_MODE; } catch(e) {}

async function getSubscriptionInfo(subscriberId, phone) {
  if (!pool || DEMO_MODE || !subscriberId) {
    // Mode démo — abonnement fictif
    return {
      subscriptionId:   'demo-sub-001',
      subscriptionType: 'Forfait Premium',
      validUntil:       new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(),
      name:             'Client Demo',
      active:           true,
    };
  }

  try {
    const r = await pool.query(`
      SELECT s.id AS subscription_id, s.plan_name, s.end_date, c.name
      FROM subscriptions s
      JOIN clients c ON c.id = s.client_id
      WHERE s.client_id = $1 AND s.status = 'active' AND s.end_date >= NOW()
      ORDER BY s.end_date DESC
      LIMIT 1
    `, [subscriberId]);

    if (r.rows.length === 0) return null;
    const row = r.rows[0];
    return {
      subscriptionId:   String(row.subscription_id),
      subscriptionType: row.plan_name || 'Abonnement',
      validUntil:       row.end_date?.toISOString(),
      name:             row.name || phone,
      active:           true,
    };
  } catch (_) {
    return null;
  }
}

/**
 * Génère un token HMAC rotatif (change toutes les 30s)
 */
function generateRotatingHMAC(phone, subscriptionId) {
  const window  = Math.floor(Date.now() / (QR_TTL_SECONDS * 1000));
  const payload = `${phone}:${subscriptionId}:${window}`;
  return crypto.createHmac('sha256', HMAC_KEY).update(payload).digest('hex').slice(0, 32);
}

/**
 * Vérifie un token HMAC (fenêtre courante ou précédente)
 */
function verifyRotatingHMAC(phone, subscriptionId, token) {
  const now    = Math.floor(Date.now() / (QR_TTL_SECONDS * 1000));
  for (const window of [now, now - 1]) {
    const payload  = `${phone}:${subscriptionId}:${window}`;
    const expected = crypto.createHmac('sha256', HMAC_KEY).update(payload).digest('hex').slice(0, 32);
    if (expected === token) return true;
  }
  return false;
}

// ── GET /api/qr/generate ──────────────────────────────────────────────────────
router.get('/generate', requireJWT, async (req, res) => {
  const { phone, subscriberId, role } = req.user;

  // Vérifier l'abonnement
  const sub = await getSubscriptionInfo(subscriberId, phone);

  if (!sub || !sub.active) {
    return res.status(403).json({ error: 'Aucun abonnement actif' });
  }

  const hmacToken = generateRotatingHMAC(phone, sub.subscriptionId);
  const expiresAt = new Date(
    (Math.floor(Date.now() / (QR_TTL_SECONDS * 1000)) + 1) * QR_TTL_SECONDS * 1000
  ).toISOString();

  const qrPayload = JSON.stringify({
    type:           'kadio-member',
    phone,
    name:           sub.name,
    subscriptionId: sub.subscriptionId,
    validUntil:     sub.validUntil,
    token:          hmacToken,
  });

  // Générer le QR en base64
  let qrDataUrl = null;
  try {
    const QRCode = require('qrcode');
    qrDataUrl = await QRCode.toDataURL(qrPayload, {
      errorCorrectionLevel: 'M',
      width: 300,
      margin: 2,
      color: { dark: '#2D1B0E', light: '#FAF6F0' },
    });
  } catch (err) {
    console.error('[QR] qrcode error:', err.message);
    return res.status(500).json({ error: 'Erreur génération QR' });
  }

  return res.json({
    qrDataUrl,
    expiresAt,
    subscriberName:   sub.name,
    subscriptionType: sub.subscriptionType,
    validUntil:       sub.validUntil,
    ttlSeconds:       QR_TTL_SECONDS,
  });
});

module.exports = router;
module.exports.verifyRotatingHMAC = verifyRotatingHMAC;
