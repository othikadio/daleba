/**
 * Budget Guard — DALEBA Metacortex Point 170
 *
 * Blocage instantané de tout agent/sous-système qui tente de dépasser
 * le budget mensuel strict DARE_MONTHLY_BUDGET_USD.
 *
 * Intègre un circuit-breaker global partagé entre tous les consommateurs
 * API (DARE, image-engine, video-pipeline, TTS, etc.)
 */

'use strict';

const bus = require('./event-bus');

// ─── CONFIGURATION [170] ──────────────────────────────────────────────────────

const MONTHLY_CAP_USD  = parseFloat(process.env.DARE_MONTHLY_BUDGET_USD) || 50;
const WARNING_THRESHOLDS = [0.75, 0.90, 0.95, 1.00]; // % du budget

// ─── ÉTAT GLOBAL DU CIRCUIT-BREAKER ──────────────────────────────────────────

const state = {
  totalSpentUSD:  0,
  byComponent:    {},  // { 'dare:claude': 0.123, 'image-engine': 0.05, ... }
  blocked:        false,
  blockReason:    null,
  lastAlertLevel: 0,
  month:          new Date().toISOString().slice(0, 7),
};

// ─── RÉINITIALISATION MENSUELLE ───────────────────────────────────────────────

function _checkMonthRollover() {
  const thisMonth = new Date().toISOString().slice(0, 7);
  if (state.month !== thisMonth) {
    state.month        = thisMonth;
    state.totalSpentUSD = 0;
    state.byComponent  = {};
    state.blocked      = false;
    state.blockReason  = null;
    state.lastAlertLevel = 0;
    bus.system(`[BudgetGuard] Nouveau mois ${thisMonth} — compteurs réinitialisés`);
  }
}

// ─── VÉRIFICATION AVANT APPEL [170] ──────────────────────────────────────────

/**
 * Lance une exception si le budget mensuel est dépassé.
 * À appeler AVANT tout appel API coûteux.
 * @param {string} component — identifiant du sous-système (ex: 'dare:claude', 'image-engine')
 * @param {number} estimatedCost — coût estimé de l'opération en USD
 */
function checkBudget(component, estimatedCost = 0) {
  _checkMonthRollover();

  if (state.blocked) {
    throw new BudgetExceededError(
      `[BudgetGuard] 🔴 SYSTÈME BLOQUÉ — Budget mensuel épuisé ($${state.totalSpentUSD.toFixed(4)}/$${MONTHLY_CAP_USD}). Raison: ${state.blockReason}`,
      { totalSpent: state.totalSpentUSD, cap: MONTHLY_CAP_USD }
    );
  }

  const projectedTotal = state.totalSpentUSD + estimatedCost;
  if (projectedTotal >= MONTHLY_CAP_USD) {
    _triggerHardBlock(`Opération estimée $${estimatedCost.toFixed(4)} dépasserait le cap $${MONTHLY_CAP_USD} (total: $${projectedTotal.toFixed(4)})`);
    throw new BudgetExceededError(
      `[BudgetGuard] 🔴 Opération BLOQUÉE — dépasserait le budget mensuel ($${projectedTotal.toFixed(4)} > $${MONTHLY_CAP_USD})`,
      { estimatedCost, projected: projectedTotal, cap: MONTHLY_CAP_USD }
    );
  }
}

// ─── ENREGISTREMENT D'UNE DÉPENSE ─────────────────────────────────────────────

/**
 * Enregistre un coût réel après exécution.
 * @param {string} component
 * @param {number} costUSD
 */
function recordSpend(component, costUSD) {
  _checkMonthRollover();

  state.totalSpentUSD = Math.round((state.totalSpentUSD + costUSD) * 1e6) / 1e6;
  state.byComponent[component] = Math.round(
    ((state.byComponent[component] || 0) + costUSD) * 1e6
  ) / 1e6;

  _checkAlertThresholds();

  // Blocage si cap atteint
  if (state.totalSpentUSD >= MONTHLY_CAP_USD) {
    _triggerHardBlock(`Dépense réelle $${state.totalSpentUSD.toFixed(4)} a atteint le cap $${MONTHLY_CAP_USD}`);
  }
}

function _checkAlertThresholds() {
  const ratio = state.totalSpentUSD / MONTHLY_CAP_USD;
  for (const threshold of WARNING_THRESHOLDS) {
    if (ratio >= threshold && state.lastAlertLevel < threshold) {
      state.lastAlertLevel = threshold;
      const pct = Math.round(threshold * 100);
      if (threshold >= 1.0) {
        bus.system(`🔴 BUDGET MENSUEL ÉPUISÉ: $${state.totalSpentUSD.toFixed(2)}/$${MONTHLY_CAP_USD} USD — TOUS LES APPELS API BLOQUÉS`);
      } else {
        bus.system(`⚠️ Budget API ${pct}%: $${state.totalSpentUSD.toFixed(3)}/$${MONTHLY_CAP_USD} USD`);
      }
      break;
    }
  }
}

function _triggerHardBlock(reason) {
  state.blocked     = true;
  state.blockReason = reason;
  bus.system(`🔴 [BudgetGuard] CIRCUIT OUVERT — ${reason}`);
  console.error('[BudgetGuard] 🔴 HARD BLOCK:', reason);
}

// ─── DÉBLOCAGE MANUEL (COMMANDANT) ───────────────────────────────────────────

function unlockBudget(newCapUSD, adminToken) {
  // Validation minimale — en production: vérifier JWT admin
  if (!adminToken) throw new Error('Token admin requis pour débloquer le budget');
  const prevCap = MONTHLY_CAP_USD;
  if (newCapUSD && newCapUSD > state.totalSpentUSD) {
    // Mise à jour du cap via env (runtime)
    process.env.DARE_MONTHLY_BUDGET_USD = String(newCapUSD);
  }
  state.blocked = false;
  state.blockReason = null;
  bus.system(`[BudgetGuard] ✅ Déblocage autorisé par Commandant. Nouveau cap: $${newCapUSD || prevCap}`);
}

// ─── ÉTAT ─────────────────────────────────────────────────────────────────────

function getStatus() {
  _checkMonthRollover();
  return {
    blocked:        state.blocked,
    blockReason:    state.blockReason,
    totalSpentUSD:  state.totalSpentUSD,
    monthlyCapUSD:  MONTHLY_CAP_USD,
    usagePct:       Math.round((state.totalSpentUSD / MONTHLY_CAP_USD) * 10000) / 100,
    month:          state.month,
    byComponent:    { ...state.byComponent },
    remainingUSD:   Math.max(0, MONTHLY_CAP_USD - state.totalSpentUSD),
  };
}

// ─── ERREUR CUSTOM ────────────────────────────────────────────────────────────

class BudgetExceededError extends Error {
  constructor(message, meta = {}) {
    super(message);
    this.name    = 'BudgetExceededError';
    this.code    = 'BUDGET_EXCEEDED';
    this.meta    = meta;
  }
}

// ─── EXPORTS ─────────────────────────────────────────────────────────────────

module.exports = {
  checkBudget, recordSpend, unlockBudget, getStatus,
  BudgetExceededError, MONTHLY_CAP_USD,
};
