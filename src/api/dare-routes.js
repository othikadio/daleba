/**
 * DALEBA — Routes DARE (Dynamic Agnostic Routing Engine)
 * DARE Metacortex — Points 001-010
 * 
 * Endpoints HUD + admin pour monitorer et contrôler le moteur de routage IA
 */

const express = require('express');
const router = express.Router();
const dare = require('../agents/dare');

// GET /api/dare/status — Snapshot complet pour le HUD
router.get('/status', (req, res) => {
  res.json(dare.getStatus());
});

// POST /api/dare/health — Force un healthcheck immédiat
router.post('/health', async (req, res) => {
  try {
    await dare.runHealthChecks();
    res.json({ success: true, status: dare.getStatus() });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/dare/test — Test de routage (sans exécuter le LLM)
router.post('/test', (req, res) => {
  const { message, forceProvider } = req.body;
  if (!message) return res.status(400).json({ error: 'message requis' });

  try {
    const routing = dare.selectProvider(message, { forceProvider });
    const provider = dare.PROVIDERS[routing.provider];
    res.json({
      input: message,
      selected: routing,
      providerInfo: {
        name: provider?.name,
        contextWindow: provider?.contextWindow,
        costPer1MInput: provider?.costPer1MInput,
        health: provider?.health,
      },
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/dare/register — Enregistre manuellement un nouveau connecteur
// (remplace l'auto-inscription — point 021-024 mode sécurisé)
router.post('/register', async (req, res) => {
  const { id, name, module: mod, contextWindow, costPer1MInput, costPer1MOutput, strengths } = req.body;

  if (!id || !name || !mod) {
    return res.status(400).json({ error: 'id, name et module sont requis' });
  }

  try {
    dare.registerConnector({ id, name, module: mod, contextWindow, costPer1MInput, costPer1MOutput, strengths: strengths || {} });
    res.json({ success: true, message: `Connecteur ${name} enregistré dans DARE` });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

module.exports = router;
