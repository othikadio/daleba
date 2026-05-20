'use strict';
/**
 * DALEBA — Routes Fidélisation Hybride
 *
 * POST /api/loyalty/earn        — enregistrer des points (comptoir uniquement)
 * POST /api/loyalty/redeem      — appliquer la réduction 20$
 * GET  /api/loyalty/balance/:phone
 * GET  /api/loyalty/history/:phone
 * GET  /api/loyalty/leaderboard — top clients (admin)
 */

const express = require('express');
const router = express.Router();
const loyalty = require('../services/loyalty-hybrid');

// POST /api/loyalty/earn
router.post('/earn', async (req, res) => {
  const { clientPhone, clientName, amountPaid, source, staffId, description } = req.body;
  if (!clientPhone || !amountPaid) {
    return res.status(400).json({ error: 'clientPhone et amountPaid requis' });
  }
  // Validation : bloquer les montants négatifs
  if (parseFloat(amountPaid) <= 0) {
    return res.status(400).json({ error: 'amountPaid doit être positif' });
  }
  try {
    const result = await loyalty.earnPoints({ clientPhone, clientName, amountPaid: parseFloat(amountPaid), source: source||'comptoir', staffId, description });
    res.json(result);
  } catch(err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/loyalty/redeem
router.post('/redeem', async (req, res) => {
  const { clientPhone, clientName, staffId } = req.body;
  if (!clientPhone) return res.status(400).json({ error: 'clientPhone requis' });
  try {
    const result = await loyalty.redeemReward({ clientPhone, clientName, staffId });
    if (!result.success) return res.status(400).json(result);
    res.json(result);
  } catch(err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/loyalty/balance/:phone
router.get('/balance/:phone', async (req, res) => {
  try {
    const balance = await loyalty.getBalance(decodeURIComponent(req.params.phone));
    res.json(balance);
  } catch(err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/loyalty/history/:phone
router.get('/history/:phone', async (req, res) => {
  try {
    const history = await loyalty.getHistory(decodeURIComponent(req.params.phone), parseInt(req.query.limit)||20);
    res.json(history);
  } catch(err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/loyalty/check-subscription — valide qu'une source est EXCLUE
router.get('/check-subscription', (req, res) => {
  const { source } = req.query;
  const excluded = loyalty.EXCLUDED_SOURCES.some(s => (source||'').toLowerCase().includes(s));
  res.json({ source, excluded, reason: excluded ? 'Abonnements exclus du circuit points — circuit isolé' : null });
});

module.exports = router;
