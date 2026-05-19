require('dotenv').config();
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const morgan = require('morgan');
const routes = require('./api/routes');
const { errorMiddleware, enableSelfHealing, logError } = require('./services/error-monitor');
const { startFollowupCron } = require('./services/client-followup');

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

// Route racine API
app.get('/health', (req, res) => {
  res.json({
    name: 'DALEBA Core',
    version: '1.0.0',
    status: 'online',
    owner: 'Kadio Ehouman Ulrich',
    endpoints: {
      chat: 'POST /api/chat',
      history: 'GET /api/history/:sessionId',
      status: 'GET /api/status',
      emergency: 'POST /api/emergency-stop',
    },
  });
});

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
