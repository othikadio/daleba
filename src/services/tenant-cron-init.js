'use strict';
/**
 * Tenant Cron Initializer — DALEBA Metacortex Point 268
 * Initialise les crons financiers et marketing par tenant, indexés sur le fuseau horaire local.
 */

const bus = require('./event-bus');

// ─── SCHEMA ───────────────────────────────────────────────────────────────────

const CREATE_TABLE_SQL = `
  CREATE TABLE IF NOT EXISTS tenant_cron_registry (
    id         SERIAL PRIMARY KEY,
    tenant_id  TEXT NOT NULL,
    cron_name  TEXT NOT NULL,
    schedule   TEXT NOT NULL,
    timezone   TEXT NOT NULL DEFAULT 'America/Toronto',
    enabled    BOOL NOT NULL DEFAULT true,
    last_run   TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE(tenant_id, cron_name)
  )
`;

// ─── CRONS STANDARDS ──────────────────────────────────────────────────────────

const DEFAULT_CRONS = [
  { cron_name: 'marketing_weekly',  schedule: '0 9 * * 1' },  // lundi 9h
  { cron_name: 'financial_daily',   schedule: '0 23 * * *' }, // 23h tous les jours
  { cron_name: 'loyalty_weekly',    schedule: '0 10 * * 3' }, // mercredi 10h
  { cron_name: 'content_daily',     schedule: '0 8 * * *' },  // 8h tous les jours
];

// ─── FONCTIONS ────────────────────────────────────────────────────────────────

/**
 * Initialise les crons standards pour un tenant.
 * @param {string} tenantId
 * @param {string} [timezone]
 * @param {object|null} [pool]
 * @returns {Promise<{ tenantId, timezone, crons: Array }>}
 */
async function initTenantCrons(tenantId, timezone = 'America/Toronto', pool = null) {
  if (!tenantId || typeof tenantId !== 'string' || tenantId.trim() === '') {
    throw new Error('[CronInit] tenantId invalide');
  }

  const registeredCrons = [];

  if (pool) {
    try {
      // S'assurer que la table existe
      await pool.query(CREATE_TABLE_SQL);

      for (const cron of DEFAULT_CRONS) {
        await pool.query(
          `INSERT INTO tenant_cron_registry (tenant_id, cron_name, schedule, timezone, enabled, created_at)
           VALUES ($1, $2, $3, $4, true, NOW())
           ON CONFLICT (tenant_id, cron_name) DO UPDATE
             SET schedule = EXCLUDED.schedule,
                 timezone = EXCLUDED.timezone,
                 enabled  = true`,
          [tenantId, cron.cron_name, cron.schedule, timezone]
        );
        registeredCrons.push({ ...cron, timezone, enabled: true });
      }
    } catch (err) {
      bus.emit('error', `[CronInit] Erreur DB: ${err.message}`, { tenantId });
      // Fallback: retourner la liste sans persistence
      for (const cron of DEFAULT_CRONS) {
        registeredCrons.push({ ...cron, timezone, enabled: true });
      }
    }
  } else {
    // Mode sans DB — on retourne la liste logique seulement
    for (const cron of DEFAULT_CRONS) {
      registeredCrons.push({ ...cron, timezone, enabled: true });
    }
  }

  bus.emit('system', `[CronInit] ✅ 4 crons enregistrés pour ${tenantId} (TZ: ${timezone})`);

  return { tenantId, timezone, crons: registeredCrons };
}

/**
 * Retourne tous les crons actifs d'un tenant.
 * @param {string} tenantId
 * @param {object} pool
 */
async function getTenantCrons(tenantId, pool) {
  if (!pool) return [];
  const result = await pool.query(
    `SELECT * FROM tenant_cron_registry WHERE tenant_id = $1 AND enabled = true ORDER BY id`,
    [tenantId]
  );
  return result.rows;
}

/**
 * Désactive tous les crons d'un tenant.
 * @param {string} tenantId
 * @param {object} pool
 */
async function disableTenantCrons(tenantId, pool) {
  if (!pool) return;
  await pool.query(
    `UPDATE tenant_cron_registry SET enabled = false WHERE tenant_id = $1`,
    [tenantId]
  );
  bus.emit('system', `[CronInit] Crons désactivés pour ${tenantId}`);
}

// ─── EXPORTS ──────────────────────────────────────────────────────────────────

module.exports = { initTenantCrons, getTenantCrons, disableTenantCrons };
