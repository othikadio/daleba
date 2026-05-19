'use strict';
/**
 * Tenant Metrics — DALEBA Metacortex Point 274
 * Volume transactions, appels, coût infra par tenant en temps réel.
 */
const bus = require('./event-bus');
async function getTenantMetrics(pool, tenantId) {
  if (!pool) return { tenantId, error: 'No pool' };
  const m = { tenantId };
  const tx = await pool.query(`SELECT COUNT(*) as count, COALESCE(SUM(amount_gross),0) as volume FROM tenant_ledgers WHERE tenant_id=$1 AND created_at > DATE_TRUNC('month', NOW())`, [tenantId]).catch(()=>({rows:[{count:0,volume:0}]}));
  m.transactions = { count: parseInt(tx.rows[0]?.count||0), volumeCAD: parseFloat(tx.rows[0]?.volume||0) };
  const calls = await pool.query(`SELECT COUNT(*) as count, COALESCE(SUM(duration_seconds),0) as dur FROM tenant_call_logs WHERE tenant_id=$1 AND created_at > DATE_TRUNC('month', NOW())`, [tenantId]).catch(()=>({rows:[{count:0,dur:0}]}));
  m.calls = { count: parseInt(calls.rows[0]?.count||0), totalDurationSec: parseInt(calls.rows[0]?.dur||0) };
  m.infraCostCAD = parseFloat((Math.ceil(m.calls.totalDurationSec/60)*0.013).toFixed(4));
  m.updatedAt = new Date().toISOString();
  return m;
}
async function getAllTenantsMetrics(pool) {
  if (!pool) return [];
  const r = await pool.query(`SELECT tenant_id, tenant_name, status, country, created_at FROM tenant_settings ORDER BY created_at DESC`).catch(()=>({rows:[]}));
  const results = [];
  for (const t of r.rows) { const m = await getTenantMetrics(pool, t.tenant_id); results.push({ ...t, metrics: m }); }
  return results;
}
module.exports = { getTenantMetrics, getAllTenantsMetrics };
