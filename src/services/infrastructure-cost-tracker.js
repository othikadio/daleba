/**
 * Infrastructure Cost Tracker — DALEBA Metacortex Points 168-169
 *
 * [168] Cumul en temps réel des dépenses infrastructure
 * [169] OpenAI · Anthropic · DeepSeek · Replicate — tokens ou secondes
 */

'use strict';

const bus = require('./event-bus');
const { roundCents } = require('./fiscal-engine');

// ─── GRILLE TARIFAIRE [169] ──────────────────────────────────────────────────
// Tarifs publics au 2026-Q1 (à mettre à jour si changement)

const PRICING = {
  // Anthropic Claude
  'claude-sonnet-4':    { input: 3.00, output: 15.00,  unit: '1M_tokens', currency: 'USD' },
  'claude-haiku-4':     { input: 0.25, output: 1.25,   unit: '1M_tokens', currency: 'USD' },
  'claude-opus-4':      { input: 15.00, output: 75.00, unit: '1M_tokens', currency: 'USD' },

  // OpenAI
  'gpt-4o':             { input: 2.50, output: 10.00,  unit: '1M_tokens', currency: 'USD' },
  'gpt-4o-mini':        { input: 0.15, output: 0.60,   unit: '1M_tokens', currency: 'USD' },
  'gpt-4-turbo':        { input: 10.00, output: 30.00, unit: '1M_tokens', currency: 'USD' },
  'whisper-1':          { price: 0.006, unit: 'per_minute', currency: 'USD' }, // transcription

  // DeepSeek
  'deepseek-chat':      { input: 0.14, output: 0.28,   unit: '1M_tokens', currency: 'USD' },
  'deepseek-reasoner':  { input: 0.55, output: 2.19,   unit: '1M_tokens', currency: 'USD' },

  // Gemini
  'gemini-1.5-pro':     { input: 1.25, output: 5.00,   unit: '1M_tokens', currency: 'USD' },
  'gemini-1.5-flash':   { input: 0.075, output: 0.30,  unit: '1M_tokens', currency: 'USD' },

  // Replicate — modèles d'images/vidéo
  'flux-pro':           { price: 0.055, unit: 'per_image',   currency: 'USD' },
  'flux-schnell':       { price: 0.003, unit: 'per_image',   currency: 'USD' },
  'real-esrgan':        { price: 0.001, unit: 'per_image',   currency: 'USD' },
  'gfpgan':             { price: 0.001, unit: 'per_image',   currency: 'USD' },

  // ElevenLabs TTS
  'elevenlabs-turbo':   { price: 0.003, unit: 'per_1k_chars', currency: 'USD' },
  'elevenlabs-v2':      { price: 0.0033, unit: 'per_1k_chars', currency: 'USD' },
};

// Alias fournisseurs → modèles par défaut
const PROVIDER_DEFAULT_MODEL = {
  'anthropic':   'claude-sonnet-4',
  'openai':      'gpt-4o',
  'deepseek':    'deepseek-chat',
  'gemini':      'gemini-1.5-pro',
  'replicate':   'flux-pro',
  'elevenlabs':  'elevenlabs-turbo',
  'whisper':     'whisper-1',
};

// ─── ACCUMULATEUR EN MÉMOIRE [168] ───────────────────────────────────────────

const _ledger = new Map(); // provider → { totalUSD, calls, tokens }
const _monthly = { month: null, totalUSD: 0 };

function _getEntry(provider) {
  if (!_ledger.has(provider)) {
    _ledger.set(provider, { totalUSD: 0, calls: 0, inputTokens: 0, outputTokens: 0, units: 0 });
  }
  return _ledger.get(provider);
}

// ─── CALCUL COÛT [169] ───────────────────────────────────────────────────────

/**
 * Calcule le coût d'un appel API et l'enregistre
 * @param {string} provider  — 'anthropic'|'openai'|'deepseek'|'replicate'|...
 * @param {string} model     — modèle utilisé (optionnel, fallback sur défaut)
 * @param {object} usage     — { inputTokens, outputTokens } ou { minutes } ou { images } ou { chars }
 */
function trackAPICall(provider, model, usage = {}) {
  const modelKey = model || PROVIDER_DEFAULT_MODEL[provider] || provider;
  const pricing  = PRICING[modelKey] || PRICING[PROVIDER_DEFAULT_MODEL[provider]];

  if (!pricing) {
    console.warn(`[CostTracker] Pas de tarif pour: ${modelKey}`);
    return 0;
  }

  let costUSD = 0;

  if (pricing.unit === '1M_tokens') {
    const inTok  = usage.inputTokens  || usage.input_tokens  || usage.prompt_tokens  || 0;
    const outTok = usage.outputTokens || usage.output_tokens || usage.completion_tokens || 0;
    costUSD = (inTok / 1e6) * pricing.input + (outTok / 1e6) * pricing.output;

    const entry = _getEntry(provider);
    entry.inputTokens  += inTok;
    entry.outputTokens += outTok;
  } else if (pricing.unit === 'per_minute') {
    const mins = usage.minutes || usage.durationSeconds ? usage.durationSeconds / 60 : 0;
    costUSD = mins * pricing.price;
    _getEntry(provider).units += mins;
  } else if (pricing.unit === 'per_image') {
    const imgs = usage.images || 1;
    costUSD = imgs * pricing.price;
    _getEntry(provider).units += imgs;
  } else if (pricing.unit === 'per_1k_chars') {
    const chars = usage.chars || 0;
    costUSD = (chars / 1000) * pricing.price;
    _getEntry(provider).units += chars;
  }

  costUSD = Math.round(costUSD * 1000000) / 1000000; // 6 décimales micro-cents

  const entry = _getEntry(provider);
  entry.totalUSD += costUSD;
  entry.calls    += 1;

  // Cumul mensuel
  const thisMonth = new Date().toISOString().slice(0, 7);
  if (_monthly.month !== thisMonth) { _monthly.month = thisMonth; _monthly.totalUSD = 0; }
  _monthly.totalUSD = Math.round((_monthly.totalUSD + costUSD) * 1000000) / 1000000;

  // Alertes seuil [168]
  _checkBudgetAlerts();

  return costUSD;
}

// ─── ALERTES BUDGET [168] ────────────────────────────────────────────────────

const MONTHLY_BUDGET_CAP_USD = parseFloat(process.env.MONTHLY_API_BUDGET_USD) || 100;

function _checkBudgetAlerts() {
  const pct = _monthly.totalUSD / MONTHLY_BUDGET_CAP_USD;
  if (pct >= 1.0)   bus.system(`🔴 BUDGET API DÉPASSÉ: $${_monthly.totalUSD.toFixed(2)}/$${MONTHLY_BUDGET_CAP_USD} USD`);
  else if (pct >= 0.9) bus.system(`⚠️ Budget API 90%: $${_monthly.totalUSD.toFixed(2)}/$${MONTHLY_BUDGET_CAP_USD} USD`);
  else if (pct >= 0.75 && pct < 0.76) bus.system(`📊 Budget API 75%: $${_monthly.totalUSD.toFixed(2)} USD`);
}

// ─── RAPPORT [168] ───────────────────────────────────────────────────────────

function getCostReport() {
  const breakdown = {};
  let totalUSD = 0;

  for (const [provider, data] of _ledger.entries()) {
    breakdown[provider] = {
      totalUSD:     Math.round(data.totalUSD * 1000000) / 1000000,
      calls:        data.calls,
      inputTokens:  data.inputTokens,
      outputTokens: data.outputTokens,
      units:        data.units,
    };
    totalUSD += data.totalUSD;
  }

  const monthBudgetUsed = roundCents((_monthly.totalUSD / MONTHLY_BUDGET_CAP_USD) * 100);

  return {
    totalUSD:         Math.round(totalUSD * 1000000) / 1000000,
    monthlyCumUSD:    _monthly.totalUSD,
    monthlyBudgetCap: MONTHLY_BUDGET_CAP_USD,
    monthBudgetUsed:  `${monthBudgetUsed}%`,
    month:            _monthly.month,
    breakdown,
    timestamp:        new Date().toISOString(),
  };
}

function formatCostReport() {
  const r = getCostReport();
  const lines = [
    `📊 DALEBA Infrastructure Costs — ${r.month}`,
    `────────────────────────────────`,
    ...Object.entries(r.breakdown).map(([p, d]) =>
      `  ${p.padEnd(12)}: $${d.totalUSD.toFixed(6)} USD (${d.calls} appels)`
    ),
    `────────────────────────────────`,
    `  TOTAL    : $${r.monthlyCumUSD.toFixed(4)} / $${r.monthlyBudgetCap} USD (${r.monthBudgetUsed})`,
  ];
  return lines.join('\n');
}

// ─── PERSISTANCE DALEBA_NOTES ─────────────────────────────────────────────────

async function persistCostSnapshot() {
  const maintenance = require('./maintenance');
  const pool = maintenance.getPool();
  if (!pool) return;

  const report = getCostReport();
  await pool.query(`
    INSERT INTO daleba_notes (category, key, content, created_at)
    VALUES ('infra_costs', $1, $2, NOW())
    ON CONFLICT (category, key)
    DO UPDATE SET content = EXCLUDED.content, created_at = NOW()
  `, [
    `costs_${report.month}`,
    JSON.stringify(report),
  ]).catch(() => {});
}

function startCostPersistenceScheduler(intervalMs = 60 * 60 * 1000) {
  setInterval(() => {
    persistCostSnapshot().catch(e => console.warn('[CostTracker] Persist:', e.message));
  }, intervalMs);
}

// ─── INTÉGRATION DARE [169] ──────────────────────────────────────────────────

/**
 * Middleware DARE: appeler cette fonction depuis dare.js updateCostTracking()
 */
function onDARECost(providerId, costUSD, usage = {}) {
  const dareToProvider = {
    claude:   'anthropic',
    gpt4o:    'openai',
    deepseek: 'deepseek',
    gemini:   'gemini',
  };
  const p = dareToProvider[providerId] || providerId;
  const entry = _getEntry(p);
  entry.totalUSD += costUSD;
  entry.calls    += 1;
  if (usage.input_tokens)  entry.inputTokens  += usage.input_tokens;
  if (usage.output_tokens) entry.outputTokens += usage.output_tokens;
  _monthly.totalUSD += costUSD;
}

// ─── EXPORTS ─────────────────────────────────────────────────────────────────

module.exports = {
  trackAPICall, getCostReport, formatCostReport,
  onDARECost, persistCostSnapshot, startCostPersistenceScheduler,
  PRICING, PROVIDER_DEFAULT_MODEL,
};
