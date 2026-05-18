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
const bus = require('../services/event-bus');
const stats = require('../services/daleba-stats');
const strategicMem = require('../services/strategic-memory');
const claude = require('../agents/claude');
const gpt4o = require('../agents/gpt4o');
const deepseek = require('../agents/deepseek');

const AGENTS = { claude, gpt4o, deepseek };

// ─── ZENITH HUD ENDPOINTS ────────────────────────────────────────────────────

// GET /api/stats — Stats snapshot pour le HUD Zenith (poll toutes les 25s)
router.get('/stats', async (req, res) => {
  try {
    const s = await stats.getZenithStats();
    res.json(s);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/zenith/stream — SSE temps réel pour le terminal HUD
router.get('/zenith/stream', (req, res) => {
  bus.subscribe(req, res);
});

// GET /api/zenith/finance — Données financières pour les graphiques
router.get('/zenith/finance', async (req, res) => {
  try {
    const [timeSeries, projections] = await Promise.all([
      stats.getFinancialTimeSeries(),
      stats.getProjections(),
    ]);
    res.json({ timeSeries, projections, ts: new Date().toISOString() });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/zenith/events — Derniers 50 événements du bus (pour hydratation)
router.get('/zenith/events', (req, res) => {
  res.json({ events: bus.getRecent(50) });
});

// ─── MÉMOIRE STRATÉGIQUE ULRICH ──────────────────────────────────────────────

// POST /api/memory — Sauvegarder une note/vision
router.post('/memory', async (req, res) => {
  try {
    const note = await strategicMem.saveNote(req.body);
    bus.system(`Note stratégique: [${note.category}] ${note.title.slice(0, 40)}`);
    res.status(201).json({ success: true, note });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// GET /api/memory — Lister les notes
router.get('/memory', async (req, res) => {
  try {
    const notes = await strategicMem.getNotes(req.query);
    res.json({ notes, count: notes.length });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/memory/summary — Résumé pour le HUD
router.get('/memory/summary', async (req, res) => {
  try {
    const summary = await strategicMem.getStrategicSummary();
    res.json(summary);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// PATCH /api/memory/:id — Modifier une note
router.patch('/memory/:id', async (req, res) => {
  try {
    const note = await strategicMem.updateNote(req.params.id, req.body);
    res.json({ success: true, note });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// DELETE /api/memory/:id
router.delete('/memory/:id', async (req, res) => {
  try {
    await strategicMem.deleteNote(req.params.id);
    res.json({ success: true });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

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
    const basePrompt = systemPrompt || DALEBA_SYSTEM_PROMPT;

    // 3b. Pont Cérébral — injecte Square + mémoire stratégique si requête admin
    const { enrichSystemPrompt } = require('../services/brain-context');
    const effectiveSystemPrompt = await enrichSystemPrompt(message, basePrompt);

    // 4. Appel au modèle sélectionné
    const agent = AGENTS[model];
    const result = await agent.query(message, effectiveSystemPrompt, history);

    // 5. Sauvegarde en mémoire
    await saveExchange(sid, message, result.content, model, reason);
    stats.incrementChat(sid);
    bus.chat(`[${model}] ${message.slice(0, 60)}${message.length > 60 ? '…' : ''}`, { model, sid: sid.slice(0, 8) });

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

// ─── COMMUNICATION HUB (V19) ─────────────────────────────────────────────────────────────────
const commHub = require('../services/communication-hub');

// Webhook WhatsApp (Twilio ou Meta Cloud API)
router.post('/webhook/whatsapp', async (req, res) => {
  const parsed = commHub.parseWhatsAppWebhook(req.body);
  if (!parsed) return res.sendStatus(200);
  try {
    await commHub.receiveMessage(parsed);
  } catch (err) {
    bus.emit('error', `WhatsApp webhook: ${err.message}`);
  }
  res.sendStatus(200);
});

// Webhook Facebook Messenger
router.post('/webhook/facebook', async (req, res) => {
  if (req.query['hub.verify_token'] === process.env.META_VERIFY_TOKEN) {
    return res.send(req.query['hub.challenge']);
  }
  const parsed = commHub.parseFacebookWebhook(req.body);
  if (parsed) await commHub.receiveMessage(parsed).catch(() => {});
  res.sendStatus(200);
});

// Webhook Instagram DMs
router.post('/webhook/instagram', async (req, res) => {
  if (req.query['hub.verify_token'] === process.env.META_VERIFY_TOKEN) {
    return res.send(req.query['hub.challenge']);
  }
  const parsed = commHub.parseInstagramWebhook(req.body);
  if (parsed) await commHub.receiveMessage(parsed).catch(() => {});
  res.sendStatus(200);
});

// Webhook SMS Twilio entrant
router.post('/webhook/sms', async (req, res) => {
  const parsed = commHub.parseSMSWebhook(req.body);
  if (!parsed) return res.sendStatus(200);
  try {
    const { response } = await commHub.receiveMessage(parsed);
    // Réponse TwiML si Twilio attend une réponse directe
    res.set('Content-Type', 'text/xml');
    res.send(`<?xml version="1.0" encoding="UTF-8"?><Response></Response>`);
  } catch (err) {
    bus.emit('error', `SMS webhook: ${err.message}`);
    res.sendStatus(200);
  }
});

// ─── LOYALTY ENGINE (V19) ────────────────────────────────────────────────────────────────────
const loyalty = require('../services/loyalty-engine');

// GET /api/loyalty/summary — Résumé du programme fidélité (HUD)
router.get('/loyalty/summary', async (req, res) => {
  try {
    const summary = await loyalty.getLoyaltySummary();
    res.json(summary);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/loyalty/profile/:phone — Profil fidélité d'un client
router.get('/loyalty/profile/:phone', async (req, res) => {
  try {
    const profile = await loyalty.getLoyaltyProfile(req.params.phone);
    if (!profile) return res.status(404).json({ error: 'Client non trouvé' });
    res.json(profile);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/loyalty/award — Créditer des points manuellement
router.post('/loyalty/award', async (req, res) => {
  const { phone, name, amountCAD, squareCustomerId } = req.body;
  if (!phone || !amountCAD) return res.status(400).json({ error: 'phone et amountCAD requis' });
  try {
    const record = await loyalty.awardPoints({ phone, name, amountCAD, squareCustomerId, source: 'manual' });
    res.json({ success: true, record });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/loyalty/campaign — Déclencher campagne réengagement
router.post('/loyalty/campaign', async (req, res) => {
  const { inactiveDays = 30 } = req.body;
  try {
    const result = await loyalty.runReengagementCampaign(inactiveDays);
    res.json({ success: true, ...result });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── SOCIAL SCHEDULER (V19) ─────────────────────────────────────────────────────────────────
const social = require('../services/social-scheduler');

// POST /api/social/generate — Générer du contenu via LLM
router.post('/social/generate', async (req, res) => {
  const { topic, style, platform, language } = req.body;
  if (!topic) return res.status(400).json({ error: 'topic requis' });
  try {
    const content = await social.generateContent({ topic, style, platform, language });
    res.json(content);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/social/schedule — Planifier une publication
router.post('/social/schedule', async (req, res) => {
  try {
    const post = await social.schedulePost(req.body);
    res.status(201).json({ success: true, post });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/social/auto — Pipeline auto hebdomadaire
router.post('/social/auto', async (req, res) => {
  try {
    const posts = await social.autoGenerateWeeklyContent();
    res.json({ success: true, posts, count: posts.length });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/social/publish — Publier les posts en attente
router.post('/social/publish', async (req, res) => {
  try {
    const result = await social.publishPendingPosts();
    res.json({ success: true, ...result });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── SALON WEB API (V19) ────────────────────────────────────────────────────────────────────────

// POST /api/salon/booking — Requêtes de réservation depuis le site web
router.post('/salon/booking', async (req, res) => {
  const { name, phone, email, service, preferredDate, message: clientMsg, channel = 'web' } = req.body;
  if (!name || !phone) return res.status(400).json({ error: 'name et phone requis' });

  try {
    bus.booking(`Demande web: ${name} — ${service || 'service non précisé'}`);

    // Analyse brain-context pour réponse intelligente
    const { enrichSystemPrompt } = require('../services/brain-context');
    const claude = require('../agents/claude');
    const { DALEBA_SYSTEM_PROMPT } = require('../agents/persona');

    const query = `Nouveau lead web: ${name} (${phone}${email ? ', '+email : ''}) souhaite ${service || 'un rendez-vous'} le ${preferredDate || 'date non précisée'}. Message: "${clientMsg || ''}". Prépare une confirmation et demande les infos manquantes.`;
    const enriched = await enrichSystemPrompt(query, DALEBA_SYSTEM_PROMPT);
    const result = await claude.query(query, enriched, []);

    res.json({
      success: true,
      message: 'Demande reçue',
      dalebaSuggestion: result.content,
      lead: { name, phone, email, service, preferredDate },
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/salon/botanique — Diagnostic capillaire + recommandations Bar à Plantes
router.post('/salon/botanique', async (req, res) => {
  const { name, hairType, concerns, currentProducts, goals } = req.body;
  if (!concerns) return res.status(400).json({ error: 'concerns requis (ex: sécheresse, casse, etc.)' });

  try {
    bus.system(`[BOTANIQUE] Diagnostic: ${name || 'client'} — ${concerns}`);

    const claude = require('../agents/claude');
    const systemPrompt = `Tu es l'experte en soins capillaires du Bar à Plantes de Kadio Coiffure.
Tu maîtrises les soins botaniques naturels pour cheveux afro, crépus, bouclés et défrisés.
Produits phares: huiles essentielles, beurres (karité, cacao), plantes (hibiscus, moringa, aloe vera).
Ton diagnostic est personnalisé, professionnel et accessible.`;

    const query = `Diagnostic capillaire pour ${name || 'ce client'}:
- Type de cheveux: ${hairType || 'non précisé'}
- Problèmes: ${concerns}
- Produits actuels: ${currentProducts || 'non précisé'}
- Objectifs: ${goals || 'non précisé'}

Donne: 1) Analyse du profil capillaire 2) Routine soins recommandée 3) Produits botaniques adaptés 4) Conseil pro Kadio Coiffure`;

    const result = await claude.query(query, systemPrompt, []);

    res.json({
      success: true,
      diagnostic: result.content,
      profile: { name, hairType, concerns, goals },
      bookingCta: 'Réservez votre consultation Bar à Plantes: daleba.vercel.app/reservation',
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
