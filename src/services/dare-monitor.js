/**
 * DARE Monitor — Surveillance continue du Dynamic Agnostic Routing Engine
 * DALEBA Metacortex — Points 025, 028, 033, 034, 036, 037, 047
 *
 * Analyse 24h · Alertes coût · Rapport infra · Journal évolution
 * Non-bloquant : toutes les opérations sont asynchrones en arrière-plan
 */

'use strict';

const dare = require('../agents/dare');

// ─── IMPORTS (lazy pour éviter deps circulaires) ─────────────────────────────

function getJournal()   { try { return require('./journal'); }   catch { return null; } }
function getTwilio()    { try { return require('./twilio-master'); } catch { return null; } }
function getEventBus()  { try { return require('./event-bus'); }  catch { return null; } }

// ─── ÉTAT DU MONITOR ─────────────────────────────────────────────────────────

const state = {
  started: false,
  dailyReportTimer: null,
  hourlyCostTimer: null,
  infraCheckTimer: null,
  lastDailyReport: null,
  lastInfraCheck: null,
};

// ─── JOURNAL D'ÉVOLUTION [025] ───────────────────────────────────────────────

async function logToJournal(event, data = {}) {
  const journal = getJournal();
  if (!journal) return;

  try {
    const ENTRY_TYPES = journal.ENTRY_TYPES || {};
    const type = ENTRY_TYPES.SYSTEM || 'SYSTEM';
    const title = `[DARE] ${event}`;
    const body = typeof data === 'string' ? data : JSON.stringify(sanitize(data)).slice(0, 500);
    await journal.logEntry(type, title, '', data).catch(() => {});
  } catch {}
}

// [039] Sanitise les données avant log (masque clés, tokens)
function sanitize(obj) {
  if (!obj || typeof obj !== 'object') return obj;
  const out = {};
  for (const [k, v] of Object.entries(obj)) {
    const sensitive = /token|key|secret|password|auth|bearer/i.test(k);
    out[k] = sensitive ? '[REDACTED]' : (typeof v === 'object' ? sanitize(v) : v);
  }
  return out;
}

// ─── ALERTE SMS COMMANDANT [028, 037] ────────────────────────────────────────

async function alertCommandant(message, priority = 'normal') {
  const bus = getEventBus();
  const phone = process.env.ULRICH_PHONE_NUMBER;
  const from  = process.env.TWILIO_PHONE_NUMBER;

  // Push sur le bus HUD
  if (bus) bus.system(`🚨 DARE: ${message.slice(0, 80)}`);

  if (!phone || !from) {
    console.warn('[DARE Monitor] SMS non envoyé (config Twilio manquante):', message.slice(0, 100));
    return;
  }

  try {
    // [071-072] Anti-boucle : shield de déduplication 60 min
    const shield = require('./notification-shield');
    const prefix = priority === 'critical' ? '🔴 DALEBA CRITIQUE' : '⚠️ DALEBA ALERTE';
    const fullMsg = `${prefix}\n${message}\n\nRépondez DARE STATUS pour détails.`;
    const result = await shield.shieldedSMS(phone, from, fullMsg);
    if (result.suppressed) {
      console.log(`[DARE Monitor] SMS dédupliqué: ${result.reason}`);
    }
  } catch (err) {
    console.error('[DARE Monitor] Échec envoi SMS:', err.message);
  }
}

// ─── ANALYSE 24H [033, 034] ──────────────────────────────────────────────────

async function runDailyAnalysis() {
  const status = dare.getStatus();
  const metrics = dare.getDailyMetrics();
  const today = new Date().toISOString().slice(0, 10);

  const report = {
    date: today,
    totalRequests: status.stats.requestsTotal,
    totalCostUSD: status.stats.estimatedCostUSD,
    failovers: status.stats.failovers,
    providers: [],
    alerts: [],
    recommendations: [],
  };

  for (const p of status.providers) {
    const m = metrics[p.id] || { requests: 0, errors: 0, costUSD: 0, demoted: false };
    const errorRate = m.requests > 0 ? (m.errors / m.requests) * 100 : 0;

    report.providers.push({
      id: p.id, name: p.name,
      requests: m.requests,
      errors: m.errors,
      errorRate: `${errorRate.toFixed(1)}%`,
      costUSD: m.costUSD.toFixed(4),
      demoted: m.demoted,
      healthStatus: p.health.status,
      latencyMs: p.health.latencyMs,
    });

    // [034] Alerte si taux d'erreur dépasse seuil
    if (errorRate > dare.CFG.maxErrorRatePercent && m.requests >= 5) {
      report.alerts.push(`⚠️ ${p.name}: taux d'erreur ${errorRate.toFixed(1)}% > ${dare.CFG.maxErrorRatePercent}% — rétrogradé`);
    }

    // Recommandation coût
    if (m.costUSD > 5 && p.id !== 'deepseek') {
      report.recommendations.push(`💰 Migrer davantage de requêtes bulk vers DeepSeek pour réduire les coûts de ${p.name}`);
    }
  }

  // [030] Vérification plafond mensuel
  const monthlySpent = status.stats.estimatedCostUSD;
  const budget = dare.CFG.monthlyBudgetUSD;
  const usagePercent = (monthlySpent / budget) * 100;

  if (usagePercent >= 80) {
    const msg = `Budget mensuel DARE: ${monthlySpent.toFixed(2)}$ / ${budget}$ (${usagePercent.toFixed(0)}% utilisé)`;
    report.alerts.push(`🔴 ${msg}`);
    await alertCommandant(msg, 'critical');
  } else if (usagePercent >= 50) {
    report.recommendations.push(`Budget mensuel à ${usagePercent.toFixed(0)}% (${monthlySpent.toFixed(2)}$ / ${budget}$)`);
  }

  // Journal [025]
  await logToJournal('Rapport quotidien DARE', report);

  // Bus HUD
  const bus = getEventBus();
  if (bus) bus.system(`📊 DARE rapport 24h — ${report.totalRequests} req · ${report.totalCostUSD.toFixed(4)}$ · ${report.alerts.length} alerte(s)`);

  if (report.alerts.length > 0) {
    console.warn('[DARE Monitor] Alertes rapport 24h:\n' + report.alerts.join('\n'));
  }

  state.lastDailyReport = { ts: Date.now(), report };
  return report;
}

// ─── SURVEILLANCE COÛT HORAIRE [037] ─────────────────────────────────────────

function checkHourlyCosts() {
  // Le bridage est géré directement dans dare.js (updateCostTracking)
  // Ici on vérifie l'état et alerte si bridé récemment
  const status = dare.getStatus();
  if (status.stats.bridledProviders.length > 0) {
    const list = status.stats.bridledProviders.join(', ');
    console.warn(`[DARE Monitor] Providers bridés: ${list}`);
  }
}

// ─── VÉRIFICATION INFRASTRUCTURE [036] ───────────────────────────────────────
// Détecte saturation Railway → alerte Commandant pour décision de scaling

async function checkInfrastructure() {
  state.lastInfraCheck = Date.now();

  try {
    // Check Railway healthcheck interne
    const DALEBA_URL = process.env.DALEBA_BASE_URL || 'https://daleba-api-production.up.railway.app';
    const axios = require('axios');
    const start = Date.now();

    const res = await axios.get(`${DALEBA_URL}/api/stats`, {
      timeout: 8000,
      headers: { 'X-DARE-Monitor': '1' },
    });

    const latency = Date.now() - start;

    if (latency > 5000) {
      const msg = `⚠️ Railway DALEBA dégradé — latence ${latency}ms. Si saturation persiste, envisager scaling (Render/AWS). Approuver manuellement.`;
      await alertCommandant(msg, 'normal');
      await logToJournal('Latence infra élevée', { latency, url: DALEBA_URL });
    }

  } catch (err) {
    const msg = `🔴 DALEBA API inaccessible — ${err.message.slice(0, 100)}. Vérification requise.`;
    console.error('[DARE Monitor]', msg);
    await alertCommandant(msg, 'critical');
    await logToJournal('Infra inaccessible', { error: err.message });
  }
}

// ─── GESTION ÉVÉNEMENTS DARE ──────────────────────────────────────────────────

function attachEventHandlers() {
  dare.healthEmitter.on('provider_down', async ({ providerId, error }) => {
    const msg = `Provider IA down: ${providerId} — ${error}. Failover automatique activé.`;
    console.error('[DARE Monitor]', msg);
    await logToJournal('Provider DOWN', { providerId, error });
    // SMS uniquement pour panne prolongée (3+ failures = déjà dans dare.js)
    await alertCommandant(`${msg}`, 'normal');
  });

  dare.healthEmitter.on('provider_demoted', async ({ providerId, errorRate }) => {
    const msg = `Provider ${providerId} rétrogradé — taux d'erreur ${errorRate.toFixed(1)}%`;
    await logToJournal('Provider rétrogradé', { providerId, errorRate });
    console.warn('[DARE Monitor]', msg);
  });

  dare.healthEmitter.on('cost_alert', async ({ providerId, costThisHourUSD, threshold }) => {
    const msg = `🔴 Alerte coût horaire: ${providerId} a consommé ${costThisHourUSD.toFixed(2)}$ en 1h (seuil: ${threshold}$). Bridé automatiquement.`;
    await alertCommandant(msg, 'critical');
    await logToJournal('Alerte coût horaire', { providerId, costThisHourUSD, threshold });
  });

  dare.healthEmitter.on('auth_error', async ({ providerId, error }) => {
    const msg = `Clé API ${providerId} invalide ou expirée — Action requise: renouveler la clé dans Railway.`;
    await alertCommandant(msg, 'critical');
    await logToJournal('Clé API expirée', { providerId, error });
  });

  // [028] Intervention humaine requise
  dare.healthEmitter.on('human_action_required', async ({ providerId, reason, message }) => {
    console.warn('[DARE Monitor] Action humaine requise:', reason);
    await alertCommandant(message, 'critical');
    await logToJournal('Intervention humaine requise', { providerId, reason });
  });

  dare.healthEmitter.on('connector_registered', async ({ id, name }) => {
    await logToJournal('Nouveau connecteur enregistré', { id, name });
    const bus = getEventBus();
    if (bus) bus.system(`✅ DARE: Connecteur ${name} (${id}) enregistré`);
  });

  dare.healthEmitter.on('connector_deprecated', async ({ providerId, replacedBy }) => {
    await logToJournal('Connecteur déprécié', { providerId, replacedBy });
  });
}

// ─── DÉMARRAGE [047] ─────────────────────────────────────────────────────────
// Tout tourne en arrière-plan, non-bloquant

function start() {
  if (state.started) return;
  state.started = true;

  attachEventHandlers();

  // Rapport quotidien à 23h30 UTC [033]
  scheduleDailyReport();

  // Check coût horaire toutes les 15min [037]
  state.hourlyCostTimer = setInterval(checkHourlyCosts, 15 * 60 * 1000);

  // Check infra toutes les 10min [036]
  state.infraCheckTimer = setInterval(checkInfrastructure, 10 * 60 * 1000);

  console.log('[DARE Monitor] ✅ Démarré — analyse 24h, alertes coût, surveillance infra');
}

function scheduleDailyReport() {
  const now = new Date();
  const target = new Date();
  target.setUTCHours(23, 30, 0, 0);
  if (target <= now) target.setUTCDate(target.getUTCDate() + 1);

  const delay = target - now;
  state.dailyReportTimer = setTimeout(async () => {
    await runDailyAnalysis();
    // Reschedule pour le lendemain
    scheduleDailyReport();
  }, delay);
}

function stop() {
  if (state.dailyReportTimer) clearTimeout(state.dailyReportTimer);
  if (state.hourlyCostTimer)  clearInterval(state.hourlyCostTimer);
  if (state.infraCheckTimer)  clearInterval(state.infraCheckTimer);
  state.started = false;
  console.log('[DARE Monitor] Arrêté');
}

// ─── EXPORTS ─────────────────────────────────────────────────────────────────

module.exports = {
  start,
  stop,
  runDailyAnalysis,
  checkInfrastructure,
  alertCommandant,
  getState: () => ({ ...state, lastDailyReport: state.lastDailyReport }),
};
