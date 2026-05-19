'use strict';
/**
 * Absence Manager — DALEBA Metacortex Point 348
 * Gestion des absences imprévues (maladie, retard last-minute).
 * Redistribution automatique des RDV du jour aux coiffeurs disponibles.
 * Validation en 1 clic par Ulrich sur le HUD.
 */
const bus = require('./event-bus');

/** [348] Déclenche une redistribution d'urgence pour un employé absent */
async function triggerAbsenceRedistribution(pool, tenantId, { absentSquareId, date, approvedBy = 'ulrich' }) {
  const dayStart = new Date(`${date}T00:00:00`);
  const dayEnd   = new Date(`${date}T23:59:59`);

  // 1. Récupère les RDV du jour de l'absent
  const rdvR = await pool.query(`
    SELECT * FROM tenant_appointments
    WHERE tenant_id=$1 AND staff_square_id=$2
      AND start_at BETWEEN $3 AND $4
      AND status NOT IN ('CANCELLED_BY_CUSTOMER','CANCELLED_BY_SELLER','NO_SHOW','COMPLETED')
    ORDER BY start_at
  `, [tenantId, absentSquareId, dayStart.toISOString(), dayEnd.toISOString()]).catch(() => ({ rows: [] }));

  if (!rdvR.rows.length) return { redistributed: 0, reason: 'no_appointments' };

  const lb       = require('./fair-load-balancer');
  const conflict = require('./schedule-conflict-sentry');
  const notifier = require('./staff-notifier');
  const audit    = require('./security-audit-log');
  const results  = [];

  for (const appt of rdvR.rows) {
    try {
      // Trouve le meilleur remplaçant (excluant l'absent) [304-306]
      const best = await lb.assignBestEmployee({
        tenantId, catalogItemId: appt.service_name || 'general',
        pool, excludeSquareId: absentSquareId,
      });

      if (!best?.employee) { results.push({ apptId: appt.id, reassigned: false, reason: 'no_staff' }); continue; }

      const newEmpId = best.employee.employee_square_id;

      // Vérifie l'absence de conflit [314]
      const chk = await conflict.check(pool, { tenantId, employeeId: newEmpId, startAt: appt.start_at, endAt: appt.end_at });
      if (!chk.available) { results.push({ apptId: appt.id, reassigned: false, reason: 'conflict', newEmp: best.employee.name }); continue; }

      // Réassigne en DB
      await pool.query(`
        UPDATE tenant_appointments SET staff_square_id=$3, updated_at=NOW()
        WHERE tenant_id=$1 AND id=$2
      `, [tenantId, appt.id, newEmpId]);

      // Notifie le nouveau coiffeur [320]
      const staffR = await pool.query(`SELECT name, phone FROM staff_profiles WHERE tenant_id=$1 AND square_id=$2`, [tenantId, newEmpId]);
      const staff  = staffR.rows[0];
      if (staff?.phone) {
        await notifier.notifyStaff({
          staffPhone: staff.phone,
          staffName:  staff.name?.split(' ')[0],
          eventType:  'MODIFIED',
          clientName: appt.customer_name || 'Client',
          service:    appt.service_name  || 'Service',
          startAt:    appt.start_at,
        }).catch(() => {});
      }

      results.push({ apptId: appt.id, reassigned: true, newEmployee: best.employee.name, startAt: appt.start_at });
    } catch (e) {
      results.push({ apptId: appt.id, reassigned: false, error: e.message });
    }
  }

  // [330] Log audit
  await audit.logAdminAction(pool, {
    tenantId, action: 'ABSENCE_REDISTRIBUTION', targetType: 'employee',
    targetId: absentSquareId, newValue: { date, results, approvedBy },
  }).catch(() => {});

  const ok = results.filter(r => r.reassigned).length;
  bus.system(`[AbsenceMgr] ✅ ${ok}/${rdvR.rows.length} RDV redistribués (absent: ${absentSquareId})`);
  return { total: rdvR.rows.length, redistributed: ok, results };
}

/** Ajoute l'absent dans staff_leaves pour la journée */
async function markAbsent(pool, tenantId, { employeeSquareId, date, reason = 'maladie' }) {
  const conflict = require('./schedule-conflict-sentry');
  await conflict.blockLeave(pool, {
    tenantId, employeeId: employeeSquareId,
    startAt: `${date}T00:00:00`, endAt: `${date}T23:59:59`, reason,
  });
  bus.system(`[AbsenceMgr] Absent marqué: ${employeeSquareId} | ${date} | ${reason}`);
}

module.exports = { triggerAbsenceRedistribution, markAbsent };
