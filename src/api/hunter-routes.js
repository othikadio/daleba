// src/api/hunter-routes.js
// Routes API — Agent Chasseur DALEBA

'use strict';

const express = require('express');
const router = express.Router();
const hunter = require('../services/agent-hunter');

// GET /api/hunter/status — résumé des découvertes
router.get('/status', (req, res) => {
  res.json({ status: 'operational', ...hunter.getDiscoverySummary() });
});

// GET /api/hunter/discoveries — liste complète
router.get('/discoveries', (req, res) => {
  const { status, canIntegrate } = req.query;
  res.json(hunter.getDiscoveries({ status, canIntegrate: canIntegrate === 'true' }));
});

// POST /api/hunter/scan — déclenchement manuel d'un cycle
router.post('/scan', async (req, res) => {
  try {
    const newItems = await hunter.runHuntCycle();
    res.json({ success: true, newDiscoveries: newItems.length, items: newItems.slice(0, 5) });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// POST /api/hunter/activate — activer une découverte
router.post('/activate', async (req, res) => {
  const { discoveryId } = req.body;
  if (!discoveryId) return res.status(400).json({ error: 'discoveryId requis' });
  const result = await hunter.activateDiscovery(discoveryId);
  res.json(result);
});

module.exports = router;
