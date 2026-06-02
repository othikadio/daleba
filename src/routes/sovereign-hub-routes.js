// src/routes/sovereign-hub-routes.js
// Routes API — Hub Souverain Multi-Agents DALEBA
'use strict';

const express = require('express');
const router = express.Router();
const fleet = require('../services/sovereign-fleet');

// GET /api/sovereign/status — état de la flotte
router.get('/status', (req, res) => {
  res.json({
    ok: true,
    fleet: fleet.getFleetStatus(),
    available: fleet.getAvailableModels(),
    timestamp: new Date().toISOString(),
  });
});

// POST /api/sovereign/chat — envoi d'un message au routeur
router.post('/chat', async (req, res) => {
  try {
    const { messages, forceModel, taskHint, systemPrompt } = req.body;
    if (!messages || !Array.isArray(messages) || messages.length === 0) {
      return res.status(400).json({ ok: false, error: 'messages array required' });
    }
    const result = await fleet.route(messages, { forceModel, taskHint, systemPrompt });
    res.json({ ok: true, ...result });
  } catch (err) {
    console.error('[SovereignHub] chat error:', err);
    res.status(500).json({ ok: false, error: err.message });
  }
});

// GET /api/sovereign/detect — détection de tâche seulement (debug)
router.get('/detect', (req, res) => {
  const { q } = req.query;
  const task = fleet.detectTask(q || '');
  const routing = fleet.ROUTING_MATRIX[task] || fleet.ROUTING_MATRIX.default;
  res.json({ task, routing, available: routing.filter(id => fleet.FLEET[id]?.available()) });
});

module.exports = router;
