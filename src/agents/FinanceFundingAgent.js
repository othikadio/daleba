'use strict';
/**
 * FinanceFundingAgent — DALEBA Metacortex Section 11 [501]
 * Périmètre STRICT: numérisation programmes, calcul RCSD, préparation dossiers
 * INTERDIT: soumission officielle sans validation humaine [507]
 */
const { BaseAgent } = require('./base-agent');
const bus = require('../services/event-bus');

const ALLOWED_ACTIONS = new Set([
  'scan_funding_opportunities','prequalify_tenant','calculate_dscr',
  'generate_pitch_memo','write_cover_letter','store_document','retrieve_document',
  'send_opportunity_alert','create_application','update_application_status',
  'get_applications','match_opportunities','calculate_wacc','simulate_max_debt',
  'project_roi','get_reporting_deadlines',
]);
const HUMAN_APPROVAL_REQUIRED = new Set([
  'submit_application','send_official_form','upload_to_government_portal',
]);

class FinanceFundingAgent extends BaseAgent {
  constructor(config = {}) {
    super({
      type: 'FINANCE_FUNDING', name: 'FinanceFundingAgent',
      scope: ['funding:read','funding:write','documents:encrypted','analyst:read'],
      capabilities: [...ALLOWED_ACTIONS],
      config: { maxRetries:2, timeoutMs:60000, budgetUSD:0.20, eligibilityThreshold:0.80, ...config },
    });
  }
  _assertScope(action) {
    if (HUMAN_APPROVAL_REQUIRED.has(action))
      throw new Error(`[FinanceFundingAgent] "${action}" requiert validation humaine cryptographique [507]`);
    if (!ALLOWED_ACTIONS.has(action))
      throw new Error(`[FinanceFundingAgent] Action hors périmètre: "${action}"`);
  }
  async execute(payload = {}) {
    const { action, tenantId, ...params } = payload;
    this._assertScope(action);
    this.log(`FinanceFundingAgent.execute(${action}) tenant=${tenantId}`);
    const scanner = require('../services/funding-scanner-worker');
    const prequal = require('../services/prequalification-engine');
    const vault   = require('../services/funding-vault');
    const alert   = require('../services/funding-alert');
    switch (action) {
      case 'scan_funding_opportunities':  return scanner.scanAll(params.pool);
      case 'prequalify_tenant':           return prequal.prequalify(params.pool, tenantId);
      case 'calculate_dscr':              return prequal.calculateDSCR(params.netOperatingIncome, params.debtService);
      case 'generate_pitch_memo':         return prequal.generatePitchMemo(params.pool, tenantId, params.opportunity);
      case 'write_cover_letter':          return prequal.writeCoverLetter(params.pool, tenantId, params);
      case 'store_document':              return vault.storeDocument(params.pool, tenantId, params);
      case 'retrieve_document':           return vault.retrieveDocument(params.pool, tenantId, params.docId);
      case 'send_opportunity_alert':      return alert.sendOpportunityAlert(tenantId, params.opportunity, params.eligibilityPct);
      case 'create_application':          return prequal.createApplication(params.pool, tenantId, params);
      case 'update_application_status':   return prequal.updateApplicationStatus(params.pool, tenantId, params);
      case 'get_applications':            return prequal.getApplications(params.pool, tenantId);
      case 'calculate_wacc':              return prequal.calculateWACC(params.offers);
      case 'simulate_max_debt':           return prequal.simulateMaxDebt(params.pool, tenantId, params);
      case 'project_roi':                 return prequal.projectROI(params.pool, tenantId, params);
      case 'get_reporting_deadlines':     return prequal.getReportingDeadlines(params.pool, tenantId);
      default: throw new Error(`Action non gérée: ${action}`);
    }
  }
}
module.exports = { FinanceFundingAgent, ALLOWED_ACTIONS, HUMAN_APPROVAL_REQUIRED };
