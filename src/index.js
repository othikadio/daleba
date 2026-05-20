require('dotenv').config();
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const morgan = require('morgan');
const routes = require('./api/routes');
const { errorMiddleware, enableSelfHealing, logError } = require('./services/error-monitor');
const errorWatcher = require('./services/error-watcher'); // V27 — Filet de Sécurité
const { startFollowupCron } = require('./services/client-followup');
const dare = require('./agents/dare');
const dareMonitor = require('./services/dare-monitor');
const swarm = require('./services/swarm');
const maintenance = require('./services/maintenance');
const shield = require('./services/notification-shield');
const cmdInterpreter = require('./services/command-interpreter');
const studioWatcher  = require('./services/studio-watcher');
const trendScraper      = require('./services/trend-scraper');
const mediaInspector    = require('./services/media-inspector');
const contentQueue      = require('./services/content-queue');
const mediaScheduler    = require('./services/media-scheduler');
const analyticsScraper  = require('./services/analytics-scraper');
const commentHandler    = require('./services/comment-handler');
const tokenVault        = require('./services/token-vault');
const mediaCleanup      = require('./services/media-cleanup');
const transactionIngester  = require('./services/transaction-ingester');
const cashflowEngine       = require('./services/cashflow-engine');
const costTracker          = require('./services/infrastructure-cost-tracker');
const taxDigestSvc         = require('./services/tax-digest');
const metaAdsSvc           = require('./services/meta-ads');
const financialSimulator   = require('./services/financial-simulator');
const budgetGuard          = require('./services/budget-guard');
const { studioStaticGuard } = require('./middleware/studio-auth');

const path = require('path');
const app = express();
const PORT = process.env.PORT || 3000;

// [244] Compression gzip — minimise transfert Railway → Twilio
const compression = require('compression');
app.use(compression({
  // Exclure les routes TwiML du gzip : Twilio attend du XML brut sans encoding
  // Les autres routes (JSON, HTML) bénéficient de la compression
  filter: (req, res) => {
    const ct = res.getHeader('Content-Type') || '';
    if (String(ct).includes('application/xml')) return false; // TwiML sans gzip [244]
    return compression.filter(req, res);
  },
  threshold: 1024, // Compresser seulement si > 1KB
  level: 6,
}));

// Middlewares
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'", "'unsafe-inline'"],
      styleSrc: ["'self'", "'unsafe-inline'", "https://fonts.googleapis.com"],
      fontSrc: ["'self'", "https://fonts.gstatic.com", "data:"],
      imgSrc: ["'self'", "data:", "blob:"],
      connectSrc: ["'self'"],
      workerSrc: ["'self'", "blob:"],
    }
  }
}));
app.use(cors());
app.use(express.json({ limit: '10mb' }));
app.use(morgan('combined'));

// Fichiers statiques (frontend)
// [148] Protéger /public/studio/exports
app.use('/studio/exports', studioStaticGuard);
app.use(express.static(path.join(__dirname, '../public')));

// Routes DALEBA
app.use('/api', routes);

// Middleware erreurs (Point 12)
app.use(errorMiddleware);
app.use(errorWatcher.middleware); // V27 — surveillance 4xx/5xx + patch SMS Ulrich

// Accueil (page principale)
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, '../public/accueil.html'));
});

// Booking page
app.get('/reservation', (req, res) => {
  res.sendFile(path.join(__dirname, '../public/reservation.html'));
});

// Dashboard → redirect
app.get('/dashboard', (req, res) => {
  res.sendFile(path.join(__dirname, '../public/dashboard.html'));
});

// Tableau de bord contenu social (V21)
app.get('/admin/images', (req, res) => {
  res.sendFile(path.join(__dirname, '../public/admin-images.html'));
});
// [139] Studio Media HUD
app.get('/admin/studio', (req, res) => {
  res.sendFile(path.join(__dirname, '../public/admin-studio.html'));
});
// [181] Dashboard financier
app.get('/admin/finances', (req, res) => {
  res.sendFile(path.join(__dirname, '../public/admin-finances.html'));
});
// [239-240] Journal des appels HUD
app.get('/admin/calls', (req, res) => {
  res.sendFile(path.join(__dirname, '../public/admin-calls.html'));
});
// [241] API calls today — proxy route (voice-routes étant sous /api/webhook)
app.get('/api/voice/calls/today', async (req, res) => {
  const callLog = require('./services/call-log');
  res.json(await callLog.getTodayCallLogs(req.query.tenant || 'kadio', 100));
});
app.get('/api/voice/recording/:sid', (req, res) => {
  // [240] Proxy audio depuis Twilio (auth requise en prod)
  const sid = req.params.sid;
  if (!process.env.TWILIO_ACCOUNT_SID) return res.status(404).json({ error: 'Twilio non configuré' });
  const url = `https://api.twilio.com/2010-04-01/Accounts/${process.env.TWILIO_ACCOUNT_SID}/Recordings/${sid}.mp3`;
  res.redirect(url);
});
// [148] Token studio pour accès exports
app.post('/api/auth/studio-token', (req, res) => {
  const { secret } = req.body || {};
  const expected = process.env.ADMIN_SECRET || process.env.ANTHROPIC_API_KEY?.slice(-8);
  if (!expected || secret !== expected) return res.status(401).json({ error: 'Secret invalide' });
  const { generateStudioToken } = require('./middleware/studio-auth');
  res.json({ token: generateStudioToken({ email: 'ulrich@kadio' }) });
});

// [273-274] Interface admin locataires
app.get('/admin/tenants', (req, res) => {
  res.sendFile(path.join(__dirname, '../public/admin-tenants.html'));
});

app.get('/admin/onboarding', (req, res) => {
  res.sendFile(path.join(__dirname, '../public/admin-onboarding.html'));
});

app.get('/admin/dashboard', (req, res) => {
  res.sendFile(path.join(__dirname, '../public/admin-dashboard.html'));
});

app.get('/admin/content', (req, res) => {
  res.sendFile(path.join(__dirname, '../public/content-dashboard.html'));
});

// Interface holographique ZENITH
app.get('/zenith', (req, res) => {
  res.sendFile(path.join(__dirname, '../public/zenith.html'));
});

// [098] Health endpoint deep — 99.9% uptime target
app.get('/health', async (req, res) => {
  const deep = req.query.deep === 'true';
  const ts   = new Date().toISOString();

  const base = {
    name: 'DALEBA Core', version: '2.0.0',
    status: 'online', ts,
    uptime: Math.round(process.uptime()) + 's',
    memory: { heapUsedMB: Math.round(process.memoryUsage().heapUsed / 1024 / 1024) },
    owner: 'Kadio Ehouman Ulrich',
  };

  if (!deep) return res.json(base);

  // Deep health: DARE + DB + Twilio check
  const checks = {};
  try { const dare = require('./agents/dare'); checks.dare = dare.getStatus().providers.filter(p => p.health.status === 'healthy').length + ' providers healthy'; } catch { checks.dare = 'error'; }
  try { const m = require('./services/maintenance'); await m.query('SELECT 1'); checks.db = 'ok'; } catch { checks.db = 'error'; }
  try { checks.twilio = process.env.TWILIO_ACCOUNT_SID ? 'configured' : 'missing'; } catch { checks.twilio = 'error'; }
  try { const am = require('./services/agent-manager'); checks.agents = am.getStatus().stats.liveAgents + ' live'; } catch { checks.agents = 'error'; }

  const allOk = !Object.values(checks).some(v => v === 'error');
  res.status(allOk ? 200 : 503).json({ ...base, checks, healthy: allOk });
});

// Alias /ping + /api/status pour Railway healthcheck
app.get('/ping', (_, res) => res.send('pong'));
app.get('/api/status', (_, res) => res.json({ status: 'online', ts: new Date().toISOString(), version: process.env.npm_package_version || '2.0' }));

// ─── SELF-HEALING (Point 13) ─────────────────────────────────────────────────
enableSelfHealing();

process.on('uncaughtException', (err) => {
  logError(err, 'UNCAUGHT_EXCEPTION');
  console.error('💀 Erreur critique — DALEBA redémarre dans 3s...');
  setTimeout(() => process.exit(1), 3000);
});

process.on('unhandledRejection', (reason) => {
  logError(reason instanceof Error ? reason : new Error(String(reason)), 'UNHANDLED_REJECTION');
  console.error('⚠️ Promesse rejetée non gérée:', reason);
});

// ─── CRON FOLLOWUP CLIENTS (Point 40) ────────────────────────────────────────
if (!process.env.VERCEL && !process.env.AWS_LAMBDA_FUNCTION_NAME) {
  startFollowupCron();
  // V20 — Cruise Control: routines autonomes fidélité + contenu social
  const { startV20Crons, scheduleBiweeklyPayrollClose } = require('./services/auto-scheduler');
  startV20Crons();
  // [323] Cron clôture quinzaine de paie
  const { pool: dbPool } = require('./memory/db');
  scheduleBiweeklyPayrollClose(dbPool);
  // DARE — Metacortex: health check loop + monitor continu
  dare.startHealthCheckLoop(120000);
  dareMonitor.start();
  // Swarm — Orchestrateur micro-agents
  swarm.start();
  // Maintenance — nettoyage disque toutes les 4h [089]
  maintenance.startAutoCleanup();
  // pg-pool indexes [090]
  maintenance.ensureIndexes().catch(e => console.warn('[Boot] Indexes:', e.message));
  // [144] Token Vault + Log Filter
  tokenVault.loadFromEnv();
  tokenVault.installLogFilter();
  // Studio Watcher [102] + Trend Scheduler [108]
  mediaInspector.ensureStudioTable().catch(e => console.warn('[Boot] studio_assets:', e.message));
  studioWatcher.start();
  trendScraper.startTrendScheduler();
  // Content queue table [124]
  contentQueue.ensureQueueTable().catch(e => console.warn('[Boot] content_queue:', e.message));
  // Media Scheduler [126, 129]
  mediaScheduler.start();
  // Analytics 24h [132] + Comment Poller [135]
  analyticsScraper.startAnalyticsScheduler();
  commentHandler.startCommentPoller(30 * 60 * 1000); // toutes les 30min
  // [143] Cleanup post-publication toutes les 3h
  mediaCleanup.startCleanupScheduler();
  // [160] Init tables finances (tenant_ledgers + staff_tips)
  transactionIngester.ensureTables().catch(e => console.warn('[Boot] finances tables:', e.message));
  // [164] Cashflow forecast 23h30 UTC
  cashflowEngine.startCashflowScheduler();
  // [168] Infrastructure cost tracker + persistance horaire
  costTracker.startCostPersistenceScheduler();
  // [186] Rapport hebdomadaire dimanche 23h59
  taxDigestSvc.startWeeklyReportScheduler();
  // [176] Meta Ads pull toutes les 12h
  metaAdsSvc.startAdSpendScheduler();
  // [190, 198] Tables coûts fixes + index SaaS scale
  financialSimulator.ensureFixedCostsTable().catch(e => console.warn('[Boot] fixed_costs:', e.message));
  financialSimulator.ensureSaaSScaleIndexes().catch(e => console.warn('[Boot] saas_scale:', e.message));
  // Daily Digest — 20h heure salon [075]
  const ULRICH_PHONE = process.env.ULRICH_PHONE_NUMBER;
  const TWILIO_FROM  = process.env.TWILIO_PHONE_NUMBER;
  if (ULRICH_PHONE && TWILIO_FROM) {
    shield.scheduleDailyDigest(async (digest) => {
      await shield.shieldedSMS(ULRICH_PHONE, TWILIO_FROM, digest, { windowMs: 0 });
    });
  }
  // [241] Scan post-appel vocal toutes les heures (stocks botaniques)
  const callLogSvc = require('./services/call-log');
  setInterval(() => {
    callLogSvc.analyzeNewVoiceBookings('kadio').catch(()=>{});
  }, 60 * 60 * 1000); // 1h
  // [238] Purge enregistrements expirés toutes les 24h
  const callRecorderSvc = require('./services/call-recorder');
  setInterval(() => {
    callRecorderSvc.purgeExpiredRecordings().catch(()=>{});
  }, 24 * 60 * 60 * 1000); // 24h
}

// ─── SMS KILL SWITCH — Purge cooldowns corrompus au démarrage ──────────────
const smsKillSwitch = require('./services/sms-kill-switch');
const { pool: _pool } = require('./memory/db');
smsKillSwitch.purgeStaleAlerts(_pool).catch(() => {});
bus.system(`[SMSKillSwitch] Statut: ${JSON.stringify(smsKillSwitch.getStatus())}`);

// Démarrage — skip listen() en mode serverless (Vercel)
if (!process.env.VERCEL && !process.env.AWS_LAMBDA_FUNCTION_NAME) {
  app.listen(PORT, () => {
    console.log(`
╔══════════════════════════════════════════╗
║     DALEBA CORE v2.0 — EN LIGNE         ║
║     Port: ${PORT}                           ║
║     Propriétaire: Kadio Ulrich           ║
║     Piliers: I+II+III+IV+V actifs 🚀     ║
╚══════════════════════════════════════════╝
    `);
  });
}

module.exports = app;
