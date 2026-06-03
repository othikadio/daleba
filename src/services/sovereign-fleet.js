// src/services/sovereign-fleet.js
// Flotte Souveraine DALEBA — Routeur Multi-Agents v2.0
// 13 modèles frontières + délégation autonome par spécialité
// Mise à jour 3 juin 2026 — Claude Sonnet/Haiku + GPT-4o + Gemini Flash
'use strict';

const axios = require('axios');

// ── RÉSOLUTION DES CLÉS (env vars uniquement — sécurisé) ─────────────────────
function getKey(envKey) {
  return process.env[envKey] || null;
}

// ── FLOTTE DE MODÈLES ─────────────────────────────────────────────────────────
const FLEET = {

  // ── CLAUDE (Anthropic Messages via ClawRapid) ─────────────────────────────
  'claude-sonnet': {
    id: 'claude-sonnet',
    label: 'Claude Sonnet 4.6',
    description: 'Analyse profonde, créativité & raisonnement complexe',
    specialty: ['reasoning', 'creative', 'writing', 'code', 'analysis', 'vision'],
    provider: 'anthropic',
    model: 'claude-sonnet-4-6',
    envKey: 'CLAWRAPID_API_KEY',
    baseUrl: 'https://www.clawrapid.com/api/llm/proxy/v1',
    icon: '🟣',
    tier: 'flagship',
    available: () => !!(getKey('CLAWRAPID_API_KEY')),
  },
  'claude-haiku': {
    id: 'claude-haiku',
    label: 'Claude Haiku 4.5',
    description: 'Ultra-rapide — résumés, extraction, tâches simples',
    specialty: ['instant', 'fast', 'structured', 'extraction'],
    provider: 'anthropic',
    model: 'claude-haiku-4-5-20251001',
    envKey: 'CLAWRAPID_API_KEY',
    baseUrl: 'https://www.clawrapid.com/api/llm/proxy/v1',
    icon: '⚗️',
    tier: 'flagship',
    available: () => !!(getKey('CLAWRAPID_API_KEY')),
  },

  // ── GPT-4o (OpenAI) ──────────────────────────────────────────────────────
  'gpt-4o': {
    id: 'gpt-4o',
    label: 'GPT-4o',
    description: 'Vision, multimodal & compréhension globale',
    specialty: ['vision', 'multimodal', 'code', 'reasoning', 'analysis'],
    provider: 'openai',
    model: 'gpt-4o',
    envKey: 'OPENAI_API_KEY',
    baseUrl: 'https://api.openai.com/v1',
    icon: '🤖',
    tier: 'flagship',
    available: () => !!(getKey('OPENAI_API_KEY')),
  },
  'gpt-4o-mini': {
    id: 'gpt-4o-mini',
    label: 'GPT-4o Mini',
    description: 'Rapide & économique pour les tâches courantes',
    specialty: ['instant', 'api', 'json', 'fast'],
    provider: 'openai',
    model: 'gpt-4o-mini',
    envKey: 'OPENAI_API_KEY',
    baseUrl: 'https://api.openai.com/v1',
    icon: '⚡',
    tier: 'efficient',
    available: () => !!(getKey('OPENAI_API_KEY')),
  },

  // ── GEMINI (Google — endpoint OpenAI-compatible) ──────────────────────────
  'gemini-flash': {
    id: 'gemini-flash',
    label: 'Gemini 2.0 Flash',
    description: 'Multimodal ultra-rapide & recherche web en temps réel',
    specialty: ['multimodal', 'vision', 'instant', 'analysis'],
    provider: 'google',
    model: 'gemini-2.0-flash',
    envKey: 'GOOGLE_AI_API_KEY',
    baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai',
    icon: '💎',
    tier: 'flagship',
    available: () => !!(getKey('GOOGLE_AI_API_KEY')),
  },

  // ── DEEPSEEK ─────────────────────────────────────────────────────────────
  'deepseek-r1': {
    id: 'deepseek-r1',
    label: 'DeepSeek R1',
    description: 'Raisonnement profond & restructuration de code',
    specialty: ['reasoning', 'code', 'refactor'],
    provider: 'deepseek',
    model: 'deepseek-reasoner',
    envKey: 'DEEPSEEK_API_KEY',
    baseUrl: 'https://api.deepseek.com/v1',
    icon: '🧠',
    tier: 'frontier',
    available: () => !!(getKey('DEEPSEEK_API_KEY')),
  },
  'deepseek-v3': {
    id: 'deepseek-v3',
    label: 'DeepSeek V3',
    description: 'Analyse contextes massifs & bases de données',
    specialty: ['context', 'analysis', 'database', 'long'],
    provider: 'deepseek',
    model: 'deepseek-chat',
    envKey: 'DEEPSEEK_API_KEY',
    baseUrl: 'https://api.deepseek.com/v1',
    icon: '🔭',
    tier: 'frontier',
    available: () => !!(getKey('DEEPSEEK_API_KEY')),
  },

  // ── MISTRAL ───────────────────────────────────────────────────────────────
  'mistral-large': {
    id: 'mistral-large',
    label: 'Mistral Large 3',
    description: 'Réponses instantanées & multilinguisme',
    specialty: ['instant', 'multilingual', 'structured'],
    provider: 'mistral',
    model: 'mistral-large-latest',
    envKey: 'MISTRAL_API_KEY',
    baseUrl: 'https://api.mistral.ai/v1',
    icon: '⚡',
    tier: 'frontier',
    available: () => !!(getKey('MISTRAL_API_KEY')),
  },

  // ── OPENROUTER ────────────────────────────────────────────────────────────
  'llama-3.3': {
    id: 'llama-3.3',
    label: 'Llama 3.3 70B',
    description: 'Requêtes API rapides (Square/Meta/JSON)',
    specialty: ['api', 'json', 'fast'],
    provider: 'openrouter',
    model: 'meta-llama/llama-3.3-70b-instruct:free',
    envKey: 'OPENROUTER_API_KEY',
    baseUrl: 'https://openrouter.ai/api/v1',
    icon: '🦙',
    tier: 'frontier',
    available: () => !!(getKey('OPENROUTER_API_KEY')),
  },
  'qwen-max': {
    id: 'qwen-max',
    label: 'Qwen3-235B Coder',
    description: 'Code, intégrations API & automatisation',
    specialty: ['instant', 'api', 'json', 'code'],
    provider: 'openrouter',
    model: 'qwen/qwen3-coder:free',
    envKey: 'OPENROUTER_API_KEY',
    baseUrl: 'https://openrouter.ai/api/v1',
    icon: '⚡',
    tier: 'frontier',
    available: () => !!(getKey('OPENROUTER_API_KEY')),
  },
  'qwen-turbo': {
    id: 'qwen-turbo',
    label: 'Qwen3-32B',
    description: 'Analyse de contextes larges & résumés',
    specialty: ['context', 'summary', 'analysis'],
    provider: 'openrouter',
    model: 'qwen/qwen3-next-80b-a3b-instruct:free',
    envKey: 'OPENROUTER_API_KEY',
    baseUrl: 'https://openrouter.ai/api/v1',
    icon: '🔬',
    tier: 'frontier',
    available: () => !!(getKey('OPENROUTER_API_KEY')),
  },

  // ── GLM (Z.ai) ───────────────────────────────────────────────────────────
  'glm-5': {
    id: 'glm-5',
    label: 'GLM-5.1',
    description: 'Raisonnement long & analyse structurelle',
    specialty: ['reasoning', 'structured', 'long'],
    provider: 'zai',
    model: 'glm-5.1',
    envKey: 'ZAI_API_KEY',
    baseUrl: 'https://api.z.ai/api/openai/v1',
    icon: '🌐',
    tier: 'frontier',
    available: () => !!(getKey('ZAI_API_KEY')),
  },

  // ── KIMI (Moonshot) ──────────────────────────────────────────────────────
  'kimi-k2': {
    id: 'kimi-k2',
    label: 'Kimi K2.6',
    description: 'Orchestration d\'essaims & tâches multi-étapes',
    specialty: ['swarm', 'orchestration', 'multistep'],
    provider: 'moonshot',
    model: 'moonshot-v1-8k',
    envKey: 'MOONSHOT_API_KEY',
    baseUrl: 'https://api.moonshot.cn/v1',
    icon: '🌙',
    tier: 'frontier',
    available: () => !!(getKey('MOONSHOT_API_KEY')),
  },
};

// ── MATRICE DE ROUTAGE AMÉLIORÉE ──────────────────────────────────────────────
const ROUTING_MATRIX = {
  reasoning:     ['claude-sonnet', 'deepseek-r1', 'glm-5'],
  code:          ['claude-sonnet', 'deepseek-r1', 'qwen-max'],
  refactor:      ['claude-sonnet', 'deepseek-r1', 'glm-5'],
  creative:      ['claude-sonnet', 'gpt-4o', 'mistral-large'],
  writing:       ['claude-sonnet', 'gpt-4o', 'mistral-large'],
  analysis:      ['claude-sonnet', 'deepseek-v3', 'gpt-4o'],
  vision:        ['gpt-4o', 'gemini-flash', 'claude-sonnet'],
  multimodal:    ['gpt-4o', 'gemini-flash'],
  context:       ['deepseek-v3', 'qwen-turbo', 'claude-sonnet'],
  database:      ['deepseek-v3', 'qwen-turbo'],
  long:          ['deepseek-v3', 'qwen-turbo'],
  summary:       ['claude-haiku', 'qwen-turbo', 'mistral-large'],
  extraction:    ['claude-haiku', 'qwen-max'],
  swarm:         ['kimi-k2', 'claude-sonnet'],
  orchestration: ['kimi-k2', 'claude-sonnet'],
  multistep:     ['kimi-k2', 'claude-sonnet'],
  instant:       ['claude-haiku', 'gpt-4o-mini', 'qwen-max', 'mistral-large'],
  fast:          ['claude-haiku', 'gpt-4o-mini', 'llama-3.3'],
  api:           ['qwen-max', 'llama-3.3', 'gpt-4o-mini'],
  json:          ['qwen-max', 'llama-3.3', 'gpt-4o-mini'],
  square:        ['qwen-max', 'llama-3.3', 'mistral-large'],
  meta:          ['qwen-max', 'llama-3.3', 'mistral-large'],
  multilingual:  ['mistral-large', 'claude-sonnet', 'gpt-4o'],
  structured:    ['glm-5', 'claude-haiku', 'mistral-large'],
  default:       ['claude-sonnet', 'gpt-4o', 'deepseek-r1', 'mistral-large'],
};

// Fallbacks globaux
const GLOBAL_FALLBACKS = ['claude-sonnet', 'deepseek-r1', 'deepseek-v3', 'mistral-large', 'gpt-4o'];

// ── STATS ─────────────────────────────────────────────────────────────────────
const stats = {};
Object.keys(FLEET).forEach(k => {
  stats[k] = { calls: 0, errors: 0, totalMs: 0, lastError: null, lastUsed: null };
});

// ── DÉTECTION DE TÂCHE ────────────────────────────────────────────────────────
function detectTask(message = '') {
  const m = message.toLowerCase();
  if (m.match(/image|photo|screenshot|voir|visuel|capture/))             return 'vision';
  if (m.match(/orchest|essaim|multi.étape|planifi|swarm|pipeline/))      return 'swarm';
  if (m.match(/raisonne|pourquoi|explique|logique|dédui|réfléchis/))     return 'reasoning';
  if (m.match(/écris|rédige|article|blog|slogan|créatif|poème|histoire/)) return 'writing';
  if (m.match(/code|bug|refactor|restructure|script|fonction|classe/))   return 'code';
  if (m.match(/résume|summary|synthèse|raccourcis/))                      return 'summary';
  if (m.match(/base de données|bd|database|résume tout|millions? de|entrées|records/)) return 'database';
  if (m.match(/analyse|contexte|document|long|complet|exhaustif/))       return 'analysis';
  if (m.match(/extrais|extrait|extraction|liste les|trouve les/))         return 'extraction';
  if (m.match(/square|appointment|booking|rendez-vous api/))              return 'square';
  if (m.match(/meta|instagram|facebook|whatsapp|webhook/))                return 'meta';
  if (m.match(/json|api|requête|response|payload|endpoint/))              return 'json';
  if (m.match(/vite|rapide|quick|maintenant|urgent/))                     return 'instant';
  if (m.match(/traduis|traduction|anglais|espagnol|multilingue/))         return 'multilingual';
  return 'default';
}

// ── HANDLER ANTHROPIC MESSAGES (Claude via ClawRapid) ─────────────────────────
async function callAnthropicMessages(modelConfig, messages, systemPrompt) {
  const apiKey = getKey(modelConfig.envKey);
  if (!apiKey) throw new Error(`Clé ${modelConfig.envKey} manquante`);

  // Format Anthropic: système séparé des messages
  const anthropicMessages = messages.filter(m => m.role !== 'system');
  const system = systemPrompt ||
    messages.find(m => m.role === 'system')?.content ||
    'Tu es DALEBA, assistant IA souverain de Kadio Coiffure. Réponds en français de façon précise et utile.';

  const res = await axios.post(
    `${modelConfig.baseUrl}/messages`,
    {
      model:      modelConfig.model,
      messages:   anthropicMessages,
      max_tokens: 2048,
      system,
    },
    {
      headers: {
        'x-api-key':         apiKey,
        'anthropic-version': '2023-06-01',
        'Content-Type':      'application/json',
      },
      timeout: 45000,
    }
  );

  const content = res.data?.content;
  if (Array.isArray(content)) {
    return content.filter(b => b.type === 'text').map(b => b.text).join('');
  }
  throw new Error('Réponse Anthropic invalide: ' + JSON.stringify(res.data));
}

// ── HANDLER OPENAI-COMPATIBLE ─────────────────────────────────────────────────
async function callOpenAICompat(modelConfig, messages, systemPrompt) {
  const apiKey = getKey(modelConfig.envKey);
  if (!apiKey) throw new Error(`Clé ${modelConfig.envKey} manquante`);

  const headers = {
    'Authorization': `Bearer ${apiKey}`,
    'Content-Type':  'application/json',
  };
  if (modelConfig.provider === 'openrouter') {
    headers['HTTP-Referer'] = 'https://daleba.vercel.app';
    headers['X-Title']      = 'DALEBA Hub Souverain';
  }

  const res = await axios.post(
    `${modelConfig.baseUrl}/chat/completions`,
    {
      model: modelConfig.model,
      messages: [
        { role: 'system', content: systemPrompt || 'Tu es DALEBA, assistant IA souverain de Kadio Coiffure. Réponds en français de façon précise et utile.' },
        ...messages.filter(m => m.role !== 'system'),
      ],
      max_tokens:  2048,
      temperature: 0.7,
    },
    { headers, timeout: 45000 }
  );
  return res.data.choices[0].message.content;
}

// ── DISPATCHER PAR PROVIDER ───────────────────────────────────────────────────
async function callModel(modelConfig, messages, systemPrompt) {
  if (modelConfig.provider === 'anthropic') {
    return callAnthropicMessages(modelConfig, messages, systemPrompt);
  }
  return callOpenAICompat(modelConfig, messages, systemPrompt);
}

// ── ROUTEUR PRINCIPAL ─────────────────────────────────────────────────────────
async function route(messages, options = {}) {
  const { systemPrompt, forceModel, taskHint } = options;
  const lastMsg = messages[messages.length - 1]?.content || '';
  const task    = taskHint || detectTask(lastMsg);

  let candidates = [];
  if (forceModel && FLEET[forceModel]) {
    candidates = [forceModel, ...(ROUTING_MATRIX[task] || ROUTING_MATRIX.default).filter(m => m !== forceModel)];
  } else {
    candidates = [...(ROUTING_MATRIX[task] || ROUTING_MATRIX.default)];
  }

  for (const fb of GLOBAL_FALLBACKS) {
    if (!candidates.includes(fb)) candidates.push(fb);
  }

  const available = candidates.filter(id => FLEET[id] && FLEET[id].available());

  if (available.length === 0) {
    return {
      text: '⚠️ Aucun modèle souverain disponible. Vérifiez les clés API dans Railway.',
      model: null, task, fallback: true, tried: candidates,
    };
  }

  for (const modelId of available) {
    const cfg   = FLEET[modelId];
    const start = Date.now();
    try {
      const text = await callModel(cfg, messages, systemPrompt);
      const ms   = Date.now() - start;
      stats[modelId].calls++;
      stats[modelId].totalMs += ms;
      stats[modelId].lastUsed = new Date().toISOString();
      return { text, model: modelId, modelLabel: cfg.label, modelIcon: cfg.icon, task, latencyMs: ms, fallback: false };
    } catch (err) {
      stats[modelId].errors++;
      stats[modelId].lastError = err.message;
      console.warn(`[SovereignFleet] ${modelId} failed: ${err.message}`);
    }
  }

  return {
    text: '⚠️ Tous les modèles sont temporairement indisponibles. Réessayez dans quelques instants.',
    model: null, task, fallback: true,
  };
}

// ── STATUT DE LA FLOTTE ───────────────────────────────────────────────────────
function getFleetStatus() {
  return Object.values(FLEET).map(cfg => ({
    id:          cfg.id,
    label:       cfg.label,
    description: cfg.description,
    icon:        cfg.icon,
    specialty:   cfg.specialty,
    provider:    cfg.provider,
    connected:   cfg.available(),
    envKey:      cfg.envKey,
    tier:        cfg.tier,
    stats:       stats[cfg.id],
  }));
}

function getAvailableModels() {
  return Object.values(FLEET).filter(cfg => cfg.available()).map(cfg => cfg.id);
}

module.exports = { route, getFleetStatus, getAvailableModels, detectTask, FLEET, ROUTING_MATRIX, stats };
