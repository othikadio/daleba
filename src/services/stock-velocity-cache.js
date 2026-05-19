'use strict';
/**
 * Stock Velocity Cache — DALEBA [482]
 * Cache glissant 12h — ne jamais surcharger PostgreSQL sur les calculs de vélocité.
 */
const bus=require('./event-bus');
const CACHE_TTL_MS=12*60*60*1000;
const _cache=new Map();

async function getVelocityCached(pool,tenantId,days=30) {
  const key=`${tenantId}:${days}`;
  const cached=_cache.get(key);
  if (cached&&Date.now()<cached.expiresAt) return {...cached.data,cached:true,expiresAt:new Date(cached.expiresAt).toISOString()};
  const velocity=require('./stock-velocity-engine');
  const data=await velocity.analyzeVelocity(pool,tenantId,days);
  _cache.set(key,{data,expiresAt:Date.now()+CACHE_TTL_MS});
  bus.system(`[VelocityCache] ♻️ Recalcul vélocité ${tenantId} (prochain: +12h)`);
  return {...data,cached:false};
}

function invalidate(tenantId){[..._cache.keys()].filter(k=>k.startsWith(tenantId+':')).forEach(k=>_cache.delete(k));}
function getCacheStatus(tenantId){const c=_cache.get(tenantId+':30');return c?{cached:Date.now()<c.expiresAt,expiresAt:new Date(c.expiresAt).toISOString()}:{cached:false};}
module.exports={getVelocityCached,invalidate,getCacheStatus,CACHE_TTL_MS};
