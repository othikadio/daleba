'use strict';
/**
 * Onboarding Watchdog — DALEBA Metacortex Point 294
 * Mesure le temps de chaque étape d'onboarding et signale les goulots d'étranglement.
 */
const bus = require('./event-bus');

// Seuils d'alerte en ms
const THRESHOLDS = {
  db_init:         500,
  twilio_provision: 8000,
  square_oauth_url: 200,
  mmi_gen:          100,
  cron_init:        500,
  api_key:          200,
  square_exchange:  5000,
  seed_catalog:    15000,
  seed_staff:       5000,
  ping_validate:   30000,
};

const _sessions = new Map(); // tenantId → { steps: [{name, startMs, endMs, durationMs, ok}] }

function startStep(tenantId, stepName) {
  const session = _sessions.get(tenantId) || { tenantId, steps: [], startMs: Date.now() };
  session.steps.push({ name: stepName, startMs: Date.now(), endMs: null, durationMs: null, ok: null });
  _sessions.set(tenantId, session);
  return session;
}

function endStep(tenantId, stepName, ok = true, error = null) {
  const session = _sessions.get(tenantId);
  if (!session) return;
  const step = [...session.steps].reverse().find(s => s.name === stepName && s.endMs === null);
  if (!step) return;
  step.endMs      = Date.now();
  step.durationMs = step.endMs - step.startMs;
  step.ok         = ok;
  step.error      = error;

  const threshold = THRESHOLDS[stepName];
  if (threshold && step.durationMs > threshold) {
    bus.system(`[Watchdog] ⚠️ Goulot: ${stepName} pour ${tenantId} — ${step.durationMs}ms (seuil: ${threshold}ms)`);
  }
}

function getReport(tenantId) {
  const session = _sessions.get(tenantId);
  if (!session) return null;
  const totalMs   = Date.now() - session.startMs;
  const bottlenecks = session.steps.filter(s => {
    const t = THRESHOLDS[s.name];
    return t && s.durationMs && s.durationMs > t;
  });
  return {
    tenantId,
    totalMs,
    steps:        session.steps,
    bottlenecks:  bottlenecks.map(s => ({ name: s.name, durationMs: s.durationMs, thresholdMs: THRESHOLDS[s.name] })),
    verdict:      bottlenecks.length === 0 ? '✅ Performance nominale' : `⚠️ ${bottlenecks.length} goulot(s) détecté(s)`,
  };
}

function clearSession(tenantId) { _sessions.delete(tenantId); }

// Wrappe une fonction async et mesure son temps
function timed(tenantId, stepName, fn) {
  return async (...args) => {
    startStep(tenantId, stepName);
    try {
      const result = await fn(...args);
      endStep(tenantId, stepName, true);
      return result;
    } catch (err) {
      endStep(tenantId, stepName, false, err.message);
      throw err;
    }
  };
}

module.exports = { startStep, endStep, getReport, clearSession, timed, THRESHOLDS };
