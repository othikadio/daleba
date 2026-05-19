/**
 * DARE — Dynamic Agnostic Routing Engine
 * DALEBA Metacortex — Volume 1, Points 001-010
 *
 * Routage intelligent multi-LLM avec healthcheck, failover < 500ms,
 * scoring coût/latence/précision par type de tâche.
 */

const EventEmitter = require('events');

// ─── REGISTRE DES PROVIDERS ──────────────────────────────────────────────────

const PROVIDERS = {
  claude: {
    id: 'claude',
    name: 'Claude (Anthropic)',
    module: './claude',
    available: !!process.env.ANTHROPIC_API_KEY,
    contextWindow: 200000,
    costPer1MInput: 3.00,   // USD
    costPer1MOutput: 15.00,
    strengths: {
      code: 10, strategy: 10, analysis: 10, reasoning: 10,
      creative: 8, conversation: 9, math: 8, bulk: 5,
    },
    health: { status: 'unknown', latencyMs: null, lastCheck: null, failures: 0 },
  },
  gpt4o: {
    id: 'gpt4o',
    name: 'GPT-4o (OpenAI)',
    module: './gpt4o',
    available: !!process.env.OPENAI_API_KEY,
    contextWindow: 128000,
    costPer1MInput: 2.50,
    costPer1MOutput: 10.00,
    strengths: {
      creative: 10, writing: 10, conversation: 10, vision: 10,
      code: 8, strategy: 7, analysis: 8, math: 7, bulk: 6,
    },
    health: { status: 'unknown', latencyMs: null, lastCheck: null, failures: 0 },
  },
  deepseek: {
    id: 'deepseek',
    name: 'DeepSeek-V3',
    module: './deepseek',
    available: !!process.env.DEEPSEEK_API_KEY,
    contextWindow: 64000,
    costPer1MInput: 0.14,
    costPer1MOutput: 0.28,
    strengths: {
      math: 10, data: 10, bulk: 10, optimization: 10,
      code: 9, analysis: 8, strategy: 6, creative: 4, conversation: 5,
    },
    health: { status: 'unknown', latencyMs: null, lastCheck: null, failures: 0 },
  },
  gemini: {
    id: 'gemini',
    name: 'Gemini 1.5 Pro (Google)',
    module: './connectors/gemini',
    available: !!process.env.GEMINI_API_KEY,
    contextWindow: 1000000,
    costPer1MInput: 1.25,
    costPer1MOutput: 5.00,
    strengths: {
      analysis: 10, documents: 10, multimodal: 10, bulk: 9,
      code: 7, strategy: 8, creative: 7, math: 8, conversation: 7,
    },
    health: { status: 'unknown', latencyMs: null, lastCheck: null, failures: 0 },
  },
};

// ─── CLASSIFICATION DES TÂCHES ───────────────────────────────────────────────

const TASK_PROFILES = [
  {
    type: 'financial',
    keywords: ['bilan', 'chiffre d\'affaires', 'ca ', 'revenue', 'revenu', 'calcul',
      'math', 'statistique', 'données', 'tableau', 'excel', 'csv', 'optimis',
      'coût', 'budget', 'profit', 'perte', 'comptabilité'],
    priorities: ['deepseek', 'claude', 'gpt4o', 'gemini'],
    skill: 'math',
  },
  {
    type: 'code',
    keywords: ['code', 'programme', 'fonction', 'bug', 'erreur', 'script', 'api',
      'endpoint', 'javascript', 'node', 'python', 'sql', 'database', 'debug'],
    priorities: ['claude', 'gpt4o', 'deepseek', 'gemini'],
    skill: 'code',
  },
  {
    type: 'strategy',
    keywords: ['stratégie', 'architecture', 'vision', 'plan', 'objectif', 'analyse',
      'pourquoi', 'explique', 'décision', 'expansion', 'marché'],
    priorities: ['claude', 'gemini', 'gpt4o', 'deepseek'],
    skill: 'strategy',
  },
  {
    type: 'creative',
    keywords: ['écris', 'rédige', 'histoire', 'slogan', 'caption', 'description',
      'post', 'instagram', 'marketing', 'publicité', 'accroche', 'campagne'],
    priorities: ['gpt4o', 'claude', 'gemini', 'deepseek'],
    skill: 'creative',
  },
  {
    type: 'document',
    keywords: ['résumé', 'synthèse', 'document', 'pdf', 'rapport', 'analyse doc',
      'extrait', 'transcription', 'long texte'],
    priorities: ['gemini', 'claude', 'gpt4o', 'deepseek'],
    skill: 'documents',
  },
  {
    type: 'conversation',
    keywords: ['bonjour', 'salut', 'comment', 'qui', 'quoi', 'aide', 'répondre',
      'rdv', 'rendez-vous', 'réservation', 'client'],
    priorities: ['claude', 'gpt4o', 'gemini', 'deepseek'],
    skill: 'conversation',
  },
];

// ─── STATS D'USAGE (runtime, non persistées) ─────────────────────────────────

const usageStats = {
  requestsTotal: 0,
  requestsByProvider: {},
  failovers: 0,
  costUSD: 0,
  lastReset: Date.now(),
};

// ─── HEALTH CHECK ENGINE ─────────────────────────────────────────────────────

const healthEmitter = new EventEmitter();
let healthCheckInterval = null;

async function pingProvider(providerId) {
  const provider = PROVIDERS[providerId];
  if (!provider || !provider.available) {
    provider.health.status = 'unavailable';
    return;
  }

  const start = Date.now();
  try {
    let agent;
    try { agent = require(provider.module); } catch { return; }

    // Ping léger — 1 token max
    await Promise.race([
      agent.query('ping', 'Reply with: pong', []),
      new Promise((_, reject) =>
        setTimeout(() => reject(new Error('timeout')), 5000)
      ),
    ]);

    const latency = Date.now() - start;
    provider.health.status = 'healthy';
    provider.health.latencyMs = latency;
    provider.health.failures = 0;
    provider.health.lastCheck = new Date().toISOString();

    if (latency > 3000) {
      provider.health.status = 'degraded';
    }

  } catch (err) {
    provider.health.failures++;
    provider.health.status = provider.health.failures >= 3 ? 'down' : 'degraded';
    provider.health.lastCheck = new Date().toISOString();

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
  // Premier check après 10s (laisse le temps au boot)
  setTimeout(runHealthChecks, 10000);
  healthCheckInterval = setInterval(runHealthChecks, intervalMs);
  console.log('[DARE] Health check loop démarré (interval:', intervalMs / 1000, 's)');
}

function stopHealthCheckLoop() {
  if (healthCheckInterval) {
    clearInterval(healthCheckInterval);
    healthCheckInterval = null;
  }
}

// ─── SÉLECTEUR DE PROVIDER (CŒUR DU DARE) ────────────────────────────────────

function classifyTask(message) {
  const text = message.toLowerCase();
  let bestProfile = null;
  let bestScore = 0;

  for (const profile of TASK_PROFILES) {
    const matches = profile.keywords.filter(kw => text.includes(kw)).length;
    if (matches > bestScore) {
      bestScore = matches;
      bestProfile = profile;
    }
  }

  return bestProfile || TASK_PROFILES[TASK_PROFILES.length - 1]; // fallback: conversation
}

function getAvailableHealthyProviders(priorityList) {
  return priorityList.filter(id => {
    const p = PROVIDERS[id];
    return p && p.available && p.health.status !== 'down';
  });
}

function selectProvider(message, options = {}) {
  // Forçage explicite
  if (options.forceProvider && PROVIDERS[options.forceProvider]?.available) {
    return { provider: options.forceProvider, task: 'forced', reason: '🎯 Provider forcé explicitement' };
  }

  const task = classifyTask(message);
  const healthy = getAvailableHealthyProviders(task.priorities);

  if (healthy.length === 0) {
    // Fallback universel : prend n'importe quel provider disponible
    const anyAvailable = Object.keys(PROVIDERS).find(id => PROVIDERS[id].available);
    if (!anyAvailable) throw new Error('DARE: Aucun provider LLM disponible');
    return {
      provider: anyAvailable,
      task: task.type,
      reason: '⚠️ Fallback universel — tous les providers préférés sont down',
    };
  }

  const selected = healthy[0];
  const provider = PROVIDERS[selected];

  const icons = {
    financial: '📊', code: '💻', strategy: '🧠',
    creative: '✍️', document: '📄', conversation: '💬',
  };

  return {
    provider: selected,
    task: task.type,
    reason: `${icons[task.type] || '🤖'} ${provider.name} — tâche: ${task.type}`,
  };
}

// ─── EXÉCUTION AVEC FAILOVER ─────────────────────────────────────────────────

async function executeWithFailover(message, systemPrompt, history, options = {}) {
  const { provider: primaryId, task, reason } = selectProvider(message, options);

  const task_profile = TASK_PROFILES.find(t => t.type === task) || TASK_PROFILES[TASK_PROFILES.length - 1];
  const candidateQueue = getAvailableHealthyProviders(task_profile.priorities);

  // Garantit que le primary est en tête
  const queue = [primaryId, ...candidateQueue.filter(id => id !== primaryId)];

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
      let agent;
      try {
        agent = require(provider.module);
      } catch (modErr) {
        console.warn(`[DARE] Module ${provider.module} non chargeable:`, modErr.message);
        continue;
      }

      const result = await Promise.race([
        agent.query(message, systemPrompt, history),
        new Promise((_, reject) =>
          setTimeout(() => reject(new Error('timeout_500ms_dare')), options.timeoutMs || 30000)
        ),
      ]);

      // Mise à jour stats
      usageStats.requestsTotal++;
      usageStats.requestsByProvider[providerId] = (usageStats.requestsByProvider[providerId] || 0) + 1;

      // Estimation coût (approximatif si usage disponible)
      if (result.usage) {
        const inputTokens = result.usage.input_tokens || result.usage.prompt_tokens || 0;
        const outputTokens = result.usage.output_tokens || result.usage.completion_tokens || 0;
        usageStats.costUSD += (
          (inputTokens / 1e6) * provider.costPer1MInput +
          (outputTokens / 1e6) * provider.costPer1MOutput
        );
      }

      return {
        ...result,
        _dare: {
          provider: providerId,
          task,
          reason: isFailover ? `⚡ Failover → ${provider.name}` : reason,
          latencyMs: Date.now() - startTotal,
          failover: isFailover,
        },
      };

    } catch (err) {
      lastError = err;
      // Marque dégradé pour déclencher failover rapide
      if (PROVIDERS[providerId]) {
        PROVIDERS[providerId].health.status = 'degraded';
        PROVIDERS[providerId].health.failures++;
      }
      // Continue immédiatement vers le suivant (< 500ms intent)
      console.warn(`[DARE] ${providerId} échoué (${err.message}), tentative suivante...`);
    }
  }

  throw new Error(`[DARE] Tous les providers ont échoué. Dernier: ${lastError?.message}`);
}

// ─── CONNECTOR AUTO-REGISTRATION (Points 021-024) ────────────────────────────
// Structure standardisée pour les nouveaux connecteurs

function registerConnector(spec) {
  const required = ['id', 'name', 'module', 'contextWindow', 'costPer1MInput', 'costPer1MOutput', 'strengths'];
  const missing = required.filter(k => !(k in spec));
  if (missing.length > 0) {
    throw new Error(`[DARE] Connecteur invalide — champs manquants: ${missing.join(', ')}`);
  }

  // Test que le module existe
  try {
    require(spec.module);
  } catch (e) {
    throw new Error(`[DARE] Module introuvable: ${spec.module} — ${e.message}`);
  }

  PROVIDERS[spec.id] = {
    ...spec,
    available: true,
    health: { status: 'unknown', latencyMs: null, lastCheck: null, failures: 0 },
  };

  // Ping immédiat
  setTimeout(() => pingProvider(spec.id), 1000);

  console.log(`[DARE] Nouveau provider enregistré: ${spec.name}`);
  return true;
}

// ─── API STATUS (pour HUD) ───────────────────────────────────────────────────

function getStatus() {
  const providers = Object.values(PROVIDERS).map(p => ({
    id: p.id,
    name: p.name,
    available: p.available,
    contextWindow: p.contextWindow,
    cost: { input: p.costPer1MInput, output: p.costPer1MOutput },
    health: p.health,
    requests: usageStats.requestsByProvider[p.id] || 0,
  }));

  return {
    engine: 'DARE v1.0',
    uptime: Math.round((Date.now() - usageStats.lastReset) / 1000) + 's',
    stats: {
      requestsTotal: usageStats.requestsTotal,
      failovers: usageStats.failovers,
      estimatedCostUSD: Math.round(usageStats.costUSD * 10000) / 10000,
    },
    providers,
    healthCheckActive: healthCheckInterval !== null,
  };
}

// ─── EXPORTS ─────────────────────────────────────────────────────────────────

module.exports = {
  selectProvider,
  executeWithFailover,
  runHealthChecks,
  startHealthCheckLoop,
  stopHealthCheckLoop,
  registerConnector,
  getStatus,
  PROVIDERS,
  healthEmitter,
};
