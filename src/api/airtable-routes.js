/**
 * DALEBA — Routes Airtable dédiées
 * Endpoints : status, subscribers, appointments, payments, hair-profiles, reminders, sync
 */

const express = require('express');
const router = express.Router();

function getAirtable() {
  return require('../services/airtable');
}

function notConfigured(res) {
  return res.status(503).json({
    error: 'Airtable non configuré',
    hint: 'Configurez AIRTABLE_API_KEY et AIRTABLE_BASE_ID dans Railway',
  });
}

// ─── STATUS ───────────────────────────────────────────────────────────────────

// GET /api/airtable/status — vérifie connexion + stats par table
router.get('/status', async (req, res) => {
  try {
    const airtable = getAirtable();
    const status = await airtable.getStatus();
    res.json({ success: true, ...status });
  } catch (err) {
    console.error('[airtable/status]', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ─── LECTURE ─────────────────────────────────────────────────────────────────

// GET /api/airtable/subscribers
router.get('/subscribers', async (req, res) => {
  try {
    const airtable = getAirtable();
    if (!airtable.isConfigured()) return notConfigured(res);
    const { status, limit = 100 } = req.query;
    const filter = status ? `{Statut} = "${status}"` : null;
    const records = await airtable.findRecords('Abonnés', filter, parseInt(limit));
    res.json({
      success: true,
      count: records.length,
      subscribers: records.map(r => ({ id: r.id, ...r.fields })),
    });
  } catch (err) {
    console.error('[airtable/subscribers]', err.message);
    res.status(500).json({ error: err.message });
  }
});

// GET /api/airtable/appointments
router.get('/appointments', async (req, res) => {
  try {
    const airtable = getAirtable();
    if (!airtable.isConfigured()) return notConfigured(res);
    const { date, status, limit = 100 } = req.query;

    let records;
    if (date) {
      records = await airtable.getAppointmentsByDate(date);
    } else {
      const filter = status ? `{Statut} = "${status}"` : null;
      records = await airtable.findRecords('Rendez-vous', filter, parseInt(limit));
    }
    res.json({
      success: true,
      count: records.length,
      appointments: records.map(r => ({ id: r.id, ...r.fields })),
    });
  } catch (err) {
    console.error('[airtable/appointments]', err.message);
    res.status(500).json({ error: err.message });
  }
});

// GET /api/airtable/payments
router.get('/payments', async (req, res) => {
  try {
    const airtable = getAirtable();
    if (!airtable.isConfigured()) return notConfigured(res);
    const { source, limit = 100 } = req.query;
    const filter = source ? `{Source} = "${source}"` : null;
    const records = await airtable.findRecords('Paiements', filter, parseInt(limit));
    res.json({
      success: true,
      count: records.length,
      payments: records.map(r => ({ id: r.id, ...r.fields })),
    });
  } catch (err) {
    console.error('[airtable/payments]', err.message);
    res.status(500).json({ error: err.message });
  }
});

// GET /api/airtable/hair-profiles
router.get('/hair-profiles', async (req, res) => {
  try {
    const airtable = getAirtable();
    if (!airtable.isConfigured()) return notConfigured(res);
    const records = await airtable.findRecords('Fiches Capillaires', null, 100);
    res.json({
      success: true,
      count: records.length,
      profiles: records.map(r => ({ id: r.id, ...r.fields })),
    });
  } catch (err) {
    console.error('[airtable/hair-profiles]', err.message);
    res.status(500).json({ error: err.message });
  }
});

// GET /api/airtable/reminders/pending
router.get('/reminders/pending', async (req, res) => {
  try {
    const airtable = getAirtable();
    if (!airtable.isConfigured()) return notConfigured(res);
    const records = await airtable.getPendingReminders();
    res.json({
      success: true,
      count: records.length,
      reminders: records.map(r => ({ id: r.id, ...r.fields })),
    });
  } catch (err) {
    console.error('[airtable/reminders/pending]', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ─── SYNC ─────────────────────────────────────────────────────────────────────

// POST /api/airtable/sync/stripe — sync full Stripe → Airtable
router.post('/sync/stripe', async (req, res) => {
  try {
    const airtable = getAirtable();
    if (!airtable.isConfigured()) return notConfigured(res);

    const stripeService = require('../services/stripe');
    const subs = await stripeService.listSubscriptions({ status: 'all', limit: 100 });

    let synced = 0;
    let errors = 0;
    const errList = [];

    for (const sub of subs) {
      try {
        await airtable.upsertSubscriber({
          email: sub.customerEmail,
          name: sub.customerName,
          customerId: sub.customerId,
          subscriptionId: sub.id,
          plan: sub.plan,
          status: sub.status,
          amount: parseFloat(sub.amount || 0),
          currentPeriodEnd: sub.currentPeriodEnd,
          createdAt: sub.createdAt,
        });
        synced++;
        await airtable.delay(200);
      } catch (e) {
        errors++;
        errList.push({ email: sub.customerEmail, error: e.message });
        console.warn('[Sync Stripe→Airtable]', sub.customerEmail, e.message);
      }
    }

    res.json({
      success: true,
      total: subs.length,
      synced,
      errors,
      errList: errList.slice(0, 10),
      lastSync: new Date().toISOString(),
    });
  } catch (err) {
    console.error('[airtable/sync/stripe]', err.message);
    res.status(500).json({ error: err.message });
  }
});

// POST /api/airtable/sync/square — sync full Square → Airtable
router.post('/sync/square', async (req, res) => {
  try {
    const airtable = getAirtable();
    if (!airtable.isConfigured()) return notConfigured(res);

    const square = require('../services/square');
    // Récupérer les bookings des 90 derniers jours
    const startAt = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000).toISOString();
    const endAt   = new Date().toISOString();

    let synced = 0;
    let errors = 0;

    try {
      const data = await square.getBookings(startAt, endAt);
      const bookings = data.bookings || [];

      for (const booking of bookings) {
        try {
          await airtable.upsertAppointment({
            squareAppointmentId: booking.id,
            client: booking.customer_note || '',
            service: booking.appointment_segments?.[0]?.service_variation_id || '',
            staff: booking.appointment_segments?.[0]?.team_member_id || '',
            startAt: booking.start_at,
            status: booking.status,
          });
          synced++;
          await airtable.delay(200);
        } catch (e) {
          errors++;
        }
      }
    } catch (squareErr) {
      console.warn('[Sync Square→Airtable]', squareErr.message);
    }

    res.json({
      success: true,
      synced,
      errors,
      lastSync: new Date().toISOString(),
    });
  } catch (err) {
    console.error('[airtable/sync/square]', err.message);
    res.status(500).json({ error: err.message });
  }
});

// POST /api/airtable/reminders/:id/sent — marque un rappel comme envoyé
router.post('/reminders/:id/sent', async (req, res) => {
  try {
    const airtable = getAirtable();
    if (!airtable.isConfigured()) return notConfigured(res);

    const { id } = req.params;
    const { twilioSid } = req.body;

    const updated = await airtable.updateRecord('Rappels SMS', id, {
      'Statut': 'envoyé',
      'Envoyé le': new Date().toISOString(),
      ...(twilioSid ? { 'Twilio SID': twilioSid } : {}),
    });

    if (!updated) {
      return res.status(404).json({ error: 'Rappel introuvable' });
    }
    res.json({ success: true, id, status: 'envoyé' });
  } catch (err) {
    console.error('[airtable/reminders/:id/sent]', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ─── UPSERT DIRECT (pour tests + intégrations externes) ──────────────────────

// POST /api/airtable/subscribers — créer/maj un abonné
router.post('/subscribers', async (req, res) => {
  try {
    const airtable = getAirtable();
    if (!airtable.isConfigured()) return notConfigured(res);
    const result = await airtable.upsertSubscriber(req.body);
    res.json({ success: !!result, record: result });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/airtable/appointments — créer/maj un RDV
router.post('/appointments', async (req, res) => {
  try {
    const airtable = getAirtable();
    if (!airtable.isConfigured()) return notConfigured(res);
    const result = await airtable.upsertAppointment(req.body);
    res.json({ success: !!result, record: result });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/airtable/hair-profiles — créer/maj une fiche capillaire
router.post('/hair-profiles', async (req, res) => {
  try {
    const airtable = getAirtable();
    if (!airtable.isConfigured()) return notConfigured(res);
    const result = await airtable.upsertHairProfile(req.body);
    res.json({ success: !!result, record: result });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/airtable/visits — logguer une visite
router.post('/visits', async (req, res) => {
  try {
    const airtable = getAirtable();
    if (!airtable.isConfigured()) return notConfigured(res);
    const result = await airtable.logVisit(req.body);
    res.json({ success: !!result, record: result });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
