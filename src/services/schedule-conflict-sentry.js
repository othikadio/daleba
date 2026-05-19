'use strict';
/**
 * Schedule Conflict Sentry — DALEBA Metacortex Point 314
 * Double vérification avant toute réservation:
 * 1. Disponibilité agenda Square
 * 2. Absence de verrou congé dans staff_leaves
 */
const bus = require('./event-bus');

/**
 * [314] Vérifie si un employé est disponible pour un créneau
 * @param {object} params - { tenantId, employeeSquareId, startAt, endAt, pool, accessToken }
 * @returns {object} - { available, conflicts: [] }
 */
async function checkAvailability({ tenantId, employeeSquareId, startAt, endAt, pool, accessToken }) {
  const conflicts = [];
  const start = new Date(startAt);
  const end   = new Date(endAt);

  // ── Check 1: Congés dans staff_leaves ─────────────────────────────────────
  if (pool) {
    try {
      const r = await pool.query(`
        SELECT id, leave_start, leave_end, reason
        FROM staff_leaves
        WHERE tenant_id = $1
          AND employee_square_id = $2
          AND leave_start < $3
          AND leave_end   > $4
      `, [tenantId, employeeSquareId, end.toISOString(), start.toISOString()]);

      for (const leave of r.rows) {
        conflicts.push({
          type:   'STAFF_LEAVE',
          reason: `Congé enregistré: ${leave.reason}`,
          from:   leave.leave_start,
          to:     leave.leave_end,
        });
      }
    } catch (err) {
      bus.system(`[ConflictSentry] Erreur check leaves: ${err.message}`);
    }
  }

  // ── Check 2: Rendez-vous existants dans tenant_appointments ────────────────
  if (pool) {
    try {
      const r = await pool.query(`
        SELECT id, start_at, end_at, customer_name
        FROM tenant_appointments
        WHERE tenant_id = $1
          AND staff_square_id = $2
          AND start_at < $3
          AND end_at   > $4
          AND status NOT IN ('CANCELLED_BY_CUSTOMER', 'CANCELLED_BY_SELLER', 'NO_SHOW')
      `, [tenantId, employeeSquareId, end.toISOString(), start.toISOString()]);

      for (const appt of r.rows) {
        conflicts.push({
          type:         'APPOINTMENT_CONFLICT',
          reason:       `RDV existant: ${appt.customer_name || 'client'}`,
          from:         appt.start_at,
          to:           appt.end_at,
          appointmentId: appt.id,
        });
      }
    } catch {}
  }

  // ── Check 3: Square API (si accessToken disponible) ────────────────────────
  if (accessToken && conflicts.length === 0) {
    try {
      const resp = await fetch('https://connect.squareup.com/v2/bookings/availability/search', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${accessToken}`,
          'Square-Version': '2024-01-18',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          query: {
            filter: {
              start_at_range: { start_at: start.toISOString(), end_at: end.toISOString() },
              team_member_id_filter: { any: [employeeSquareId] },
            },
          },
        }),
      });

      if (resp.ok) {
        const data = await resp.json();
        // Si aucun créneau disponible retourné → conflit Square
        const slots = data.availabilities || [];
        if (slots.length === 0) {
          conflicts.push({ type: 'SQUARE_UNAVAILABLE', reason: 'Créneau non disponible dans Square' });
        }
      }
    } catch {} // Square check non bloquant
  }

  const available = conflicts.length === 0;
  if (!available) {
    bus.system(`[ConflictSentry] ❌ Conflit pour ${employeeSquareId}: ${conflicts.map(c=>c.type).join(', ')}`);
  }

  return { available, conflicts, employeeSquareId, startAt, endAt };
}

/**
 * Ajoute un congé dans staff_leaves
 */
async function addLeave(pool, { tenantId, employeeSquareId, leaveStart, leaveEnd, reason = 'congé', approvedBy = 'admin' }) {
  await pool.query(`
    INSERT INTO staff_leaves (tenant_id, employee_square_id, leave_start, leave_end, reason, approved_by)
    VALUES ($1,$2,$3,$4,$5,$6)
  `, [tenantId, employeeSquareId, leaveStart, leaveEnd, reason, approvedBy]);
  bus.system(`[ConflictSentry] Congé ajouté: ${employeeSquareId} du ${leaveStart} au ${leaveEnd}`);
}

async function removeLeave(pool, leaveId, tenantId) {
  await pool.query(`DELETE FROM staff_leaves WHERE id=$1 AND tenant_id=$2`, [leaveId, tenantId]);
}

async function getActiveLeaves(pool, tenantId, employeeSquareId = null) {
  const params = [tenantId];
  let sql = `SELECT * FROM staff_leaves WHERE tenant_id=$1 AND leave_end > NOW()`;
  if (employeeSquareId) { params.push(employeeSquareId); sql += ` AND employee_square_id=$2`; }
  sql += ` ORDER BY leave_start`;
  const r = await pool.query(sql, params).catch(() => ({ rows: [] }));
  return r.rows;
}

module.exports = { checkAvailability, addLeave, removeLeave, getActiveLeaves };
