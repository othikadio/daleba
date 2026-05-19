'use strict';
/**
 * Onboarding Cleanup — DALEBA Metacortex Point 283
 * Purge les onboardings abandonnés après 48h d'inactivité.
 */
const bus = require('./event-bus');

async function purgeAbandoned(pool) {
  if (!pool) return { purged: 0 };
  try {
    const r = await pool.query(`
      DELETE FROM tenant_settings
      WHERE status = 'onboarding'
      AND created_at < NOW() - INTERVAL '48 hours'
      RETURNING tenant_id, tenant_name
    `);
    const purged = r.rows.length;
    if (purged > 0) {
      bus.system(`[Cleanup] 🗑️ ${purged} onboarding(s) abandonné(s) purgé(s)`);
      // Purger aussi les tables liées
      for (const row of r.rows) {
        await pool.query(`DELETE FROM tenant_credentials WHERE tenant_id=$1`, [row.tenant_id]).catch(()=>{});
        await pool.query(`DELETE FROM tenant_cron_registry WHERE tenant_id=$1`, [row.tenant_id]).catch(()=>{});
        await pool.query(`DELETE FROM tenant_env_vars WHERE tenant_id=$1`, [row.tenant_id]).catch(()=>{});
      }
    }
    return { purged, details: r.rows };
  } catch (err) {
    bus.system(`[Cleanup] Erreur purge: ${err.message}`);
    return { purged: 0, error: err.message };
  }
}

// À appeler via cron toutes les 6h
async function runCleanup(pool) {
  const result = await purgeAbandoned(pool);
  return result;
}

module.exports = { purgeAbandoned, runCleanup };
