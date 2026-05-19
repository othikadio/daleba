/**
 * AnalystAgent — DALEBA Metacortex Point 151
 *
 * Hérite de BaseAgent.js.
 * Périmètre restreint : comptabilité, calculs fiscaux, lecture transactions.
 * Accès interdit : écriture Square/Stripe, envoi SMS/email, publication sociale.
 */

'use strict';

const { BaseAgent } = require('./base-agent');

class AnalystAgent extends BaseAgent {
  constructor(id, options = {}) {
    super(id || `analyst_${Date.now()}`, {
      ...options,
      // [151] Scope restreint aux opérations comptables/fiscales [147 pattern]
      scope: [
        'read:transactions',
        'read:ledger',
        'read:catalog_prices',
        'write:daleba_notes',
        'write:tenant_ledgers',
        'write:staff_tips',
        'write:cashflow_forecast',
        'read:square_payments',
        'read:stripe_charges',
        'compute:fiscal',
        'compute:forecast',
        'emit:predictive_alert',
      ],
      // AnalystAgent ne touche pas aux APIs sociales/SMS
      forbiddenActions: [
        'send_sms', 'send_whatsapp', 'post_instagram',
        'post_tiktok', 'charge_payment', 'refund',
        'delete_transaction', 'modify_catalog',
      ],
    });

    this.type     = 'AnalystAgent';
    this.province = options.province || 'QC';
    this.tenantId = options.tenantId || 'kadio';
  }

  // ─── EXECUTE [151] ──────────────────────────────────────────────────────────

  async execute(action, params = {}) {
    this._validateScope(action);

    switch (action) {

      // [152-163] Ingestion d'une transaction unique
      case 'ingest_transaction': {
        const ingester = require('../services/transaction-ingester');
        const { source, rawTx } = params;
        if (!source || !rawTx) throw new Error('ingest_transaction: source + rawTx requis');
        return ingester.ingestTransaction(source, rawTx, {
          tenantId: params.tenantId || this.tenantId,
          province: params.province || this.province,
        });
      }

      // [152-163] Ingestion en lot
      case 'ingest_batch': {
        const ingester = require('../services/transaction-ingester');
        return ingester.ingestBatch(params.source, params.transactions, {
          tenantId: params.tenantId || this.tenantId,
          province: params.province || this.province,
        });
      }

      // [155-159] Calcul fiscal isolé
      case 'compute_fiscal': {
        const fiscal = require('../services/fiscal-engine');
        const { amount, province, mode = 'gross' } = params;
        const fn = mode === 'net' ? fiscal.decomposeFromNet : fiscal.decomposeFromGross;
        const result = fn(amount, province || this.province);
        return {
          ...result,
          formatted: fiscal.formatFiscalBreakdown(result),
        };
      }

      // [164-166] Prévision de trésorerie
      case 'run_cashflow_forecast': {
        const cashflow = require('../services/cashflow-engine');
        return cashflow.runCashflowForecast(
          params.tenantId || this.tenantId,
          params.province || this.province,
        );
      }

      // Rapport d'infrastructure
      case 'get_cost_report': {
        const tracker = require('../services/infrastructure-cost-tracker');
        return tracker.getCostReport();
      }

      // Lecture ledger
      case 'get_ledger_summary': {
        const maintenance = require('../services/maintenance');
        const pool = maintenance.getPool();
        if (!pool) return { error: 'DB non disponible' };
        const r = await pool.query(`
          SELECT
            sale_type,
            SUM(amount_net)   AS total_net,
            SUM(amount_tps)   AS total_tps,
            SUM(amount_tvq)   AS total_tvq,
            SUM(amount_gross) AS total_gross,
            SUM(amount_tip)   AS total_tips,
            COUNT(*)          AS tx_count,
            MIN(timestamp_utc) AS first_tx,
            MAX(timestamp_utc) AS last_tx
          FROM tenant_ledgers
          WHERE tenant_id = $1
            ${params.since ? "AND timestamp_utc >= $2" : ''}
          GROUP BY sale_type
        `, params.since ? [this.tenantId, params.since] : [this.tenantId]);
        return { rows: r.rows, tenant: this.tenantId };
      }

      // Rapport tips par employé [163]
      case 'get_staff_tips_report': {
        const maintenance = require('../services/maintenance');
        const pool = maintenance.getPool();
        if (!pool) return { error: 'DB non disponible' };
        const r = await pool.query(`
          SELECT employee_id, SUM(tip_amount) AS total_tips, COUNT(*) AS tip_count
          FROM staff_tips
          WHERE tenant_id = $1
          GROUP BY employee_id ORDER BY total_tips DESC
        `, [this.tenantId]);
        return { rows: r.rows };
      }

      // Transactions FLAGGED [161-162]
      case 'get_audit_flags': {
        const maintenance = require('../services/maintenance');
        const pool = maintenance.getPool();
        if (!pool) return { error: 'DB non disponible' };
        const r = await pool.query(`
          SELECT tx_id, amount_gross, amount_net, catalog_id,
                 audit_delta, audit_reason, timestamp_utc
          FROM tenant_ledgers
          WHERE tenant_id = $1 AND audit_status = 'flagged'
          ORDER BY timestamp_utc DESC LIMIT 50
        `, [this.tenantId]);
        return { flagged: r.rows, count: r.rows.length };
      }

      default:
        throw new Error(`AnalystAgent: action inconnue — "${action}"`);
    }
  }

  // [151] Validation scope strict
  _validateScope(action) {
    const forbidden = this.options?.forbiddenActions || [];
    if (forbidden.includes(action)) {
      throw new Error(`[AnalystAgent] Action interdite hors périmètre: "${action}"`);
    }
  }
}

module.exports = AnalystAgent;
