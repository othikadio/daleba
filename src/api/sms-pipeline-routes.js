/**
 * DALEBA — Routes SMS Pipeline
 * Section 16 — Endpoints pour le pipeline SMS automatique
 */

'use strict';

const express = require('express');
const router = express.Router();
const smsPipeline = require('../services/sms-pipeline');

// POST /api/sms/confirmation
router.post('/confirmation', async (req, res) => {
  const { clientPhone, clientName, serviceName, datetime, staffName } = req.body;
  if (!clientPhone || !clientName || !serviceName || !datetime || !staffName) {
    return res.status(400).json({ error: 'Champs requis: clientPhone, clientName, serviceName, datetime, staffName' });
  }
  try {
    const result = await smsPipeline.sendBookingConfirmation(clientPhone, clientName, serviceName, datetime, staffName);
    res.json({ success: true, ...result });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/sms/reminder
router.post('/reminder', async (req, res) => {
  const { clientPhone, clientName, serviceName, datetime, staffName } = req.body;
  if (!clientPhone || !clientName || !serviceName || !datetime || !staffName) {
    return res.status(400).json({ error: 'Champs requis: clientPhone, clientName, serviceName, datetime, staffName' });
  }
  try {
    const result = await smsPipeline.sendReminderSMS(clientPhone, clientName, serviceName, datetime, staffName);
    res.json({ success: true, ...result });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/sms/review-request
router.post('/review-request', async (req, res) => {
  const { clientPhone, clientName, staffName } = req.body;
  if (!clientPhone || !clientName || !staffName) {
    return res.status(400).json({ error: 'Champs requis: clientPhone, clientName, staffName' });
  }
  try {
    const result = await smsPipeline.sendReviewRequestSMS(clientPhone, clientName, staffName);
    res.json({ success: true, ...result });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/sms/rating-request
router.post('/rating-request', async (req, res) => {
  const { clientPhone, clientName, staffId, staffName, bookingId } = req.body;
  if (!clientPhone || !clientName || !staffId || !staffName || !bookingId) {
    return res.status(400).json({ error: 'Champs requis: clientPhone, clientName, staffId, staffName, bookingId' });
  }
  try {
    const result = await smsPipeline.sendInternalRatingRequest(clientPhone, clientName, staffId, staffName, bookingId);
    res.json({ success: true, ...result });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/sms/inbound — Twilio webhook pour capter les notes 1-5
// Twilio envoie Body et From en form-urlencoded
router.post('/inbound', express.urlencoded({ extended: false }), async (req, res) => {
  const body = req.body.Body || req.body.body || '';
  const from = req.body.From || req.body.from || '';

  try {
    // Traiter comme annulation si "ANNULER"
    if (body.trim().toUpperCase() === 'ANNULER') {
      console.log(`[SMS-PIPELINE] Demande annulation reçue de ${from}`);
      res.type('text/xml');
      return res.send(`<?xml version="1.0" encoding="UTF-8"?><Response><Message>Votre demande d'annulation a été reçue. Nous vous contacterons pour confirmer. Kadio Coiffure — 514-919-5970.</Message></Response>`);
    }

    // Traiter comme note interne
    const result = await smsPipeline.processInternalRating(body, from);

    let replyMsg;
    if (result.success) {
      replyMsg = `Merci pour votre évaluation ! (Coiffeur: ${result.staffRating}/5, Salon: ${result.salonRating}/5) — Kadio Coiffure`;
    } else {
      replyMsg = `Merci pour votre message. Pour évaluer votre visite, répondez avec 2 chiffres ex: 45 (coiffeur 4/5, salon 5/5).`;
    }

    res.type('text/xml');
    res.send(`<?xml version="1.0" encoding="UTF-8"?><Response><Message>${replyMsg}</Message></Response>`);
  } catch (err) {
    console.error('[SMS-PIPELINE] Erreur inbound:', err.message);
    res.type('text/xml');
    res.send(`<?xml version="1.0" encoding="UTF-8"?><Response></Response>`);
  }
});

// GET /api/sms/ratings — liste des notes internes
router.get('/ratings', async (req, res) => {
  try {
    const ratings = await smsPipeline.getRatings();
    res.json({ success: true, count: ratings.length, ratings });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/sms/ratings/staff/:staffId — notes d'un coiffeur
router.get('/ratings/staff/:staffId', async (req, res) => {
  try {
    const ratings = await smsPipeline.getRatings(req.params.staffId);
    const avg = ratings.length
      ? {
          staff: (ratings.reduce((a, r) => a + (r.staff_rating || 0), 0) / ratings.length).toFixed(1),
          salon: (ratings.reduce((a, r) => a + (r.salon_rating || 0), 0) / ratings.length).toFixed(1),
        }
      : null;
    res.json({ success: true, staffId: req.params.staffId, count: ratings.length, average: avg, ratings });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/sms/process-rating — Bouclier réputation
router.post('/process-rating', async (req, res) => {
  const { clientPhone, clientName, staffName, staffRating, salonRating } = req.body;
  if (!clientPhone || !staffRating || !salonRating) {
    return res.status(400).json({ error: 'clientPhone, staffRating, salonRating requis' });
  }
  try {
    const result = await smsPipeline.processRatingAndReputation({
      clientPhone, clientName: clientName||'Client',
      staffName: staffName||'coiffeur', staffRating, salonRating
    });
    res.json({ success: true, ...result });
  } catch(err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/sms/queue — file des reminders à envoyer
router.get('/queue', async (req, res) => {
  try {
    const queue = await smsPipeline.getReminderQueue();
    res.json({ success: true, count: queue.length, queue });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;


// POST /api/sms/schedule-reminders — planifier 24h + 2h rappels
router.post('/schedule-reminders', async (req, res) => {
  const { clientPhone, clientName, serviceName, datetime, staffName } = req.body;
  if (!clientPhone || !clientName || !datetime) {
    return res.status(400).json({ error: 'Champs requis: clientPhone, clientName, datetime' });
  }
  try {
    const { scheduleReminders } = require('../services/sms-pipeline');
    await scheduleReminders({ clientPhone, clientName, serviceName: serviceName||'Service', datetime, staffName: staffName||'votre coiffeur' });
    res.json({ success: true, message: 'Rappels 24h et 2h planifiés' });
  } catch (err) {
    console.error('[SMS-ROUTES] schedule-reminders error:', err.message);
    res.status(500).json({ error: err.message });
  }
});
