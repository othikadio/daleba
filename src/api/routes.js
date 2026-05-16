const express = require('express');
const router = express.Router();
const paymentRoutes = require('./payment-routes');
const smsRoutes = require('./sms-routes');
const systemRoutes = require('./system-routes');
const prospectionRoutes = require('./prospection-routes');
const authRoutes = require('./auth-routes');
const businessRoutes = require('./business-routes');
const bookingRoutes = require('./booking-routes');
const calendarRoutes = require('./calendar-routes');
const { requireAuth } = require('../middleware/auth');
const { resolveTenant } = require('../middleware/tenant');
const { v4: uuidv4 } = require('uuid');
const { selectModel, explainRouting } = require('../router');
const { saveExchange, getHistory, saveAnnale } = require('../memory/db');
const { logEntry, ENTRY_TYPES } = require('../services/journal');
const claude = require('../agents/claude');
const gpt4o = require('../agents/gpt4o');
const deepseek = require('../agents/deepseek');

const AGENTS = { claude, gpt4o, deepseek };

// Routes Auth (publiques)
router.use('/auth', authRoutes);

// Routes Entreprises (super_admin)
router.use('/businesses', requireAuth, businessRoutes);

// Middleware tenant sur toutes les routes suivantes
router.use(resolveTenant);

// POST /api/chat — Point d’entrée principal DALEBA
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

    // 4b. Journal de bord - log automatique de chaque échange
    await logEntry(
      ENTRY_TYPES.LEARNED,
      `Requête traitée via ${model} - session ${sid.slice(0, 8)}`,
      message.slice(0, 200),
      { model, routing: reason, sessionId: sid }
    ).catch(() => {}); // Non-bloquant

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

// GET /api/history/:sessionId - Historique d'une session
router.get('/history/:sessionId', async (req, res) => {
  const history = await getHistory(req.params.sessionId, 20);
  res.json({ history });
});

// GET /api/status - Santé du système
router.get('/status', (req, res) => {
  res.json({
    status: 'online',
    name: 'DALEBA Core v1',
    version: '1.0.0',
    models: ['claude', 'gpt4o', 'deepseek'],
    timestamp: new Date().toISOString(),
  });
});

// POST /api/emergency-stop - Disjoncteur (Point 10)
router.post('/emergency-stop', (req, res) => {
  const { masterKey } = req.body;
  if (masterKey !== process.env.DALEBA_MASTER_KEY) {
    return res.status(403).json({ error: 'Clé invalide' });
  }
  console.log('🚨 ARRÊT D\'URGENCE DÉCLENCHÉ');
  res.json({ status: 'stopped', message: 'DALEBA arrêtée par commande maître' });
  process.exit(0);
});

// Routes Stripe (paiements)
router.use('/payment', paymentRoutes);

// Routes Twilio (SMS)
router.use('/sms', smsRoutes);

// Routes Système (Journal + Rollback)
router.use('/system', systemRoutes);

// Routes Prospection (GMB Scanner + Cold Outreach)
router.use('/prospects', prospectionRoutes);

// Routes Réservation (publiques — clients)
router.use('/booking', bookingRoutes);

// Routes Calendrier (privé — employés + admin)
router.use('/calendar', calendarRoutes);

module.exports = router;
