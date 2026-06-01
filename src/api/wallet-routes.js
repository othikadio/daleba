/**
 * wallet-routes.js — Apple/Google Wallet pour clients Kadio Coiffure
 * POST /api/wallet/generate/:customerId
 * GET  /api/wallet/download/:customerId/apple
 * GET  /api/wallet/download/:customerId/google
 */
const express = require('express');
const router = express.Router();
const { pool } = require('../memory/db');
const walletService = require('../services/wallet-service');

// ── Cache en mémoire (évite regénération répétée) ────────────────────────────
const walletCache = new Map();

// ── Lookup client depuis DB ──────────────────────────────────────────────────
async function getCustomer(customerId) {
  try {
    // Chercher par ID, phone, ou email
    const res = await pool.query(`
      SELECT id, name, phone, email,
             COALESCE(loyalty_points, 0) AS points,
             (SELECT MAX(start_time) FROM appointments WHERE client_phone = c.phone AND start_time > NOW())::text AS next_visit
      FROM clients c
      WHERE c.id::text = $1 OR c.phone = $1 OR c.email = $1
      LIMIT 1
    `, [String(customerId)]);
    if (res.rows.length > 0) return res.rows[0];
  } catch (e) {
    console.warn('[wallet] DB lookup failed, using fallback:', e.message);
  }
  // Fallback: client démo
  return {
    id: customerId,
    name: 'Client Kadio',
    phone: customerId,
    points: 0,
    next_visit: null
  };
}

// POST /api/wallet/generate/:customerId
router.post('/generate/:customerId', async (req, res) => {
  try {
    const { customerId } = req.params;
    const customer = await getCustomer(customerId);
    const result = await walletService.generateWalletCards({
      id: customer.id || customerId,
      name: customer.name,
      phone: customer.phone,
      points: parseInt(customer.points) || 0,
      nextVisit: customer.next_visit || null
    });
    // Cache 10min
    walletCache.set(customerId, { result, ts: Date.now() });
    res.json({
      success: true,
      customerId,
      customer: { name: customer.name, points: customer.points },
      apple: { available: true, demoMode: result.apple.demoMode },
      google: { available: true, saveUrl: result.google.saveUrl, demoMode: result.google.demoMode }
    });
  } catch (e) {
    console.error('[wallet/generate]', e.message);
    res.status(500).json({ error: e.message });
  }
});

// GET /api/wallet/download/:customerId/apple
router.get('/download/:customerId/apple', async (req, res) => {
  try {
    const { customerId } = req.params;
    let cached = walletCache.get(customerId);
    if (!cached || Date.now() - cached.ts > 600000) {
      const customer = await getCustomer(customerId);
      const result = await walletService.generateWalletCards({
        id: customer.id || customerId,
        name: customer.name,
        phone: customer.phone,
        points: parseInt(customer.points) || 0,
        nextVisit: customer.next_visit || null
      });
      cached = { result, ts: Date.now() };
      walletCache.set(customerId, cached);
    }
    const { apple } = cached.result;
    // Mode démo: envoyer pass.json comme application/json (téléchargeable)
    res.setHeader('Content-Disposition', `attachment; filename="kadio-coiffure-${customerId}.pkpass.json"`);
    res.setHeader('Content-Type', 'application/json');
    res.json({
      _note: apple.note,
      _demoMode: true,
      pass: apple.passJson
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// GET /api/wallet/download/:customerId/google
router.get('/download/:customerId/google', async (req, res) => {
  try {
    const { customerId } = req.params;
    let cached = walletCache.get(customerId);
    if (!cached || Date.now() - cached.ts > 600000) {
      const customer = await getCustomer(customerId);
      const result = await walletService.generateWalletCards({
        id: customer.id || customerId,
        name: customer.name,
        phone: customer.phone,
        points: parseInt(customer.points) || 0,
        nextVisit: customer.next_visit || null
      });
      cached = { result, ts: Date.now() };
      walletCache.set(customerId, cached);
    }
    const { google } = cached.result;
    // Redirect vers Google Pay save URL
    res.redirect(google.saveUrl);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

module.exports = router;
