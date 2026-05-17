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
const { logError } = require('../services/error-monitor');
const logEvent = (type, data) => logEntry(type, JSON.stringify(data).slice(0, 100), '', data).catch(() => {});
const { postToInstagram, postToFacebook, getSocialStatus } = require('../services/meta-social');
const { getFollowupStats, checkAppointmentFollowups } = require('../services/client-followup');
const finance = require('../services/finance');
const creative = require('../services/creative');
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

// POST /api/chat — Point d'entrée principal DALEBA (avec persona de guerre)
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

    // 3. Injecter le persona DALEBA si pas de systemPrompt explicite (Point 11)
    const { DALEBA_SYSTEM_PROMPT } = require('../agents/persona');
    const effectiveSystemPrompt = systemPrompt || DALEBA_SYSTEM_PROMPT;

    // 4. Appel au modèle sélectionné
    const agent = AGENTS[model];
    const result = await agent.query(message, effectiveSystemPrompt, history);

    // 5. Sauvegarde en mémoire
    await saveExchange(sid, message, result.content, model, reason);

    // 5b. Journal de bord - log automatique de chaque échange
    await logEntry(
      ENTRY_TYPES.LEARNED,
      `Requête traitée via ${model} - session ${sid.slice(0, 8)}`,
      message.slice(0, 200),
      { model, routing: reason, sessionId: sid }
    ).catch(() => {}); // Non-bloquant

    // 6. Réponse
    res.json({
      sessionId: sid,
      model: result.model,
      routing: reason,
      response: result.content,
      usage: result.usage,
    });

  } catch (err) {
    logError(err, 'CHAT_API');
    console.error('❌ Erreur DALEBA:', err.message);
    res.json({
      response: 'DALEBA recalibrant... Veuillez réessayer dans un instant. 🔄',
      error: true,
      sessionId: sid,
    });
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

// Routes Réservation (publiques - clients)
router.use('/booking', bookingRoutes);

// Routes Calendrier (privé - employés + admin)
router.use('/calendar', calendarRoutes);

// ─── ROUTES SOCIAL META (Point 38) ───────────────────────────────────────

router.post('/social/instagram', async (req, res) => {
  const { imageUrl, caption } = req.body;
  if (!imageUrl || !caption) return res.status(400).json({ error: 'imageUrl et caption requis' });
  try {
    const result = await postToInstagram(imageUrl, caption);
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/social/facebook', async (req, res) => {
  const { message, imageUrl } = req.body;
  if (!message) return res.status(400).json({ error: 'message requis' });
  try {
    const result = await postToFacebook(message, imageUrl);
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/social/status', (req, res) => {
  res.json(getSocialStatus());
});

// ─── ROUTES FOLLOWUP (Point 40) ───────────────────────────────────────

router.get('/admin/followup/stats', (req, res) => {
  res.json(getFollowupStats());
});

router.post('/admin/followup/trigger', async (req, res) => {
  try {
    await checkAppointmentFollowups();
    res.json({ success: true, message: 'Scan followup déclenché' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── ROUTES FINANCE (Points 21-26, 28) ─────────────────────────────────

router.get('/finance/stock/:symbol', async (req, res) => {
  try {
    const data = await finance.getStockData(req.params.symbol);
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/finance/crypto/:symbol', async (req, res) => {
  try {
    const data = await finance.getCryptoData(req.params.symbol);
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/finance/paper-portfolio/:userId', async (req, res) => {
  try {
    const portfolio = await finance.getPortfolio(req.params.userId);
    if (!portfolio) return res.status(404).json({ error: 'Portfolio non trouvé' });
    res.json(portfolio);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/finance/paper-trade', async (req, res) => {
  const { userId, action, symbol, quantity } = req.body;
  if (!userId || !action || !symbol || !quantity) {
    return res.status(400).json({ error: 'userId, action, symbol, quantity requis' });
  }
  try {
    if (!finance.portfolios.has(userId)) finance.createPortfolio(userId);
    const result = action === 'buy'
      ? await finance.buyStock(userId, symbol, quantity)
      : await finance.sellStock(userId, symbol, quantity);
    res.json(result);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

router.get('/finance/audit', async (req, res) => {
  try {
    const report = await finance.getWeeklyFinancialReport(req.tenant?.id || 'kadio');
    res.json(report);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── ROUTES CRÉATIF (Points 29-34) ─────────────────────────────────────

router.post('/creative/narrative', async (req, res) => {
  const { concept, genre, chapters } = req.body;
  if (!concept) return res.status(400).json({ error: 'concept requis' });
  try {
    const result = await creative.buildNarrativeStructure(concept, genre, chapters);
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/creative/write', async (req, res) => {
  const { prompt, style, length } = req.body;
  if (!prompt) return res.status(400).json({ error: 'prompt requis' });
  try {
    const result = await creative.writeInStyle(prompt, style, length);
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/creative/proofread', async (req, res) => {
  const { text } = req.body;
  if (!text) return res.status(400).json({ error: 'text requis' });
  try {
    const result = await creative.proofread(text);
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/creative/translate', async (req, res) => {
  const { text, from, to } = req.body;
  if (!text) return res.status(400).json({ error: 'text requis' });
  try {
    const result = await creative.translateLiterarily(text, from, to);
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/creative/ebook', async (req, res) => {
  const { title, subject, chapters, audience } = req.body;
  if (!title || !subject) return res.status(400).json({ error: 'title et subject requis' });
  try {
    const result = await creative.generateEbook(title, subject, chapters, audience);
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── ROUTE JOURNAL ADMIN (Point 17) ──────────────────────────────────────

router.get('/journal/today', async (req, res) => {
  try {
    const entries = await require('../services/journal').getDailyJournal();
    res.json({ date: new Date().toISOString().slice(0, 10), entries, count: entries.length });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
