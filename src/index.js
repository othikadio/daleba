require('dotenv').config();
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const morgan = require('morgan');
const routes = require('./api/routes');

const path = require('path');
const app = express();
const PORT = process.env.PORT || 3000;

// Middlewares
app.use(helmet());
app.use(cors());
app.use(express.json({ limit: '10mb' }));
app.use(morgan('combined'));

// Fichiers statiques (frontend)
app.use(express.static(path.join(__dirname, '../public')));

// Routes DALEBA
app.use('/api', routes);

// Accueil (page principale)
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, '../public/accueil.html'));
});

// Booking page
app.get('/reservation', (req, res) => {
  res.sendFile(path.join(__dirname, '../public/index.html'));
});

// Dashboard → redirect
app.get('/dashboard', (req, res) => {
  res.sendFile(path.join(__dirname, '../public/dashboard.html'));
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

// Démarrage — skip listen() en mode serverless (Vercel)
if (!process.env.VERCEL && !process.env.AWS_LAMBDA_FUNCTION_NAME) {
  app.listen(PORT, () => {
    console.log(`
╔══════════════════════════════════════╗
║     DALEBA CORE v1.0 — EN LIGNE     ║
║     Port: ${PORT}                       ║
║     Propriétaire: Kadio Ulrich       ║
╚══════════════════════════════════════╝
    `);
  });
}

module.exports = app;
