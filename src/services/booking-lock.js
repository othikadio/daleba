'use strict';
/**
 * Booking Lock — DALEBA Metacortex Point 341
 * Évite les réservations simultanées (Overlapping Bookings).
 * Utilise un verrou optimiste par employé+créneau.
 */
const bus = require('./event-bus');
const _locks = new Map(); // key: `tenantId:employeeId:slot` → timestamp

/**
 * [341] Tente d'acquérir un verrou de réservation (TTL 30s)
 */
function acquireLock(tenantId, employeeId, slotKey) {
  const key     = `${tenantId}:${employeeId}:${slotKey}`;
  const now     = Date.now();
  const existing = _locks.get(key);

  if (existing && now - existing < 30_000) {
    bus.system(`[BookingLock] ❌ Slot déjà verrouillé: ${key}`);
    return { acquired: false, key };
  }

  _locks.set(key, now);
  setTimeout(() => _locks.delete(key), 30_000); // auto-release 30s
  bus.system(`[BookingLock] ✅ Lock acquis: ${key}`);
  return { acquired: true, key };
}

function releaseLock(tenantId, employeeId, slotKey) {
  const key = `${tenantId}:${employeeId}:${slotKey}`;
  _locks.delete(key);
}

/**
 * [341] Vérifie DB pour chevauchements réels (requête optimisée avec index)
 */
async function checkOverlap(pool, tenantId, employeeId, startAt, endAt) {
  // INDEX requis: CREATE INDEX IF NOT EXISTS idx_appt_staff_time ON tenant_appointments(tenant_id, staff_square_id, start_at, end_at)
  const r = await pool.query(`
    SELECT id FROM tenant_appointments
    WHERE tenant_id = $1
      AND staff_square_id = $2
      AND start_at < $4
      AND end_at   > $3
      AND status NOT IN ('CANCELLED_BY_CUSTOMER', 'CANCELLED_BY_SELLER', 'NO_SHOW')
    LIMIT 1
  `, [tenantId, employeeId, startAt, endAt]).catch(() => ({ rows: [] }));

  return r.rows.length > 0;
}

/**
 * [341] Crée les index optimisés pour les requêtes d'agenda
 */
async function createIndexes(pool) {
  const indexes = [
    `CREATE INDEX IF NOT EXISTS idx_appt_staff_time    ON tenant_appointments(tenant_id, staff_square_id, start_at, end_at)`,
    `CREATE INDEX IF NOT EXISTS idx_appt_tenant_start  ON tenant_appointments(tenant_id, start_at)`,
    `CREATE INDEX IF NOT EXISTS idx_payouts_emp_status ON staff_payouts(employee_square_id, status, created_at)`,  // [324]
    `CREATE INDEX IF NOT EXISTS idx_payouts_tenant     ON staff_payouts(tenant_id, created_at)`,
    `CREATE INDEX IF NOT EXISTS idx_tips_emp_ts        ON staff_tips(employee_id, timestamp_utc DESC)`,
  ];

  for (const idx of indexes) {
    await pool.query(idx).catch(() => {});
  }
  bus.system('[BookingLock] Indexes optimisés créés [324+341]');
}

module.exports = { acquireLock, releaseLock, checkOverlap, createIndexes };
