'use strict';
/**
 * Campaign Energy Saver — DALEBA [497]
 * Coupe les budgets pub si occupation salon > 90% sur 2 semaines.
 */
const bus = require('./event-bus');
const OCCUPANCY_THRESHOLD = 0.90; // 90%

/**
 * [497] Vérifie le taux d'occupation et coupe les budgets si plein
 */
async function checkOccupancyAndPause(pool, tenantId) {
  // Compte les créneaux réservés vs disponibles sur les 14 prochains jours
  const r = await pool.query(`
    SELECT COUNT(*) AS booked FROM tenant_appointments
    WHERE tenant_id=$1 AND status='confirmed'
    AND start_time >= NOW() AND start_time <= NOW() + INTERVAL '14 days'
  `, [tenantId]).catch(() => ({ rows: [{ booked: 0 }] }));

  const booked   = parseInt(r.rows[0]?.booked || 0);
  const capacity = 14 * 8 * 2; // 14 jours × 8h/j × 2 employés (estimé)
  const occupancy = booked / capacity;

  if (occupancy >= OCCUPANCY_THRESHOLD) {
    // Pause toutes les campagnes actives
    await pool.query(`UPDATE tenant_campaigns SET status='paused' WHERE tenant_id=$1 AND status='active'`, [tenantId]).catch(() => {});
    bus.system(`[EnergySaver] ⚡ Salon plein à ${(occupancy*100).toFixed(0)}% → budgets pub coupés`);
    bus.emit('campaign:energy_save_mode', { tenantId, occupancy });
    return { energySaveMode: true, occupancy, booked, capacity };
  }
  return { energySaveMode: false, occupancy, booked };
}

module.exports = { checkOccupancyAndPause, OCCUPANCY_THRESHOLD };
