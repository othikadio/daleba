'use strict';
/**
 * Commission Engine — DALEBA Metacortex Points 309-313
 * Calcule et distribue commissions + pourboires depuis tenant_ledgers.
 * [312] Base: amount_net (JAMAIS le brut TTC)
 */
const bus = require('./event-bus');

async function initSchema(pool) {
  if (!pool) return;

  // [313] Table staff_payouts
  await pool.query(`
    CREATE TABLE IF NOT EXISTS staff_payouts (
      id                SERIAL PRIMARY KEY,
      tenant_id         TEXT NOT NULL,
      employee_square_id TEXT NOT NULL,
      employee_name     TEXT,
      tx_id             TEXT,
      payout_type       TEXT NOT NULL,  -- 'service_commission' | 'product_commission' | 'tip'
      amount_net        NUMERIC(10,2),  -- base de calcul [312]
      rate_pct          NUMERIC(5,2),   -- taux appliqué
      payout_amount     NUMERIC(10,2) NOT NULL,
      currency          TEXT DEFAULT 'CAD',
      status            TEXT DEFAULT 'PENDING',  -- PENDING | PAID [313]
      period_label      TEXT,  -- ex: '2026-05 Q1'
      paid_at           TIMESTAMPTZ,
      created_at        TIMESTAMPTZ DEFAULT NOW(),
      UNIQUE(tx_id, employee_square_id, payout_type)
    )
  `).catch(() => {});
}

/**
 * [309-312] Traite une transaction et calcule commissions + tip
 *
 * @param {object} tx - Ligne de tenant_ledgers
 * @param {object} pool
 */
async function processTransaction(tx, pool) {
  await initSchema(pool);

  const {
    tenant_id, tx_id, employee_id: employeeSquareId,
    amount_net = 0, amount_tip = 0,
    item_type = 'service',  // 'service' | 'product'
  } = tx;

  if (!employeeSquareId) {
    bus.system(`[Commission] TX ${tx_id}: pas d'employé associé — skip`);
    return { skipped: true, reason: 'no employee_id' };
  }

  // Récupère les taux de commission de l'employé [311]
  let commissionRate    = 40.0; // % services par défaut
  let productCommRate   = 10.0; // % produits par défaut
  let employeeName      = '';

  try {
    const r = await pool.query(`
      SELECT commission_rate, product_commission_rate, name
      FROM staff_profiles
      WHERE tenant_id=$1 AND square_id=$2
    `, [tenant_id, employeeSquareId]);

    if (r.rows[0]) {
      commissionRate  = parseFloat(r.rows[0].commission_rate  || 40);
      productCommRate = parseFloat(r.rows[0].product_commission_rate || 10);
      employeeName    = r.rows[0].name || '';
    }
  } catch {}

  const payouts = [];

  // [311] Commission service ou produit — [312] sur amount_net UNIQUEMENT
  const netAmount  = parseFloat(amount_net) || 0;
  const rate       = item_type === 'product' ? productCommRate : commissionRate;
  const commission = parseFloat((netAmount * rate / 100).toFixed(2));

  if (commission > 0) {
    const type = item_type === 'product' ? 'product_commission' : 'service_commission';
    await pool.query(`
      INSERT INTO staff_payouts (tenant_id, employee_square_id, employee_name, tx_id, payout_type, amount_net, rate_pct, payout_amount)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
      ON CONFLICT (tx_id, employee_square_id, payout_type) DO NOTHING
    `, [tenant_id, employeeSquareId, employeeName, tx_id, type, netAmount, rate, commission]);
    payouts.push({ type, amount: commission, rate });
  }

  // [310] Pourboire → 100% à l'employé
  const tipAmount = parseFloat(amount_tip) || 0;
  if (tipAmount > 0) {
    await pool.query(`
      INSERT INTO staff_payouts (tenant_id, employee_square_id, employee_name, tx_id, payout_type, amount_net, rate_pct, payout_amount)
      VALUES ($1,$2,$3,$4,'tip',$5,100,$6)
      ON CONFLICT (tx_id, employee_square_id, payout_type) DO NOTHING
    `, [tenant_id, employeeSquareId, employeeName, tx_id, tipAmount, tipAmount]);

    // [310] Aussi insérer dans staff_tips existant
    await pool.query(`
      INSERT INTO staff_tips (tenant_id, tx_id, employee_id, tip_amount, currency, timestamp_utc)
      VALUES ($1,$2,$3,$4,'CAD',NOW())
      ON CONFLICT (tx_id, employee_id) DO NOTHING
    `, [tenant_id, tx_id, employeeSquareId, tipAmount]).catch(() => {});

    payouts.push({ type: 'tip', amount: tipAmount, rate: 100 });
  }

  const total = payouts.reduce((s, p) => s + p.amount, 0);
  bus.system(`[Commission] TX ${tx_id} → ${employeeName}: ${payouts.map(p=>`${p.type}=${p.amount}CAD`).join(', ')}`);

  return { tx_id, employeeSquareId, employeeName, payouts, total };
}

/**
 * Marque des payouts comme PAID
 */
async function markAsPaid(pool, tenantId, employeeSquareId, periodLabel) {
  const r = await pool.query(`
    UPDATE staff_payouts SET status='PAID', paid_at=NOW()
    WHERE tenant_id=$1 AND employee_square_id=$2 AND status='PENDING'
      ${periodLabel ? "AND period_label=$3" : ''}
    RETURNING id
  `, periodLabel ? [tenantId, employeeSquareId, periodLabel] : [tenantId, employeeSquareId]);
  return r.rowCount;
}

module.exports = { initSchema, processTransaction, markAsPaid };
