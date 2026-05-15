require('dotenv').config();
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const morgan = require('morgan');
const routes = require('./api/routes');

const app = express();
const PORT = process.env.PORT || 3000;

// Middlewares
app.use(helmet());
app.use(cors());
app.use(express.json({ limit: '10mb' }));
app.use(morgan('combined'));

// Routes DALEBA
app.use('/api', routes);

// Route racine
app.get('/', (req, res) => {
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

// Démarrage
app.listen(PORT, () => {
  console.log(`
╔══════════════════════════════════════╗
║     DALEBA CORE v1.0 — EN LIGNE     ║
║     Port: ${PORT}                       ║
║     Propriétaire: Kadio Ulrich       ║
╚══════════════════════════════════════╝
  `);
});

module.exports = app;
