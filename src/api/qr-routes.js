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

/**
 * GET /api/qr/checkin/:code — QR Check-in Kiosque
 * Retourne les infos client pour l'accueil en salon
 */
router.get('/checkin/:code', async (req, res) => {
  const { code } = req.params;

  // Mode démo ou DB non disponible
  if (!pool || DEMO_MODE) {
    return res.json({
      found: true,
      customer: {
        id: 1,
        name: 'Marie Dubois',
        initials: 'MD',
        loyaltyPoints: 250,
        lastVisit: { date: '2024-11-15', service: 'Tresses box braids' },
        hairNotes: 'Cheveux fins, sensibles à la chaleur. Aime les tresses longues.',
        nextVisit: '2024-12-20',
        isDemo: true
      }
    });
  }

  try {
    // Chercher le client par QR code (customerId ou token wallet)
    let customerId = null;

    // Format KADIO:ID:TOKEN
    if (code.startsWith('KADIO:')) {
      const parts = code.split(':');
      customerId = parseInt(parts[1]);
    } else {
      customerId = parseInt(code);
    }

    if (!customerId || isNaN(customerId)) {
      return res.status(404).json({ found: false, error: 'QR invalide' });
    }

    const r = await pool.query(`
      SELECT c.id, c.name, c.email, c.phone,
        COALESCE(lp.points_balance, 0) AS loyalty_points,
        (
          SELECT JSON_BUILD_OBJECT(
            'date', TO_CHAR(a.start_at, 'YYYY-MM-DD'),
            'service', COALESCE(s.name, 'Prestation'),
            'stylist', COALESCE(st.name, 'Équipe')
          )
          FROM appointments a
          LEFT JOIN services s ON s.id = a.service_id
          LEFT JOIN staff st ON st.id = a.staff_id
          WHERE a.client_id = c.id AND a.start_at < NOW()
          ORDER BY a.start_at DESC LIMIT 1
        ) AS last_visit,
        (
          SELECT TO_CHAR(a.start_at, 'YYYY-MM-DD') FROM appointments a
          WHERE a.client_id = c.id AND a.start_at > NOW()
          ORDER BY a.start_at LIMIT 1
        ) AS next_visit,
        (
          SELECT STRING_AGG(note, ' | ' ORDER BY created_at DESC)
          FROM client_notes WHERE client_id = c.id LIMIT 3
        ) AS hair_notes
      FROM clients c
      LEFT JOIN loyalty_points lp ON lp.client_id = c.id
      WHERE c.id = $1
    `, [customerId]);

    if (!r.rows[0]) return res.status(404).json({ found: false, error: 'Client introuvable' });
    const row = r.rows[0];
    const nameParts = (row.name || 'Inconnu').split(' ');
    const initials = nameParts.map(p => p[0]).join('').slice(0, 2).toUpperCase();

    res.json({
      found: true,
      customer: {
        id: row.id,
        name: row.name,
        initials,
        loyaltyPoints: parseInt(row.loyalty_points) || 0,
        lastVisit: row.last_visit || null,
        hairNotes: row.hair_notes || null,
        nextVisit: row.next_visit || null
      }
    });
  } catch(e) {
    console.error('[QR] checkin:', e);
    res.status(500).json({ found: false, error: e.message });
  }
});

module.exports = router;
module.exports.verifyRotatingHMAC = verifyRotatingHMAC;
