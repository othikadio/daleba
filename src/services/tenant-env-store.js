'use strict';
/**
 * Tenant Env Store — DALEBA Metacortex Point 280
 * Stockage sécurisé des variables d'environnement par tenant en DB.
 * Évite de surcharger Railway .env.
 */
const crypto = require('crypto');
const bus    = require('./event-bus');

function _key() {
  return crypto.scryptSync(process.env.VAULT_SECRET || process.env.ANTHROPIC_API_KEY || 'daleba-env-v1', 'tenant-env-salt', 32);
}
function encrypt(v) {
  const iv = crypto.randomBytes(12);
  const c  = crypto.createCipheriv('aes-256-gcm', _key(), iv);
  const e  = Buffer.concat([c.update(v, 'utf8'), c.final()]);
  return `${iv.toString('hex')}:${e.toString('hex')}:${c.getAuthTag().toString('hex')}`;
}
function decrypt(enc) {
  const [ivH, eH, tagH] = enc.split(':');
  const d = crypto.createDecipheriv('aes-256-gcm', _key(), Buffer.from(ivH,'hex'));
  d.setAuthTag(Buffer.from(tagH,'hex'));
  return d.update(Buffer.from(eH,'hex')) + d.final('utf8');
}

async function initSchema(pool) {
  if (!pool) return;
  await pool.query(`
    CREATE TABLE IF NOT EXISTS tenant_env_vars (
      id         SERIAL PRIMARY KEY,
      tenant_id  TEXT NOT NULL,
      var_name   TEXT NOT NULL,
      var_value  TEXT NOT NULL,
      encrypted  BOOL DEFAULT true,
      created_at TIMESTAMPTZ DEFAULT NOW(),
      updated_at TIMESTAMPTZ DEFAULT NOW(),
      UNIQUE(tenant_id, var_name)
    )
  `);
}

async function setVar(pool, tenantId, varName, value, shouldEncrypt = true) {
  await initSchema(pool);
  const stored = shouldEncrypt ? encrypt(String(value)) : String(value);
  await pool.query(`
    INSERT INTO tenant_env_vars (tenant_id, var_name, var_value, encrypted)
    VALUES ($1,$2,$3,$4)
    ON CONFLICT (tenant_id, var_name) DO UPDATE SET var_value=$3, updated_at=NOW()
  `, [tenantId, varName, stored, shouldEncrypt]);
}

async function getVar(pool, tenantId, varName) {
  const r = await pool.query(`SELECT var_value, encrypted FROM tenant_env_vars WHERE tenant_id=$1 AND var_name=$2`, [tenantId, varName]);
  if (!r.rows[0]) return null;
  try { return r.rows[0].encrypted ? decrypt(r.rows[0].var_value) : r.rows[0].var_value; } catch { return null; }
}

async function getAllVars(pool, tenantId) {
  const r = await pool.query(`SELECT var_name, encrypted FROM tenant_env_vars WHERE tenant_id=$1`, [tenantId]);
  return r.rows.map(row => ({ name: row.var_name, encrypted: row.encrypted }));
}

module.exports = { initSchema, setVar, getVar, getAllVars };
