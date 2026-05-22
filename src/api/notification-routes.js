/**
 * DALEBA — Routes Notifications SMS
 * Chantier A — Tests, logs, forçage manuel
 */

'use strict';

const express  = require('express');
const router   = express.Router();
const twilio   = require('twilio');
const notifier = require('../services/appointment-notifier');

const TWILIO_SID  = process.env.TWILIO_ACCOUNT_SID;
const TWILIO_AUTH = process.env.TWILIO_AUTH_TOKEN;
const TWILIO_FROM = process.env.TWILIO_PHONE_NUMBER || '+13022328291';

function getTwilio() {
  if (!TWILIO_SID || !TWILIO_AUTH) return null;
  return twilio(TWILIO_SID, TWILIO_AUTH);
}

/**
 * POST /api/notifications/test-sms
 * Body: { to, message }
 * Envoie un SMS de test (admin only — pas de JWT pour simplifier)
 */
router.post('/test-sms', async (req, res) => {
  const { to, message } = req.body || {};
  if (!to || !message) {
    return res.status(400).json({ error: 'Champs requis: to, message' });
  }

  const client = getTwilio();
  if (!client) {
    return res.json({ success: true, demo: true, message: `SMS simulé vers ${to}: ${message}` });
  }

  try {
    const msg = await client.messages.create({ from: TWILIO_FROM, to, body: message });
    res.json({ success: true, sid: msg.sid, to, status: msg.status });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

/**
 * GET /api/notifications/pending
 * Retourne les RDV avec leur statut de notification
 */
router.get('/pending', async (req, res) => {
  try {
    const pending = await notifier.getPendingNotifications();
    res.json({ bookings: pending, count: pending.length });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

/**
 * POST /api/notifications/send-now/:bookingId/:type
 * Force l'envoi d'un SMS pour un booking donné
 * Types: confirm | remind_24h | remind_2h | staff_1h
 */
router.post('/send-now/:bookingId/:type', async (req, res) => {
  const { bookingId, type } = req.params;
  const validTypes = ['confirm', 'remind_24h', 'remind_2h', 'staff_1h'];

  if (!validTypes.includes(type)) {
    return res.status(400).json({ error: `Type invalide. Types valides: ${validTypes.join(', ')}` });
  }

  try {
    const result = await notifier.forceNotification(bookingId, type);
    res.json(result);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

/**
 * GET /api/notifications/log
 * Historique des SMS envoyés
 */
router.get('/log', async (req, res) => {
  try {
    const limit = Math.min(parseInt(req.query.limit) || 100, 500);
    const log   = await notifier.getNotificationLog(limit);
    res.json({ log, count: log.length });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

module.exports = router;
