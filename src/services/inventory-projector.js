'use strict';
/**
 * Inventory Projector — DALEBA [491]
 * Projette les besoins en matières premières sur 30 jours
 * basé sur l'agenda Square déjà planifié.
 */
const bus    = require('./event-bus');
const stock  = require('./dynamic-stock-tracker');

/**
 * [491] Calcule la consommation prévisionnelle sur la base des RDV planifiés
 */
async function projectInventoryNeeds(pool, tenantId, days = 30) {
  // Récupère les RDV planifiés
  const r = await pool.query(`
    SELECT service_type, COUNT(*) AS qty
    FROM tenant_appointments
    WHERE tenant_id=$1 AND status='confirmed'
    AND start_time >= NOW() AND start_time <= NOW() + ($2 || ' days')::INTERVAL
    GROUP BY service_type
  `, [tenantId, days]).catch(() => ({ rows: [] }));

  const projections = {};
  for (const row of r.rows) {
    const formula = stock.CONSUMPTION_FORMULAS[row.service_type] || stock.CONSUMPTION_FORMULAS['default'];
    for (const [productId, perService] of Object.entries(formula)) {
      projections[productId] = (projections[productId] || 0) + (perService * parseInt(row.qty));
    }
  }

  // Compare avec l'inventaire actuel
  const inv = await pool.query(`SELECT product_id, name, quantity, unit FROM tenant_inventory WHERE tenant_id=$1`, [tenantId]).catch(() => ({ rows: [] }));
  const needs = [];
  for (const item of inv.rows) {
    const projected = projections[item.product_id] || 0;
    const deficit   = projected - parseFloat(item.quantity);
    needs.push({ productId: item.product_id, name: item.name, unit: item.unit,
      currentStock: parseFloat(item.quantity), projectedConsumption: projected,
      deficit: Math.max(0, deficit), sufficient: deficit <= 0 });
  }

  bus.system(`[InvProjector] 📊 Projection ${days}j: ${needs.filter(n=>!n.sufficient).length} produit(s) en déficit`);
  return { days, projections, needs, generatedAt: new Date().toISOString() };
}

module.exports = { projectInventoryNeeds };
