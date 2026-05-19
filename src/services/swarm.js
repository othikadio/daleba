/**
 * Swarm Orchestrator — DALEBA Metacortex Points 060-065
 *
 * Divise les tâches complexes en micro-agents spécialisés.
 * Chaque agent : ID unique · Sandbox · Timeout kill · Rapport final.
 * Communication via event-bus interne.
 */

'use strict';

const { v4: uuidv4 } = require('uuid');
const EventEmitter = require('events');

// ─── BUS INTERNE ─────────────────────────────────────────────────────────────

const swarmBus = new EventEmitter();
swarmBus.setMaxListeners(100);

// ─── ÉTAT DU SWARM ───────────────────────────────────────────────────────────

// [061] Registry des agents actifs
const AGENTS = new Map(); // agentId → AgentRecord

// [062] File de tâches pendantes
const TASK_QUEUE = [];

// Stats globales
const swarmStats = {
  totalCreated: 0,
  totalCompleted: 0,
  totalFailed: 0,
  totalKilled: 0,
  lastActivity: null,
};

// ─── TYPES DE MICRO-AGENTS ────────────────────────────────────────────────────

const AGENT_TYPES = {
  ANALYST:    { timeout: 30000,  description: 'Analyse données et rapports' },
  CODER:      { timeout: 60000,  description: 'Génération et correction de code' },
  MARKETER:   { timeout: 45000,  description: 'Création contenu marketing' },
  RESEARCHER: { timeout: 60000,  description: 'Recherche et synthèse information' },
  DEPLOYER:   { timeout: 90000,  description: 'Validation et déploiement patches' },
  MONITOR:    { timeout: 120000, description: 'Surveillance système et alertes' },
  GENERIC:    { timeout: 30000,  description: 'Tâche générique' },
};

// ─── CRÉATION D'AGENT [060, 061] ─────────────────────────────────────────────

/**
 * Crée et lance un micro-agent
 * @param {object} config
 *   type: keyof AGENT_TYPES
 *   task: string — description de la tâche
 *   payload: any — données pour l'agent
 *   scope: string[] — fichiers/ressources autorisés (sandbox)
 *   parentId: string|null — agent parent si orchestration hiérarchique
 */
function createAgent(config) {
  const agentId = `agent_${config.type?.toLowerCase() || 'gen'}_${uuidv4().slice(0, 8)}`;
  const agentType = AGENT_TYPES[config.type?.toUpperCase()] || AGENT_TYPES.GENERIC;
  const timeout = config.timeout || agentType.timeout;

  const record = {
    id: agentId,
    type: config.type || 'GENERIC',
    task: config.task || '',
    scope: config.scope || [],        // [061] périmètre strictement délimité
    parentId: config.parentId || null,
    status: 'QUEUED',                  // QUEUED | RUNNING | DONE | FAILED | KILLED
    createdAt: Date.now(),
    startedAt: null,
    endedAt: null,
    result: null,
    error: null,
    _abort: null,                      // AbortController reference
    _timer: null,                      // Kill timer
  };

  AGENTS.set(agentId, record);
  TASK_QUEUE.push({ agentId, payload: config.payload });
  swarmStats.totalCreated++;
  swarmStats.lastActivity = Date.now();

  // [062] Annonce sur le bus
  swarmBus.emit('agent:created', { agentId, type: record.type, task: record.task });

  // Lancement asynchrone
  setImmediate(() => runAgent(agentId, config.payload, timeout, config.handler));

  return agentId;
}

// ─── EXÉCUTION [062, 064] ────────────────────────────────────────────────────

async function runAgent(agentId, payload, timeout, handler) {
  const record = AGENTS.get(agentId);
  if (!record) return;

  record.status = 'RUNNING';
  record.startedAt = Date.now();

  // [064] Kill timer — tue l'agent si dépasse son timeout
  record._timer = setTimeout(() => {
    killAgent(agentId, 'timeout');
  }, timeout);

  swarmBus.emit('agent:started', { agentId, type: record.type });

  try {
    // [061] Validation scope — empêche l'agent d'agir hors de son périmètre
    const scopedPayload = applyScopeGuard(payload, record.scope);

    // Exécution du handler (injecté ou handler générique LLM)
    const fn = handler || getDefaultHandler(record.type);
    const result = await fn(scopedPayload, { agentId, scope: record.scope, task: record.task });

    clearTimeout(record._timer);
    record.status = 'DONE';
    record.result = result;
    record.endedAt = Date.now();
    swarmStats.totalCompleted++;
    swarmStats.lastActivity = Date.now();

    // [063] Rapport au parent si applicable
    if (record.parentId) {
      swarmBus.emit('agent:report', { agentId, parentId: record.parentId, result });
    }

    swarmBus.emit('agent:done', { agentId, type: record.type, result, durationMs: record.endedAt - record.startedAt });

  } catch (err) {
    clearTimeout(record._timer);
    if (record.status !== 'KILLED') {
      record.status = 'FAILED';
      record.error = err.message;
      record.endedAt = Date.now();
      swarmStats.totalFailed++;
      swarmBus.emit('agent:failed', { agentId, type: record.type, error: err.message });
    }
  }
}

// ─── KILL [064] ──────────────────────────────────────────────────────────────

function killAgent(agentId, reason = 'manual') {
  const record = AGENTS.get(agentId);
  if (!record || ['DONE', 'KILLED', 'FAILED'].includes(record.status)) return false;

  if (record._timer) clearTimeout(record._timer);

  record.status = 'KILLED';
  record.error = `Killed: ${reason}`;
  record.endedAt = Date.now();
  swarmStats.totalKilled++;

  swarmBus.emit('agent:killed', { agentId, reason });
  console.warn(`[Swarm] Agent tué: ${agentId} — ${reason}`);

  return true;
}

// [064] Détection boucle infinie / latence excessive
function startStuckDetector(intervalMs = 10000) {
  setInterval(() => {
    const now = Date.now();
    for (const [agentId, record] of AGENTS.entries()) {
      if (record.status !== 'RUNNING') continue;
      const agentType = AGENT_TYPES[record.type] || AGENT_TYPES.GENERIC;
      const maxAge = agentType.timeout * 1.2; // 20% de grâce
      if (now - record.startedAt > maxAge) {
        killAgent(agentId, 'stuck_detected');
      }
    }
  }, intervalMs);
}

// ─── ORCHESTRATION COMPLEXE [060] ────────────────────────────────────────────

/**
 * Divise une tâche complexe en sous-tâches et lance les agents
 * @param {string} masterTask — description de la tâche principale
 * @param {Array} subtasks — [{ type, task, payload, scope }]
 * @param {object} options — { parallel: true/false, onComplete }
 * @returns {string} masterAgentId
 */
async function orchestrate(masterTask, subtasks, options = {}) {
  const masterAgentId = `master_${uuidv4().slice(0, 8)}`;
  const childIds = [];
  const results = [];

  const masterRecord = {
    id: masterAgentId, type: 'MASTER',
    task: masterTask, scope: [],
    parentId: null, status: 'RUNNING',
    createdAt: Date.now(), startedAt: Date.now(),
    endedAt: null, result: null, error: null,
    children: [], _timer: null,
  };
  AGENTS.set(masterAgentId, masterRecord);

  // Lancement des sous-agents
  for (const subtask of subtasks) {
    const childId = createAgent({ ...subtask, parentId: masterAgentId });
    childIds.push(childId);
    masterRecord.children.push(childId);
  }

  // [063] Collecte des rapports enfants
  const reportHandler = ({ agentId, parentId, result }) => {
    if (parentId !== masterAgentId) return;
    results.push({ agentId, result });

    if (results.length >= childIds.length) {
      swarmBus.off('agent:report', reportHandler);
      masterRecord.status = 'DONE';
      masterRecord.result = { subtasks: results };
      masterRecord.endedAt = Date.now();

      if (options.onComplete) options.onComplete(masterRecord.result);
      swarmBus.emit('swarm:complete', { masterAgentId, results });
    }
  };

  swarmBus.on('agent:report', reportHandler);

  // Timeout master
  masterRecord._timer = setTimeout(() => {
    if (masterRecord.status === 'RUNNING') {
      childIds.forEach(id => killAgent(id, 'master_timeout'));
      masterRecord.status = 'FAILED';
      masterRecord.error = 'Timeout orchestration master';
      swarmBus.off('agent:report', reportHandler);
    }
  }, 5 * 60 * 1000); // 5 min max pour une orchestration complète

  return masterAgentId;
}

// ─── SCOPE GUARD [061] ───────────────────────────────────────────────────────

function applyScopeGuard(payload, scope) {
  // Si pas de scope défini → payload intact
  if (!scope || scope.length === 0) return payload;

  // Si payload contient un filePath → vérifier qu'il est dans le scope
  if (payload?.filePath) {
    const allowed = scope.some(s => payload.filePath.startsWith(s));
    if (!allowed) throw new Error(`Swarm: filePath "${payload.filePath}" hors scope [${scope.join(', ')}]`);
  }

  return payload;
}

// ─── HANDLERS GÉNÉRIQUES PAR TYPE ────────────────────────────────────────────

function getDefaultHandler(type) {
  const handlers = {
    ANALYST: async (payload) => {
      const dare = require('../agents/dare');
      const result = await dare.executeWithFailover(
        payload.query || payload.task || 'Analyse cette donnée',
        'Tu es un analyste de données expert. Sois précis et concis.',
        []
      );
      return { analysis: result.content, provider: result._dare?.provider };
    },

    CODER: async (payload) => {
      const codegen = require('../agents/connectors/codegen');
      return codegen.query(payload.task || payload.prompt, '', []);
    },

    MARKETER: async (payload) => {
      const dare = require('../agents/dare');
      const result = await dare.executeWithFailover(
        payload.brief || payload.task,
        'Tu es un expert marketing pour salon de coiffure africain premium. Rédige du contenu percutant.',
        []
      );
      return { content: result.content, provider: result._dare?.provider };
    },

    RESEARCHER: async (payload) => {
      const dare = require('../agents/dare');
      const result = await dare.executeWithFailover(
        payload.query || payload.task,
        'Tu es un chercheur expert. Synthétise les informations de manière structurée.',
        []
      );
      return { research: result.content };
    },

    GENERIC: async (payload) => {
      const dare = require('../agents/dare');
      const result = await dare.executeWithFailover(
        payload.message || payload.task || JSON.stringify(payload),
        '',
        []
      );
      return { output: result.content };
    },
  };

  return handlers[type?.toUpperCase()] || handlers.GENERIC;
}

// ─── DASHBOARD [065] ─────────────────────────────────────────────────────────

function getSwarmStatus() {
  const agents = [];
  for (const [id, record] of AGENTS.entries()) {
    agents.push({
      id, type: record.type, task: record.task,
      status: record.status,
      scope: record.scope,
      parentId: record.parentId,
      children: record.children || [],
      durationMs: record.endedAt ? record.endedAt - record.startedAt : (record.startedAt ? Date.now() - record.startedAt : null),
      createdAt: new Date(record.createdAt).toISOString(),
      // Masque les résultats volumineux pour le dashboard
      result: record.result ? { type: typeof record.result, preview: JSON.stringify(record.result).slice(0, 100) } : null,
      error: record.error,
    });
  }

  // Tri par date desc, limite 50 pour le dashboard
  agents.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));

  return {
    swarm: 'DALEBA Swarm Orchestrator v1.0',
    stats: { ...swarmStats, activeAgents: [...AGENTS.values()].filter(a => a.status === 'RUNNING').length },
    agents: agents.slice(0, 50),
    queue: TASK_QUEUE.length,
  };
}

// ─── INIT ─────────────────────────────────────────────────────────────────────

function start() {
  startStuckDetector(10000);
  console.log('[Swarm] Orchestrateur démarré — stuck detector actif');
}

// ─── EXPORTS ─────────────────────────────────────────────────────────────────

module.exports = {
  createAgent, killAgent, orchestrate,
  getSwarmStatus, start,
  swarmBus, AGENTS, AGENT_TYPES,
};
