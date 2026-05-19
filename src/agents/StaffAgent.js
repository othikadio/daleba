'use strict';
/**
 * StaffAgent — DALEBA Metacortex Points 301-319
 * Périmètre strict: profils employés, horaires, commissions, pourboires.
 */
const { BaseAgent } = require('./base-agent');
const bus = require('../services/event-bus');

class StaffAgent extends BaseAgent {
  constructor() {
    super({
      type: 'STAFF',
      name: 'Staff Orchestrator',
      scope: ['staff:read', 'staff:write', 'schedule:read', 'commission:calculate', 'tips:distribute'],
      capabilities: ['sync_staff', 'assign_appointment', 'calculate_commission', 'check_conflicts', 'generate_payout_report'],
      config: { maxRetries: 3, timeoutMs: 30000, budgetUSD: 0.10 },
    });
  }

  // [302] Lance la synchronisation Square Team
  async syncStaff(tenantId, accessToken, pool) {
    const worker = require('../services/staff-sync-worker');
    return worker.syncNow(tenantId, accessToken, pool);
  }

  // [304-306] Assigne intelligemment un rendez-vous
  async assignAppointment(params) {
    const lb = require('../services/fair-load-balancer');
    return lb.assignBestEmployee(params);
  }

  // [309-312] Calcule commissions pour une transaction
  async calculateCommission(txData, pool) {
    const engine = require('../services/commission-engine');
    return engine.processTransaction(txData, pool);
  }

  // [315-316] Génère le rapport de paie quinzaine
  async generatePayoutReport(tenantId, pool, opts = {}) {
    const payouts = require('../services/staff-payouts');
    return payouts.generateBiweeklyReport(tenantId, pool, opts);
  }

  async execute(payload) {
    const { action, ...params } = payload;
    switch (action) {
      case 'sync':         return this.syncStaff(params.tenantId, params.accessToken, params.pool);
      case 'assign':       return this.assignAppointment(params);
      case 'commission':   return this.calculateCommission(params.txData, params.pool);
      case 'payout':       return this.generatePayoutReport(params.tenantId, params.pool, params.opts);
      default: throw new Error(`Action inconnue: ${action}`);
    }
  }
}

const agent = new StaffAgent();
module.exports = agent;
module.exports.StaffAgent = StaffAgent;
