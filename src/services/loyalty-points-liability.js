'use strict';
/**
 * Points Liability & NPS — DALEBA Metacortex Points 429, 431
 * [429] Calcule la valeur financière des points en circulation (bilan trésorerie)
 * [431] NPS trimestriel basé sur les notes de rétroaction
 */
const bus = require('./event-bus');

// Valeur monétaire d'un point (en CAD) — configurable
const POINT_VALUE_CAD = 0.01; // 100 pts = 1$ (aligné: 500pts = Brume ~5$, 2000pts = 50$)

/**
 * [429] Calcule la liability totale de points par tenant
 */
async function calculatePointsLiability(pool, tenantId) {
  const r = await pool.query(`
    SELECT
      COUNT(*)                          AS total_cards,
      SUM(points_balance)               AS total_points,
      SUM(points_balance * $2)          AS liability_cad,
      AVG(points_balance)               AS avg_balance,
      MAX(points_balance)               AS max_balance,
      SUM(CASE WHEN points_balance >= 500 THEN 1 ELSE 0 END) AS redeemable_cards
    FROM tenant_loyalty_cards WHERE tenant_id=$1
  `, [tenantId, POINT_VALUE_CAD]).catch(() => ({ rows: [{}] }));

  const row = r.rows[0] || {};
  const liability = {
    tenantId,
    totalCards:      parseInt(row.total_cards || 0),
    totalPoints:     parseInt(row.total_points || 0),
    liabilityCad:    parseFloat(row.liability_cad || 0).toFixed(2),
    avgBalance:      parseFloat(row.avg_balance || 0).toFixed(1),
    maxBalance:      parseInt(row.max_balance || 0),
    redeemableCards: parseInt(row.redeemable_cards || 0),
    pointValueCad:   POINT_VALUE_CAD,
    calculatedAt:    new Date().toISOString(),
  };

  bus.system(`[PointsLiability] Bilan tenant ${tenantId}: ${liability.totalPoints} pts = ${liability.liabilityCad}$ CAD latents`);
  return liability;
}

/**
 * [431] Calcule le NPS trimestriel
 * NPS = % Promoteurs (4-5★) - % Détracteurs (1-2★)
 */
async function calculateNPS(pool, tenantId) {
  const since = new Date(Date.now() - 90 * 86400000).toISOString(); // 90 jours
  const r = await pool.query(`
    SELECT rating, COUNT(*) AS cnt
    FROM tenant_review_tokens
    WHERE tenant_id=$1 AND rating IS NOT NULL AND created_at >= $2
    GROUP BY rating ORDER BY rating
  `, [tenantId, since]).catch(() => ({ rows: [] }));

  const counts = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 };
  for (const row of r.rows) counts[row.rating] = parseInt(row.cnt);
  const total = Object.values(counts).reduce((a, b) => a + b, 0);
  if (total === 0) return { nps: 0, total: 0, message: 'Aucune donnée de rétroaction ce trimestre' };

  const promoters  = (counts[4] + counts[5]) / total * 100;
  const detractors = (counts[1] + counts[2]) / total * 100;
  const nps        = Math.round(promoters - detractors);

  bus.system(`[NPS] Tenant ${tenantId}: NPS=${nps} (${total} avis — ${promoters.toFixed(0)}% promo / ${detractors.toFixed(0)}% détract.)`);
  return {
    tenantId, nps, total,
    promoters:  Math.round(promoters),
    detractors: Math.round(detractors),
    neutral:    Math.round(100 - promoters - detractors),
    distribution: counts,
    verdict:   nps >= 50 ? 'Excellent 🌟' : nps >= 30 ? 'Bien 👍' : nps >= 0 ? 'À améliorer ⚠️' : 'Critique 🚨',
    since,
  };
}

module.exports = { calculatePointsLiability, calculateNPS, POINT_VALUE_CAD };
