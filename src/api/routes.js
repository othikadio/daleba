const express = require('express');
const router = express.Router();
const { v4: uuidv4 } = require('uuid');
const { selectModel, explainRouting } = require('../router');
const { saveExchange, getHistory, saveAnnale } = require('../memory/db');
const claude = require('../agents/claude');
const gpt4o = require('../agents/gpt4o');
const deepseek = require('../agents/deepseek');

const AGENTS = { claude, gpt4o, deepseek };

// POST /api/chat — Point d'entrée principal DALEBA
router.post('/chat', async (req, res) => {
  const { message, sessionId, forceModel, systemPrompt } = req.body;

  if (!message) {
    return res.status(400).json({ error: 'Message requis' });
  }

  const sid = sessionId || uuidv4();

  try {
    // 1. Sélection du modèle optimal
    const model = selectModel(message, { forceModel });
    const reason = explainRouting(model, message);

    // 2. Récupération de l'historique
    const rawHistory = await getHistory(sid, 8);
    const history = rawHistory.map(h => ([
      { role: 'user', content: h.user_message },
      { role: 'assistant', content: h.ai_response },
    ])).flat();

    // 3. Appel au modèle sélectionné
    const agent = AGENTS[model];
    const result = await agent.query(message, systemPrompt, history);

    // 4. Sauvegarde en mémoire
    await saveExchange(sid, message, result.content, model, reason);

    // 5. Réponse
    res.json({
      sessionId: sid,
      model: result.model,
      routing: reason,
      response: result.content,
      usage: result.usage,
    });

  } catch (err) {
    console.error('❌ Erreur DALEBA:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// GET /api/history/:sessionId — Historique d'une session
router.get('/history/:sessionId', async (req, res) => {
  const history = await getHistory(req.params.sessionId, 20);
  res.json({ history });
});

// GET /api/status — Santé du système
router.get('/status', (req, res) => {
  res.json({
    status: 'online',
    name: 'DALEBA Core v1',
    version: '1.0.0',
    models: ['claude', 'gpt4o', 'deepseek'],
    timestamp: new Date().toISOString(),
  });
});

// POST /api/emergency-stop — Disjoncteur (Point 10)
router.post('/emergency-stop', (req, res) => {
  const { masterKey } = req.body;
  if (masterKey !== process.env.DALEBA_MASTER_KEY) {
    return res.status(403).json({ error: 'Clé invalide' });
  }
  console.log('🚨 ARRÊT D\'URGENCE DÉCLENCHÉ');
  res.json({ status: 'stopped', message: 'DALEBA arrêtée par commande maître' });
  process.exit(0);
});

module.exports = router;
