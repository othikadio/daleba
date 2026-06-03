'use strict';
const express = require('express');
const router = express.Router();
const catalog = require('../services/stripe-catalog');
const path = require('path');

// GET /api/sales/packages — liste des packages avec liens Stripe
router.get('/packages', async (req, res) => {
  try {
    const packages = await catalog.getPackagesWithLinks();
    res.json({ ok: true, packages });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

// POST /api/sales/sync — force resync catalogue Stripe
router.post('/sync', async (req, res) => {
  try {
    const results = await catalog.syncAll();
    res.json({ ok: true, synced: results.length, results });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

// POST /api/sales/dynamic-link — lien dynamique par montant
router.post('/dynamic-link', async (req, res) => {
  try {
    const { amount, description, email } = req.body;
    if (!amount || !description) return res.status(400).json({ ok: false, error: 'amount + description requis' });
    const url = await catalog.createDynamicPaymentLink(amount, description, email);
    res.json({ ok: true, url });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

// Page de vente publique
router.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, '../../public/daleba-sales.html'));
});

module.exports = router;
