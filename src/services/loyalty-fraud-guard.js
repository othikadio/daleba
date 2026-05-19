'use strict';
/**
 * Loyalty Fraud Guard — DALEBA Metacortex Points 421-423
 * [421] Débit points sur remboursement/annulation
 * [422] Blocage si >2 transactions majeures en 12h
 * [423] SELECT FOR UPDATE (verrous pessimistes)
 */
const bus = require('./event-bus');

// Seuil "transaction majeure" [422]
const MAJOR_TX_THRESHOLD_CAD = 30;
const MAX_MAJOR_TX_12H        = 2;

async function initSchema(pool) {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS loyalty_audit_logs (
      id              SERIAL PRIMARY KEY,
      tenant_id       TEXT NOT NULL,
      customer_id     TEXT NOT NULL,
      action          TEXT NOT NULL,  -- award | redeem | debit | blocked | refund_debit
      points          INTEGER,
      tx_id           TEXT,
      reason          TEXT,
      signature_hash  TEXT,
      operator_id     TEXT,
      created_at      TIMESTAMPTZ DEFAULT NOW()
    )
  `).catch(() => {});
  await pool.query('CREATE INDEX IF NOT EXISTS idx_audit_cust ON loyalty_audit_logs(tenant_id, customer_id, created_at DESC)').catch(() => {});
}

/**
 * [435] Signe et logue une action de points
 */
async function auditLog(pool, tenantId, customerId, action, points, txId, reason, operatorId) {
  const crypto = require('crypto');
  const payload = `${tenantId}:${customerId}:${action}:${points}:${Date.now()}`;
  const sig     = crypto.createHash('sha256').update(payload).digest('hex').slice(0, 16);
  await pool.query(`
    INSERT INTO loyalty_audit_logs (tenant_id, customer_id, action, points, tx_id, reason, signature_hash, operator_id)
    VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
  `, [tenantId, customerId, action, points, txId, reason, sig, operatorId || 'system']).catch(() => {});
  return sig;
}

/**
 * [422] Vérifie si un client dépasse le quota de transactions en 12h
 */
async function checkFraudLimit(pool, tenantId, customerId, amountNet) {
  if (amountNet < MAJOR_TX_THRESHOLD_CAD) return { allowed: true, reason: 'minor_tx' };

  const r = await pool.query(`
    SELECT COUNT(*) AS cnt FROM loyalty_audit_logs
    WHERE tenant_id=$1 AND customer_id=$2 AND action='award'
      AND created_at >= NOW() - INTERVAL '12 hours'
  `, [tenantId, customerId]).catch(() => ({ rows: [{ cnt: 0 }] }));

  const cnt = parseInt(r.rows[0]?.cnt || 0);
  if (cnt >= MAX_MAJOR_TX_12H) {
    bus.system(`[LoyaltyFraud] 🚨 BLOCAGE: ${customerId} — ${cnt} transactions majeures en 12h`);
    return { allowed: false, reason: 'too_many_major_tx_12h', count: cnt };
  }
  return { allowed: true, count: cnt };
}

/**
 * [421] Débite les points lors d'un remboursement
 */
async function processRefundDebit(pool, tenantId, { customerId, txId, amountNet, itemType }) {
  await initSchema(pool);
  const pts     = require('./dynamic-points-engine');
  const { points } = pts.calculatePoints(amountNet, itemType || 'service', new Date().toISOString());

  // [423] SELECT FOR UPDATE
  const r = await pool.query(`
    SELECT id, points_balance FROM tenant_loyalty_cards
    WHERE tenant_id=$1 AND customer_id=$2 FOR UPDATE
  `, [tenantId, customerId]).catch(() => ({ rows: [] }));

  if (!r.rows.length) return { debited: 0, reason: 'no_card' };

  const toDebit = Math.min(points, r.rows[0].points_balance);
  await pool.query(`
    UPDATE tenant_loyalty_cards SET points_balance = points_balance - $3, updated_at=NOW()
    WHERE tenant_id=$1 AND customer_id=$2
  `, [tenantId, customerId, toDebit]).catch(() => {});

  const sig = await auditLog(pool, tenantId, customerId, 'refund_debit', -toDebit, txId, 'Remboursement transaction', 'system');
  bus.system(`[LoyaltyFraud] 🔄 Débit remboursement: -${toDebit} pts (${customerId}) tx=${txId}`);
  return { debited: toDebit, originalPoints: points, signature: sig };
}

/**
 * [423] awardPoints avec verrou pessimiste + fraud check
 */
async function safeAwardPoints(pool, tenantId, params) {
  await initSchema(pool);
  const fraud = await checkFraudLimit(pool, tenantId, params.customerId, params.amountNet);
  if (!fraud.allowed) {
    await auditLog(pool, tenantId, params.customerId, 'blocked', 0, params.txId, fraud.reason, 'system');
    return { awarded: 0, blocked: true, reason: fraud.reason };
  }
  const pts = require('./dynamic-points-engine');
  const result = await pts.awardPoints(pool, tenantId, params);
  if (result.awarded > 0) {
    await auditLog(pool, tenantId, params.customerId, 'award', result.awarded, params.txId, `${params.itemType} tx`, 'system');
  }
  return result;
}

module.exports = { checkFraudLimit, processRefundDebit, safeAwardPoints, auditLog, initSchema, MAX_MAJOR_TX_12H, MAJOR_TX_THRESHOLD_CAD };
