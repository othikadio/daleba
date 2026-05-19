/**
 * BaseAgent — Classe de base pour tous les agents DALEBA
 * DALEBA Metacortex — Point 100 (Keystone)
 *
 * Tous les agents héritent de cette classe.
 * Fournit : cycle de vie · budget · logging · retry · sandbox · santé.
 *
 * Usage:
 *   class MyAgent extends BaseAgent {
 *     async execute(payload) { ... }
 *   }
 */

'use strict';

const { v4: uuidv4 } = require('uuid');
const EventEmitter = require('events');

// ─── CONSTANTES ───────────────────────────────────────────────────────────────

const AGENT_STATES = {
  IDLE:     'IDLE',
  RUNNING:  'RUNNING',
  PAUSED:   'PAUSED',
  DONE:     'DONE',
  FAILED:   'FAILED',
  KILLED:   'KILLED',
};

const DEFAULT_CONFIG = {
  maxRetries:     2,
  timeoutMs:      30000,
  budgetUSD:      0.10,   // budget par exécution
  logLevel:       'info', // info | warn | error | silent
};

// ─── CLASSE DE BASE ────────────────────────────────────────────────────────────

class BaseAgent extends EventEmitter {

  /**
   * @param {object} config
   *   type        {string}   — type d'agent (ANALYST, CODER, etc.)
   *   name        {string}   — nom lisible
   *   scope       {string[]} — ressources autorisées (sandbox)
   *   capabilities{string[]} — ce que l'agent peut faire
   *   parentId    {string}   — ID de l'agent parent (pour hiérarchie)
   *   config      {object}   — override DEFAULT_CONFIG
   */
  constructor({ type = 'GENERIC', name = '', scope = [], capabilities = [], parentId = null, config = {} } = {}) {
    super();

    this.agentId      = `${type.toLowerCase()}_${uuidv4().slice(0, 8)}`;
    this.type         = type;
    this.name         = name || `${type} Agent`;
    this.scope        = scope;           // [061] périmètre sandbox
    this.capabilities = capabilities;
    this.parentId     = parentId;        // [063] hiérarchie agent maître
    this.state        = AGENT_STATES.IDLE;
    this.cfg          = { ...DEFAULT_CONFIG, ...config };

    // Métriques d'exécution
    this.metrics = {
      createdAt:    Date.now(),
      startedAt:    null,
      endedAt:      null,
      retries:      0,
      costUSD:      0,
      tokensUsed:   0,
      lastError:    null,
    };

    // Kill timer [064]
    this._killTimer   = null;
    this._aborted     = false;

    this._log('info', `Agent créé: ${this.agentId} (${this.type})`);
  }

  // ─── CYCLE DE VIE ──────────────────────────────────────────────────────────

  /**
   * Lance l'exécution de l'agent avec retry et timeout
   * @param {any} payload — données d'entrée
   * @returns {Promise<any>} résultat de execute()
   */
  async run(payload) {
    this._transition(AGENT_STATES.RUNNING);
    this.metrics.startedAt = Date.now();

    // [064] Kill timer — tue l'agent si dépassement timeout
    this._killTimer = setTimeout(() => {
      if (this.state === AGENT_STATES.RUNNING) {
        this._aborted = true;
        this._transition(AGENT_STATES.KILLED);
        this.emit('killed', { agentId: this.agentId, reason: 'timeout' });
      }
    }, this.cfg.timeoutMs);

    // [061] Validation scope avant exécution
    this._validateScope(payload);

    let lastError = null;
    for (let attempt = 0; attempt <= this.cfg.maxRetries; attempt++) {
      if (this._aborted) break;

      try {
        if (attempt > 0) {
          this.metrics.retries++;
          const delay = Math.min(500 * Math.pow(2, attempt - 1), 4000);
          await new Promise(r => setTimeout(r, delay));
          this._log('warn', `Retry ${attempt}/${this.cfg.maxRetries}`);
        }

        const result = await this.execute(payload);

        clearTimeout(this._killTimer);
        this._transition(AGENT_STATES.DONE);
        this.metrics.endedAt = Date.now();

        this._log('info', `Complété en ${this.metrics.endedAt - this.metrics.startedAt}ms`);

        // [063] Rapport au parent
        if (this.parentId) {
          this.emit('report', { agentId: this.agentId, parentId: this.parentId, result });
        }

        this.emit('done', { agentId: this.agentId, result, metrics: this.getMetrics() });
        return result;

      } catch (err) {
        lastError = err;
        this.metrics.lastError = err.message;
        this._log('warn', `Échec attempt ${attempt}: ${err.message}`);

        // Erreur fatale → pas de retry
        if (err.fatal || err.status === 401) break;
      }
    }

    clearTimeout(this._killTimer);
    if (this.state !== AGENT_STATES.KILLED) {
      this._transition(AGENT_STATES.FAILED);
    }
    this.metrics.endedAt = Date.now();
    this.emit('failed', { agentId: this.agentId, error: lastError?.message, metrics: this.getMetrics() });
    throw lastError || new Error(`Agent ${this.agentId} failed after ${this.cfg.maxRetries + 1} attempts`);
  }

  /**
   * MÉTHODE À IMPLÉMENTER par les sous-classes
   * @param {any} payload
   * @returns {Promise<any>}
   */
  async execute(payload) {
    throw new Error(`BaseAgent.execute() doit être implémentée par ${this.constructor.name}`);
  }

  // ─── CONTRÔLE ──────────────────────────────────────────────────────────────

  pause() {
    if (this.state === AGENT_STATES.RUNNING) {
      this._transition(AGENT_STATES.PAUSED);
      this.emit('paused', { agentId: this.agentId });
    }
  }

  resume() {
    if (this.state === AGENT_STATES.PAUSED) {
      this._transition(AGENT_STATES.RUNNING);
      this.emit('resumed', { agentId: this.agentId });
    }
  }

  kill(reason = 'manual') {
    clearTimeout(this._killTimer);
    this._aborted = true;
    this._transition(AGENT_STATES.KILLED);
    this.metrics.endedAt = Date.now();
    this.emit('killed', { agentId: this.agentId, reason });
    this._log('warn', `Agent tué: ${reason}`);
  }

  // ─── BUDGET & COÛT ──────────────────────────────────────────────────────────

  trackCost(costUSD, tokens = 0) {
    this.metrics.costUSD  += costUSD;
    this.metrics.tokensUsed += tokens;

    // [030] Vérification budget par agent
    if (this.metrics.costUSD > this.cfg.budgetUSD) {
      this._log('warn', `Budget dépassé: $${this.metrics.costUSD.toFixed(4)} > $${this.cfg.budgetUSD}`);
      this.emit('budget_exceeded', { agentId: this.agentId, cost: this.metrics.costUSD });
    }
  }

  /**
   * Raccourci : appel LLM via DARE avec tracking coût automatique
   */
  async llm(message, systemPrompt = '', history = [], options = {}) {
    if (this._aborted) throw new Error('Agent aborted');
    const dare = require('./dare');
    const result = await dare.executeWithFailover(message, systemPrompt, history, {
      ...options,
      forceProvider: options.provider,
    });
    if (result._dare?.costUSD) this.trackCost(result._dare.costUSD);
    return result;
  }

  // ─── SANDBOX [061] ─────────────────────────────────────────────────────────

  _validateScope(payload) {
    if (!this.scope || this.scope.length === 0) return;
    if (payload?.filePath) {
      const allowed = this.scope.some(s => payload.filePath.startsWith(s));
      if (!allowed) throw Object.assign(
        new Error(`Scope violation: "${payload.filePath}" interdit pour ${this.agentId}`),
        { fatal: true }
      );
    }
  }

  // ─── ÉTAT & LOGS ───────────────────────────────────────────────────────────

  _transition(newState) {
    const old = this.state;
    this.state = newState;
    this.emit('state_change', { agentId: this.agentId, from: old, to: newState });
  }

  _log(level, msg) {
    if (this.cfg.logLevel === 'silent') return;
    const levels = { info: 0, warn: 1, error: 2 };
    if ((levels[level] || 0) >= (levels[this.cfg.logLevel] || 0)) {
      const prefix = `[${this.agentId}]`;
      if (level === 'error') console.error(prefix, msg);
      else if (level === 'warn') console.warn(prefix, msg);
      else console.log(prefix, msg);
    }
  }

  getMetrics() {
    return {
      ...this.metrics,
      durationMs: this.metrics.endedAt
        ? this.metrics.endedAt - this.metrics.startedAt
        : (this.metrics.startedAt ? Date.now() - this.metrics.startedAt : null),
      state: this.state,
    };
  }

  toJSON() {
    return {
      agentId: this.agentId, type: this.type, name: this.name,
      state: this.state, scope: this.scope,
      capabilities: this.capabilities, parentId: this.parentId,
      metrics: this.getMetrics(),
    };
  }
}

// ─── AGENTS CONCRETS INTÉGRÉS ─────────────────────────────────────────────────

/**
 * LLMAgent — Agent généraliste LLM via DARE
 */
class LLMAgent extends BaseAgent {
  constructor(config = {}) {
    super({ type: 'LLM', name: 'LLM Agent', ...config });
    this.systemPrompt = config.systemPrompt || '';
    this.history = config.history || [];
  }

  async execute(payload) {
    const message = typeof payload === 'string' ? payload : (payload.message || payload.task || JSON.stringify(payload));
    const result = await this.llm(message, this.systemPrompt, this.history);
    return { content: result.content, provider: result._dare?.provider };
  }
}

/**
 * AnalystAgent — Analyse données métier (finance, RDV, KPIs)
 */
class AnalystAgent extends BaseAgent {
  constructor(config = {}) {
    super({ type: 'ANALYST', name: 'Data Analyst', capabilities: ['financial_analysis', 'kpi', 'forecasting'], ...config });
  }

  async execute({ query, dataContext = null }) {
    const systemPrompt = `Tu es un analyste de données expert pour salon de coiffure.
Analyse les données avec précision. Retourne des insights actionnables, pas du texte générique.
${dataContext ? `Contexte: ${JSON.stringify(dataContext)}` : ''}`;
    const result = await this.llm(query, systemPrompt, []);
    return { analysis: result.content, provider: result._dare?.provider };
  }
}

/**
 * CoderAgent — Génération, correction et test de code
 */
class CoderAgent extends BaseAgent {
  constructor(config = {}) {
    super({ type: 'CODER', name: 'Code Generator', capabilities: ['codegen', 'refactor', 'test', 'debug'], ...config });
  }

  async execute({ task, context = '', language = 'javascript' }) {
    const systemPrompt = `Tu es un expert ${language} pour DALEBA. Code propre, commenté, prêt production.
Réponds uniquement avec le code, sans markdown ni explication sauf si demandé.`;
    const result = await this.llm(task + (context ? `\n\nContexte: ${context}` : ''), systemPrompt, []);
    return { code: result.content, language, provider: result._dare?.provider };
  }
}

/**
 * MarketerAgent — Contenu marketing salon
 */
class MarketerAgent extends BaseAgent {
  constructor(config = {}) {
    super({ type: 'MARKETER', name: 'Marketing Agent', capabilities: ['copywriting', 'social', 'campaign'], ...config });
  }

  async execute({ brief, platform = 'instagram', tone = 'premium' }) {
    const systemPrompt = `Tu es un expert marketing pour salon de coiffure africain premium.
Plateforme cible: ${platform}. Ton: ${tone}. Rédige du contenu percutant, court, mémorable.`;
    const result = await this.llm(brief, systemPrompt, []);
    return { content: result.content, platform, provider: result._dare?.provider };
  }
}

// ─── EXPORTS ─────────────────────────────────────────────────────────────────

module.exports = {
  BaseAgent, AGENT_STATES,
  // Agents concrets
  LLMAgent, AnalystAgent, CoderAgent, MarketerAgent,
};
