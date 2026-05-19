'use strict';
/**
 * Fair Load Balancer — DALEBA Metacortex Points 304-306
 * Distribue équitablement les rendez-vous selon le taux d'occupation.
 * [306] Priorité: employé qualifié avec taux d'occupation le plus bas.
 */
const bus = require('./event-bus');
const skills = require('./staff-skills');

/**
 * [305] Calcule le taux d'occupation d'un employé pour la semaine en cours
 * Occupation = heures réservées / heures disponibles hebdo
 */
async function getOccupancyRate(pool, tenantId, employeeSquareId, weeklyHours = 40) {
  // Heures réservées cette semaine (lundi 00:00 → dimanche 23:59)
  const now       = new Date();
  const dayOfWeek = now.getDay() === 0 ? 6 : now.getDay() - 1; // lundi=0
  const weekStart = new Date(now); weekStart.setDate(now.getDate() - dayOfWeek); weekStart.setHours(0,0,0,0);
  const weekEnd   = new Date(weekStart); weekEnd.setDate(weekStart.getDate() + 7);

  try {
    // Requête sur les bookings Square locaux (tenant_appointments) ou Square directement
    const r = await pool.query(`
      SELECT COALESCE(SUM(
        EXTRACT(EPOCH FROM (end_at - start_at)) / 3600
      ), 0) AS booked_hours
      FROM tenant_appointments
      WHERE tenant_id = $1
        AND staff_square_id = $2
        AND start_at >= $3
        AND start_at < $4
        AND status NOT IN ('CANCELLED_BY_CUSTOMER', 'CANCELLED_BY_SELLER', 'NO_SHOW')
    `, [tenantId, employeeSquareId, weekStart.toISOString(), weekEnd.toISOString()]);

    const bookedHours = parseFloat(r.rows[0]?.booked_hours || 0);
    const rate        = weeklyHours > 0 ? Math.min(1, bookedHours / weeklyHours) : 0;
    return { employeeSquareId, bookedHours, weeklyHours, occupancyRate: rate };
  } catch {
    return { employeeSquareId, bookedHours: 0, weeklyHours, occupancyRate: 0 };
  }
}

/**
 * [304-306] Sélectionne le meilleur employé pour un service
 *
 * @param {object} params - { tenantId, catalogItemId, pool, date?, duration? }
 * @returns {object} - { employee, occupancyRate, reason }
 */
async function assignBestEmployee({ tenantId, catalogItemId, pool, preferredName = null }) {
  if (!pool) throw new Error('Pool DB requis pour assignBestEmployee');

  // [307] Récupérer les employés qualifiés pour ce service
  let qualifiedStaff = await skills.getQualifiedStaff(pool, tenantId, catalogItemId);

  // Si aucune compétence enregistrée: fallback sur tous les actifs
  if (qualifiedStaff.length === 0) {
    bus.system(`[LoadBalancer] Aucune compétence pour "${catalogItemId}" — fallback tous actifs`);
    const r = await pool.query(`
      SELECT square_id AS employee_square_id, name, status, weekly_hours
      FROM staff_profiles
      WHERE tenant_id=$1 AND active=true AND status='ACTIVE'
    `, [tenantId]);
    qualifiedStaff = r.rows;
  }

  if (qualifiedStaff.length === 0) {
    throw new Error('Aucun employé actif disponible pour ce service');
  }

  // [305] Calculer le taux d'occupation de chaque candidat
  const withOccupancy = await Promise.all(
    qualifiedStaff.map(async (emp) => {
      // Récupère weekly_hours depuis staff_profiles si pas déjà là
      let weeklyHours = emp.weekly_hours || 40;
      if (!emp.weekly_hours) {
        try {
          const r = await pool.query(`SELECT weekly_hours FROM staff_profiles WHERE tenant_id=$1 AND square_id=$2`, [tenantId, emp.employee_square_id]);
          weeklyHours = parseFloat(r.rows[0]?.weekly_hours || 40);
        } catch {}
      }
      const occ = await getOccupancyRate(pool, tenantId, emp.employee_square_id, weeklyHours);
      return { ...emp, ...occ };
    })
  );

  // [306] Trier par taux d'occupation croissant → le moins chargé en premier
  withOccupancy.sort((a, b) => a.occupancyRate - b.occupancyRate);

  const winner = withOccupancy[0];
  bus.system(`[LoadBalancer] Assigné: ${winner.name} (${(winner.occupancyRate*100).toFixed(1)}% occ.) pour "${catalogItemId}"`);

  return {
    employee:        winner,
    occupancyRate:   winner.occupancyRate,
    bookedHours:     winner.bookedHours,
    weeklyHours:     winner.weeklyHours,
    allCandidates:   withOccupancy,
    reason:          `Taux d'occupation le plus bas: ${(winner.occupancyRate*100).toFixed(1)}%`,
  };
}

module.exports = { assignBestEmployee, getOccupancyRate };
