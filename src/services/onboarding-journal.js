'use strict';
/**
 * Onboarding Journal — DALEBA Metacortex Point 279
 * Journal global des onboardings réussis.
 */
const bus = require('./event-bus');

async function initSchema(pool) {
  if (!pool) return;
  await pool.query(`
    CREATE TABLE IF NOT EXISTS onboarding_journal (
      id          SERIAL PRIMARY KEY,
      tenant_id   TEXT NOT NULL,
      tenant_name TEXT,
      country     TEXT,
      status      TEXT DEFAULT 'SUCCESS',
      steps_json  JSONB,
      operator_id TEXT DEFAULT 'system',
      created_at  TIMESTAMPTZ DEFAULT NOW()
    )
  `);
}

async function record(pool, { tenantId, tenantName, country, status = 'SUCCESS', steps = [], operatorId = 'system' }) {
  try {
    if (!pool) { bus.system(`[Journal] ${status}: ${tenantId} — ${tenantName}`); return; }
    await initSchema(pool);
    await pool.query(`
      INSERT INTO onboarding_journal (tenant_id, tenant_name, country, status, steps_json, operator_id)
      VALUES ($1,$2,$3,$4,$5,$6)
    `, [tenantId, tenantName, country, status, JSON.stringify(steps), operatorId]);
    bus.system(`[Journal] ✅ Inscrit: ${tenantId} | ${status}`);
  } catch (err) {
    bus.system(`[Journal] Erreur écriture: ${err.message}`);
  }
}

async function getRecentOnboardings(pool, limit = 20) {
  if (!pool) return [];
  try {
    const r = await pool.query(`SELECT * FROM onboarding_journal ORDER BY created_at DESC LIMIT $1`, [limit]);
    return r.rows;
  } catch { return []; }
}

async function countToday(pool) {
  if (!pool) return 0;
  try {
    const r = await pool.query(`SELECT COUNT(*) FROM onboarding_journal WHERE DATE(created_at) = CURRENT_DATE AND status='SUCCESS'`);
    return parseInt(r.rows[0]?.count || 0);
  } catch { return 0; }
}

module.exports = { initSchema, record, getRecentOnboardings, countToday };
