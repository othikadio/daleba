/**
 * DALEBA — Agent de Veille des Erreurs (Points 12 + 13)
 * Intercepte, log, et répond aux erreurs critiques.
 * Self-healing : relance automatique sur crash.
 */

const fs = require('fs');
const path = require('path');
const axios = require('axios');

// ─── CONFIG ──────────────────────────────────────────────────────────────────
const LOGS_DIR = path.join(__dirname, '../../logs');
const ALERT_PHONE = process.env.ALERT_PHONE || '+15149195970';
const TWILIO_SID = process.env.TWILIO_ACCOUNT_SID;
const TWILIO_TOKEN = process.env.TWILIO_AUTH_TOKEN;
const TWILIO_FROM = process.env.TWILIO_PHONE_NUMBER;

// Créer le dossier logs si nécessaire
if (!fs.existsSync(LOGS_DIR)) {
  fs.mkdirSync(LOGS_DIR, { recursive: true });
}

// ─── LOG D'ERREUR ────────────────────────────────────────────────────────────
function getLogFile(date) {
  const d = date || new Date().toISOString().slice(0, 10);
  return path.join(LOGS_DIR, `errors-${d}.json`);
}

function logError(error, context = {}) {
  const entry = {
    timestamp: new Date().toISOString(),
    message: error.message || String(error),
    stack: error.stack || null,
    code: error.code || error.status || null,
    context,
  };

  const logFile = getLogFile();

  try {
    let entries = [];
    if (fs.existsSync(logFile)) {
      try {
        entries = JSON.parse(fs.readFileSync(logFile, 'utf8'));
      } catch (_) {
        entries = [];
      }
    }
    entries.push(entry);
    fs.writeFileSync(logFile, JSON.stringify(entries, null, 2));
  } catch (writeErr) {
    console.error('❌ Impossible d\'écrire le log d\'erreur:', writeErr.message);
  }

  return entry;
}

// ─── ALERTE WHATSAPP / SMS ───────────────────────────────────────────────────
async function sendAlert(message) {
  if (!TWILIO_SID || !TWILIO_TOKEN || !TWILIO_FROM) {
    console.warn('⚠️ Alerte non envoyée (Twilio non configuré):', message);
    return false;
  }

  try {
    const auth = Buffer.from(`${TWILIO_SID}:${TWILIO_TOKEN}`).toString('base64');
    await axios.post(
      `https://api.twilio.com/2010-04-01/Accounts/${TWILIO_SID}/Messages.json`,
      new URLSearchParams({
        To: ALERT_PHONE,
        From: TWILIO_FROM,
        Body: `🚨 Erreur Daleba: ${message}`,
      }),
      {
        headers: {
          Authorization: `Basic ${auth}`,
          'Content-Type': 'application/x-www-form-urlencoded',
        },
      }
    );
    console.log('📱 Alerte envoyée au', ALERT_PHONE);
    return true;
  } catch (err) {
    console.error('❌ Échec envoi alerte:', err.message);
    return false;
  }
}

// ─── MIDDLEWARE EXPRESS (500) ────────────────────────────────────────────────
function errorMiddleware(err, req, res, next) {
  const entry = logError(err, {
    method: req.method,
    url: req.url,
    body: req.body,
    ip: req.ip,
  });

  console.error('🚨 Erreur critique DALEBA:', entry.message);

  // Alerte async (non-bloquant)
  sendAlert(`[${err.status || 500}] ${err.message} — ${req.method} ${req.url}`).catch(() => {});

  res.status(err.status || 500).json({
    error: 'Erreur interne du serveur',
    message: process.env.NODE_ENV === 'production' ? 'Une erreur est survenue' : err.message,
    timestamp: entry.timestamp,
  });
}

// ─── SELF-HEALING : UNCAUGHT EXCEPTIONS ─────────────────────────────────────
function enableSelfHealing() {
  process.on('uncaughtException', (err) => {
    const entry = logError(err, { type: 'uncaughtException', pid: process.pid });
    console.error('💀 CRASH DÉTECTÉ — Redémarrage en cours...');
    console.error('Erreur:', entry.message);
    console.error('Stack:', entry.stack);

    // Alerte immédiate (synchrone dans le mesure du possible)
    sendAlert(`CRASH SERVEUR: ${err.message}`).catch(() => {}).finally(() => {
      // PM2 / superviseur détectera process.exit(1) et relancera le processus
      process.exit(1);
    });
  });

  process.on('unhandledRejection', (reason, promise) => {
    const err = reason instanceof Error ? reason : new Error(String(reason));
    logError(err, { type: 'unhandledRejection', promise: String(promise) });
    console.error('⚠️ Promise rejetée non gérée:', err.message);
    // On ne quitte pas sur unhandledRejection, on log seulement
  });

  console.log('🛡️ Self-healing activé (uncaughtException + unhandledRejection)');
}

// ─── LECTURE DES LOGS ────────────────────────────────────────────────────────
function getErrorLog(date) {
  const logFile = getLogFile(date);
  if (!fs.existsSync(logFile)) return [];
  try {
    return JSON.parse(fs.readFileSync(logFile, 'utf8'));
  } catch (_) {
    return [];
  }
}

module.exports = {
  logError,
  sendAlert,
  errorMiddleware,
  enableSelfHealing,
  getErrorLog,
};
