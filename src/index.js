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

const path = require('path');
const app = express();
const PORT = process.env.PORT || 3000;

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

// Alias /ping pour Railway healthcheck
app.get('/ping', (_, res) => res.send('pong'));

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
  const { startV20Crons } = require('./services/auto-scheduler');
  startV20Crons();
  // DARE — Metacortex: health check loop + monitor continu
  dare.startHealthCheckLoop(120000);
  dareMonitor.start();
  // Swarm — Orchestrateur micro-agents
  swarm.start();
  // Maintenance — nettoyage disque toutes les 4h [089]
  maintenance.startAutoCleanup();
  // pg-pool indexes [090]
  maintenance.ensureIndexes().catch(e => console.warn('[Boot] Indexes:', e.message));
  // Daily Digest — 20h heure salon [075]
  const ULRICH_PHONE = process.env.ULRICH_PHONE_NUMBER;
  const TWILIO_FROM  = process.env.TWILIO_PHONE_NUMBER;
  if (ULRICH_PHONE && TWILIO_FROM) {
    shield.scheduleDailyDigest(async (digest) => {
      await shield.shieldedSMS(ULRICH_PHONE, TWILIO_FROM, digest, { windowMs: 0 });
    });
  }
}

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
