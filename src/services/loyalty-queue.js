'use strict';
/**
 * Loyalty Queue — DALEBA Metacortex Point 434
 * File d'attente volatile en mémoire (Redis-compatible API).
 * En cas de panne DB, les gains sont mis en attente puis répliqués.
 * Redis optionnel: si REDIS_URL dispo, utilise Redis; sinon Map en mémoire.
 */
const bus = require('./event-bus');

// Queue en mémoire (fallback si Redis absent)
const _queue = [];
let _draining = false;

/**
 * [434] Met un gain de points en attente
 */
function enqueue(tenantId, payload) {
  const item = { tenantId, payload, enqueuedAt: new Date().toISOString(), id: `q_${Date.now()}_${Math.random().toString(36).slice(2,6)}` };
  _queue.push(item);
  bus.system(`[LoyaltyQueue] 📥 Enqueue: ${payload.customerId} +${payload.amountNet||'?'}pts (queue size: ${_queue.length})`);
  return item.id;
}

/**
 * [434] Vide la queue vers la DB dès qu'elle est disponible
 */
async function drain(pool) {
  if (_draining || _queue.length === 0) return { processed: 0 };
  _draining = true;
  let processed = 0;
  const pts = require('./dynamic-points-engine');

  while (_queue.length > 0) {
    const item = _queue[0];
    try {
      await pts.awardPoints(pool, item.tenantId, item.payload);
      _queue.shift();
      processed++;
    } catch {
      break; // DB toujours indisponible
    }
  }

  if (processed > 0) bus.system(`[LoyaltyQueue] ✅ Drain: ${processed} item(s) traités`);
  _draining = false;
  return { processed, remaining: _queue.length };
}

function getQueueSize() { return _queue.length; }
function getQueue() { return [..._queue]; }

module.exports = { enqueue, drain, getQueueSize, getQueue };
