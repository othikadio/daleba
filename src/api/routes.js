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
const voiceRoutes    = require('./voice-routes');   // V22 — Agent Vocal
const onboardingRoutes = require('./onboarding-routes'); // V23 — SaaS Multi-Tenant
const videoRoutes = require('./video-routes'); // V24 — Studio Vidéo Botanique
const dareRoutes = require('./dare-routes'); // DARE — Dynamic Agnostic Routing Engine
const commanderRoutes = require('./commander-routes'); // Commander — DAE + Swarm + Rollback
const integrationRoutes = require('./integration-routes'); // Integration Hub + Docs
const { requireAuth } = require('../middleware/auth');
const { resolveTenant } = require('../middleware/tenant');
const { v4: uuidv4 } = require('uuid');
const { selectModel, explainRouting } = require('../router');
const dare = require('../agents/dare');
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

// Routes Onboarding SaaS (publiques — V23)
router.use('/onboarding', onboardingRoutes);

// Routes Entreprises (super_admin)
router.use('/businesses', requireAuth, businessRoutes);

// Middleware tenant sur toutes les routes suivantes
router.use(resolveTenant);

// POST /api/chat — Point d'entrée principal DALEBA (avec persona de guerre)
router.post('/chat', async (req, res) => {
  const { message, sessionId, forceModel, systemPrompt, senderPhone, senderTelegramId } = req.body;

  if (!message) {
    return res.status(400).json({ error: 'Message requis' });
  }

  // [076-080] Intercept commandes Commandant (SMS ou Telegram)
  const cmdInterp = require('../services/command-interpreter');
  const senderKey = senderPhone || senderTelegramId;
  const channel   = senderTelegramId ? 'telegram' : (senderPhone ? 'sms' : null);
  if (senderKey && channel) {
    const cmdResult = await cmdInterp.handleIncoming(message, senderKey, channel).catch(() => null);
    if (cmdResult?.handled && cmdResult?.response) {
      return res.json({ response: cmdResult.response, _command: true });
    }
    if (cmdResult?.blocked) return res.json({ response: '', _blocked: true });
  }

  const sid = sessionId || uuidv4();

  try {
    // 1. Sélection du modèle optimal via DARE
    const dareResult = dare.selectProvider(message, { forceProvider: forceModel });
    const model = dareResult.provider;
    const reason = dareResult.reason;

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

    // 4. Appel au modèle sélectionné via DARE (avec failover automatique)
    const result = await dare.executeWithFailover(message, effectiveSystemPrompt, history, { forceProvider: forceModel });

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

// V22 — Twilio Voice Webhooks (non authentifiés — validés par signature Twilio)
router.use('/webhook', voiceRoutes);

// V24 — Studio Vidéo Botanique
router.use('/video', videoRoutes);
router.use('/dare', dareRoutes); // DARE — Metacortex Routing Engine
router.use('/commander', commanderRoutes); // Commander — DAE + Swarm + Shield
router.use('/v1/integration/ext-app', integrationRoutes); // [082] External App API
router.use('/', integrationRoutes); // [088] /api/docs (mount sur la racine aussi)

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

// POST /api/social/auto — Pipeline auto hebdomadaire (3 posts: botanique + abonnements + TikTok)
router.post('/social/auto', async (req, res) => {
  try {
    const { generateWeeklyTriple } = require('../services/auto-scheduler');
    const posts = await generateWeeklyTriple(req.body?.perfContext || '');
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
  const { name, phone, email, hairType, concerns, currentProducts, goals } = req.body;
  if (!concerns) return res.status(400).json({ error: 'concerns requis (ex: sécheresse, casse, etc.)' });

  try {
    bus.system(`[BOTANIQUE] Diagnostic: ${name || 'client'} — ${concerns}`);

    const claude = require('../agents/claude');
    const systemPrompt = `Tu es l'experte en soins capillaires du Bar à Plantes de Kadio Coiffure.
Tu maîtrises les soins botaniques naturels pour cheveux afro, crépus, bouclés et défrisés.
Produits phares: huiles essentielles, beurres (karité, cacao), plantes (hibiscus, moringa, aloe vera).
Inclure TOUJOURS: 1) Recette maison personnalisée avec proportions exactes, 2) Routine hebdomadaire, 3) CTA réservation.
Ton diagnostic est professionnel, accessible et chaleureux.`;

    const query = `Diagnostic capillaire pour ${name || 'ce client'}:
- Type de cheveux: ${hairType || 'non précisé'}
- Problèmes principaux: ${concerns}
- Produits actuels: ${currentProducts || 'non précisé'}
- Objectifs: ${goals || 'non précisé'}

Génère:
1) Analyse du profil capillaire
2) RECETTE BOTANIQUE PERSONNALISÉE (ingrédients + proportions + mode d'application)
3) Routine soins hebdomadaire (3 étapes max)
4) Lien réservation soin Bar à Plantes: https://daleba.vercel.app/reservation`;

    const result = await claude.query(query, systemPrompt, []);
    const diagnosticText = result.content;

    // ── Envoi automatique SMS/WhatsApp si téléphone fourni ──────────────────
    if (phone) {
      const twilio = require('../services/twilio');
      const shortMsg = `Bonjour ${name || ''} ! 🌿 Voici votre diagnostic capillaire personnalisé du Bar à Plantes Kadio Coiffure :\n\n${diagnosticText.slice(0, 600)}${diagnosticText.length > 600 ? '...' : ''}\n\n📅 Réservez votre soin: https://daleba.vercel.app/reservation`;

      // Tentative WhatsApp en priorité, fallback SMS
      const dest = `whatsapp:${phone}`;
      twilio.sendSMS(dest, shortMsg).catch(() => {
        // Fallback SMS classique
        twilio.sendSMS(phone, shortMsg).catch(err => {
          bus.emit('error', `[BOTANIQUE] Envoi SMS échoué: ${err.message}`);
        });
      });

      bus.sms(`[BOTANIQUE] Diagnostic envoyé à ${phone}`);
    }

    res.json({
      success: true,
      diagnostic: diagnosticText,
      profile: { name, hairType, concerns, goals },
      smsSent: !!phone,
      bookingCta: 'https://daleba.vercel.app/reservation',
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── COMMANDER ALERTS (V21) ────────────────────────────────────────────────
const alerts = require('../services/commander-alerts');

// POST /api/commander/test — Envoyer une alerte de test à Ulrich
router.post('/commander/test', async (req, res) => {
  try {
    const result = await alerts.sendTestAlert();
    res.json({ success: true, ...result });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/commander/status — Statut du système d'alertes
router.get('/commander/status', (req, res) => {
  res.json({
    active: true,
    ulrichConfigured: !!process.env.ULRICH_PHONE_NUMBER,
    twilioConfigured: !!(process.env.TWILIO_ACCOUNT_SID && process.env.TWILIO_AUTH_TOKEN),
    thresholds: alerts.THRESHOLDS,
    nextChecks: {
      bigPayments: 'toutes les heures',
      lastMinuteCancellations: 'toutes les heures',
      weeklyRevenue: 'toutes les heures',
    },
  });
});

// POST /api/commander/check — Déclencher un scan manuel immédiat
router.post('/commander/check', async (req, res) => {
  try {
    await alerts.runAllAlertChecks();
    res.json({ success: true, message: 'Scan complet déclenché' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── CONTENT QUEUE HUD (V21) ────────────────────────────────────────────────

// GET /api/social/queue — Posts en attente de validation (pour HUD/admin)
router.get('/social/queue', async (req, res) => {
  try {
    const { pool, DEMO_MODE } = require('../memory/db');
    if (DEMO_MODE) return res.json({ posts: [], demo: true });
    const result = await pool.query(
      `SELECT * FROM daleba_content_queue WHERE status = 'pending' ORDER BY scheduled_at ASC LIMIT 20`
    );
    res.json({ posts: result.rows, count: result.rows.length });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/social/approve/:id — Approuver un post (status → approved)
router.post('/social/approve/:id', async (req, res) => {
  try {
    const { pool } = require('../memory/db');
    const result = await pool.query(
      `UPDATE daleba_content_queue SET status = 'approved', updated_at = NOW() WHERE id = $1 RETURNING *`,
      [req.params.id]
    );
    if (!result.rows.length) return res.status(404).json({ error: 'Post non trouvé' });
    bus.system(`[SOCIAL] Post #${req.params.id} approuvé par Ulrich`);
    res.json({ success: true, post: result.rows[0] });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// DELETE /api/social/queue/:id — Rejeter/supprimer un post
router.delete('/social/queue/:id', async (req, res) => {
  try {
    const { pool } = require('../memory/db');
    await pool.query(`UPDATE daleba_content_queue SET status = 'rejected' WHERE id = $1`, [req.params.id]);
    bus.system(`[SOCIAL] Post #${req.params.id} rejeté`);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── V25 : POSTE DE COMMANDEMENT — ENDPOINTS ────────────────────────────────

// POST /api/commander/chat — Chat direct avec Béatrice depuis le dashboard admin
router.post('/commander/chat', async (req, res) => {
  try {
    const { message, history = [] } = req.body;
    if (!message) return res.status(400).json({ error: 'message requis' });

    const claudeAgent = require('../agents/claude');
    const { enrichSystemPrompt } = require('../services/brain-context');

    const systemBase = `Tu es Béatrice, l'IA de DALEBA — système de gestion intelligent pour Kadio Coiffure.
Tu parles directement à Ulrich (le propriétaire) depuis son Poste de Commandement Admin.
Sois concise, professionnelle et proactive. Tu as accès aux données Square, aux alertes et aux logs.
Réponds en français. Si Ulrich pose des questions opérationnelles (RDV, revenus, alertes), synthétise les données disponibles.
Date/heure actuelle : ${new Date().toLocaleString('fr-CA', { timeZone: 'America/Toronto' })}`;

    const enriched = await enrichSystemPrompt(message, systemBase).catch(() => systemBase);
    // claude.query(message, systemPrompt, history) — retourne { content, model, usage }
    const result = await claudeAgent.query(message, enriched, history);
    const response = typeof result === 'string' ? result : (result.content || result.text || JSON.stringify(result));

    bus.system(`[COMMANDER/CHAT] Ulrich: ${message.slice(0, 60)}`);
    res.json({ response, ts: new Date().toISOString() });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/commander/daily-report — Rapport quotidien visuel (Square + alertes + logs)
router.get('/commander/daily-report', async (req, res) => {
  try {
    const journal = require('../services/journal');
    const today = new Date().toISOString().slice(0, 10);

    // Stats Square + système
    let zenithStats = {};
    try { zenithStats = await stats.getZenithStats(); } catch (e) { zenithStats = {}; }

    // Journal du jour
    let journalEntries = [];
    try { journalEntries = await journal.getDailyJournal(today); } catch (e) { journalEntries = []; }

    // Alertes commander
    const commanderStatus = {
      active: true,
      ulrichConfigured: !!process.env.ULRICH_PHONE_NUMBER,
      twilioConfigured: !!(process.env.TWILIO_ACCOUNT_SID && process.env.TWILIO_AUTH_TOKEN),
    };

    // Queue sociale en attente
    let pendingSocialCount = 0;
    try {
      const { pool } = require('../memory/db');
      const r = await pool.query(`SELECT COUNT(*) FROM daleba_content_queue WHERE status = 'pending'`);
      pendingSocialCount = parseInt(r.rows[0]?.count || '0', 10);
    } catch (e) { pendingSocialCount = 0; }

    bus.system(`[COMMANDER/REPORT] Rapport quotidien généré pour ${today}`);

    res.json({
      date: today,
      generatedAt: new Date().toISOString(),
      stats: {
        appointmentsToday:  zenithStats.appointmentsToday  || 0,
        revenueToday:       zenithStats.revenueToday       || 0,
        clientsTotal:       zenithStats.clientsTotal       || 0,
        smsEnvoyes:         zenithStats.smsSent            || 0,
        chatRequests:       zenithStats.chatRequests       || 0,
        bookingsMade:       zenithStats.bookingsMade       || 0,
      },
      security: {
        commanderActive:    commanderStatus.active,
        ulrichConfigured:   commanderStatus.ulrichConfigured,
        twilioConfigured:   commanderStatus.twilioConfigured,
        recentAlerts:       zenithStats.recentAlerts || [],
      },
      social: {
        pendingApproval:    pendingSocialCount,
      },
      journal: journalEntries.slice(-10).map(e => ({
        type:    e.entry_type,
        summary: e.summary,
        ts:      e.created_at,
      })),
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/webhook/voice/test — Simulation d'appel (dev/admin, sans Twilio)
router.post('/webhook/voice/test', async (req, res) => {
  try {
    const { speech = 'Bonjour, je voudrais prendre un rendez-vous pour samedi prochain' } = req.body;
    const voiceAgent = require('../services/voice-agent');

    // Appel direct à analyzeWithLLM exposé via module
    const result = await voiceAgent.testAnalyze(speech, '+15141234567');

    bus.system(`[VOICE/TEST] Simulation: "${speech.slice(0, 50)}" → intent=${result.intent}`);
    res.json({
      success:         true,
      speech,
      intent:          result.intent,
      frustrationScore: result.frustrationScore,
      llmResponse:     result.llmResponse,
      bookingDetails:  result.bookingDetails || {},
      escalate:        result.frustrationScore >= 70,
      ts:              new Date().toISOString(),
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── V29 : ARMURE VISUELLE ABSOLUE ────────────────────────────────

const imageEngine   = require('../services/image-engine');
const imageUpscaler = require('../services/image-upscaler');

// GET /api/image/styles — Styles tenant disponibles
router.get('/image/styles', (req, res) => {
  res.json({ styles: imageEngine.TENANT_STYLES });
});

// POST /api/image/generate — Génération visuel d'élite
router.post('/image/generate', async (req, res) => {
  try {
    const { prompt, style = 'beauty', model, tenantName, width, height } = req.body;
    if (!prompt) return res.status(400).json({ error: 'prompt requis' });
    const result = await imageEngine.generateEliteVisual(prompt, style, { model, tenantName, width, height });
    res.json(result);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// POST /api/image/enrich-prompt — Enrichissement prompt seul (preview avant génération)
router.post('/image/enrich-prompt', async (req, res) => {
  try {
    const { prompt, style = 'beauty', tenantName } = req.body;
    if (!prompt) return res.status(400).json({ error: 'prompt requis' });
    const enriched = await imageEngine.enrichVisualPrompt(prompt, style, tenantName || 'Kadio Coiffure');
    const model    = imageEngine.selectModel(style, style);
    res.json({ original: prompt, enriched, recommendedModel: model, style });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// POST /api/image/variants — Génération multi-variantes A/B
router.post('/image/variants', async (req, res) => {
  try {
    const { prompt, style = 'social', count = 2 } = req.body;
    if (!prompt) return res.status(400).json({ error: 'prompt requis' });
    const result = await imageEngine.generateVisualVariants(prompt, style, Math.min(count, 4));
    res.json(result);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// POST /api/image/upscale — Upscale + finition 4K
router.post('/image/upscale', async (req, res) => {
  try {
    const { imageUrl, imageType = 'product' } = req.body;
    if (!imageUrl) return res.status(400).json({ error: 'imageUrl requis' });
    const result = await imageUpscaler.runUpscalePipeline(imageUrl, imageType);
    res.json(result);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// POST /api/image/full — Génération + upscale en une passe
router.post('/image/full', async (req, res) => {
  try {
    const { prompt, style = 'beauty', imageType, tenantName } = req.body;
    if (!prompt) return res.status(400).json({ error: 'prompt requis' });

    // 1. Générer
    const generated = await imageEngine.generateEliteVisual(prompt, style, { tenantName });

    // 2. Upscale si image disponible (pas en mode mock)
    let upscaled = null;
    if (generated.url && !generated.url.includes('placehold.co')) {
      upscaled = await imageUpscaler.runUpscalePipeline(
        generated.url, imageType || style
      ).catch(e => ({ error: e.message }));
    }

    res.json({ generated, upscaled });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ─── V27 : OMNICORE ALPHA — PIPELINE MÉDIA & FILET SÉCURITÉ ───────────────

const videoPipeline = require('../services/video-pipeline');
const errorWatcher  = require('../services/error-watcher');

// GET /api/video/platforms — Profils plateformes disponibles
router.get('/video/platforms', (req, res) => {
  res.json({ platforms: videoPipeline.PLATFORM_PROFILES });
});

// POST /api/video/test — Génère une vidéo de test (color bars) sans source externe
router.post('/video/test', async (req, res) => {
  try {
    const result = await videoPipeline.generateTestVideo();
    res.json({ success: true, ...result });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// POST /api/video/subtitles — Génère un SRT à partir d'un script
router.post('/video/subtitles', async (req, res) => {
  try {
    const { script, durationSec = 30 } = req.body;
    if (!script) return res.status(400).json({ error: 'script requis' });
    const lines = await videoPipeline.generateSubtitles(script, durationSec);
    const srt   = videoPipeline.buildSRT(lines);
    res.json({ lines, srt, count: lines.length });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// GET /api/errors/report — Rapport des erreurs récentes
router.get('/errors/report', (req, res) => {
  const report = errorWatcher.getErrorReport(parseInt(req.query.limit) || 20);
  res.json(report);
});

// POST /api/errors/test-alert — Déclenche une alerte SMS test (dev/admin)
router.post('/errors/test-alert', async (req, res) => {
  try {
    const fakeCtx = {
      method: 'POST', path: '/api/test',
      statusCode: 500, errorMessage: 'Test alerte error-watcher V27',
      classification: errorWatcher.classifyError(500, '/api/test', 'Test'),
      ts: new Date().toISOString(),
    };
    const patch  = await errorWatcher.generatePatchSuggestion(fakeCtx);
    const result = await errorWatcher.sendErrorAlertSMS(fakeCtx, patch);
    res.json({ success: true, patch, smsResult: result });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ─── V26 : ONBOARDING UNIVERSEL & CERVEAU AUTONOME ──────────────────────────────

const onboardingTelephony = require('../services/onboarding-telephony');
const autonomousMarketing = require('../services/autonomous-marketing');
const tenantFinances      = require('../services/tenant-finances');

// POST /api/onboarding/telephony — Lancer l'onboarding téléphonique complet
router.post('/onboarding/telephony', async (req, res) => {
  try {
    const { tenantId, tenantName, tenantEmail, countryCode, areaCode, existingPhone } = req.body;
    if (!tenantId || !tenantName) return res.status(400).json({ error: 'tenantId et tenantName requis' });
    const result = await onboardingTelephony.runTelephonyOnboarding({
      tenantId, tenantName, tenantEmail, countryCode, areaCode, existingPhone,
    });
    res.json(result);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// POST /api/onboarding/forwarding — Générer instructions transfert d'appel uniquement
router.post('/onboarding/forwarding', (req, res) => {
  try {
    const { tenantPhone, dalebaNumber, countryCode = 'CA' } = req.body;
    if (!tenantPhone || !dalebaNumber) return res.status(400).json({ error: 'tenantPhone et dalebaNumber requis' });
    const result = onboardingTelephony.generateForwardingInstructions(tenantPhone, dalebaNumber, countryCode);
    res.json(result);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// GET /api/onboarding/mmi-codes — Liste des codes MMI par pays
router.get('/onboarding/mmi-codes', (req, res) => {
  const codes = {};
  for (const [code, profile] of Object.entries(onboardingTelephony.MMI_PROFILES)) {
    if (code === 'DEFAULT') continue;
    codes[code] = { country: profile.country, prefix: profile.prefix, note: profile.carrierNote };
  }
  res.json({ countries: codes, total: Object.keys(codes).length });
});

// POST /api/marketing/analyze — Analyser le taux de remplissage agenda
router.post('/marketing/analyze', async (req, res) => {
  try {
    const { tenantId } = req.body;
    const analysis = await autonomousMarketing.analyzeWeekFillRate(tenantId);
    res.json(analysis);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// POST /api/marketing/worker — Lancer le worker marketing autonome
router.post('/marketing/worker', async (req, res) => {
  try {
    const { tenantId } = req.body;
    const result = await autonomousMarketing.runMarketingWorker(tenantId);
    res.json(result);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// GET /api/finances/report — Rapport financier tenant
router.get('/finances/report', async (req, res) => {
  try {
    const { tenantId = 'kadio', period = 'month' } = req.query;
    const report = await tenantFinances.getTenantFinancialReport(tenantId, period);
    res.json(report);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// POST /api/finances/sync — Sync manuelle des paiements Square
router.post('/finances/sync', async (req, res) => {
  try {
    const { tenantId = 'kadio', countryCode = 'CA', province = 'QC' } = req.body;
    await tenantFinances.initFinancesTable();
    const result = await tenantFinances.runDailyFinanceSync(tenantId, countryCode, province);
    res.json({ success: true, ...result });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// GET /api/finances/tax-rates — Taux de taxes par pays
router.get('/finances/tax-rates', (req, res) => {
  res.json({ rates: tenantFinances.TAX_RATES });
});

module.exports = router;
