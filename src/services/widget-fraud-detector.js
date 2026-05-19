'use strict';
/**
 * Widget Fraud Detector — DALEBA Metacortex Point 388
 * Détecte les abus: > 50 requêtes/min avec clé valide depuis domaine non autorisé.
 * Suspend temporairement la clé et notifie.
 */
const bus = require('./event-bus');

// Compteurs en mémoire: Map<apiKey:domain, { count, windowStart, suspended }>
const _counters   = new Map();
const _suspended  = new Map();

const RATE_LIMIT    = 50;    // requêtes max par minute
const WINDOW_MS     = 60_000;
const SUSPEND_MS    = 15 * 60_000; // 15 min de suspension

/**
 * [388] Enregistre une requête et vérifie le rate-limit
 * @returns { allowed: bool, suspended: bool, count: number }
 */
function checkRequest(apiKey, domain) {
  const key = `${apiKey}:${domain}`;
  const now = Date.now();

  // Vérif suspension active
  if (_suspended.has(key)) {
    const suspendedUntil = _suspended.get(key);
    if (now < suspendedUntil) {
      return { allowed: false, suspended: true, resumesAt: new Date(suspendedUntil).toISOString() };
    }
    _suspended.delete(key);
    _counters.delete(key);
  }

  // Initialise ou réinitialise la fenêtre
  const entry = _counters.get(key) || { count: 0, windowStart: now };
  if (now - entry.windowStart > WINDOW_MS) {
    entry.count       = 0;
    entry.windowStart = now;
  }
  entry.count++;
  _counters.set(key, entry);

  // Dépassement ?
  if (entry.count > RATE_LIMIT) {
    _suspended.set(key, now + SUSPEND_MS);
    _counters.delete(key);

    bus.system(`[WidgetFraud] 🚨 FRAUDE DÉTECTÉE: clé ${apiKey.slice(0,12)}*** — domaine ${domain} — ${entry.count} req/min → SUSPENSION 15min`);

    // Notif Ulrich via Event Bus
    bus.emit('widget:fraud:alert', {
      apiKey:    apiKey.slice(0, 12) + '***',
      domain,
      count:     entry.count,
      suspendedUntil: new Date(now + SUSPEND_MS).toISOString(),
    });

    return { allowed: false, suspended: true, reason: 'rate_limit_exceeded', count: entry.count, resumesAt: new Date(now + SUSPEND_MS).toISOString() };
  }

  return { allowed: true, suspended: false, count: entry.count, remaining: RATE_LIMIT - entry.count };
}

function isKeySuspended(apiKey, domain) {
  const key  = `${apiKey}:${domain}`;
  const until = _suspended.get(key);
  if (!until || Date.now() >= until) return false;
  return { suspended: true, resumesAt: new Date(until).toISOString() };
}

function resetKey(apiKey, domain) {
  const key = `${apiKey}:${domain}`;
  _counters.delete(key);
  _suspended.delete(key);
}

module.exports = { checkRequest, isKeySuspended, resetKey, RATE_LIMIT, WINDOW_MS };
