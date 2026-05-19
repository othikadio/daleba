/**
 * DALEBA V27 — Filet de Sécurité (Error Watcher)
 * Surveille les erreurs 4xx/5xx en temps réel
 * Génère un patch correctif via Claude + l'envoie à Ulrich par SMS
 * Ulrich approuve → déploiement (jamais autonome)
 */

const bus = require('./event-bus');

// ─── CONFIG ──────────────────────────────────────────────────────────────────

const ULRICH_PHONE   = process.env.ULRICH_PHONE_NUMBER;
const WATCH_CODES    = [400, 401, 403, 404, 422, 429, 500, 502, 503];
const CRITICAL_CODES = [500, 502, 503];
const COOLDOWN_MS    = 5 * 60 * 1000; // 5 min entre deux alertes pour le même endpoint

// Anti-spam par endpoint
const alertCooldown  = new Map();
// Stockage des erreurs récentes pour analyse
const errorBuffer    = [];
const MAX_BUFFER     = 100;

// ─── DÉTECTION ET ANALYSE ────────────────────────────────────────────────────

function shouldAlert(method, path, statusCode) {
  if (!WATCH_CODES.includes(statusCode)) return false;
  const key  = `${method}:${path}:${statusCode}`;
  const last = alertCooldown.get(key) || 0;
  if (Date.now() - last < COOLDOWN_MS) return false;
  alertCooldown.set(key, Date.now());
  return true;
}

function classifyError(statusCode, path, errorMessage) {
  if (statusCode === 401) return { type: 'AUTH_FAILURE',   severity: 'HIGH',   hint: 'Token expiré ou invalide' };
  if (statusCode === 429) return { type: 'RATE_LIMIT',     severity: 'MEDIUM', hint: "Trop de requêtes — ajouter retry/backoff" };
  if (statusCode === 404 && path.includes('/api/')) return { type: 'ROUTE_MISSING', severity: 'LOW', hint: 'Endpoint supprimé ou renommé' };
  if (statusCode >= 500)  return { type: 'SERVER_CRASH',   severity: 'CRITICAL', hint: errorMessage?.slice(0, 80) || 'Erreur interne' };
  if (statusCode === 400) return { type: 'BAD_REQUEST',    severity: 'MEDIUM', hint: 'Payload ou paramètre invalide' };
  return { type: 'API_ERROR', severity: 'LOW', hint: `HTTP ${statusCode}` };
}

// ─── GÉNÉRATION DU PATCH ──────────────────────────────────────────────────────

/**
 * Demande à Claude de générer un patch correctif
 * Retourne un texte court adapté à un SMS
 */
async function generatePatchSuggestion(errorContext) {
  if (!process.env.ANTHROPIC_API_KEY) {
    return buildFallbackPatch(errorContext);
  }

  try {
    const claude = require('../agents/claude');
    const prompt = `Tu es l'IA de monitoring DALEBA. Une erreur ${errorContext.statusCode} vient de se produire.

Endpoint: ${errorContext.method} ${errorContext.path}
Type: ${errorContext.classification.type}
Message: ${errorContext.errorMessage || '—'}
Occurences: ${errorContext.count || 1}

Génère UN patch correctif en 3 lignes max. Format:
CAUSE: [une phrase]
FIX: [code ou action concrète, max 100 chars]
COMMANDE: [commande CLI ou action Railway si applicable]

Sois ultra-concis. Pas d'explication longue.`;

    const result = await claude.query(prompt, '', []);
    const text   = typeof result === 'string' ? result : (result.content || '');
    return text.slice(0, 300);
  } catch (err) {
    return buildFallbackPatch(errorContext);
  }
}

function buildFallbackPatch(ctx) {
  const fixes = {
    AUTH_FAILURE:  'FIX: Régénérer le token API dans Railway Variables',
    RATE_LIMIT:    'FIX: Ajouter setTimeout(fn, 1000) autour des appels API',
    ROUTE_MISSING: 'FIX: Vérifier routes.js — endpoint disparu après merge',
    SERVER_CRASH:  'FIX: railway logs → identifier la stack trace → corriger',
    BAD_REQUEST:   'FIX: Valider le payload JSON avant envoi à l\'API',
    API_ERROR:     `FIX: Inspecter ${ctx.path} — code ${ctx.statusCode}`,
  };
  return fixes[ctx.classification?.type] || `FIX: Inspecter ${ctx.method} ${ctx.path}`;
}

// ─── ENVOI SMS ULRICH ─────────────────────────────────────────────────────────

async function sendErrorAlertSMS(errorContext, patchSuggestion) {
  if (!ULRICH_PHONE) {
    bus.system(`[WATCHER] ULRICH_PHONE_NUMBER manquant — alerte log uniquement`);
    return { sent: false, reason: 'no_phone' };
  }

  const severity  = errorContext.classification.severity;
  const emoji     = severity === 'CRITICAL' ? '🔴' : severity === 'HIGH' ? '🟠' : '🟡';
  const shortPath = errorContext.path.replace('/api/', '/').slice(0, 30);

  // Message ultra-scannable (format SMS)
  const smsBody = [
    `${emoji} DALEBA ERROR — ${errorContext.classification.type}`,
    `Route: ${errorContext.method} ${shortPath} → HTTP ${errorContext.statusCode}`,
    '',
    patchSuggestion.slice(0, 200),
    '',
    `⚡ Pour déployer le fix: répondre OUI à Béatrice sur Telegram`,
    `Heure: ${new Date().toLocaleTimeString('fr-CA', { timeZone: 'America/Toronto' })}`,
  ].join('\n');

  try {
    // [071-072] Anti-boucle : déduplication sur 60 minutes
    const shield = require('./notification-shield');
    const from = process.env.TWILIO_PHONE_NUMBER;
    const result = await shield.shieldedSMS(ULRICH_PHONE, from, smsBody);
    if (result.suppressed) {
      bus.system(`[WATCHER] SMS dédupliqué (${result.reason})`);
      return { sent: false, suppressed: true, reason: result.reason };
    }
    bus.system(`[WATCHER] SMS alerte envoyé à Ulrich: ${errorContext.classification.type}`);
    return { sent: true, channel: 'sms' };
  } catch (err) {
    bus.system(`[WATCHER] Erreur SMS: ${err.message}`);
    return { sent: false, error: err.message };
  }
}

// ─── MIDDLEWARE EXPRESS ───────────────────────────────────────────────────────

/**
 * Middleware à brancher dans Express APRÈS les routes
 * app.use(errorWatcher.middleware)
 */
function middleware(err, req, res, next) {
  const statusCode   = err.status || err.statusCode || 500;
  const errorMessage = err.message || 'Erreur interne';

  // Toujours logguer dans le bus
  const logEntry = {
    ts:           new Date().toISOString(),
    method:       req.method,
    path:         req.path,
    statusCode,
    errorMessage: errorMessage.slice(0, 200),
    body:         req.method !== 'GET' ? JSON.stringify(req.body || {}).slice(0, 100) : undefined,
  };

  // Buffer circulaire
  errorBuffer.unshift(logEntry);
  if (errorBuffer.length > MAX_BUFFER) errorBuffer.pop();

  if (statusCode >= 500) {
    bus.system(`[WATCHER] 🔴 ${req.method} ${req.path} → ${statusCode}: ${errorMessage.slice(0, 60)}`);
  } else if (statusCode >= 400) {
    bus.system(`[WATCHER] 🟡 ${req.method} ${req.path} → ${statusCode}`);
  }

  // Alerte SMS si éligible (non-bloquant)
  if (shouldAlert(req.method, req.path, statusCode)) {
    const classification = classifyError(statusCode, req.path, errorMessage);
    const errorContext   = { ...logEntry, classification, count: 1 };

    generatePatchSuggestion(errorContext)
      .then(patch => sendErrorAlertSMS(errorContext, patch))
      .catch(e => bus.system(`[WATCHER] Alert pipeline error: ${e.message}`));
  }

  // Passe au gestionnaire d'erreur suivant (ou réponse par défaut)
  if (!res.headersSent) {
    res.status(statusCode).json({ error: errorMessage, code: statusCode });
  } else {
    next(err);
  }
}

// ─── SURVEILLANCE DES APPELS EXTERNES ────────────────────────────────────────

/**
 * Wrapper pour monitorer les appels API externes (Square, Twilio, Meta)
 * Usage: const result = await errorWatcher.watchExternalCall('Square', fn)
 */
async function watchExternalCall(serviceName, fn) {
  try {
    return await fn();
  } catch (err) {
    const statusCode = err.status || err.statusCode || err.code || 500;
    const isApiChange = err.message?.includes('deprecated') ||
                        err.message?.includes('not found') ||
                        err.message?.includes('changed');

    bus.system(`[WATCHER] External API error — ${serviceName}: ${err.message?.slice(0, 80)}`);

    const errorContext = {
      method:       'EXTERNAL',
      path:         serviceName,
      statusCode:   typeof statusCode === 'number' ? statusCode : 500,
      errorMessage: err.message,
      classification: classifyError(
        typeof statusCode === 'number' ? statusCode : 500,
        serviceName,
        err.message
      ),
      isApiChange,
      ts: new Date().toISOString(),
    };

    errorBuffer.unshift(errorContext);
    if (errorBuffer.length > MAX_BUFFER) errorBuffer.pop();

    if (shouldAlert('EXTERNAL', serviceName, errorContext.statusCode)) {
      const patch = await generatePatchSuggestion(errorContext).catch(() => buildFallbackPatch(errorContext));
      await sendErrorAlertSMS(errorContext, patch).catch(() => {});
    }

    throw err; // Re-throw pour que l'appelant gère
  }
}

// ─── RAPPORT D'ERREURS ────────────────────────────────────────────────────────

function getErrorReport(limit = 20) {
  const recent   = errorBuffer.slice(0, limit);
  const critical = recent.filter(e => e.statusCode >= 500).length;
  const warnings = recent.filter(e => e.statusCode >= 400 && e.statusCode < 500).length;

  // Endpoints les plus touchés
  const pathCounts = {};
  recent.forEach(e => { pathCounts[e.path] = (pathCounts[e.path] || 0) + 1; });
  const hotspots = Object.entries(pathCounts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([path, count]) => ({ path, count }));

  return {
    total:    recent.length,
    critical,
    warnings,
    hotspots,
    recent:   recent.slice(0, 10),
    ts:       new Date().toISOString(),
  };
}

module.exports = {
  middleware,
  watchExternalCall,
  getErrorReport,
  generatePatchSuggestion,
  sendErrorAlertSMS,
  classifyError,
  errorBuffer,
};
