'use strict';

/**
 * DALEBA — Tenant Credentials [258]
 * Metacortex: Coffre-fort AES-256-GCM pour tokens multi-tenant en PostgreSQL
 *
 * Persistance chiffrée des credentials par tenant.
 * Table auto-créée `tenant_credentials`.
 * Zéro exposition en clair dans les logs/traces.
 */

const crypto = require('crypto');
const bus    = require('./event-bus');

// ─── CHIFFREMENT ──────────────────────────────────────────────────────────────

function _deriveKey() {
  const secret = process.env.VAULT_SECRET
    || process.env.ANTHROPIC_API_KEY
    || 'daleba-vault-v2';
  return crypto.scryptSync(secret, 'tenant-cred-salt', 32);
}

function _encrypt(plaintext) {
  const key    = _deriveKey();
  const iv     = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const enc    = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const tag    = cipher.getAuthTag();
  return [iv.toString('hex'), enc.toString('hex'), tag.toString('hex')].join(':');
}

function _decrypt(ciphertext) {
  const [ivHex, encHex, tagHex] = ciphertext.split(':');
  const key     = _deriveKey();
  const iv      = Buffer.from(ivHex, 'hex');
  const enc     = Buffer.from(encHex, 'hex');
  const tag     = Buffer.from(tagHex, 'hex');
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(tag);
  return decipher.update(enc) + decipher.final('utf8');
}

// ─── SCHEMA ───────────────────────────────────────────────────────────────────

/**
 * Crée la table tenant_credentials si elle n'existe pas encore.
 * @param {object} pool — pg Pool
 */
async function initSchema(pool) {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS tenant_credentials (
      id              SERIAL PRIMARY KEY,
      tenant_id       TEXT NOT NULL,
      key_name        TEXT NOT NULL,
      encrypted_value TEXT NOT NULL,
      created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      UNIQUE(tenant_id, key_name)
    )
  `);
  bus.emit('system', '[TenantCreds] schema ready');
}

// ─── CRUD ─────────────────────────────────────────────────────────────────────

/**
 * Chiffre et persiste une valeur.
 * @param {object} pool
 * @param {string} tenantId
 * @param {string} keyName
 * @param {string} value — valeur en clair
 */
async function store(pool, tenantId, keyName, value) {
  try {
    const encrypted = _encrypt(value);
    await pool.query(
      `INSERT INTO tenant_credentials (tenant_id, key_name, encrypted_value, updated_at)
       VALUES ($1, $2, $3, NOW())
       ON CONFLICT (tenant_id, key_name)
       DO UPDATE SET encrypted_value = EXCLUDED.encrypted_value, updated_at = NOW()`,
      [tenantId, keyName, encrypted]
    );
    bus.emit('system', `[TenantCreds] stored key ${keyName} for tenant ${tenantId}`);
  } catch (err) {
    bus.emit('error', `[TenantCreds] store failed: ${err.message}`, { tenantId, keyName });
    throw err;
  }
}

/**
 * Récupère et déchiffre une valeur.
 * @returns {string|null}
 */
async function retrieve(pool, tenantId, keyName) {
  try {
    const result = await pool.query(
      `SELECT encrypted_value FROM tenant_credentials
       WHERE tenant_id = $1 AND key_name = $2`,
      [tenantId, keyName]
    );
    if (result.rows.length === 0) return null;
    return _decrypt(result.rows[0].encrypted_value);
  } catch (err) {
    bus.emit('error', `[TenantCreds] retrieve failed: ${err.message}`, { tenantId, keyName });
    throw err;
  }
}

/**
 * Liste les noms de clés d'un tenant (pas les valeurs).
 * @returns {string[]}
 */
async function listKeys(pool, tenantId) {
  try {
    const result = await pool.query(
      `SELECT key_name FROM tenant_credentials WHERE tenant_id = $1 ORDER BY key_name`,
      [tenantId]
    );
    return result.rows.map(r => r.key_name);
  } catch (err) {
    bus.emit('error', `[TenantCreds] listKeys failed: ${err.message}`, { tenantId });
    throw err;
  }
}

/**
 * Supprime une clé.
 */
async function deleteKey(pool, tenantId, keyName) {
  try {
    await pool.query(
      `DELETE FROM tenant_credentials WHERE tenant_id = $1 AND key_name = $2`,
      [tenantId, keyName]
    );
    bus.emit('system', `[TenantCreds] deleted key ${keyName} for tenant ${tenantId}`);
  } catch (err) {
    bus.emit('error', `[TenantCreds] deleteKey failed: ${err.message}`, { tenantId, keyName });
    throw err;
  }
}

// ─── EXPORTS ──────────────────────────────────────────────────────────────────

module.exports = { initSchema, store, retrieve, listKeys, deleteKey };
