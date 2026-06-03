'use strict';
/**
 * DALEBA — Routes Accès Client (SMS OTP)
 * ========================================
 * POST /api/daleba/request-otp       — Envoie OTP par SMS
 * POST /api/daleba/verify-otp        — Vérifie OTP → token session
 * GET  /api/daleba/my-subscription   — Données abonnement (protégé)
 *
 * Aucune donnée admin/Usine n'est exposée.
 */

const express = require('express');
const router  = express.Router();
const {
  requestOTP,
  verifyOTPAndLogin,
  resolveToken,
  getClientSubscription,
} = require('../services/subscription-service');

// ── Middleware auth client ────────────────────────────────────────────────────
async function requireClientAuth(req, res, next) {
  const auth  = req.headers.authorization || '';
  const token = auth.replace('Bearer ', '').trim()
              || req.cookies?.daleba_client_token;
  if (!token) return res.status(401).json({ error: 'Non authentifié' });

  const phone = await resolveToken(token);
  if (!phone) return res.status(401).json({ error: 'Session expirée — reconnectez-vous' });

  req.clientPhone = phone;
  next();
}

// ── POST /api/daleba/request-otp ─────────────────────────────────────────────
router.post('/request-otp', async (req, res) => {
  const { phone } = req.body || {};
  if (!phone) return res.status(400).json({ error: 'Numéro de téléphone requis' });

  // Validation format basique
  const cleaned = phone.replace(/\s/g, '');
  if (!/^\+?\d{10,15}$/.test(cleaned)) {
    return res.status(400).json({ error: 'Format de numéro invalide (ex: +15141234567)' });
  }

  try {
    const result = await requestOTP(cleaned);
    return res.json({ success: true, demo: result.demo || false });
  } catch(err) {
    console.error('[DALEBA-CLIENT] request-otp:', err.message);
    return res.status(500).json({ error: 'Impossible d\'envoyer le SMS. Réessayez.' });
  }
});

// ── POST /api/daleba/verify-otp ──────────────────────────────────────────────
router.post('/verify-otp', async (req, res) => {
  const { phone, code } = req.body || {};
  if (!phone || !code) {
    return res.status(400).json({ error: 'Numéro et code requis' });
  }

  const cleaned = phone.replace(/\s/g, '');

  try {
    const result = await verifyOTPAndLogin(cleaned, String(code).trim());
    if (!result.valid) {
      return res.status(401).json({ error: result.reason });
    }

    // Fetch subscription data
    const sub = await getClientSubscription(cleaned);

    return res.json({
      success:  true,
      token:    result.token,
      hasSubscription: !!sub,
      subscription: sub || null,
    });
  } catch(err) {
    console.error('[DALEBA-CLIENT] verify-otp:', err.message);
    return res.status(500).json({ error: 'Erreur serveur' });
  }
});

// ── GET /api/daleba/my-subscription ─────────────────────────────────────────
router.get('/my-subscription', requireClientAuth, async (req, res) => {
  try {
    const sub = await getClientSubscription(req.clientPhone);
    if (!sub) {
      return res.status(404).json({ error: 'Aucun abonnement actif trouvé' });
    }
    // Réponse blindée — AUCUNE donnée admin/interne
    return res.json({
      packageName:  sub.packageName,
      startedAt:    sub.startedAt,
      status:       sub.status,
      clientName:   sub.clientName,
      amountCad:    sub.amountCad,
      deliverables: sub.deliverables.map(d => ({
        title:    d.title,
        status:   d.status,
        position: d.position,
      })),
    });
  } catch(err) {
    console.error('[DALEBA-CLIENT] my-subscription:', err.message);
    return res.status(500).json({ error: 'Erreur serveur' });
  }
});

module.exports = router;
