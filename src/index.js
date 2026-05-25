require('dotenv').config();
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const morgan = require('morgan');
const routes = require('./api/routes');
const clientPortalRoutes = require('./api/client-portal-routes');
const authRoutes = require('./api/auth-routes');
const accountingRoutes = require('./api/accounting-routes');
const loyaltyHybridRoutes = require('./api/loyalty-hybrid-routes');
const mediaRoutes = require('./api/media-routes');
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
const requireAdminPin = require('./middleware/adminAuth');

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
// rawBody middleware — utilise le verify callback pour capturer le raw body
// SANS consommer le stream avant express.json (fix bug 500 webhooks)
app.use(express.json({
  limit: '10mb',
  verify: (req, _res, buf) => {
    if (req.path && req.path.includes('/webhook')) {
      req.rawBody = buf.toString('utf8');
    }
  }
}));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));
app.use(morgan('combined'));

// Fichiers statiques (frontend)
// [148] Protéger /public/studio/exports
app.use('/studio/exports', studioStaticGuard);
app.use(express.static(path.join(__dirname, '../public')));

// Routes DALEBA
// V32: Booking live — montage direct AVANT routes générales (Square slots + SMS)
app.use('/api/booking', require('./api/booking-routes'));
app.use('/api/oauth/meta', require('./api/meta-oauth-routes')); // Meta OAuth — 1 clic PME
app.use('/api', routes);
app.use('/api/ai', require('./api/ai-admin-routes')); // Hub IA universel — Cerveau Central
app.use('/api/auth', require('./api/otp-auth-routes')); // V31-AUTH: OTP phone (monté PREMIER — request-otp + verify-otp avec {phone,code})
app.use('/api/auth', authRoutes); // Auth legacy: login email, register, /me, /super
app.use('/api/qr',   require('./api/qr-routes'));         // V31-AUTH: QR abonnés
app.use('/api/staff', require('./api/staff-scan-routes')); // V31-AUTH: scan QR
app.use('/api/vip',  require('./api/vip-welcome-routes')); // V31-AUTH: VIP accueil
app.use('/api/rating', require('./api/rating-routes'));    // V31-AUTH: notation + bouclier Google
app.use('/api/client-portal', clientPortalRoutes);
app.use('/api/accounting', accountingRoutes);
app.use('/api/loyalty', loyaltyHybridRoutes);
app.use('/api/media', mediaRoutes);
app.use('/api/hunter', require('./api/hunter-routes')); // Agent chasseur IA
app.use('/api/opportunities', require('./api/opportunity-routes'));
app.use('/api/proposals',    require('./api/proposal-routes'));
app.use('/api/revenue',      require('./api/revenue-routes')); // Radar Planétaire — opportunités mondiales
app.use('/api/voice', require('./api/voice-dashboard-routes'));     // Jarvis — commande vocale + meta
app.use('/api/dashboard', require('./api/voice-dashboard-routes')); // Jarvis — statut meta + site
app.use('/api/salon', require('./api/salon-ops-routes'));  // V35 — Arrivée VIP + ratings + bouclier Google
app.use('/api/staff', require('./api/staff-routes'));       // V35 — /api/staff/scan-qr
app.use('/api/training', require('./api/training-routes')); // V31 — Ingestion conversations historiques + Style DNA
app.use('/api/sq-calendar', require('./api/square-calendar-routes')); // Chantier 2 — Calendrier Square multi-staff
app.use('/api/public', require('./api/public-booking-routes')); // Site public — booking Kadio Coiffure
app.use('/api/staff-auth', require('./api/auth-staff-routes')); // Authentification staff JWT + PIN
app.use('/api/staff-portal', require('./api/staff-portal-routes')); // Portail staff — dashboard, notes, agenda
app.use('/api/notifications', require('./api/notification-routes')); // Chantier A — SMS auto RDV

// Middleware erreurs (Point 12)
app.use(errorMiddleware);
app.use(errorWatcher.middleware); // V27 — surveillance 4xx/5xx + patch SMS Ulrich

// Accueil (page principale)
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, '../public/index.html'));
});

// Booking page
app.get('/reservation', (req, res) => {
  res.sendFile(path.join(__dirname, '../public/reservation.html'));
});
app.get('/login', (req, res) => {
  res.sendFile(path.join(__dirname, '../public/login.html'));
});
app.get('/portail-client', (req, res) => {
  res.sendFile(path.join(__dirname, '../public/portail-client.html'));
});
app.get('/portail-staff', (req, res) => {
  res.sendFile(path.join(__dirname, '../public/portail-staff.html'));
});
app.get('/agenda', (req, res) => {
  res.sendFile(path.join(__dirname, '../public/agenda.html'));
});
app.get('/scan-qr', (req, res) => {
  res.sendFile(path.join(__dirname, '../public/scan-qr.html'));
});
app.get('/noter-service', (req, res) => {
  res.sendFile(path.join(__dirname, '../public/noter-service.html'));
});

// Dashboard → redirect
app.get('/dashboard', (req, res) => {
  res.sendFile(path.join(__dirname, '../public/dashboard.html'));
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

// Portail Staff
app.get('/admin/login', (req, res) => {
  res.sendFile(path.join(__dirname, '../public/admin/login.html'));
});
app.get('/admin/staff-portal', (req, res) => {
  res.sendFile(path.join(__dirname, '../public/admin/staff-portal.html'));
});
app.get('/admin/team-manager', (req, res) => {
  res.sendFile(path.join(__dirname, '../public/admin/team-manager.html'));
});

// Chantier 2 — Calendrier Square multi-staff
app.get('/admin/calendar', (req, res) => {
  res.sendFile(path.join(__dirname, '../public/admin/calendar.html'));
});

// [273-274] Interface admin locataires
app.get('/admin/images', requireAdminPin, (req, res) => {
  res.sendFile(path.join(__dirname, '../public/admin-images.html'));
});

app.get('/admin/tenants', (req, res) => {
  res.sendFile(path.join(__dirname, '../public/admin-tenants.html'));
});

app.get('/admin/onboarding', (req, res) => {
  res.sendFile(path.join(__dirname, '../public/admin-onboarding.html'));
});

app.get('/admin/dashboard', (req, res) => {
  res.sendFile(path.join(__dirname, '../public/admin-dashboard.html'));
});

// JARVIS — Interface vocale Ulrich (route étanche, priorité absolue)
app.get('/jarvis', (req, res) => {
  res.sendFile(path.join(__dirname, '../public/jarvis.html'));
});

app.get('/admin/content', (req, res) => {
  res.sendFile(path.join(__dirname, '../public/content-dashboard.html'));
});

// Interface holographique ZENITH
app.get('/zenith', (req, res) => {
  res.sendFile(path.join(__dirname, '../public/zenith.html'));
});

// [Section 15] Portail client public — Menu & Forfaits
app.get('/menu', (req, res) => {
  res.sendFile(path.join(__dirname, '../public/menu.html'));
});
app.get('/forfaits', (req, res) => {
  res.sendFile(path.join(__dirname, '../public/forfaits.html'));
});
app.get('/formation', (req, res) => {
  res.sendFile(path.join(__dirname, '../public/formation.html'));
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

  // [Section 16] Reminder Worker SMS — toutes les heures
  const { runReminderWorker } = require('./workers/reminder-worker');
  setInterval(runReminderWorker, 60 * 60 * 1000); // toutes les heures
  runReminderWorker(); // run immédiatement au démarrage

  // [Chantier A] Notifications SMS auto (confirmation + rappels 24h/2h + staff 1h)
  const apptNotifier = require('./services/appointment-notifier');
  apptNotifier.scheduleReminders();

  // [Manifeste] Pôle Média — worker publication toutes les 30 min
  const mediaPipeline = require('./services/media-pipeline');
  mediaPipeline.init().catch(e => console.warn('[Boot] Media pipeline:', e.message));
  setInterval(mediaPipeline.runPublishWorker, 30 * 60 * 1000);

  // Chantier 1 — Meta History Puller : pull au démarrage si vide, puis toutes les 6h
  const metaHistoryPuller = require('./services/meta-history-puller');
  metaHistoryPuller.ensureSyncTable().catch(e => console.warn('[Boot] sync_state:', e.message));
  setImmediate(async () => {
    try {
      const isEmpty = await metaHistoryPuller.isTrainingTableEmpty();
      if (isEmpty) {
        console.log('[META-PULLER] Table vide — pull initial au démarrage...');
        await metaHistoryPuller.pullAll();
      }
    } catch (e) { console.warn('[META-PULLER] Pull initial:', e.message); }
  });
  setInterval(() => {
    metaHistoryPuller.pullAll().catch(e => console.warn('[META-PULLER] Pull 6h:', e.message));
  }, 6 * 60 * 60 * 1000); // toutes les 6h

  // [Manifeste] Comptabilité — init tables
  const accounting = require('./services/accounting');
  accounting.init().catch(e => console.warn('[Boot] Accounting:', e.message));

  // [Manifeste] Fidélité hybride — init tables
  const loyaltyHybrid = require('./services/loyalty-hybrid');
  loyaltyHybrid.init().catch(e => console.warn('[Boot] Loyalty hybrid:', e.message));

  // [Section 16] Init tables SMS Pipeline + Staff Calendar
  const smsPipeline = require('./services/sms-pipeline');
  const staffCalendar = require('./services/staff-calendar');
  smsPipeline.ensureTables().catch(e => console.warn('[Boot] SMS Pipeline tables:', e.message));
  staffCalendar.ensureTable().catch(e => console.warn('[Boot] Staff Calendar table:', e.message));
}

// ─── SMS KILL SWITCH — Purge cooldowns corrompus au démarrage ──────────────
const smsKillSwitch = require('./services/sms-kill-switch');
const { pool: _pool } = require('./memory/db');
smsKillSwitch.purgeStaleAlerts(_pool).catch(() => {});
try { require('./services/event-bus').system(`[SMSKillSwitch] Statut: ${JSON.stringify(smsKillSwitch.getStatus())}`); } catch(_e) {}

// Démarrage — skip listen() en mode serverless (Vercel)
if (!process.env.VERCEL && !process.env.AWS_LAMBDA_FUNCTION_NAME) {
  // Démarrer le chasseur d'agents IA autonome
  const { startHunter } = require('./services/agent-hunter');
  startHunter().catch(e => console.warn('[Hunter] Démarrage:', e.message));

  // Radar Planétaire — scan opportunités mondiales toutes les 4h
  const { startOpportunityWorker } = require('./workers/opportunity-worker');
  startOpportunityWorker();

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
