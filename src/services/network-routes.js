'use strict';
/**
 * Network Routes — DALEBA Metacortex Point 291
 * Table de routage réseau dynamique: lie les appels entrants aux instances métier.
 * Lookup O(1) en mémoire + persistance PostgreSQL.
 */
const bus = require('./event-bus');

// Cache mémoire: phoneNumber → { tenantId, accountSid, webhookBase, updatedAt }
const _routes = new Map();

async function initSchema(pool) {
  if (!pool) return;
  await pool.query(`
    CREATE TABLE IF NOT EXISTS network_routes (
      id            SERIAL PRIMARY KEY,
      phone_number  TEXT NOT NULL UNIQUE,
      tenant_id     TEXT NOT NULL,
      account_sid   TEXT,
      webhook_base  TEXT,
      active        BOOL DEFAULT true,
      priority      INT  DEFAULT 10,
      created_at    TIMESTAMPTZ DEFAULT NOW(),
      updated_at    TIMESTAMPTZ DEFAULT NOW()
    )
  `);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_network_routes_phone ON network_routes(phone_number) WHERE active=true`);
}

async function loadRoutes(pool) {
  if (!pool) return;
  const r = await pool.query(`SELECT * FROM network_routes WHERE active=true`);
  for (const row of r.rows) {
    _routes.set(row.phone_number, {
      tenantId:    row.tenant_id,
      accountSid:  row.account_sid,
      webhookBase: row.webhook_base,
      updatedAt:   row.updated_at,
    });
  }
  bus.system(`[NetworkRoutes] ${_routes.size} routes chargées en mémoire`);
}

async function registerRoute(pool, { phoneNumber, tenantId, accountSid, webhookBase }) {
  const base = webhookBase || process.env.DALEBA_BASE_URL || 'https://daleba-api-production.up.railway.app';
  // Mémoire d'abord (O(1))
  _routes.set(phoneNumber, { tenantId, accountSid, webhookBase: base, updatedAt: new Date() });
  // Persistance async
  if (pool) {
    await pool.query(`
      INSERT INTO network_routes (phone_number, tenant_id, account_sid, webhook_base)
      VALUES ($1,$2,$3,$4)
      ON CONFLICT (phone_number) DO UPDATE SET tenant_id=$2, account_sid=$3, webhook_base=$4, updated_at=NOW()
    `, [phoneNumber, tenantId, accountSid || null, base]);
  }
  bus.system(`[NetworkRoutes] Route enregistrée: ${phoneNumber} → ${tenantId}`);
}

function resolve(phoneNumber) {
  return _routes.get(phoneNumber) || null;
}

async function deactivateRoute(pool, phoneNumber) {
  _routes.delete(phoneNumber);
  if (pool) await pool.query(`UPDATE network_routes SET active=false WHERE phone_number=$1`, [phoneNumber]);
}

module.exports = { initSchema, loadRoutes, registerRoute, resolve, deactivateRoute };
