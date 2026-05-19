'use strict';
/**
 * CampaignAgent — DALEBA Metacortex Points 451-466
 * @module CampaignAgent
 *
 * Périmètre STRICT [451]:
 *   - Gestion budgets publicitaires (Meta Ads, Google Ads)
 *   - Analyse inventaire Bar à Plantes
 *   - Interfaçage API publicitaires
 *
 * Hors périmètre (throw si tentative):
 *   - Accès staff_payouts, loyalty_cards, appointments directs
 *   - Modification prix catalog Square
 *   - Envoi direct de SMS clients hors campagnes
 */
const { BaseAgent } = require('./base-agent');
const bus       = require('../services/event-bus');

const ALLOWED_ACTIONS = new Set([
  'create_campaign', 'deploy_campaign', 'get_performance',
  'check_inventory', 'trigger_reorder', 'analyze_stock_velocity',
  'generate_ad_copies', 'build_lookalike_audience',
  'set_budget', 'pause_campaign', 'resume_campaign',
  'generate_purchase_order', 'approve_purchase_order',
]);

class CampaignAgent extends BaseAgent {
  /**
   * @param {object} [config]
   * @param {number} [config.maxDailyBudgetCAD] - Plafond quotidien [458]
   */
  constructor(config = {}) {
    super({
      type:         'CAMPAIGN',
      name:         'CampaignAgent',
      scope:        ['ads:read', 'ads:write', 'inventory:read', 'purchase_order:write'],
      capabilities: [...ALLOWED_ACTIONS],
      config: {
        maxRetries:        2,
        timeoutMs:         45_000,
        budgetUSD:         0.15,
        maxDailyBudgetCAD: parseFloat(process.env.MAX_DAILY_ADS_BUDGET_CAD || '50'),
        ...config,
      },
    });
  }

  /** @param {string} action @throws si hors périmètre */
  _assertScope(action) {
    if (!ALLOWED_ACTIONS.has(action))
      throw new Error(`[CampaignAgent] Action hors périmètre: "${action}"`);
  }

  /** @param {object} payload */
  async execute(payload = {}) {
    const { action, tenantId, ...params } = payload;
    this._assertScope(action);
    this.log(`CampaignAgent.execute(${action}) tenant=${tenantId}`);

    const adsOrch  = require('../services/autonomous-ads-orchestrator');
    const stockEng = require('../services/stock-velocity-engine');
    const purAgent = require('../services/autonomous-purchase-agent');

    switch (action) {
      case 'create_campaign':         return adsOrch.buildCampaign(params.pool, tenantId, params);
      case 'deploy_campaign':         return adsOrch.deployCampaign(params.pool, tenantId, params);
      case 'get_performance':         return adsOrch.getCampaignPerformance(params.pool, tenantId, params);
      case 'check_inventory':         return stockEng.getInventoryStatus(params.pool, tenantId);
      case 'trigger_reorder':         return purAgent.triggerReorder(params.pool, tenantId, params);
      case 'analyze_stock_velocity':  return stockEng.analyzeVelocity(params.pool, tenantId, params.days);
      case 'generate_ad_copies':      return adsOrch.generateAdCopies(params.serviceNames, params.tone);
      case 'build_lookalike_audience':return adsOrch.buildLookalikeAudience(params.pool, tenantId, params);
      case 'set_budget':              return adsOrch.setBudget(tenantId, params.amount, this.config.maxDailyBudgetCAD);
      case 'pause_campaign':          return adsOrch.pauseCampaign(tenantId, params.campaignId);
      case 'resume_campaign':         return adsOrch.resumeCampaign(tenantId, params.campaignId);
      case 'generate_purchase_order': return purAgent.generatePurchaseOrder(params.pool, tenantId, params);
      case 'approve_purchase_order':  return purAgent.approvePurchaseOrder(params.pool, tenantId, params);
      default: throw new Error(`Action non gérée: ${action}`);
    }
  }
}

module.exports = { CampaignAgent };
