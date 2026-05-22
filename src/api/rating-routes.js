'use strict';
/**
 * DALEBA — Routes Notation + Bouclier Google (V31-AUTH)
 * POST /api/rating/submit
 */

const express = require('express');
const router  = express.Router();
const jwt     = require('jsonwebtoken');

const JWT_SECRET    = process.env.JWT_SECRET || 'daleba-secret-change-in-prod';
const OWNER_PHONE   = process.env.OWNER_PHONE || '+15149845970';
const GOOGLE_REVIEW = 'https://g.page/r/kadiocoiffure/review';

// ── Middleware auth JWT ───────────────────────────────────────────────────────
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

// ── DB + Twilio ───────────────────────────────────────────────────────────────
let pool = null, DEMO_MODE = true;
try { const db = require('../memory/db'); pool = db.pool; DEMO_MODE = db.DEMO_MODE; } catch(e) {}

let sendSMS = null;
try { sendSMS = require('../services/twilio').sendSMS; } catch(e) {}

async function sms(to, body) {
  if (!sendSMS || !to) { console.log(`[RATING] DEMO SMS → ${to}: ${body}`); return; }
  try { await sendSMS(to, body); } catch(e) { console.error(`[RATING] SMS error: ${e.message}`); }
}

// ── POST /api/rating/submit ───────────────────────────────────────────────────
router.post('/submit', requireJWT, async (req, res) => {
  const { appointmentId, clientRating, staffRating, comment } = req.body || {};
  const { phone: callerPhone, role } = req.user;

  if (!appointmentId || clientRating === undefined) {
    return res.status(400).json({ error: 'appointmentId et clientRating requis' });
  }

  const cRating = parseInt(clientRating, 10);
  const sRating = staffRating !== undefined ? parseInt(staffRating, 10) : null;

  if (cRating < 1 || cRating > 5) {
    return res.status(400).json({ error: 'clientRating doit être entre 1 et 5' });
  }

  let googleLinkSent = false;
  let clientName     = req.body.clientName || 'Client';
  let clientPhone    = req.body.clientPhone || callerPhone;

  // ── Sauvegarder en DB ──────────────────────────────────────────────────────
  if (pool && !DEMO_MODE) {
    try {
      await pool.query(`
        INSERT INTO appointment_ratings
          (appointment_id, client_rating, staff_rating, comment, created_at)
        VALUES ($1, $2, $3, $4, NOW())
        ON CONFLICT DO NOTHING
      `, [appointmentId, cRating, sRating, comment || '']);
    } catch (e) {
      console.warn('[RATING] DB insert:', e.message);
    }
  }

  // ── Logique bouclier Google ────────────────────────────────────────────────
  if (cRating >= 4) {
    // Envoyer lien Google Review au client
    const googleSMS = `Merci pour votre visite chez Kadio Coiffure ! Si vous avez apprécié votre service, laissez-nous un avis Google : ${GOOGLE_REVIEW}`;
    await sms(clientPhone, googleSMS);
    googleLinkSent = true;
  } else {
    // NE PAS envoyer lien Google — créer ticket + alerter propriétaire
    if (pool && !DEMO_MODE) {
      try {
        await pool.query(`
          INSERT INTO daleba_notes (type, content, priority, created_at)
          VALUES ('rating_alert', $1, 'HIGH', NOW())
        `, [JSON.stringify({ appointmentId, clientRating: cRating, clientName, clientPhone })]);
      } catch (e) {
        console.warn('[RATING] Ticket alert:', e.message);
      }
    }

    // Alerter le propriétaire
    const alertSMS = `ALERTE: Note ${cRating}/5 pour RDV #${appointmentId}. Client: ${clientName}. Action requise.`;
    await sms(OWNER_PHONE, alertSMS);
  }

  return res.json({ success: true, googleLinkSent });
});

module.exports = router;
