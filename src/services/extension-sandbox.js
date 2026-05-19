'use strict';
/**
 * Extension Sandbox — DALEBA Metacortex Points 352-353
 * [352] Point de montage pour applications esthétiques externes
 * [353] Isolation stricte: l'extension ne peut pas toucher les tables core
 */
const bus = require('./event-bus');
const crypto = require('crypto');

const _mounted = new Map(); // tenantId:extensionKey → config

async function initSchema(pool) {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS tenant_extensions (
      id              SERIAL PRIMARY KEY,
      tenant_id       TEXT NOT NULL,
      extension_key   TEXT NOT NULL,
      extension_name  TEXT,
      config          JSONB,
      allowed_tables  TEXT[],  -- tables auxquelles l'extension peut accéder
      status          TEXT DEFAULT 'active',
      mounted_at      TIMESTAMPTZ DEFAULT NOW(),
      UNIQUE(tenant_id, extension_key)
    )
  `).catch(() => {});
}

/**
 * [352] Monte une extension externe
 * [353] Vérifie la clé et applique le sandbox
 */
async function mount(pool, tenantId, extensionKey, config = {}) {
  await initSchema(pool);

  // Valider la clé extension (format: ext_<32hex>)
  if (!extensionKey?.match(/^ext_[a-f0-9]{32}$/)) {
    throw new Error('Clé extension invalide. Format requis: ext_<32 hex chars>');
  }

  // [353] Tables autorisées pour l'extension (uniquement esthétique)
  const ALLOWED_TABLES = [
    'tenant_aesthetic_records',
    'aesthetic_product_formulations',
    'aesthetic_prescriptions',
  ];

  const r = await pool.query(`
    INSERT INTO tenant_extensions (tenant_id, extension_key, extension_name, config, allowed_tables)
    VALUES ($1,$2,$3,$4,$5)
    ON CONFLICT (tenant_id, extension_key) DO UPDATE
      SET config=$4, status='active', mounted_at=NOW()
    RETURNING *
  `, [tenantId, extensionKey, config.name || 'Extension Esthétique', JSON.stringify(config), ALLOWED_TABLES]);

  const mountKey = `${tenantId}:${extensionKey}`;
  _mounted.set(mountKey, { ...r.rows[0], allowedTables: ALLOWED_TABLES });

  bus.system(`[ExtensionSandbox] ✅ Extension montée: ${config.name || extensionKey} pour ${tenantId}`);
  return { mounted: true, extensionKey, allowedTables: ALLOWED_TABLES, tenantId };
}

/**
 * [353] Vérifie qu'une table est accessible depuis l'extension
 */
function assertExtensionAccess(extensionKey, tableName) {
  const entry = [..._mounted.values()].find(e => e.extension_key === extensionKey);
  if (!entry) throw new Error(`Extension non montée: ${extensionKey}`);
  if (!entry.allowedTables?.includes(tableName)) {
    throw new Error(`[Sandbox] Extension "${extensionKey}" — accès REFUSÉ à "${tableName}". Tables autorisées: ${entry.allowedTables.join(', ')}`);
  }
  return true;
}

function generateExtensionKey() {
  return `ext_${crypto.randomBytes(16).toString('hex')}`;
}

module.exports = { mount, assertExtensionAccess, generateExtensionKey, initSchema };
