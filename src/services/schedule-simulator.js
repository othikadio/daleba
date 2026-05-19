'use strict';
/**
 * Schedule Simulator — DALEBA Metacortex Points 327-328
 * [327] Projette l'impact financier: nouvel employé ou modification horaires
 * [328] Multi-salon (multi-location Square)
 */
const bus = require('./event-bus');

/**
 * [327] Simule l'impact financier de l'ajout d'un nouvel employé
 * @param {object} pool
 * @param {string} tenantId
 * @param {object} newEmployee - { weeklyHours, avgServicePrice, utilization, commissionRate, productCommRate, locationId? }
 * @returns {object} projection 30/90/365 jours
 */
async function simulateNewEmployee(pool, tenantId, newEmployee) {
  const {
    weeklyHours      = 35,
    avgServicePrice  = 80,
    utilization      = 0.70, // 70% du temps réservé
    commissionRate   = 40,
    productCommRate  = 10,
    avgProductSales  = 200,  // CAD/semaine produits
    locationId       = null,
  } = newEmployee;

  // CA service estimé par semaine
  const workableSlotsPerWeek = weeklyHours * utilization;
  const avgServiceDuration   = 1.5; // heures
  const servicesPerWeek      = Math.floor(workableSlotsPerWeek / avgServiceDuration);
  const caServicePerWeek     = servicesPerWeek * avgServicePrice;
  const caProductPerWeek     = avgProductSales;
  const caTotalPerWeek       = caServicePerWeek + caProductPerWeek;

  // Commissions (coût employeur)
  const commisionServicePerWeek = caServicePerWeek * commissionRate / 100;
  const commisionProductPerWeek = caProductPerWeek * productCommRate / 100;
  const totalCommissionsPerWeek = commisionServicePerWeek + commisionProductPerWeek;

  // Marge nette salon = CA - commissions
  const marginPerWeek = caTotalPerWeek - totalCommissionsPerWeek;

  const periods = [30, 90, 365].map(days => {
    const weeks = days / 7;
    return {
      days,
      caService:   (caServicePerWeek  * weeks).toFixed(2),
      caProducts:  (caProductPerWeek  * weeks).toFixed(2),
      caTotal:     (caTotalPerWeek    * weeks).toFixed(2),
      commissions: (totalCommissionsPerWeek * weeks).toFixed(2),
      marginNet:   (marginPerWeek     * weeks).toFixed(2),
    };
  });

  bus.system(`[Simulator] Nouvel employé: CA/sem=${caTotalPerWeek.toFixed(2)} CAD, marge=${marginPerWeek.toFixed(2)} CAD`);
  return {
    scenario: 'new_employee',
    tenantId,
    locationId,
    assumptions: { weeklyHours, avgServicePrice, utilization, commissionRate, productCommRate, avgProductSales, servicesPerWeek },
    perWeek: { caService: caServicePerWeek.toFixed(2), caProducts: caProductPerWeek.toFixed(2), caTotal: caTotalPerWeek.toFixed(2), commissions: totalCommissionsPerWeek.toFixed(2), marginNet: marginPerWeek.toFixed(2) },
    projections: periods,
    currency: 'CAD',
  };
}

/**
 * [327] Simule l'impact d'une modification des heures d'ouverture
 */
async function simulateHoursChange(pool, tenantId, { currentHoursPerDay, newHoursPerDay, staffCount, avgRevenuePerHour }) {
  const deltaHours    = newHoursPerDay - currentHoursPerDay;
  const deltaCAPerDay = deltaHours * staffCount * (avgRevenuePerHour || 60);

  const projections = [30, 90, 365].map(days => ({
    days,
    deltaCA:    (deltaCAPerDay * days).toFixed(2),
    deltaSign:  deltaCAPerDay >= 0 ? '+' : '-',
  }));

  return {
    scenario: 'hours_change',
    tenantId,
    currentHoursPerDay, newHoursPerDay, staffCount,
    deltaHoursPerDay: deltaHours,
    deltaCAPerDay: deltaCAPerDay.toFixed(2),
    projections,
    currency: 'CAD',
  };
}

/**
 * [328] Multi-salon: récupère les métriques par location Square
 */
async function getMultiLocationMetrics(pool, tenantId) {
  const r = await pool.query(`
    SELECT
      location_id,
      COUNT(DISTINCT staff_square_id) AS staff_count,
      COUNT(*) AS total_appointments,
      SUM(CASE WHEN status='COMPLETED' THEN 1 ELSE 0 END) AS completed,
      AVG(EXTRACT(EPOCH FROM (end_at - start_at))/3600) AS avg_duration_hours
    FROM tenant_appointments
    WHERE tenant_id = $1
    GROUP BY location_id
    ORDER BY completed DESC
  `, [tenantId]).catch(() => ({ rows: [] }));

  return r.rows;
}

module.exports = { simulateNewEmployee, simulateHoursChange, getMultiLocationMetrics };
