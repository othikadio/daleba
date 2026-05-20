'use strict';
/**
 * GoDaddy Routes — DALEBA Section 14
 * /api/v1/godaddy/*
 */
const express = require('express');
const router  = express.Router();
const { pool }    = require('../memory/db');
const { requireAuth } = require('../middleware/auth');
const gd = require('../services/connectors/godaddy-connector');
const bus = require('../services/event-bus');

const ok  = (res, d)    => res.json({ success: true,  data: d, ts: new Date().toISOString() });
const err = (res, m, s=400) => res.status(s).json({ success: false, error: m });

// Sync RDV depuis GoDaddy
router.post('/sync-appointments', requireAuth, async (req, res) => {
  try { ok(res, await gd.syncAppointments(pool, req.body.tenantId)); }
  catch(e) { err(res, e.message); }
});

// Créer un RDV GoDaddy
router.post('/appointments', requireAuth, async (req, res) => {
  try { ok(res, await gd.createAppointment(req.body)); }
  catch(e) { err(res, e.message); }
});

// Statut / annulation RDV
router.patch('/appointments/:id', requireAuth, async (req, res) => {
  try { ok(res, await gd.updateAppointmentStatus(req.params.id, req.body.status)); }
  catch(e) { err(res, e.message); }
});

// Import paiements GoDaddy → tenant_ledgers
router.post('/sync-payments', requireAuth, async (req, res) => {
  try { ok(res, await gd.fetchPayments(pool, req.body.tenantId, req.body)); }
  catch(e) { err(res, e.message); }
});

// Statut domaine
router.get('/domain', requireAuth, async (_req, res) => {
  try { ok(res, await gd.checkDomainStatus()); }
  catch(e) { err(res, e.message); }
});

// Pointer domaine vers VPS
router.post('/domain/point-to-vps', requireAuth, async (req, res) => {
  try { ok(res, await gd.pointDomainToVPS(req.body.vpsIP)); }
  catch(e) { err(res, e.message); }
});

// Widget HTML (pour kadiocoiffure.com)
router.get('/booking-widget', (req, res) => {
  const html = gd.getBookingWidgetHTML(req.query);
  res.setHeader('Content-Type', 'text/html');
  res.send(html);
});

// Webhook booking depuis kadiocoiffure.com (public — pas auth)
router.post('/booking-webhook', async (req, res) => {
  try {
    const booking = req.body;
    bus.emit('godaddy:booking:incoming', booking);
    bus.system(`[GoDaddy] 📅 Booking entrant: ${booking.clientName || booking.customer?.firstName} → ${booking.serviceName || booking.service?.name}`);
    // Sync DALEBA
    await gd.syncAppointments(pool, booking.tenantId || 'kadiocoiffure').catch(() => {});
    res.json({ received: true, ts: new Date().toISOString() });
  } catch(e) { err(res, e.message); }
});

module.exports = router;
