// src/api/ai-admin-routes.js
// Routes admin pour le Cerveau Central DALEBA — statut + injection de clés

'use strict';

const express = require('express');
const router = express.Router();
const { getProviderStatus, getAvailableProviders, PROVIDERS } = require('../services/ai-router');

// Middleware PIN admin
const ADMIN_PIN = process.env.ADMIN_PIN || '2024DALEBA';
function requirePin(req, res, next) {
  const pin = req.headers['x-admin-pin'] || req.body?.adminPin || req.query?.pin;
  if (pin !== ADMIN_PIN) return res.status(403).json({ error: 'PIN requis' });
  next();
}

// GET /api/ai/status — public (sans valeurs de clés)
router.get('/status', (req, res) => {
  res.json({
    providers: getProviderStatus(),
    available: getAvailableProviders(),
    timestamp: new Date().toISOString(),
  });
});

// POST /api/ai/set-key — protégé PIN
router.post('/set-key', requirePin, (req, res) => {
  const { provider, apiKey } = req.body;
  const providerMap = {
    claude: 'ANTHROPIC_API_KEY',
    openai: 'OPENAI_API_KEY',
    gemini: 'GEMINI_API_KEY',
    deepseek: 'DEEPSEEK_API_KEY',
  };
  const envVar = providerMap[provider];
  if (!envVar) return res.status(400).json({ error: 'Provider inconnu' });
  if (!apiKey || apiKey.length < 8) return res.status(400).json({ error: 'Clé invalide' });

  // Injecter en mémoire pour la session
  process.env[envVar] = apiKey;

  // Mettre à jour la disponibilité dans DARE si chargé
  try {
    const dare = require('../agents/dare');
    if (dare && dare.PROVIDERS && dare.PROVIDERS[provider]) {
      dare.PROVIDERS[provider].available = true;
    }
  } catch (e) { /* DARE peut ne pas exposer PROVIDERS — non-bloquant */ }

  res.json({
    success: true,
    provider,
    message: `Clé ${envVar} activée pour cette session. Ajoutez-la dans Railway pour persister.`,
  });
});

// GET /api/ai/test/:provider — tester un provider avec un ping
router.get('/test/:provider', requirePin, async (req, res) => {
  const { route } = require('../services/ai-router');
  const provider = req.params.provider;
  const validProviders = ['claude', 'openai', 'gemini', 'deepseek'];
  if (!validProviders.includes(provider)) {
    return res.status(400).json({ error: 'Provider inconnu' });
  }
  try {
    const result = await route(
      [{ role: 'user', content: 'Réponds juste "OK" en un mot.' }],
      { forceProvider: provider, taskHint: 'chat' }
    );
    res.json({
      success: !result.fallback,
      provider: result.provider,
      latencyMs: result.latencyMs,
      response: result.text?.slice(0, 100),
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

module.exports = router;
