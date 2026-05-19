'use strict';
/**
 * Aesthetics Module — DALEBA Metacortex Point 278
 * Points d'ancrage pour modules esthétique avancés par tenant.
 */
const bus = require('./event-bus');
const MODULES = {
  botanicalBar: { name:'Bar à Plantes', description:'Soins capillaires botaniques', defaultEnabled:false },
  skinCare:     { name:'Soins Peau',    description:'Traitements esthétiques avancés', defaultEnabled:false },
  colorStudio:  { name:'Studio Couleur',description:'Consultations couleur IA',  defaultEnabled:true },
  nailCare:     { name:'Ongles',        description:'Manucure / Pédicure',         defaultEnabled:false },
};
async function initSchema(pool) {
  if (!pool) return;
  await pool.query(`CREATE TABLE IF NOT EXISTS tenant_modules (id SERIAL PRIMARY KEY, tenant_id TEXT NOT NULL, module_key TEXT NOT NULL, enabled BOOL DEFAULT false, config JSONB DEFAULT '{}', updated_at TIMESTAMPTZ DEFAULT NOW(), UNIQUE(tenant_id,module_key))`).catch(()=>{});
}
async function getModuleStatus(pool, tenantId) {
  await initSchema(pool);
  const r = await pool.query(`SELECT module_key,enabled,config FROM tenant_modules WHERE tenant_id=$1`,[tenantId]).catch(()=>({rows:[]}));
  const active = {};
  for (const [key,def] of Object.entries(MODULES)) { const row=r.rows.find(x=>x.module_key===key); active[key]={...def,enabled:row?row.enabled:def.defaultEnabled,config:row?.config||{}}; }
  return active;
}
async function toggleModule(pool, tenantId, moduleKey, enabled) {
  if (!MODULES[moduleKey]) throw new Error(`Module inconnu: ${moduleKey}`);
  await initSchema(pool);
  await pool.query(`INSERT INTO tenant_modules (tenant_id,module_key,enabled,updated_at) VALUES ($1,$2,$3,NOW()) ON CONFLICT (tenant_id,module_key) DO UPDATE SET enabled=$3,updated_at=NOW()`,[tenantId,moduleKey,enabled]);
  bus.system(`[Modules] ${tenantId}: ${moduleKey} → ${enabled?'activé':'désactivé'}`);
  return { tenantId, moduleKey, enabled };
}
module.exports = { MODULES, getModuleStatus, toggleModule };
