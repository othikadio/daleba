/**
 * DALEBA — Routes SMS (Twilio)
 */

const express = require('express');
const router = express.Router();
const twilio = require('../services/twilio');

// POST /api/sms/send — SMS libre
router.post('/send', async (req, res) => {
  const { to, message } = req.body;

  if (!to || !message) {
    return res.status(400).json({ error: 'to et message requis' });
  }

  try {
    const result = await twilio.sendSMS(to, message);
    res.json({ success: true, ...result });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/sms/confirmation — SMS de confirmation RDV
router.post('/confirmation', async (req, res) => {
  const { clientPhone, clientName, date, service, coiffeur } = req.body;

  if (!clientPhone || !clientName || !date) {
    return res.status(400).json({ error: 'clientPhone, clientName et date requis' });
  }

  try {
    const result = await twilio.sendConfirmation({ clientPhone, clientName, date, service, coiffeur });
    res.json({ success: true, ...result });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/sms/reminder — SMS de rappel 24h avant
router.post('/reminder', async (req, res) => {
  const { clientPhone, clientName, date, service } = req.body;

  if (!clientPhone || !clientName || !date) {
    return res.status(400).json({ error: 'clientPhone, clientName et date requis' });
  }

  try {
    const result = await twilio.sendReminder({ clientPhone, clientName, date, service });
    res.json({ success: true, ...result });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/sms/cancellation — SMS d'annulation
router.post('/cancellation', async (req, res) => {
  const { clientPhone, clientName, date } = req.body;

  if (!clientPhone || !clientName || !date) {
    return res.status(400).json({ error: 'clientPhone, clientName et date requis' });
  }

  try {
    const result = await twilio.sendCancellation({ clientPhone, clientName, date });
    res.json({ success: true, ...result });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/sms/alert — Alerte urgente à Ulrich
router.post('/alert', async (req, res) => {
  const { message } = req.body;

  if (!message) {
    return res.status(400).json({ error: 'message requis' });
  }

  try {
    const result = await twilio.alertUlrich(message);
    res.json({ success: true, ...result });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
