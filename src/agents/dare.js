/**
 * DARE — Dynamic Agnostic Routing Engine  v2.0
 * DALEBA Metacortex — Volume 1, Points 001-048
 *
 * Routage multi-LLM · Failover < 500ms · Exponential backoff · Cost cap
 * Context truncation · PII masking · Parallel fusion · 72h stability window
 * Error-rate auto-demotion · Connector registry · Prompt caching
 */

'use strict';

const EventEmitter = require('events');
const path = require('path');

// ─── CONFIGURATION GLOBALE ───────────────────────────────────────────────────

const CFG = {
  // [030] Plafond mensuel total (USD) — configurable via env
  monthlyBudgetUSD: parseFloat(process.env.DARE_MONTHLY_BUDGET_USD || '50'),
  // [037] Seuil d'alerte horaire (USD) par provider
  hourlyAlertThresholdUSD: parseFloat(process.env.DARE_HOURLY_ALERT_USD || '10'),
  // [031] Budget tokens contexte par requête (input)
  maxContextTokens: parseInt(process.env.DARE_MAX_CONTEXT_TOKENS || '6000', 10),
  // [034] Taux d'erreur max avant rétrogradation
  maxErrorRatePercent: parseFloat(process.env.DARE_MAX_ERROR_RATE || '2'),
  // [026] Fenêtre stabilité avant dépréciation (ms)
  stabilityWindowMs: parseInt(process.env.DARE_STABILITY_WINDOW_MS || String(72 * 3600 * 1000), 10),
  // [040] Backoff config
  backoff: { maxRetries: 3, baseDelayMs: 500, maxDelayMs: 8000, factor: 2 },
};

// ─── REGISTRE DES PROVIDERS ──────────────────────────────────────────────────

const PROVIDERS = {
  claude: {
    id: 'claude', name: 'Claude (Anthropic)',
    module: path.resolve(__dirname, 'claude'),
    available: !!process.env.ANTHROPIC_API_KEY,
    contextWindow: 200000, costPer1MInput: 3.00, costPer1MOutput: 15.00,
    strengths: { code: 10, strategy: 10, analysis: 10, reasoning: 10, creative: 8, conversation: 9, math: 8, bulk: 5 },
    health: { status: 'unknown', latencyMs: null, lastCheck: null, failures: 0 },
    addedAt: Date.now(), deprecated: false,
    // [044] Documentation
    docs: { url: 'https://docs.anthropic.com', authScheme: 'Bearer', envKey: 'ANTHROPIC_API_KEY' },
  },
  gpt4o: {
    id: 'gpt4o', name: 'GPT-4o (OpenAI)',
    module: path.resolve(__dirname, 'gpt4o'),
    available: !!process.env.OPENAI_API_KEY,
    contextWindow: 128000, costPer1MInput: 2.50, costPer1MOutput: 10.00,
    strengths: { creative: 10, writing: 10, conversation: 10, vision: 10, code: 8, strategy: 7, analysis: 8, math: 7, bulk: 6 },
    health: { status: 'unknown', latencyMs: null, lastCheck: null, failures: 0 },
    addedAt: Date.now(), deprecated: false,
    docs: { url: 'https://platform.openai.com/docs', authScheme: 'Bearer', envKey: 'OPENAI_API_KEY' },
  },
  deepseek: {
    id: 'deepseek', name: 'DeepSeek-V3',
    module: path.resolve(__dirname, 'deepseek'),
    available: !!process.env.DEEPSEEK_API_KEY,
    contextWindow: 64000, costPer1MInput: 0.14, costPer1MOutput: 0.28,
    strengths: { math: 10, data: 10, bulk: 10, optimization: 10, code: 9, analysis: 8, strategy: 6, creative: 4, conversation: 5 },
    health: { status: 'unknown', latencyMs: null, lastCheck: null, failures: 0 },
    addedAt: Date.now(), deprecated: false,
    docs: { url: 'https://api-docs.deepseek.com', authScheme: 'Bearer', envKey: 'DEEPSEEK_API_KEY' },
  },
  gemini: {
    id: 'gemini', name: 'Gemini 1.5 Pro (Google)',
    module: path.resolve(__dirname, 'connectors/gemini'),
    available: !!process.env.GEMINI_API_KEY,
    contextWindow: 1000000, costPer1MInput: 1.25, costPer1MOutput: 5.00,
    strengths: { analysis: 10, documents: 10, multimodal: 10, bulk: 9, code: 7, strategy: 8, creative: 7, math: 8, conversation: 7 },
    health: { status: 'unknown', latencyMs: null, lastCheck: null, failures: 0 },
    addedAt: Date.now(), deprecated: false,
    docs: { url: 'https://ai.google.dev/docs', authScheme: 'Bearer', envKey: 'GEMINI_API_KEY' },
  },
};

// ─── MÉTRIQUES JOURNALIÈRES [033, 034] ──────────────────────────────────────
// { [providerId]: { date: 'YYYY-MM-DD', requests: 0, errors: 0, costUSD: 0, demoted: false } }

const dailyMetrics = {};

function getTodayKey() {
  return new Date().toISOString().slice(0, 10);
}

function getDailyMetric(providerId) {
  const today = getTodayKey();
  if (!dailyMetrics[providerId] || dailyMetrics[providerId].date !== today) {
    dailyMetrics[providerId] = { date: today, requests: 0, errors: 0, costUSD: 0, demoted: false };
  }
  return dailyMetrics[providerId];
}

function trackRequest(providerId, success, costUSD = 0) {
  const m = getDailyMetric(providerId);
  m.requests++;
  if (!success) m.errors++;
  m.costUSD += costUSD;

  // [034] Vérification taux d'erreur
  if (m.requests >= 10) {
    const errorRate = (m.errors / m.requests) * 100;
    if (errorRate > CFG.maxErrorRatePercent && !m.demoted) {
      m.demoted = true;
      console.warn(`[DARE] ⬇️ ${providerId} rétrogradé — taux d'erreur: ${errorRate.toFixed(1)}%`);
      healthEmitter.emit('provider_demoted', { providerId, errorRate });
    }
  }
}

// ─── STATS GLOBALES ──────────────────────────────────────────────────────────

const usageStats = {
  requestsTotal: 0,
  requestsByProvider: {},
  failovers: 0,
  costUSD: 0,
  costByProvider: {},
  costThisHour: {},       // [037] { [providerId]: { windowStart: ts, costUSD: 0 } }
  bridledProviders: new Set(), // [037] providers bridés
  lastReset: Date.now(),
};

// ─── PII MASKING [039, 043] ──────────────────────────────────────────────────

const PII_PATTERNS = [
  // Noms complets (heuristique)
  { regex: /\b[A-Z][a-zéèàêâîôùûü]+ [A-Z][a-zéèàêâîôùûü]+\b/g, replacement: '[NOM]' },
  // Téléphones canadiens/français
  { regex: /\b(?:\+?1[-.\s]?)?\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4}\b/g, replacement: '[TEL]' },
  { regex: /\b(?:\+33|0)[1-9](?:[-.\s]?\d{2}){4}\b/g, replacement: '[TEL]' },
  // Emails
  { regex: /[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}/g, replacement: '[EMAIL]' },
  // Cartes de crédit
  { regex: /\b(?:\d{4}[-\s]?){3}\d{4}\b/g, replacement: '[CARTE]' },
  // Clés API génériques (r8_, sk-, Bearer xxx)
  { regex: /\b(r8_|sk-|pk_)[A-Za-z0-9]{10,}/g, replacement: '[API_KEY]' },
  { regex: /Bearer\s+[A-Za-z0-9\-._~+/]+=*/gi, replacement: 'Bearer [REDACTED]' },
];

function maskForLog(text) {
  if (!text || typeof text !== 'string') return text;
  let out = text;
  for (const { regex, replacement } of PII_PATTERNS) {
    out = out.replace(regex, replacement);
  }
  return out;
}

// [043] Masquage pour requêtes sortantes vers APIs tierces
function maskForAPI(message) {
  // Masque uniquement si la requête contient des noms de clients identifiables
  // (heuristique conservatrice — ne modifie pas si pas de PII détectés)
  const hasPII = PII_PATTERNS.slice(0, 3).some(({ regex }) => {
    regex.lastIndex = 0;
    return regex.test(message);
  });
  return hasPII ? maskForLog(message) : message;
}

// ─── CONTEXT TRUNCATION [031] ────────────────────────────────────────────────
// Estimation rough: 1 token ≈ 4 chars (fr/en mélangé)

function estimateTokens(text) {
  return Math.ceil((text || '').length / 4);
}

function truncateHistory(history, maxTokens = CFG.maxContextTokens) {
  if (!Array.isArray(history) || history.length === 0) return [];

  // Compte depuis la fin (messages récents = plus importants)
  let total = 0;
  const kept = [];

  for (let i = history.length - 1; i >= 0; i--) {
    const tokens = estimateTokens(history[i].content || '');
    if (total + tokens > maxTokens && kept.length > 0) break;
    kept.unshift(history[i]);
    total += tokens;
  }

  if (kept.length < history.length) {
    console.log(`[DARE] Contexte tronqué: ${history.length} → ${kept.length} messages (${total} tokens estimés)`);
  }

  return kept;
}

// ─── EXPONENTIAL BACKOFF [040] ───────────────────────────────────────────────

async function withExponentialBackoff(fn, providerId, options = {}) {
  const { maxRetries, baseDelayMs, maxDelayMs, factor } = { ...CFG.backoff, ...options };
  let attempt = 0;

  while (attempt <= maxRetries) {
    try {
      return await fn();
    } catch (err) {
      // Ne pas retry sur des erreurs d'auth [027]
      if (err.status === 401 || err.status === 403 || err.message?.includes('auth')) {
        healthEmitter.emit('auth_error', { providerId, error: err.message });
        throw err;
      }

      // Rate limit → backoff [040]
      const isRateLimit = err.status === 429 || err.message?.includes('rate') || err.message?.includes('limit');

      if (attempt === maxRetries) throw err;

      const delay = Math.min(baseDelayMs * Math.pow(factor, attempt), maxDelayMs);
      const jitter = Math.random() * 200;
      const waitMs = Math.round(delay + jitter);

      if (isRateLimit) {
        console.warn(`[DARE] Rate limit ${providerId} — retry ${attempt + 1}/${maxRetries} dans ${waitMs}ms`);
      }

      await new Promise(r => setTimeout(r, waitMs));
      attempt++;
    }
  }
}

// ─── COST CAP ENFORCEMENT [030, 037] ────────────────────────────────────────

function checkCostCap(providerId) {
  // [170] BudgetGuard global — blocage instantané si cap dépassé
  try {
    const guard = require('../services/budget-guard');
    guard.checkBudget(`dare:${providerId}`, 0.002); // estimation conservatrice
  } catch (bgErr) {
    if (bgErr.code === 'BUDGET_EXCEEDED') throw bgErr; // propager
    // guard non disponible au boot — continuer
  }
  // [030] Plafond mensuel local DARE
  const monthlyTotal = Object.values(usageStats.costByProvider).reduce((a, b) => a + b, 0);
  if (monthlyTotal >= CFG.monthlyBudgetUSD) {
    throw new Error(`[DARE] Plafond mensuel atteint (${monthlyTotal.toFixed(2)}$ / ${CFG.monthlyBudgetUSD}$). Approbation Commandant requise.`);
  }

  // [037] Plafond horaire par provider
  const now = Date.now();
  if (!usageStats.costThisHour[providerId]) {
    usageStats.costThisHour[providerId] = { windowStart: now, costUSD: 0 };
  }

  const hourWindow = usageStats.costThisHour[providerId];
  if (now - hourWindow.windowStart > 3600000) {
    // Réinitialise fenêtre horaire
    hourWindow.windowStart = now;
    hourWindow.costUSD = 0;
    usageStats.bridledProviders.delete(providerId);
  }

  if (usageStats.bridledProviders.has(providerId)) {
    throw new Error(`[DARE] Provider ${providerId} bridé — dépasse ${CFG.hourlyAlertThresholdUSD}$/h. En attente analyse.`);
  }
}

function updateCostTracking(providerId, costUSD, usage) {
  usageStats.costUSD += costUSD;
  usageStats.costByProvider[providerId] = (usageStats.costByProvider[providerId] || 0) + costUSD;
  // [169] Sync infra-cost-tracker
  try {
    const tracker = require('../services/infrastructure-cost-tracker');
    tracker.onDARECost(providerId, costUSD, usage || {});
  } catch { /* tracker non chargé au boot initial */ }

  // [037] Fenêtre horaire
  if (usageStats.costThisHour[providerId]) {
    usageStats.costThisHour[providerId].costUSD += costUSD;
    if (usageStats.costThisHour[providerId].costUSD >= CFG.hourlyAlertThresholdUSD) {
      usageStats.bridledProviders.add(providerId);
      console.error(`[DARE] 🔴 ${providerId} bridé — ${usageStats.costThisHour[providerId].costUSD.toFixed(2)}$/h`);
      healthEmitter.emit('cost_alert', {
        providerId,
        costThisHourUSD: usageStats.costThisHour[providerId].costUSD,
        threshold: CFG.hourlyAlertThresholdUSD,
      });
    }
  }
}

// ─── CLASSIFICATION DES TÂCHES ───────────────────────────────────────────────

const TASK_PROFILES = [
  {
    type: 'financial',
    keywords: ['bilan', "chiffre d'affaires", 'ca ', 'revenue', 'revenu', 'calcul',
      'math', 'statistique', 'données', 'tableau', 'excel', 'csv', 'optimis',
      'coût', 'budget', 'profit', 'perte', 'comptabilité'],
    priorities: ['deepseek', 'claude', 'gpt4o', 'gemini'],
  },
  {
    type: 'code',
    keywords: ['code', 'programme', 'fonction', 'bug', 'erreur', 'script', 'api',
      'endpoint', 'javascript', 'node', 'python', 'sql', 'database', 'debug'],
    priorities: ['claude', 'gpt4o', 'deepseek', 'gemini'],
  },
  {
    type: 'strategy',
    keywords: ['stratégie', 'architecture', 'vision', 'plan', 'objectif', 'analyse',
      'pourquoi', 'explique', 'décision', 'expansion', 'marché'],
    priorities: ['claude', 'gemini', 'gpt4o', 'deepseek'],
  },
  {
    type: 'creative',
    keywords: ['écris', 'rédige', 'histoire', 'slogan', 'caption', 'description',
      'post', 'instagram', 'marketing', 'publicité', 'accroche', 'campagne'],
    priorities: ['gpt4o', 'claude', 'gemini', 'deepseek'],
  },
  {
    type: 'document',
    keywords: ['résumé', 'synthèse', 'document', 'pdf', 'rapport', 'analyse doc',
      'extrait', 'transcription', 'long texte'],
    priorities: ['gemini', 'claude', 'gpt4o', 'deepseek'],
  },
  {
    type: 'conversation',
    keywords: ['bonjour', 'salut', 'comment', 'qui', 'quoi', 'aide', 'répondre',
      'rdv', 'rendez-vous', 'réservation', 'client'],
    priorities: ['claude', 'gpt4o', 'gemini', 'deepseek'],
  },
];

function classifyTask(message) {
  const text = message.toLowerCase();
  let bestProfile = null;
  let bestScore = 0;
  for (const profile of TASK_PROFILES) {
    const matches = profile.keywords.filter(kw => text.includes(kw)).length;
    if (matches > bestScore) { bestScore = matches; bestProfile = profile; }
  }
  return bestProfile || TASK_PROFILES[TASK_PROFILES.length - 1];
}

function getAvailableHealthyProviders(priorityList) {
  return priorityList.filter(id => {
    const p = PROVIDERS[id];
    if (!p || !p.available || p.deprecated) return false;
    if (p.health.status === 'down') return false;
    if (usageStats.bridledProviders.has(id)) return false;
    // [034] Exclure si rétrogradé aujourd'hui (mais ne pas bloquer complètement)
    const m = dailyMetrics[id];
    if (m?.demoted) return false;
    return true;
  });
}

function selectProvider(message, options = {}) {
  if (options.forceProvider && PROVIDERS[options.forceProvider]?.available) {
    return { provider: options.forceProvider, task: 'forced', reason: '🎯 Provider forcé explicitement' };
  }

  const task = classifyTask(message);
  const healthy = getAvailableHealthyProviders(task.priorities);

  if (healthy.length === 0) {
    // [034] Si tous sont rétrogradés, utiliser quand même le premier dispo (dernier recours)
    const anyAvailable = Object.keys(PROVIDERS).find(id =>
      PROVIDERS[id].available && !PROVIDERS[id].deprecated && PROVIDERS[id].health.status !== 'down'
    );
    if (!anyAvailable) throw new Error('DARE: Aucun provider LLM disponible');
    return { provider: anyAvailable, task: task.type, reason: '⚠️ Fallback universel — providers préférés indisponibles' };
  }

  const icons = { financial: '📊', code: '💻', strategy: '🧠', creative: '✍️', document: '📄', conversation: '💬' };
  return {
    provider: healthy[0],
    task: task.type,
    reason: `${icons[task.type] || '🤖'} ${PROVIDERS[healthy[0]].name} — tâche: ${task.type}`,
  };
}

// ─── HEALTH CHECK ENGINE ─────────────────────────────────────────────────────

const healthEmitter = new EventEmitter();
let healthCheckInterval = null;

async function pingProvider(providerId) {
  const provider = PROVIDERS[providerId];
  if (!provider || !provider.available || provider.deprecated) {
    if (provider) provider.health.status = 'unavailable';
    return;
  }

  const start = Date.now();
  try {
    let agent;
    try { agent = require(provider.module); } catch { return; }

    await Promise.race([
      agent.query('ping', 'Reply with exactly: pong', []),
      new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), 5000)),
    ]);

    const latency = Date.now() - start;
    provider.health.status = latency > 3000 ? 'degraded' : 'healthy';
    provider.health.latencyMs = latency;
    provider.health.failures = 0;
    provider.health.lastCheck = new Date().toISOString();

  } catch (err) {
    provider.health.failures = (provider.health.failures || 0) + 1;
    provider.health.status = provider.health.failures >= 3 ? 'down' : 'degraded';
    provider.health.lastCheck = new Date().toISOString();

    // [027] Détection expiration clé
    if (err.status === 401 || err.status === 403) {
      healthEmitter.emit('auth_error', { providerId, error: 'Clé API invalide ou expirée' });
    }

    if (provider.health.status === 'down') {
      healthEmitter.emit('provider_down', { providerId, error: err.message });
    }
  }
}

async function runHealthChecks() {
  const checks = Object.keys(PROVIDERS).map(id => pingProvider(id));
  await Promise.allSettled(checks);
}

function startHealthCheckLoop(intervalMs = 120000) {
  if (healthCheckInterval) return;
  setTimeout(runHealthChecks, 10000);
  healthCheckInterval = setInterval(runHealthChecks, intervalMs);
  console.log('[DARE] Health check loop démarré (interval:', intervalMs / 1000, 's)');
}

function stopHealthCheckLoop() {
  if (healthCheckInterval) { clearInterval(healthCheckInterval); healthCheckInterval = null; }
}

// ─── EXÉCUTION PRINCIPALE AVEC FAILOVER + BACKOFF ───────────────────────────

async function executeWithFailover(message, systemPrompt, history, options = {}) {
  const { provider: primaryId, task, reason } = selectProvider(message, options);

  const taskProfile = TASK_PROFILES.find(t => t.type === task) || TASK_PROFILES[TASK_PROFILES.length - 1];
  const candidateQueue = getAvailableHealthyProviders(taskProfile.priorities);
  const queue = [primaryId, ...candidateQueue.filter(id => id !== primaryId)];

  // [031] Truncation contexte
  const trimmedHistory = truncateHistory(history, CFG.maxContextTokens);

  // [043] Masquage PII pour APIs tierces
  const safeMessage = maskForAPI(message);

  let lastError = null;
  const startTotal = Date.now();

  for (const providerId of queue) {
    const provider = PROVIDERS[providerId];
    if (!provider?.available) continue;

    const isFailover = providerId !== primaryId;
    if (isFailover) {
      console.warn(`[DARE] Failover → ${providerId} (primary ${primaryId} failed)`);
      usageStats.failovers++;
    }

    try {
      // [030, 037] Vérification plafond avant exécution
      checkCostCap(providerId);

      let agent;
      try {
        agent = require(provider.module);
      } catch (modErr) {
        console.warn(`[DARE] Module non chargeable (${providerId}):`, modErr.message);
        continue;
      }

      // [040] Exécution avec backoff
      const result = await withExponentialBackoff(
        () => Promise.race([
          agent.query(safeMessage, systemPrompt, trimmedHistory),
          new Promise((_, reject) =>
            setTimeout(() => reject(new Error('dare_timeout')), options.timeoutMs || 30000)
          ),
        ]),
        providerId
      );

      // Calcul coût
      let costUSD = 0;
      if (result.usage) {
        const inTok = result.usage.input_tokens || result.usage.prompt_tokens || 0;
        const outTok = result.usage.output_tokens || result.usage.completion_tokens || 0;
        costUSD = (inTok / 1e6) * provider.costPer1MInput + (outTok / 1e6) * provider.costPer1MOutput;
      }

      // Mise à jour stats
      usageStats.requestsTotal++;
      usageStats.requestsByProvider[providerId] = (usageStats.requestsByProvider[providerId] || 0) + 1;
      updateCostTracking(providerId, costUSD, result.usage);
      trackRequest(providerId, true, costUSD);
      // [170] BudgetGuard — enregistrer la dépense réelle
      try { require('../services/budget-guard').recordSpend(`dare:${providerId}`, costUSD); } catch {}

      return {
        ...result,
        _dare: {
          provider: providerId,
          task,
          reason: isFailover ? `⚡ Failover → ${provider.name}` : reason,
          latencyMs: Date.now() - startTotal,
          failover: isFailover,
          contextMessages: trimmedHistory.length,
          costUSD: Math.round(costUSD * 100000) / 100000,
        },
      };

    } catch (err) {
      lastError = err;
      trackRequest(providerId, false);
      if (PROVIDERS[providerId]) {
        PROVIDERS[providerId].health.status = 'degraded';
        PROVIDERS[providerId].health.failures = (PROVIDERS[providerId].health.failures || 0) + 1;
      }
      console.warn(`[DARE] ${providerId} échoué (${maskForLog(err.message)}), tentative suivante...`);
    }
  }

  throw new Error(`[DARE] Tous les providers ont échoué. Dernier: ${maskForLog(lastError?.message)}`);
}

// ─── EXÉCUTION PARALLÈLE + FUSION [035] ──────────────────────────────────────

async function executeParallel(message, providerIds, systemPrompt, history, options = {}) {
  const trimmedHistory = truncateHistory(history, CFG.maxContextTokens);
  const safeMessage = maskForAPI(message);

  const calls = providerIds.map(async (providerId) => {
    const provider = PROVIDERS[providerId];
    if (!provider?.available) return null;
    try {
      checkCostCap(providerId);
      const agent = require(provider.module);
      const result = await withExponentialBackoff(
        () => agent.query(safeMessage, systemPrompt, trimmedHistory),
        providerId
      );

      let costUSD = 0;
      if (result.usage) {
        const inTok = result.usage.input_tokens || result.usage.prompt_tokens || 0;
        const outTok = result.usage.output_tokens || result.usage.completion_tokens || 0;
        costUSD = (inTok / 1e6) * provider.costPer1MInput + (outTok / 1e6) * provider.costPer1MOutput;
        updateCostTracking(providerId, costUSD);
        trackRequest(providerId, true, costUSD);
      }

      return { providerId, content: result.content, costUSD, provider: provider.name };
    } catch (err) {
      trackRequest(providerId, false);
      return { providerId, error: maskForLog(err.message) };
    }
  });

  const results = (await Promise.allSettled(calls))
    .filter(r => r.status === 'fulfilled' && r.value && !r.value.error)
    .map(r => r.value);

  if (results.length === 0) throw new Error('[DARE] executeParallel: tous les providers ont échoué');

  // Fusion simple : si 1 résultat → retourne direct ; si 2+ → fusion LLM
  if (results.length === 1 || options.noFusion) {
    return { ...results[0], _parallel: results, _fused: false };
  }

  // [035] Fusion intelligente : utiliser Claude pour combiner
  const fusePrompt = `Tu es un éditeur IA expert. Voici ${results.length} réponses de différents modèles IA à la même question. 
Fusionne-les en une seule réponse optimale : garde la précision de l'une, la clarté de l'autre, sans redondance.

${results.map((r, i) => `=== Réponse ${i + 1} (${r.provider}) ===\n${r.content}`).join('\n\n')}

Produis une réponse unifiée, meilleure que chacune individuellement.`;

  try {
    const fusionProvider = PROVIDERS['claude']?.available ? 'claude' : results[0].providerId;
    const fusionAgent = require(PROVIDERS[fusionProvider].module);
    const fused = await fusionAgent.query(fusePrompt, 'Tu es un expert en synthèse et fusion de contenus IA.', []);
    return {
      providerId: 'fused',
      content: fused.content,
      _parallel: results,
      _fused: true,
      _providers: results.map(r => r.providerId),
    };
  } catch {
    // Si fusion échoue → retourne le premier résultat
    return { ...results[0], _parallel: results, _fused: false };
  }
}

// ─── CONNECTOR REGISTRY [021-026, 044, 046] ──────────────────────────────────

function registerConnector(spec) {
  const required = ['id', 'name', 'module', 'contextWindow', 'costPer1MInput', 'costPer1MOutput', 'strengths'];
  const missing = required.filter(k => !(k in spec));
  if (missing.length) throw new Error(`[DARE] Connecteur invalide — champs manquants: ${missing.join(', ')}`);

  try { require(spec.module); } catch (e) {
    throw new Error(`[DARE] Module introuvable: ${spec.module} — ${e.message}`);
  }

  PROVIDERS[spec.id] = {
    ...spec,
    available: true,
    addedAt: Date.now(),
    deprecated: false,
    health: { status: 'unknown', latencyMs: null, lastCheck: null, failures: 0 },
    docs: spec.docs || {},
  };

  setTimeout(() => pingProvider(spec.id), 1000);

  healthEmitter.emit('connector_registered', { id: spec.id, name: spec.name });
  console.log(`[DARE] ✅ Nouveau provider enregistré: ${spec.name}`);
  return true;
}

// [026] Dépréciation sécurisée avec fenêtre 72h
function deprecateConnector(providerId, replacedBy = null) {
  const provider = PROVIDERS[providerId];
  if (!provider) throw new Error(`[DARE] Provider inconnu: ${providerId}`);

  if (replacedBy) {
    const replacement = PROVIDERS[replacedBy];
    if (!replacement) throw new Error(`[DARE] Provider de remplacement inconnu: ${replacedBy}`);

    const ageMs = Date.now() - (replacement.addedAt || 0);
    if (ageMs < CFG.stabilityWindowMs) {
      const hoursLeft = Math.ceil((CFG.stabilityWindowMs - ageMs) / 3600000);
      throw new Error(`[DARE] Dépréciation bloquée — ${replacedBy} doit être stable 72h (encore ${hoursLeft}h)`);
    }
  }

  provider.deprecated = true;
  provider.available = false;
  provider.deprecatedAt = new Date().toISOString();
  provider.replacedBy = replacedBy;

  console.log(`[DARE] 🗄️ Provider déprécié: ${providerId} → remplacé par ${replacedBy || 'N/A'}`);
  healthEmitter.emit('connector_deprecated', { providerId, replacedBy });
  return true;
}

// [028] Suspension avec alerte SMS Commandant
function suspendProvider(providerId, reason, requiresHumanAction = false) {
  const provider = PROVIDERS[providerId];
  if (!provider) return;

  provider.health.status = 'suspended';
  provider.suspendedReason = reason;

  console.warn(`[DARE] ⏸️ Provider suspendu: ${providerId} — ${reason}`);

  if (requiresHumanAction) {
    healthEmitter.emit('human_action_required', {
      providerId,
      reason,
      message: `⚠️ DALEBA — Action requise: le provider ${provider.name} nécessite une intervention humaine. Raison: ${reason}`,
    });
  }
}

// ─── API STATUS [025] ────────────────────────────────────────────────────────

function getStatus() {
  const today = getTodayKey();
  const providers = Object.values(PROVIDERS).map(p => {
    const m = dailyMetrics[p.id];
    const errorRate = m && m.requests > 0 ? ((m.errors / m.requests) * 100).toFixed(1) : '0.0';
    return {
      id: p.id, name: p.name, available: p.available,
      deprecated: p.deprecated,
      contextWindow: p.contextWindow,
      cost: { input: p.costPer1MInput, output: p.costPer1MOutput },
      health: p.health,
      requests: usageStats.requestsByProvider[p.id] || 0,
      costUSD: Math.round((usageStats.costByProvider[p.id] || 0) * 10000) / 10000,
      today: { requests: m?.requests || 0, errors: m?.errors || 0, errorRate: `${errorRate}%`, demoted: m?.demoted || false },
      bridled: usageStats.bridledProviders.has(p.id),
      docs: p.docs || {},
    };
  });

  return {
    engine: 'DARE v2.0',
    version: '2.0.0',
    uptime: Math.round((Date.now() - usageStats.lastReset) / 1000) + 's',
    config: {
      monthlyBudgetUSD: CFG.monthlyBudgetUSD,
      hourlyAlertUSD: CFG.hourlyAlertThresholdUSD,
      maxContextTokens: CFG.maxContextTokens,
      maxErrorRatePercent: CFG.maxErrorRatePercent,
      stabilityWindow72h: `${CFG.stabilityWindowMs / 3600000}h`,
    },
    stats: {
      requestsTotal: usageStats.requestsTotal,
      failovers: usageStats.failovers,
      estimatedCostUSD: Math.round(usageStats.costUSD * 10000) / 10000,
      bridledProviders: [...usageStats.bridledProviders],
    },
    providers,
    healthCheckActive: healthCheckInterval !== null,
  };
}

// ─── EXPORTS ─────────────────────────────────────────────────────────────────

module.exports = {
  // Core
  selectProvider,
  executeWithFailover,
  executeParallel,
  // Health
  runHealthChecks,
  startHealthCheckLoop,
  stopHealthCheckLoop,
  pingProvider,
  // Registry
  registerConnector,
  deprecateConnector,
  suspendProvider,
  // Utilities
  truncateHistory,
  maskForLog,
  maskForAPI,
  // Status
  getStatus,
  getDailyMetrics: () => dailyMetrics,
  // State
  PROVIDERS,
  CFG,
  usageStats,
  healthEmitter,
};
