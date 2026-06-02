// src/services/sovereign-fleet.js
// Flotte Souveraine DALEBA — Routeur Multi-Agents v1.0
// 8 modèles frontières + délégation autonome par spécialité
'use strict';

const axios = require('axios');

// ── FLOTTE DE MODÈLES ─────────────────────────────────────────────────────────
const FLEET = {
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
    available: () => !!process.env.DEEPSEEK_API_KEY,
  },
  'deepseek-v3': {
    id: 'deepseek-v3',
    label: 'DeepSeek V3 (V4 Pro)',
    description: 'Analyse contextes massifs & bases de données',
    specialty: ['context', 'analysis', 'database', 'long'],
    provider: 'deepseek',
    model: 'deepseek-chat',
    envKey: 'DEEPSEEK_API_KEY',
    baseUrl: 'https://api.deepseek.com/v1',
    icon: '🔭',
    tier: 'frontier',
    available: () => !!process.env.DEEPSEEK_API_KEY,
  },
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
    available: () => !!process.env.MISTRAL_API_KEY,
  },
  'llama-3.3': {
    id: 'llama-3.3',
    label: 'Llama 3.3 70B',
    description: 'Requêtes API rapides (Square/Meta/JSON)',
    specialty: ['api', 'json', 'fast'],
    provider: 'groq',
    model: 'llama-3.3-70b-versatile',
    envKey: 'GROQ_API_KEY',
    baseUrl: 'https://api.groq.com/openai/v1',
    icon: '🦙',
    tier: 'frontier',
    available: () => !!process.env.GROQ_API_KEY,
  },
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
    available: () => !!process.env.ZAI_API_KEY,
  },
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
    available: () => !!process.env.MOONSHOT_API_KEY,
  },
  'qwen-max': {
    id: 'qwen-max',
    label: 'Qwen3.7-Max',
    description: 'Réponses rapides & intégrations API',
    specialty: ['instant', 'api', 'json'],
    provider: 'dashscope',
    model: 'qwen-max',
    envKey: 'DASHSCOPE_API_KEY',
    baseUrl: 'https://dashscope-intl.aliyuncs.com/compatible-mode/v1',
    icon: '⚡',
    tier: 'frontier',
    available: () => !!process.env.DASHSCOPE_API_KEY,
  },
  'qwen-turbo': {
    id: 'qwen-turbo',
    label: 'Qwen3.7-Turbo',
    description: 'Analyse de contextes larges & résumés',
    specialty: ['context', 'summary', 'analysis'],
    provider: 'dashscope',
    model: 'qwen-turbo',
    envKey: 'DASHSCOPE_API_KEY',
    baseUrl: 'https://dashscope-intl.aliyuncs.com/compatible-mode/v1',
    icon: '🔬',
    tier: 'frontier',
    available: () => !!process.env.DASHSCOPE_API_KEY,
  },
};

// ── MATRICE DE ROUTAGE ────────────────────────────────────────────────────────
const ROUTING_MATRIX = {
  reasoning: ['glm-5', 'deepseek-r1'],
  code:       ['deepseek-r1', 'glm-5'],
  refactor:   ['deepseek-r1', 'glm-5'],
  context:    ['deepseek-v3', 'qwen-turbo'],
  database:   ['deepseek-v3', 'qwen-turbo'],
  analysis:   ['deepseek-v3', 'qwen-turbo'],
  long:       ['deepseek-v3', 'qwen-turbo'],
  swarm:      ['kimi-k2'],
  orchestration: ['kimi-k2'],
  multistep:  ['kimi-k2'],
  instant:    ['qwen-max', 'llama-3.3', 'mistral-large'],
  api:        ['qwen-max', 'llama-3.3', 'mistral-large'],
  json:       ['qwen-max', 'llama-3.3', 'mistral-large'],
  square:     ['qwen-max', 'llama-3.3', 'mistral-large'],
  meta:       ['qwen-max', 'llama-3.3', 'mistral-large'],
  default:    ['deepseek-r1', 'mistral-large', 'deepseek-v3'],
};

// Fallbacks globaux (modèles toujours accessibles)
const GLOBAL_FALLBACKS = ['deepseek-r1', 'deepseek-v3', 'mistral-large'];

// ── STATS ─────────────────────────────────────────────────────────────────────
const stats = {};
Object.keys(FLEET).forEach(k => {
  stats[k] = { calls: 0, errors: 0, totalMs: 0, lastError: null, lastUsed: null };
});

// ── DÉTECTION DE TÂCHE ────────────────────────────────────────────────────────
function detectTask(message = '') {
  const m = message.toLowerCase();
  if (m.match(/orchest|essaim|multi.étape|planifi|swarm|pipeline/)) return 'swarm';
  if (m.match(/raisonne|pourquoi|explique|logique|dédui/)) return 'reasoning';
  if (m.match(/code|bug|refactor|restructure|script|fonction|classe/)) return 'code';
  if (m.match(/base de données|bd|database|résume tout|millions? de|entrées|records/)) return 'database';
  if (m.match(/analyse|contexte|document|long|complet|exhaustif/)) return 'analysis';
  if (m.match(/square|appointment|booking|rendez-vous api/)) return 'square';
  if (m.match(/meta|instagram|facebook|whatsapp|webhook/)) return 'meta';
  if (m.match(/json|api|requête|response|payload|endpoint/)) return 'json';
  if (m.match(/vite|rapide|quick|maintenant|urgent/)) return 'instant';
  return 'default';
}

// ── APPEL GÉNÉRIQUE OPENAI-COMPATIBLE ─────────────────────────────────────────
async function callOpenAICompat(modelConfig, messages, systemPrompt) {
  const apiKey = process.env[modelConfig.envKey];
  if (!apiKey) throw new Error(`Clé ${modelConfig.envKey} manquante`);

  const res = await axios.post(
    `${modelConfig.baseUrl}/chat/completions`,
    {
      model: modelConfig.model,
      messages: [
        { role: 'system', content: systemPrompt || 'Tu es DALEBA, assistant IA de Kadio Coiffure.' },
        ...messages,
      ],
      max_tokens: 2048,
      temperature: 0.7,
    },
    {
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      timeout: 30000,
    }
  );
  return res.data.choices[0].message.content;
}

// ── ROUTEUR PRINCIPAL ─────────────────────────────────────────────────────────
async function route(messages, options = {}) {
  const { systemPrompt, forceModel, taskHint } = options;
  const lastMsg = messages[messages.length - 1]?.content || '';
  const task = taskHint || detectTask(lastMsg);

  // Construire la liste des candidats
  let candidates = [];
  if (forceModel && FLEET[forceModel]) {
    candidates = [forceModel, ...(ROUTING_MATRIX[task] || ROUTING_MATRIX.default).filter(m => m !== forceModel)];
  } else {
    candidates = [...(ROUTING_MATRIX[task] || ROUTING_MATRIX.default)];
  }

  // Ajouter les fallbacks globaux si pas déjà présents
  for (const fb of GLOBAL_FALLBACKS) {
    if (!candidates.includes(fb)) candidates.push(fb);
  }

  // Filtrer aux modèles disponibles
  const available = candidates.filter(id => FLEET[id] && FLEET[id].available());

  if (available.length === 0) {
    return {
      text: 'Aucun modèle souverain disponible. Ajoutez les clés API dans Railway.',
      model: null,
      task,
      fallback: true,
      tried: candidates,
    };
  }

  // Essayer les modèles dans l'ordre
  for (const modelId of available) {
    const cfg = FLEET[modelId];
    const start = Date.now();
    try {
      const text = await callOpenAICompat(cfg, messages, systemPrompt);
      const ms = Date.now() - start;
      stats[modelId].calls++;
      stats[modelId].totalMs += ms;
      stats[modelId].lastUsed = new Date().toISOString();
      return {
        text,
        model: modelId,
        modelLabel: cfg.label,
        modelIcon: cfg.icon,
        task,
        latencyMs: ms,
        fallback: false,
      };
    } catch (err) {
      stats[modelId].errors++;
      stats[modelId].lastError = err.message;
      console.warn(`[SovereignFleet] ${modelId} failed: ${err.message}`);
    }
  }

  return {
    text: 'Tous les modèles sont temporairement indisponibles. Réessayez dans quelques instants.',
    model: null,
    task,
    fallback: true,
  };
}

// ── STATUT DE LA FLOTTE ───────────────────────────────────────────────────────
function getFleetStatus() {
  return Object.values(FLEET).map(cfg => ({
    id: cfg.id,
    label: cfg.label,
    description: cfg.description,
    icon: cfg.icon,
    specialty: cfg.specialty,
    provider: cfg.provider,
    connected: cfg.available(),
    envKey: cfg.envKey,
    tier: cfg.tier,
    stats: stats[cfg.id],
  }));
}

function getAvailableModels() {
  return Object.values(FLEET).filter(cfg => cfg.available()).map(cfg => cfg.id);
}

module.exports = { route, getFleetStatus, getAvailableModels, detectTask, FLEET, ROUTING_MATRIX, stats };
