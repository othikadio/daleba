'use strict';
/**
 * SaaS Billing Tracker — DALEBA Metacortex Point 275
 * Abonnement fixe + micro-commission volume Square.
 */
const bus = require('./event-bus');
const PLANS = {
  starter:    { name: 'Starter',    monthlyFeeCAD: 49,  squareCommissionPct: 0.5  },
  pro:        { name: 'Pro',        monthlyFeeCAD: 99,  squareCommissionPct: 0.35 },
  enterprise: { name: 'Enterprise', monthlyFeeCAD: 199, squareCommissionPct: 0.20 },
};
async function initSchema(pool) {
  if (!pool) return;
  await pool.query(`CREATE TABLE IF NOT EXISTS saas_billing (id SERIAL PRIMARY KEY, tenant_id TEXT NOT NULL, period_start DATE NOT NULL, period_end DATE NOT NULL, plan TEXT DEFAULT 'starter', base_fee NUMERIC(10,2), square_volume NUMERIC(12,2) DEFAULT 0, commission NUMERIC(10,2) DEFAULT 0, total_due NUMERIC(10,2), currency TEXT DEFAULT 'CAD', status TEXT DEFAULT 'pending', created_at TIMESTAMPTZ DEFAULT NOW(), UNIQUE(tenant_id, period_start))`).catch(()=>{});
}
function calculateBill(squareVolumeCAD, plan = 'starter') {
  const p = PLANS[plan] || PLANS.starter;
  const commission = parseFloat((squareVolumeCAD * p.squareCommissionPct / 100).toFixed(2));
  const total = parseFloat((p.monthlyFeeCAD + commission).toFixed(2));
  return { plan: p.name, baseFee: p.monthlyFeeCAD, squareVolume: squareVolumeCAD, commissionRate: p.squareCommissionPct, commission, total, currency: 'CAD' };
}
async function generateMonthlyBill(pool, tenantId, squareVolumeCAD = 0, plan = 'starter') {
  await initSchema(pool);
  const bill = calculateBill(squareVolumeCAD, plan);
  const now = new Date();
  const start = new Date(now.getFullYear(), now.getMonth(), 1).toISOString().split('T')[0];
  const end   = new Date(now.getFullYear(), now.getMonth()+1, 0).toISOString().split('T')[0];
  try {
    const r = await pool.query(`INSERT INTO saas_billing (tenant_id,period_start,period_end,plan,base_fee,square_volume,commission,total_due) VALUES ($1,$2,$3,$4,$5,$6,$7,$8) ON CONFLICT (tenant_id,period_start) DO UPDATE SET square_volume=$6,commission=$7,total_due=$8 RETURNING *`, [tenantId,start,end,plan,bill.baseFee,bill.squareVolume,bill.commission,bill.total]);
    return r.rows[0];
  } catch(err) { return { ...bill, tenantId, period_start: start }; }
}
async function getTenantBilling(pool, tenantId) {
  if (!pool) return [];
  const r = await pool.query(`SELECT * FROM saas_billing WHERE tenant_id=$1 ORDER BY period_start DESC LIMIT 12`, [tenantId]).catch(()=>({rows:[]}));
  return r.rows;
}
async function getPlatformRevenue(pool) {
  if (!pool) return { total: 0, byPlan: {} };
  try {
    const r = await pool.query(`SELECT plan, COUNT(*) as count, SUM(total_due) as revenue FROM saas_billing GROUP BY plan`);
    const byPlan = {}; let total = 0;
    for (const row of r.rows) { byPlan[row.plan] = { count: row.count, revenue: parseFloat(row.revenue||0) }; total += parseFloat(row.revenue||0); }
    return { total, byPlan };
  } catch { return { total: 0, byPlan: {} }; }
}
module.exports = { PLANS, calculateBill, generateMonthlyBill, getTenantBilling, getPlatformRevenue };
