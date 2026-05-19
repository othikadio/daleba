'use strict';
/**
 * Financial Statements — DALEBA [555]
 * Bilan comptable + Compte de résultats (P&L)
 * Inclut la Loyalty Points Liability [555]
 */
const bus = require('./event-bus');
const { GST_RATE, QST_RATE } = require('./tax-formulator');
const POINT_VALUE_CAD = 0.01; // [430] 100pts = 1$

async function generateBalanceSheet(pool, tenantId) {
  // Actifs
  const revenueR = await pool.query(`SELECT COALESCE(SUM(amount_net),0) AS total FROM tenant_ledgers WHERE tenant_id=$1 AND created_at >= NOW()-INTERVAL '12 months'`, [tenantId]).catch(() => ({rows:[{total:0}]}));
  const cashBalance = parseFloat(revenueR.rows[0].total || 0) * 0.15; // 15% en trésorerie estimé

  const equipR = await pool.query(`SELECT COALESCE(SUM(amount),0) AS total FROM tenant_expenses WHERE tenant_id=$1 AND category='equipment'`, [tenantId]).catch(() => ({rows:[{total:0}]}));
  const equipment = parseFloat((equipR.rows[0] || {}).total || 0);

  // Passifs — Points Loyalty [555]
  const loyaltyR = await pool.query(`SELECT COALESCE(SUM(points_balance),0) AS total_points FROM tenant_loyalty_cards WHERE tenant_id=$1`, [tenantId]).catch(() => ({rows:[{total_points:0}]}));
  const totalPoints = parseInt(loyaltyR.rows[0].total_points || 0);
  const loyaltyLiability = Math.round(totalPoints * POINT_VALUE_CAD * 100) / 100;

  // Passifs — taxes dues
  const taxR = await pool.query(`SELECT COALESCE(SUM(amount_net*${GST_RATE+QST_RATE}),0) AS taxes FROM tenant_ledgers WHERE tenant_id=$1 AND created_at >= NOW()-INTERVAL '3 months'`, [tenantId]).catch(() => ({rows:[{taxes:0}]}));
  const taxesDue = Math.round(parseFloat((taxR.rows[0] || {}).taxes || 0) * 100) / 100;

  const totalAssets      = Math.round((cashBalance + equipment) * 100) / 100;
  const totalLiabilities = Math.round((loyaltyLiability + taxesDue) * 100) / 100;
  const netBookValue     = Math.round((totalAssets - totalLiabilities) * 100) / 100;

  bus.system(`[Financials] 📊 Bilan: actifs=${totalAssets}$ | passifs=${totalLiabilities}$ (dont loyalty=${loyaltyLiability}$)`);
  return {
    tenantId,
    asOf: new Date().toISOString(),
    assets: { cash: cashBalance, equipment, total: totalAssets },
    liabilities: {
      loyalty_points_latent_liability: loyaltyLiability,
      taxes_due:                        taxesDue,
      total:                            totalLiabilities,
    },
    netBookValue,
    note: `Passif fidélité: ${totalPoints.toLocaleString('fr-CA')} pts × ${POINT_VALUE_CAD}$ = ${loyaltyLiability}$`,
  };
}

async function generateIncomeStatement(pool, tenantId, { periodMonths = 12 } = {}) {
  const r = await pool.query(`
    SELECT COALESCE(SUM(amount_net),0) AS revenue FROM tenant_ledgers
    WHERE tenant_id=$1 AND created_at >= NOW()-($2 || ' months')::INTERVAL
  `, [tenantId, periodMonths]).catch(() => ({rows:[{revenue:0}]}));
  const totalRevenue = parseFloat(r.rows[0].revenue || 0);

  const expR = await pool.query(`
    SELECT category, COALESCE(SUM(amount),0) AS total FROM tenant_expenses
    WHERE tenant_id=$1 AND created_at >= NOW()-($2 || ' months')::INTERVAL GROUP BY category
  `, [tenantId, periodMonths]).catch(() => ({rows:[]}));

  const expenses = {};
  for (const row of expR.rows) expenses[row.category] = parseFloat(row.total || 0);
  const totalExpenses = Object.values(expenses).reduce((s,v) => s+v, 0);
  const netIncome = Math.round((totalRevenue - totalExpenses) * 100) / 100;

  bus.system(`[Financials] 📈 P&L ${periodMonths}m: revenus=${totalRevenue}$ | charges=${totalExpenses}$ | résultat=${netIncome}$`);
  return { tenantId, periodMonths, revenue: { total: totalRevenue }, expenses, totalExpenses: Math.round(totalExpenses*100)/100, netIncome, marginPct: totalRevenue > 0 ? Math.round(netIncome/totalRevenue*10000)/100 : 0 };
}

module.exports = { generateBalanceSheet, generateIncomeStatement };
