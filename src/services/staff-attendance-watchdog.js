'use strict';
/**
 * Staff Attendance Watchdog — DALEBA Metacortex Point 317
 * Si un RDV a commencé mais que l'employé n'a pas validé après 10 min → alerte HUD.
 */
const bus = require('./event-bus');

const LATE_THRESHOLD_MS = 10 * 60 * 1000; // 10 minutes [317]
const _alerts = new Map(); // appointmentId → alertData

async function checkLateStarts(pool, tenantId) {
  if (!pool) return [];
  const now      = new Date();
  const tenMin   = new Date(now.getTime() - LATE_THRESHOLD_MS);
  const nowMinus1h = new Date(now.getTime() - 60 * 60 * 1000);

  try {
    // RDV qui ont commencé il y a 10-60min et dont le statut Square est encore ACCEPTED (pas STARTED)
    const r = await pool.query(`
      SELECT id, staff_square_id, customer_name, service_name, start_at, end_at, status
      FROM tenant_appointments
      WHERE tenant_id = $1
        AND start_at BETWEEN $2 AND $3
        AND status = 'ACCEPTED'  -- pas encore validé par l'employé
        AND active = true
    `, [tenantId, nowMinus1h.toISOString(), tenMin.toISOString()]);

    const newAlerts = [];
    for (const appt of r.rows) {
      if (_alerts.has(appt.id)) continue; // déjà alerté

      const minutesLate = Math.floor((now - new Date(appt.start_at)) / 60000);
      const alert = {
        appointmentId: appt.id,
        staffSquareId: appt.staff_square_id,
        customerName:  appt.customer_name,
        serviceName:   appt.service_name,
        startAt:       appt.start_at,
        minutesLate,
        severity:      minutesLate > 20 ? 'HIGH' : 'MEDIUM',
        detectedAt:    new Date().toISOString(),
      };

      _alerts.set(appt.id, alert);
      newAlerts.push(alert);

      bus.system(`[AttendanceWatchdog] ⚠️ Retard: ${appt.staff_square_id} | ${appt.service_name} | ${minutesLate}min de retard`);
    }

    return newAlerts;
  } catch (err) {
    bus.system(`[AttendanceWatchdog] Erreur: ${err.message}`);
    return [];
  }
}

// Appelé quand un employé valide le début du soin → efface l'alerte
function clearAlert(appointmentId) {
  _alerts.delete(appointmentId);
}

function getActiveAlerts(tenantId = null) {
  return [..._alerts.values()];
}

// Démarre le watchdog (appelé au boot pour le tenant Kadio)
function startWatchdog(pool, tenantId, intervalMs = 5 * 60 * 1000) {
  setInterval(() => checkLateStarts(pool, tenantId).catch(() => {}), intervalMs);
  bus.system(`[AttendanceWatchdog] Actif pour ${tenantId} (scan toutes les ${intervalMs/60000}min)`);
}

module.exports = { checkLateStarts, clearAlert, getActiveAlerts, startWatchdog };
