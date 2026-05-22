'use strict';
/**
 * DALEBA — Routes Protocole VIP (V31-AUTH)
 * POST /api/vip/welcome-confirm — envoi SMS d'accueil VIP au client
 */

const express = require('express');
const router  = express.Router();
const jwt     = require('jsonwebtoken');

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

// ── Twilio ────────────────────────────────────────────────────────────────────
let sendSMS = null;
try { sendSMS = require('../services/twilio').sendSMS; } catch(e) {}

const VIP_SMS = `Bienvenue chez Kadio Coiffure et Esthétique ! Installez-vous confortablement. Nous avons le plaisir de vous offrir une boisson : eau, jus, café, chocolat chaud, ou même un verre de vin ou une bière pour relaxer, accompagnés de petites grignotines. (Pour information, les toilettes se trouvent au fond à droite du salon).`;

// ── POST /api/vip/welcome-confirm ─────────────────────────────────────────────
router.post('/welcome-confirm', requireStaff, async (req, res) => {
  const { appointmentId, clientPhone, clientName, staffConfirm, clientConfirm } = req.body || {};

  if (!clientPhone) {
    return res.status(400).json({ error: 'clientPhone requis' });
  }

  let smsSent = false;

  if (sendSMS) {
    try {
      await sendSMS(clientPhone, VIP_SMS);
      smsSent = true;
      console.log(`[VIP] SMS accueil envoyé → ${clientPhone} (RDV #${appointmentId})`);
    } catch (err) {
      console.error(`[VIP] SMS error: ${err.message}`);
    }
  } else {
    console.log(`[VIP] DEMO → ${clientPhone}: ${VIP_SMS}`);
    smsSent = true;
  }

  return res.json({ success: true, smsSent });
});

module.exports = router;
