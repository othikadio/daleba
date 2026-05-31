'use strict';
/**
 * DALEBA — Wallet Routes (V47)
 * QR codes, previews cartes membres, scan tracking
 */

const express = require('express');
const router  = express.Router();
const walletService = require('../services/wallet-service');
const axios = require('axios');

const SQUARE_TOKEN = process.env.SQUARE_ACCESS_TOKEN || 'EAAAl621sVKBGg0JYZaOIMRv7iHe8aOPxX5Ub6-Rfnrr5J9ovhf4dRC-i1WZrgC3';
const FRONTEND_URL = process.env.FRONTEND_URL || 'https://kadiocoiffure.vercel.app';

let pool = null;
try { const db = require('../memory/db'); pool = db.pool; } catch(e) {}

// ── DB init ───────────────────────────────────────────────────────────────────
async function ensureQRScansTable() {
  if (!pool) return;
  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS daleba_qr_scans (
        id         SERIAL PRIMARY KEY,
        client_id  TEXT NOT NULL,
        scanned_at TIMESTAMP DEFAULT NOW(),
        ip         TEXT
      )
    `);
  } catch (e) {
    console.warn('[wallet] ensureQRScansTable:', e.message);
  }
}
ensureQRScansTable();

// ── Square helper ─────────────────────────────────────────────────────────────
async function getSquareCustomer(clientId) {
  try {
    const resp = await axios.get(`https://connect.squareup.com/v2/customers/${clientId}`, {
      headers: { Authorization: `Bearer ${SQUARE_TOKEN}`, 'Square-Version': '2024-01-17' },
      timeout: 8000
    });
    return resp.data.customer || null;
  } catch (e) {
    console.warn('[wallet] Square customer fetch failed:', e.message);
    // Mode démo — client fictif
    return {
      id: clientId,
      given_name: 'Client',
      family_name: 'Demo',
      email_address: 'demo@kadiocoiffure.com',
      phone_number: '+15141234567',
      created_at: new Date().toISOString()
    };
  }
}

async function getLoyaltyPoints(clientId) {
  if (!pool) return 0;
  try {
    const r = await pool.query(
      `SELECT points FROM daleba_loyalty WHERE customer_id = $1 LIMIT 1`,
      [clientId]
    );
    return r.rows[0]?.points || 0;
  } catch (e) {
    return 0;
  }
}

// ── Routes ────────────────────────────────────────────────────────────────────

/**
 * GET /api/wallet/qr/:clientId
 * Retourne une image PNG du QR code
 */
router.get('/api/wallet/qr/:clientId', async (req, res) => {
  try {
    const { clientId } = req.params;
    const buffer = await walletService.generateQRCode(clientId);
    res.setHeader('Content-Type', 'image/png');
    res.setHeader('Cache-Control', 'public, max-age=3600');
    res.send(buffer);
  } catch (e) {
    console.error('[wallet] QR error:', e);
    res.status(500).json({ error: 'Erreur génération QR', details: e.message });
  }
});

/**
 * GET /api/wallet/preview/:clientId
 * Retourne la page HTML de preview de la carte
 */
router.get('/api/wallet/preview/:clientId', async (req, res) => {
  try {
    const { clientId } = req.params;
    const [customer, points] = await Promise.all([
      getSquareCustomer(clientId),
      getLoyaltyPoints(clientId)
    ]);
    const html = await walletService.generateWalletPreviewHTML(customer, points);
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.send(html);
  } catch (e) {
    console.error('[wallet] preview error:', e);
    res.status(500).json({ error: 'Erreur preview', details: e.message });
  }
});

/**
 * GET /api/wallet/pkpass/:clientId
 * Télécharge un .pkpass (Apple Wallet) — nécessite certs Apple Developer
 */
router.get('/api/wallet/pkpass/:clientId', async (req, res) => {
  try {
    const { clientId } = req.params;
    const [customer, points] = await Promise.all([
      getSquareCustomer(clientId),
      getLoyaltyPoints(clientId)
    ]);
    const buffer = await walletService.generatePkPass(customer, points);
    if (!buffer) {
      // Pas de certs — rediriger vers la preview HTML
      return res.redirect(`/api/wallet/preview/${clientId}`);
    }
    res.setHeader('Content-Type', 'application/vnd.apple.pkpass');
    res.setHeader('Content-Disposition', `attachment; filename="kadio-membre-${clientId}.pkpass"`);
    res.send(buffer);
  } catch (e) {
    console.error('[wallet] pkpass error:', e);
    res.redirect(`/api/wallet/preview/${req.params.clientId}`);
  }
});

/**
 * GET /api/wallet/pass-data/:clientId
 * Retourne les infos JSON du pass
 */
router.get('/api/wallet/pass-data/:clientId', async (req, res) => {
  try {
    const { clientId } = req.params;
    const [customer, points] = await Promise.all([
      getSquareCustomer(clientId),
      getLoyaltyPoints(clientId)
    ]);
    const name = customer.given_name
      ? `${customer.given_name} ${customer.family_name || ''}`.trim()
      : (customer.name || 'Membre');
    res.json({
      memberId: clientId,
      name,
      email: customer.email_address || null,
      phone: customer.phone_number || null,
      points,
      status: points >= 500 ? 'VIP' : 'Membre',
      joinDate: customer.created_at,
      qrUrl: `${process.env.BACKEND_URL || 'https://daleba-api-production.up.railway.app'}/api/wallet/qr/${clientId}`,
      previewUrl: `${process.env.BACKEND_URL || 'https://daleba-api-production.up.railway.app'}/api/wallet/preview/${clientId}`,
      cardUrl: `${process.env.BACKEND_URL || 'https://daleba-api-production.up.railway.app'}/wallet-card/${clientId}`
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

/**
 * GET /scan/:clientId
 * Point de scan public — logge le scan et redirige vers admin
 */
router.get('/scan/:clientId', async (req, res) => {
  const { clientId } = req.params;
  const ip = req.headers['x-forwarded-for'] || req.socket.remoteAddress || null;

  // Loguer le scan
  if (pool) {
    try {
      await pool.query(
        `INSERT INTO daleba_qr_scans (client_id, ip) VALUES ($1, $2)`,
        [clientId, ip]
      );
    } catch (e) {
      console.warn('[wallet] scan log failed:', e.message);
    }
  }

  // Rediriger vers la fiche admin (si connecté) ou la page mobile légère
  const adminUrl = `${FRONTEND_URL}/admin-clients.html?client=${clientId}`;
  res.redirect(adminUrl);
});

/**
 * GET /wallet-card/:clientId
 * Page publique mobile-friendly de la carte membre
 */
router.get('/wallet-card/:clientId', async (req, res) => {
  const { clientId } = req.params;
  try {
    const [customer, points] = await Promise.all([
      getSquareCustomer(clientId),
      getLoyaltyPoints(clientId)
    ]);
    const html = await walletService.generateWalletPreviewHTML(customer, points);
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.send(html);
  } catch (e) {
    res.status(500).send('<h2>Erreur lors du chargement de la carte</h2>');
  }
});

/**
 * GET /api/wallet/scan-stats
 * Stats pour dashboard admin
 */
router.get('/api/wallet/scan-stats', async (req, res) => {
  try {
    if (!pool) return res.json({ today: 0, total: 0, recentScans: [] });
    const [todayR, totalR, recentR] = await Promise.all([
      pool.query(`SELECT COUNT(*) FROM daleba_qr_scans WHERE scanned_at > NOW() - INTERVAL '1 day'`),
      pool.query(`SELECT COUNT(*) FROM daleba_qr_scans`),
      pool.query(`SELECT client_id, scanned_at, ip FROM daleba_qr_scans ORDER BY scanned_at DESC LIMIT 20`)
    ]);
    res.json({
      today: parseInt(todayR.rows[0].count),
      total: parseInt(totalR.rows[0].count),
      recentScans: recentR.rows
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

module.exports = router;
