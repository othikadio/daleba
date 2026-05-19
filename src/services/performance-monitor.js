'use strict';
/**
 * Performance Monitor — DALEBA Metacortex Points 325-326-331
 * [325] Score de rétention client par employé (90 jours glissants)
 * [326] Suggère augmentation commission si rétention > 85%
 * [331] Expose données pour voice-commander ("qui a fait le plus gros CA ?")
 */
const bus = require('./event-bus');

const RETENTION_WINDOW_DAYS = 90;   // [325]
const RETENTION_THRESHOLD   = 85;   // [326] % pour trigger augmentation

/**
 * [325] Calcule le score de rétention client d'un employé
 * Rétention = % clients qui sont revenus avec le MÊME employé
 */
async function computeRetentionScore(pool, tenantId, employeeSquareId) {
  const since = new Date();
  since.setDate(since.getDate() - RETENTION_WINDOW_DAYS);

  try {
    // Clients uniques ayant eu un RDV avec cet employé
    const totalR = await pool.query(`
      SELECT COUNT(DISTINCT customer_id) AS total
      FROM tenant_appointments
      WHERE tenant_id = $1 AND staff_square_id = $2
        AND start_at >= $3 AND status = 'COMPLETED'
    `, [tenantId, employeeSquareId, since.toISOString()]);

    const total = parseInt(totalR.rows[0]?.total || 0);
    if (total === 0) return { score: 0, total: 0, returning: 0 };

    // Clients qui ont eu 2+ RDV avec ce même employé
    const retainedR = await pool.query(`
      SELECT COUNT(DISTINCT customer_id) AS retained
      FROM (
        SELECT customer_id, COUNT(*) as cnt
        FROM tenant_appointments
        WHERE tenant_id = $1 AND staff_square_id = $2
          AND start_at >= $3 AND status = 'COMPLETED'
        GROUP BY customer_id HAVING COUNT(*) >= 2
      ) sub
    `, [tenantId, employeeSquareId, since.toISOString()]);

    const returning = parseInt(retainedR.rows[0]?.retained || 0);
    const score     = total > 0 ? Math.round((returning / total) * 100) : 0;

    return { score, total, returning, windowDays: RETENTION_WINDOW_DAYS };
  } catch {
    return { score: 0, total: 0, returning: 0, error: 'table unavailable' };
  }
}

/**
 * [325] Calcule les scores pour toute l'équipe d'un tenant
 */
async function computeTeamRetention(pool, tenantId) {
  const staffR = await pool.query(
    `SELECT square_id, name FROM staff_profiles WHERE tenant_id=$1 AND active=true`,
    [tenantId]
  ).catch(() => ({ rows: [] }));

  const results = await Promise.all(staffR.rows.map(async (s) => {
    const ret = await computeRetentionScore(pool, tenantId, s.square_id);
    return { squareId: s.square_id, name: s.name, ...ret };
  }));

  return results.sort((a, b) => b.score - a.score);
}

/**
 * [326] Vérifie si un employé mérite une suggestion d'augmentation
 */
async function checkCommissionRaiseSuggestion(pool, tenantId, employeeSquareId) {
  const ret = await computeRetentionScore(pool, tenantId, employeeSquareId);

  if (ret.score >= RETENTION_THRESHOLD) {
    const empR = await pool.query(
      `SELECT name, commission_service FROM staff_profiles WHERE tenant_id=$1 AND square_id=$2`,
      [tenantId, employeeSquareId]
    ).catch(() => ({ rows: [] }));

    const emp = empR.rows[0];
    const suggestion = {
      employeeSquareId,
      name:             emp?.name || employeeSquareId,
      retentionScore:   ret.score,
      windowDays:       RETENTION_WINDOW_DAYS,
      currentRate:      parseFloat(emp?.commission_service || 40),
      suggestedRate:    Math.min(parseFloat(emp?.commission_service || 40) + 5, 60),
      trigger:          `Rétention ${ret.score}% > seuil ${RETENTION_THRESHOLD}%`,
      hudAlert:         true,
    };

    bus.system(`[PerfMonitor] 🌟 Suggestion augmentation: ${emp?.name} — rétention ${ret.score}%`);
    return { suggest: true, ...suggestion };
  }

  return { suggest: false, retentionScore: ret.score, threshold: RETENTION_THRESHOLD };
}

/**
 * [331] Top performeurs pour voice-commander
 * "Qui a fait le plus gros CA aujourd'hui ?"
 */
async function getTopPerformerToday(pool, tenantId) {
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const r = await pool.query(`
    SELECT sp.name, sp.square_id,
      COALESCE(SUM(py.amount_net), 0)     AS ca_net,
      COALESCE(SUM(py.payout_amount), 0)  AS gains,
      COUNT(DISTINCT py.tx_id)            AS nb_transactions
    FROM staff_profiles sp
    LEFT JOIN staff_payouts py
      ON py.tenant_id = sp.tenant_id AND py.employee_square_id = sp.square_id
      AND py.created_at >= $2
    WHERE sp.tenant_id = $1 AND sp.active = true
    GROUP BY sp.name, sp.square_id
    ORDER BY ca_net DESC
    LIMIT 5
  `, [tenantId, today.toISOString()]).catch(() => ({ rows: [] }));

  return r.rows.map(row => ({
    name:           row.name,
    caNet:          parseFloat(row.ca_net).toFixed(2),
    gains:          parseFloat(row.gains).toFixed(2),
    nbTransactions: parseInt(row.nb_transactions),
  }));
}

/**
 * [331] Phrase vocale pour voice-commander
 */
async function getVoicePerformanceSummary(pool, tenantId) {
  const tops = await getTopPerformerToday(pool, tenantId);
  if (!tops.length) return 'Pas de données de performance disponibles pour aujourd\'hui.';

  const first = tops[0];
  const others = tops.slice(1, 3).map(e => `${e.name} avec ${e.caNet} CAD`).join(', ');

  let phrase = `Aujourd'hui, ${first.name} est en tête avec ${first.caNet} CAD de CA net en ${first.nbTransactions} transaction${first.nbTransactions > 1 ? 's' : ''}.`;
  if (others) phrase += ` Suivi${tops.length > 2 ? 'e' : ''} par ${others}.`;

  return phrase;
}

module.exports = {
  computeRetentionScore,
  computeTeamRetention,
  checkCommissionRaiseSuggestion,
  getTopPerformerToday,
  getVoicePerformanceSummary,
};
