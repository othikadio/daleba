/**
 * Agent Manager — Gestionnaire de sous-agents DALEBA
 * DALEBA Metacortex — Point 100 (Architecture finale)
 *
 * Registre central · Instanciation · Hiérarchie · Communication IPC
 * Intègre BaseAgent + Swarm pour une orchestration unifiée.
 */

'use strict';

const { BaseAgent, LLMAgent, AnalystAgent, CoderAgent, MarketerAgent, AGENT_STATES } = require('../agents/base-agent');
const EventEmitter = require('events');

// ─── BUS IPC [062] ────────────────────────────────────────────────────────────

const ipcBus = new EventEmitter();
ipcBus.setMaxListeners(200);

// ─── REGISTRE DE CLASSES D'AGENTS ────────────────────────────────────────────

const AGENT_CLASSES = {
  BASE:     BaseAgent,
  LLM:      LLMAgent,
  ANALYST:  AnalystAgent,
  CODER:    CoderAgent,
  MARKETER: MarketerAgent,
};

/**
 * Enregistre une nouvelle classe d'agent personnalisée
 */
function registerAgentClass(type, AgentClass) {
  if (!(AgentClass.prototype instanceof BaseAgent)) {
    throw new Error(`${AgentClass.name} doit hériter de BaseAgent`);
  }
  AGENT_CLASSES[type.toUpperCase()] = AgentClass;
  console.log(`[AgentManager] Classe enregistrée: ${type}`);
}

// ─── LIFECYCLE REGISTRY ───────────────────────────────────────────────────────

const LIVE_AGENTS = new Map(); // agentId → BaseAgent instance

const managerStats = {
  totalSpawned:   0,
  totalCompleted: 0,
  totalFailed:    0,
  totalKilled:    0,
};

// ─── SPAWN ────────────────────────────────────────────────────────────────────

/**
 * Instancie et lance un agent
 * @param {string} type       — clé dans AGENT_CLASSES
 * @param {any}    payload    — données pour execute()
 * @param {object} agentConfig — config BaseAgent (scope, parentId, etc.)
 * @returns {Promise<{ agentId, result }>}
 */
async function spawn(type, payload, agentConfig = {}) {
  const AgentClass = AGENT_CLASSES[type?.toUpperCase()] || LLMAgent;
  const agent = new AgentClass(agentConfig);

  LIVE_AGENTS.set(agent.agentId, agent);
  managerStats.totalSpawned++;

  // Wiring événements → IPC bus [062]
  agent.on('done',    (data) => { managerStats.totalCompleted++; ipcBus.emit('agent:done', data); _cleanup(agent.agentId, 30000); });
  agent.on('failed',  (data) => { managerStats.totalFailed++;    ipcBus.emit('agent:failed', data); _cleanup(agent.agentId, 30000); });
  agent.on('killed',  (data) => { managerStats.totalKilled++;    ipcBus.emit('agent:killed', data); _cleanup(agent.agentId, 5000); });
  agent.on('report',  (data) => ipcBus.emit('agent:report', data));
  agent.on('state_change', (data) => ipcBus.emit('agent:state', data));
  agent.on('budget_exceeded', (data) => {
    ipcBus.emit('agent:budget', data);
    console.warn(`[AgentManager] Budget dépassé: ${data.agentId}`);
  });

  // Lancement
  const resultPromise = agent.run(payload);
  return { agentId: agent.agentId, resultPromise };
}

/**
 * Spawn + await résultat (mode synchrone)
 */
async function spawnAndWait(type, payload, agentConfig = {}) {
  const { agentId, resultPromise } = await spawn(type, payload, agentConfig);
  const result = await resultPromise;
  return { agentId, result };
}

// ─── KILL ─────────────────────────────────────────────────────────────────────

function killAgent(agentId, reason = 'manual') {
  const agent = LIVE_AGENTS.get(agentId);
  if (!agent) return false;
  agent.kill(reason);
  return true;
}

function killAll(reason = 'shutdown') {
  for (const [id, agent] of LIVE_AGENTS.entries()) {
    if (![AGENT_STATES.DONE, AGENT_STATES.FAILED, AGENT_STATES.KILLED].includes(agent.state)) {
      agent.kill(reason);
    }
  }
}

function _cleanup(agentId, delayMs) {
  setTimeout(() => LIVE_AGENTS.delete(agentId), delayMs);
}

// ─── ORCHESTRATION HIÉRARCHIQUE [060, 063] ────────────────────────────────────

/**
 * Lance plusieurs sous-agents en parallèle et attend leurs résultats
 * @param {Array<{ type, payload, config }>} tasks
 * @param {object} options — { parallel: true, timeout: 60000 }
 * @returns {Array<{ agentId, result|error }>}
 */
async function orchestrate(tasks, options = {}) {
  const parallel = options.parallel !== false;
  const results  = [];

  if (parallel) {
    const promises = tasks.map(t => spawnAndWait(t.type, t.payload, t.config || {}).catch(err => ({ error: err.message })));
    const settled  = await Promise.allSettled(promises);
    for (const r of settled) {
      results.push(r.status === 'fulfilled' ? r.value : { error: r.reason?.message });
    }
  } else {
    // Séquentiel
    for (const task of tasks) {
      try {
        const r = await spawnAndWait(task.type, task.payload, task.config || {});
        results.push(r);
      } catch (err) {
        results.push({ error: err.message });
      }
    }
  }

  return results;
}

// ─── COMMUNICATION IPC [062] ──────────────────────────────────────────────────

function broadcast(event, data) {
  ipcBus.emit(event, data);
}

function onAgentEvent(event, handler) {
  ipcBus.on(event, handler);
  return () => ipcBus.off(event, handler); // retourne un unsubscribe
}

// ─── STATUS [065] ─────────────────────────────────────────────────────────────

function getStatus() {
  const agents = [...LIVE_AGENTS.values()].map(a => a.toJSON());

  return {
    manager:     'DALEBA Agent Manager v1.0',
    registeredClasses: Object.keys(AGENT_CLASSES),
    stats:       { ...managerStats, liveAgents: LIVE_AGENTS.size },
    agents:      agents.sort((a, b) => (b.metrics.createdAt || 0) - (a.metrics.createdAt || 0)),
  };
}

// ─── EXPORTS ─────────────────────────────────────────────────────────────────

module.exports = {
  // Lifecycle
  spawn, spawnAndWait, killAgent, killAll,
  // Orchestration
  orchestrate,
  // Registry
  registerAgentClass, AGENT_CLASSES,
  // IPC
  broadcast, onAgentEvent, ipcBus,
  // Status
  getStatus,
  // Re-exports pour accès direct
  BaseAgent, LLMAgent, AnalystAgent, CoderAgent, MarketerAgent, AGENT_STATES,
};
