/**
 * Notification Loop Shield — DALEBA Metacortex Points 071-072
 *
 * Déduplique toutes les alertes SMS/canal sur une fenêtre glissante.
 * Intégration transparente : wrapping de l'envoi SMS existant.
 *
 * Règle : si une alerte identique (même clé) a été émise dans
 * la fenêtre de déduplication → elle est silencieusement supprimée.
 */

'use strict';

// ─── STORE DE DÉDUPLICATION ───────────────────────────────────────────────────
// En mémoire (runtime) — suffisant pour Railway (1 instance)
// Pour multi-instance : remplacer par Redis/PostgreSQL

const ALERT_STORE = new Map();
// Map<alertKey, { lastSentAt: timestamp, count: number, suppressedCount: number }>

const DEFAULT_WINDOW_MS = 60 * 60 * 1000; // [072] 60 minutes

// ─── CLÉS DE DÉDUPLICATION ────────────────────────────────────────────────────

/**
 * Génère une clé de dédup depuis le contenu de l'alerte
 * Normalisation : lowercase, sans espaces superflus, sans timestamp
 */
function alertKey(type, message) {
  const normalized = (message || '')
    .toLowerCase()
    .replace(/\d{4}-\d{2}-\d{2}T[\d:.Z]+/g, '')  // retire timestamps ISO
    .replace(/\b\d+\.\d+\$/g, '')                  // retire montants variables
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 120);  // fingerprint max 120 chars

  return `${type}::${normalized}`;
}

// ─── VÉRIFICATION [071, 072] ─────────────────────────────────────────────────

/**
 * Vérifie si une alerte peut être envoyée
 * @returns {{ allowed: boolean, reason: string, suppressedCount?: number }}
 */
function canSend(type, message, windowMs = DEFAULT_WINDOW_MS) {
  const key = alertKey(type, message);
  const now = Date.now();
  const entry = ALERT_STORE.get(key);

  if (!entry) return { allowed: true, key };

  const elapsed = now - entry.lastSentAt;
  if (elapsed < windowMs) {
    entry.suppressedCount = (entry.suppressedCount || 0) + 1;
    return {
      allowed: false,
      key,
      reason: `Dédupliquée — même alerte envoyée il y a ${Math.round(elapsed / 60000)}min`,
      suppressedCount: entry.suppressedCount,
      nextAllowedIn: Math.ceil((windowMs - elapsed) / 60000) + ' min',
    };
  }

  return { allowed: true, key };
}

/**
 * Enregistre qu'une alerte vient d'être envoyée
 */
function markSent(type, message) {
  const key = alertKey(type, message);
  const existing = ALERT_STORE.get(key) || { count: 0, suppressedCount: 0 };
  ALERT_STORE.set(key, {
    key,
    type,
    messagePreview: message.slice(0, 80),
    lastSentAt: Date.now(),
    count: existing.count + 1,
    suppressedCount: existing.suppressedCount,
  });
}

// ─── WRAPPER SMS PROTÉGÉ ──────────────────────────────────────────────────────

/**
 * Remplace l'envoi SMS direct — ajoute le shield de déduplication
 * Usage : remplace sendSMS(to, from, message) partout
 */
async function shieldedSMS(to, from, message, options = {}) {
  const check = canSend('sms', message, options.windowMs);

  if (!check.allowed) {
    console.log(`[Shield] SMS supprimé (${check.reason}): ${message.slice(0, 60)}…`);
    return { sent: false, suppressed: true, ...check };
  }

  // Envoi réel
  let twilio;
  try {
    twilio = require('./twilio-master');
  } catch {
    twilio = require('./twilio');
  }

  try {
    const result = await twilio.sendSMS(to, from, message);
    markSent('sms', message);
    return { sent: true, suppressed: false, result };
  } catch (err) {
    throw err;
  }
}

/**
 * Wrapper alerte générique (pour dare-monitor, error-watcher, etc.)
 */
async function shieldedAlert(type, message, sendFn, options = {}) {
  const check = canSend(type, message, options.windowMs);

  if (!check.allowed) {
    console.log(`[Shield] Alerte ${type} supprimée (${check.reason}): ${message.slice(0, 60)}…`);
    return { sent: false, suppressed: true, ...check };
  }

  await sendFn(message);
  markSent(type, message);
  return { sent: true, suppressed: false };
}

// ─── INTROSPECTION ───────────────────────────────────────────────────────────

function getShieldStatus() {
  const entries = [...ALERT_STORE.values()].map(e => ({
    ...e,
    lastSentAgo: `${Math.round((Date.now() - e.lastSentAt) / 60000)}min`,
  }));

  return {
    shield: 'Notification Loop Shield v1.0',
    windowMinutes: DEFAULT_WINDOW_MS / 60000,
    trackedAlerts: entries.length,
    totalSuppressed: entries.reduce((a, e) => a + (e.suppressedCount || 0), 0),
    entries: entries.slice(0, 20),
  };
}

function clearShield(type = null) {
  if (type) {
    for (const [key, entry] of ALERT_STORE.entries()) {
      if (entry.type === type) ALERT_STORE.delete(key);
    }
  } else {
    ALERT_STORE.clear();
  }
}

// ─── NETTOYAGE AUTOMATIQUE ───────────────────────────────────────────────────
// Purge les entrées expirées toutes les heures

setInterval(() => {
  const cutoff = Date.now() - 2 * DEFAULT_WINDOW_MS;
  for (const [key, entry] of ALERT_STORE.entries()) {
    if (entry.lastSentAt < cutoff) ALERT_STORE.delete(key);
  }
}, 60 * 60 * 1000);

// ─── SMART SUPPRESSION [073] ─────────────────────────────────────────────────
// Même métrique financière ou même code d'erreur → HUD only, silence SMS

const HUD_ONLY_PATTERNS = [
  /chiffre d'affaires|ca |revenue|\d+\.\d+\$|total.*\$/i,
  /HTTP (4\d\d|5\d\d)/i,
  /taux d'erreur|error rate/i,
  /latence|latency|\d+ms/i,
];

function isHUDOnly(message) {
  return HUD_ONLY_PATTERNS.some(p => p.test(message));
}

/**
 * Envoie sur HUD seulement si la métrique n'a pas changé
 * @param {string} metricKey — clé unique de la métrique (ex: 'ca_daily')
 * @param {string|number} value — valeur actuelle
 * @param {string} message — message complet
 */
function reportMetricChange(metricKey, value, message) {
  const existing = ALERT_STORE.get(`metric::${metricKey}`);
  const hasChanged = !existing || existing.lastValue !== String(value);

  if (!hasChanged) {
    // [073] Valeur identique → HUD uniquement
    const bus = (() => { try { return require('./event-bus'); } catch { return null; } })();
    if (bus) bus.system(`📊 ${message.slice(0, 80)}`);
    return { smsRequired: false, reason: 'metric_unchanged', hudUpdated: true };
  }

  // Valeur changée → mise à jour du store + SMS autorisé
  ALERT_STORE.set(`metric::${metricKey}`, {
    lastValue: String(value), updatedAt: Date.now(),
    messagePreview: message.slice(0, 80),
    type: 'metric', lastSentAt: Date.now(), count: 1, suppressedCount: 0,
  });
  return { smsRequired: true };
}

// ─── CADENCE DYNAMIQUE [074] ──────────────────────────────────────────────────
// Fenêtre élargie pendant forte affluence (moins de notifications)

/**
 * Retourne la fenêtre de déduplication adaptée à l'heure actuelle
 * Heures creuses (8h-10h, 18h-21h) → 30 min
 * Heures d'affluence (10h-17h) → 90 min
 * Nuit → 3h
 */
function getDynamicWindow() {
  const h = new Date().getUTCHours() - 4; // America/Toronto UTC-4
  const localH = ((h % 24) + 24) % 24;

  if (localH >= 23 || localH < 8)  return 3 * 60 * 60 * 1000;  // nuit → 3h
  if (localH >= 10 && localH < 17) return 90 * 60 * 1000;       // affluence → 90min
  return DEFAULT_WINDOW_MS;                                       // transition → 60min
}

// ─── DAILY DIGEST [075] ───────────────────────────────────────────────────────

const digestQueue = [];  // { type, message, ts }

function queueForDigest(type, message) {
  digestQueue.push({ type, message: message.slice(0, 120), ts: Date.now() });
}

/**
 * Génère le Daily Digest consolidé — scannable en < 10 secondes
 */
function buildDailyDigest() {
  if (digestQueue.length === 0) return null;

  const byType = {};
  for (const item of digestQueue) {
    if (!byType[item.type]) byType[item.type] = [];
    byType[item.type].push(item.message);
  }

  const icons = { cost_alert: '💰', provider_down: '🔴', auth_error: '🔑',
                   error: '⚠️', info: 'ℹ️', sms: '📱' };

  const lines = [
    `📋 DALEBA — Résumé ${new Date().toLocaleDateString('fr-CA')}`,
    '─'.repeat(30),
  ];

  for (const [type, messages] of Object.entries(byType)) {
    const icon = icons[type] || '•';
    lines.push(`${icon} ${type.toUpperCase()} (${messages.length}x)`);
    // Max 3 exemples par catégorie
    messages.slice(0, 3).forEach(m => lines.push(`  · ${m}`));
    if (messages.length > 3) lines.push(`  · … +${messages.length - 3} autres`);
  }

  lines.push('─'.repeat(30));
  lines.push('Répondez STATUT pour les logs complets.');

  digestQueue.length = 0;  // Reset après génération
  return lines.join('\n');
}

// Planifie le digest quotidien à 20h heure salon (America/Toronto = UTC-4)
function scheduleDailyDigest(sendFn) {
  function scheduleNext() {
    const now = new Date();
    const target = new Date();
    target.setUTCHours(24, 0, 0, 0); // 20h Toronto = 00h UTC
    if (target <= now) target.setUTCDate(target.getUTCDate() + 1);
    const delay = target - now;
    setTimeout(async () => {
      const digest = buildDailyDigest();
      if (digest && sendFn) await sendFn(digest);
      scheduleNext();
    }, delay);
  }
  scheduleNext();
}

// ─── EXPORTS ─────────────────────────────────────────────────────────────────

module.exports = {
  canSend, markSent,
  shieldedSMS, shieldedAlert,
  getShieldStatus, clearShield,
  DEFAULT_WINDOW_MS, getDynamicWindow,
  // [073]
  isHUDOnly, reportMetricChange,
  // [074]
  getDynamicWindow,
  // [075]
  queueForDigest, buildDailyDigest, scheduleDailyDigest,
};
