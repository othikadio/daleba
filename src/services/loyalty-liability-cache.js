'use strict';
/**
 * Loyalty Liability Cache — DALEBA Metacortex Point 448
 * Cache 6h de la valeur financière des points. Jamais recalculé en hot path.
 */
const bus = require('./event-bus');

const CACHE_TTL_MS = 6 * 60 * 60 * 1000; // 6h
const _cache = new Map(); // { tenantId → { data, expiresAt } }

async function getLiabilityCached(pool, tenantId) {
  const cached = _cache.get(tenantId);
  if (cached && Date.now() < cached.expiresAt) {
    return { ...cached.data, cached: true, expiresAt: new Date(cached.expiresAt).toISOString() };
  }
  const { calculatePointsLiability } = require('./loyalty-points-liability');
  const data = await calculatePointsLiability(pool, tenantId);
  _cache.set(tenantId, { data, expiresAt: Date.now() + CACHE_TTL_MS });
  bus.system(`[LiabilityCache] ♻️ Cache recalculé pour ${tenantId} (prochain: +6h)`);
  return { ...data, cached: false };
}

function invalidateCache(tenantId) {
  _cache.delete(tenantId);
  bus.system(`[LiabilityCache] 🗑️ Cache invalidé: ${tenantId}`);
}

function getCacheStatus(tenantId) {
  const c = _cache.get(tenantId);
  if (!c) return { cached: false };
  return { cached: Date.now() < c.expiresAt, expiresAt: new Date(c.expiresAt).toISOString(), ageMs: Date.now() - (c.expiresAt - CACHE_TTL_MS) };
}

module.exports = { getLiabilityCached, invalidateCache, getCacheStatus, CACHE_TTL_MS };
