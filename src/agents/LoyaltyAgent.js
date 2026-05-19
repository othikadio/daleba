'use strict';
/**
 * LoyaltyAgent — DALEBA Metacortex Points 401-418
 * @module LoyaltyAgent
 *
 * @description
 * Agent spécialisé fidélité, réputation Google et parrainage viral.
 * Périmètre STRICT [401]:
 *   - Gestion points de fidélité (gain, dépense, paliers)
 *   - Génération liens d'avis Google (review guard)
 *   - Suivi parrainage (parrain/filleul, fraude)
 *
 * Hors périmètre (throw si tentative):
 *   - Accès staff_payouts, tenant_appointments directs
 *   - Modification de prix catalog Square
 */
const { BaseAgent } = require('./base-agent');
const bus       = require('../services/event-bus');

const ALLOWED_ACTIONS = new Set([
  'award_points', 'redeem_points', 'get_balance', 'check_tier',
  'send_review_request', 'process_feedback', 'create_referral',
  'validate_referral', 'apply_referral_discount', 'run_happy_hour',
  'list_top_referrers', 'send_tier_notification',
]);

class LoyaltyAgent extends BaseAgent {
  /**
   * @param {object} [config]
   */
  constructor(config = {}) {
    super({
      type:         'LOYALTY',
      name:         'LoyaltyAgent',
      scope:        ['loyalty:read', 'loyalty:write', 'review:send', 'referral:manage'],
      capabilities: [...ALLOWED_ACTIONS],
      config: {
        maxRetries: 3,
        timeoutMs:  30_000,
        budgetUSD:  0.10,
        ...config,
      },
    });
  }

  /** @param {string} action @throws si hors périmètre */
  _assertScope(action) {
    if (!ALLOWED_ACTIONS.has(action))
      throw new Error(`[LoyaltyAgent] Action hors périmètre: "${action}"`);
  }

  /** @param {object} payload */
  async execute(payload = {}) {
    const { action, tenantId, ...params } = payload;
    this._assertScope(action);
    this.log(`LoyaltyAgent.execute(${action}) tenant=${tenantId}`);

    const pts     = require('../services/dynamic-points-engine');
    const guard   = require('../services/google-review-guard');
    const referral= require('../services/viral-referral-engine');

    switch (action) {
      case 'award_points':             return pts.awardPoints(params.pool, tenantId, params);
      case 'redeem_points':            return pts.redeemPoints(params.pool, tenantId, params);
      case 'get_balance':              return pts.getBalance(params.pool, tenantId, params.customerId);
      case 'check_tier':               return pts.checkTier(params.pool, tenantId, params.customerId);
      case 'send_review_request':      return guard.sendReviewRequest(params.pool, tenantId, params);
      case 'process_feedback':         return guard.processFeedback(params.pool, tenantId, params);
      case 'create_referral':          return referral.createReferralCode(params.pool, tenantId, params);
      case 'validate_referral':        return referral.validateAndApply(params.pool, tenantId, params);
      case 'apply_referral_discount':  return referral.applyDiscount(params.pool, tenantId, params);
      case 'run_happy_hour':           return pts.applyHappyHourMultiplier(params.pool, tenantId, params);
      case 'list_top_referrers':       return referral.listTopReferrers(params.pool, tenantId, params.limit);
      case 'send_tier_notification':   return pts.notifyTierReached(params.pool, tenantId, params);
      default: throw new Error(`Action non gérée: ${action}`);
    }
  }
}

module.exports = { LoyaltyAgent };
