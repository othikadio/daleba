'use strict';
/**
 * EvolutionAgent — DALEBA Metacortex Section 13 [601]
 * Périmètre STRICT: veille technologique, crawling dépôts,
 * mise à jour dynamique des Skills de l'écosystème.
 * INTERDIT [605,609]: exécution directe de code externe + mutation sans approbation Ulrich.
 */
const { BaseAgent } = require('./base-agent');
const bus = require('../services/event-bus');

const ALLOWED_ACTIONS = new Set([
  'scan_github_skills',       // [602]
  'crawl_ai_releases',        // [602]
  'analyze_snippet',          // [604] via sandbox uniquement
  'detect_poison',            // [606]
  'stage_evolution',          // [603]
  'get_evolution_pool',       // [603]
  'get_staged_skills',
  'request_upgrade_approval', // [610]
  'list_banned_sources',      // [607]
  'get_evolution_stats',
]);

const GATEKEEPER_REQUIRED = new Set([
  'inject_skill',             // [609] requiert OUI Ulrich
  'mutate_production_code',   // [609]
  'overwrite_service_file',   // [609]
  'activate_skill',           // [609]
  'push_to_main',             // [611]
]);

class EvolutionAgent extends BaseAgent {
  constructor(config = {}) {
    super({
      type: 'EVOLUTION', name: 'EvolutionAgent',
      scope: ['github:read', 'evolution:write', 'sandbox:execute', 'skills:staged'],
      capabilities: [...ALLOWED_ACTIONS],
      config: { maxRetries:2, timeoutMs:90000, budgetUSD:0.30, ...config },
    });
  }

  _assertScope(action) {
    if (GATEKEEPER_REQUIRED.has(action))
      throw new Error(`[EvolutionAgent] "${action}" requiert autorisation explicite Ulrich [609]`);
    if (!ALLOWED_ACTIONS.has(action))
      throw new Error(`[EvolutionAgent] Action hors périmètre: "${action}"`);
  }

  async execute(payload = {}) {
    const { action, ...params } = payload;
    this._assertScope(action);
    this.log(`EvolutionAgent.execute(${action})`);
    const crawler = require('../services/github-skill-crawler-worker');
    const sandbox = require('../services/evolution-sandbox');
    const poison  = require('../services/code-poison-detector');
    const guard   = require('../services/sovereign-upgrade-guard');

    switch (action) {
      case 'scan_github_skills':       return crawler.scanGitHubSkills(params.pool, params);
      case 'crawl_ai_releases':        return crawler.crawlAIReleases(params.pool);
      case 'analyze_snippet':          return sandbox.runInSandbox(params.code, params.options);
      case 'detect_poison':            return poison.detectPoison(params.code, params.source);
      case 'stage_evolution':          return guard.stageSkill(params.pool, params);
      case 'get_evolution_pool':       return guard.getEvolutionPool(params.pool, params);
      case 'get_staged_skills':        return guard.getStagedSkills(params.pool);
      case 'request_upgrade_approval': return guard.requestUpgradeApproval(params.pool, params);
      case 'list_banned_sources':      return guard.getBannedSources(params.pool);
      case 'get_evolution_stats':      return guard.getEvolutionStats(params.pool);
      default: throw new Error(`Action non gérée: ${action}`);
    }
  }
}

module.exports = { EvolutionAgent, ALLOWED_ACTIONS, GATEKEEPER_REQUIRED };
