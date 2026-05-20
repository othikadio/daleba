'use strict';
/**
 * GoDaddy Routes — DALEBA Section 14
 * /api/v1/godaddy/*  +  /api/v1/webhooks/godaddy
 */
const express = require('express');
const multer  = require('multer');
const router  = express.Router();
const { pool }    = require('../memory/db');
const { requireAuth } = require('../middleware/auth');
const gd          = require('../services/connectors/godaddy-connector');
const csvParser   = require('../services/poynt-csv-parser');
const wh          = require('../services/godaddy-webhook-handler');
const bus         = require('../services/event-bus');

// Upload en mémoire (max 10 MB — CSV seulement)
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter: (_, file, cb) => {
    if (file.mimetype === 'text/csv' || file.originalname.endsWith('.csv'))
      return cb(null, true);
    cb(new Error('Seuls les fichiers .csv sont acceptés'));
  },
});

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

// ══ OPTION A — Import CSV Poynt ════════════════════════════════

// Upload + parse CSV Poynt (drag & drop HUD)
router.post('/upload-csv', requireAuth, upload.single('csvFile'), async (req, res) => {
  try {
    if (!req.file) return err(res, 'Aucun fichier CSV reçu — champ attendu: csvFile');
    const tenantId = req.body.tenantId || req.query.tenantId || 'godaddy';
    const csvText  = req.file.buffer.toString('utf-8');
    bus.system(`[PoyntCSV] 📁 Fichier reçu: ${req.file.originalname} (${req.file.size} octets)`);

    // Parse
    const { transactions, stats, errors: parseErrors, format } = csvParser.parsePoyntCSV(csvText, { tenantId, source: 'poynt_csv' });

    // Persister
    const dbResult = await csvParser.persistTransactions(pool, transactions);

    ok(res, {
      file:         req.file.originalname,
      format,
      stats,
      db:           dbResult,
      parseErrors:  parseErrors.slice(0, 10),
      preview:      transactions.slice(0, 5).map(t => ({
        id: t.externalId, date: t.txDate, gross: t.amountGross,
        net: t.amountNet, description: t.description, status: t.status,
      })),
    });
  } catch(e) { err(res, e.message); }
});

// Preview CSV sans persistance (dry-run)
router.post('/preview-csv', requireAuth, upload.single('csvFile'), async (req, res) => {
  try {
    if (!req.file) return err(res, 'Aucun fichier CSV');
    const csvText = req.file.buffer.toString('utf-8');
    const { transactions, stats, errors: parseErrors, format } = csvParser.parsePoyntCSV(csvText, { tenantId: 'preview', source: 'preview' });
    ok(res, { format, stats, parseErrors, transactions: transactions.slice(0, 20) });
  } catch(e) { err(res, e.message); }
});

// ══ OPTION B — Webhooks Natifs GoDaddy Payments ════════════════

// Endpoint webhook (public — pas requireAuth, vérifié par HMAC)
router.post('/webhook', async (req, res) => {
  try {
    // Utiliser le rawBody injecté par express.raw middleware (monté dans index.js)
    const rawBody = req.rawBody || req.body;
    const result  = await wh.handleWebhook(pool, rawBody, req.headers);
    if (!result.success && result.code === 401)
      return res.status(401).json({ error: result.error });
    res.json({ received: true, ...result });
  } catch(e) {
    bus.system(`[GDWebhook] ❌ Erreur: ${e.message}`);
    res.status(200).json({ received: true, error: e.message }); // 200 pour éviter retry storm
  }
});

// Instructions de configuration webhook (HUD)
router.get('/webhook/setup', requireAuth, (req, res) => {
  const baseUrl = `${req.protocol}://${req.get('host')}`;
  ok(res, wh.getSetupInstructions(baseUrl));
});

module.exports = router;
