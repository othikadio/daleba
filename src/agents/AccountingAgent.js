'use strict';
/**
 * AccountingAgent — DALEBA Metacortex Section 12 [551]
 * Périmètre STRICT: consolidation livre-comptable, génération TPS/TVQ, catégorisation
 * dépenses, staging API gouvernementales.
 * INTERDIT [556]: toute transmission XML/remise financière sans confirmation humaine.
 */
const { BaseAgent } = require('./base-agent');
const bus = require('../services/event-bus');

const ALLOWED_ACTIONS = new Set([
  'compute_quarterly_taxes',     // [552]
  'stage_gst_return',            // [553]
  'stage_qst_return',            // [553]
  'stage_pad_payment',           // [554]
  'generate_balance_sheet',      // [555]
  'generate_income_statement',   // [555]
  'get_tax_summary',
  'get_itc_itr',
  'categorize_expenses',
  'list_filings',
  'get_filing',
]);
const GATEKEEPER_REQUIRED = new Set([
  'transmit_gst_return',
  'transmit_qst_return',
  'execute_pad_payment',
  'submit_official_filing',
]);

class AccountingAgent extends BaseAgent {
  constructor(config = {}) {
    super({
      type: 'ACCOUNTING', name: 'AccountingAgent',
      scope: ['ledger:read', 'tax:write', 'filings:staged', 'banking:staged'],
      capabilities: [...ALLOWED_ACTIONS],
      config: { maxRetries:2, timeoutMs:60000, budgetUSD:0.20, ...config },
    });
  }
  _assertScope(action) {
    if (GATEKEEPER_REQUIRED.has(action))
      throw new Error(`[AccountingAgent] "${action}" requiert confirmation humaine cryptographique [556]`);
    if (!ALLOWED_ACTIONS.has(action))
      throw new Error(`[AccountingAgent] Action hors périmètre: "${action}"`);
  }
  async execute(payload = {}) {
    const { action, tenantId, ...params } = payload;
    this._assertScope(action);
    this.log(`AccountingAgent.execute(${action}) tenant=${tenantId}`);
    const tax  = require('../services/tax-formulator');
    const stmt = require('../services/financial-statements');
    const gov  = require('../services/gov-filing-connector');
    switch (action) {
      case 'compute_quarterly_taxes':   return tax.computeQuarterlyTaxes(params.pool, tenantId, params);
      case 'stage_gst_return':          return gov.stageGSTReturn(params.pool, tenantId, params);
      case 'stage_qst_return':          return gov.stageQSTReturn(params.pool, tenantId, params);
      case 'stage_pad_payment':         return gov.stagePADPayment(params.pool, tenantId, params);
      case 'generate_balance_sheet':    return stmt.generateBalanceSheet(params.pool, tenantId);
      case 'generate_income_statement': return stmt.generateIncomeStatement(params.pool, tenantId, params);
      case 'get_tax_summary':           return tax.getTaxSummary(params.pool, tenantId, params);
      case 'get_itc_itr':               return tax.getITCITR(params.pool, tenantId, params);
      case 'categorize_expenses':       return tax.categorizeExpenses(params.pool, tenantId, params);
      case 'list_filings':              return gov.listFilings(params.pool, tenantId);
      case 'get_filing':                return gov.getFiling(params.pool, tenantId, params.filingId);
      default: throw new Error(`Action non gérée: ${action}`);
    }
  }
}
module.exports = { AccountingAgent, ALLOWED_ACTIONS, GATEKEEPER_REQUIRED };
