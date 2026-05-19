'use strict';
/**
 * Tenant API Keys — DALEBA Metacortex Point 285
 * Génère et valide les clés API uniques par tenant.
 */
const crypto = require('crypto');
const bus    = require('./event-bus');
function generate() { return 'tk_' + crypto.randomBytes(24).toString('hex'); }
async function issue(pool, tenantId, label = 'default') {
  const key  = generate();
  const hash = crypto.createHash('sha256').update(key).digest('hex');
  if (pool) {
    await pool.query(`CREATE TABLE IF NOT EXISTS tenant_api_keys (id SERIAL PRIMARY KEY, tenant_id TEXT NOT NULL, key_hash TEXT NOT NULL UNIQUE, label TEXT DEFAULT 'default', active BOOL DEFAULT true, last_used TIMESTAMPTZ, created_at TIMESTAMPTZ DEFAULT NOW())`).catch(()=>{});
    await pool.query(`INSERT INTO tenant_api_keys (tenant_id,key_hash,label) VALUES ($1,$2,$3) ON CONFLICT DO NOTHING`,[tenantId,hash,label]);
  }
  bus.system(`[ApiKeys] Clé émise pour ${tenantId}`);
  return key;
}
async function validate(pool, key) {
  if (!key?.startsWith('tk_') || !pool) return null;
  const hash = crypto.createHash('sha256').update(key).digest('hex');
  const r = await pool.query(`SELECT tenant_id FROM tenant_api_keys WHERE key_hash=$1 AND active=true`,[hash]).catch(()=>({rows:[]}));
  if (!r.rows[0]) return null;
  await pool.query(`UPDATE tenant_api_keys SET last_used=NOW() WHERE key_hash=$1`,[hash]).catch(()=>{});
  return r.rows[0].tenant_id;
}
async function revoke(pool, tenantId, label = null) {
  if (!pool) return;
  if (label) await pool.query(`UPDATE tenant_api_keys SET active=false WHERE tenant_id=$1 AND label=$2`,[tenantId,label]);
  else await pool.query(`UPDATE tenant_api_keys SET active=false WHERE tenant_id=$1`,[tenantId]);
}
function apiKeyMiddleware(pool) {
  return async (req, res, next) => {
    const key = req.headers['x-api-key'] || req.query.api_key;
    if (!key) return res.status(401).json({ error:'Clé API requise (X-Api-Key)' });
    const tenantId = await validate(pool, key).catch(()=>null);
    if (!tenantId) return res.status(403).json({ error:'Clé API invalide' });
    req.tenantId = tenantId; next();
  };
}
module.exports = { generate, issue, validate, revoke, apiKeyMiddleware };
