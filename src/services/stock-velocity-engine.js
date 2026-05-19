'use strict';
/**
 * Stock Velocity Engine — DALEBA Metacortex Points 460-461
 * [460] Mesure vitesse d'épuisement (grammes/jour par ingrédient)
 * [461] Bascule REORDER_REQUIRED si épuisement < 10 jours
 */
const bus = require('./event-bus');

const REORDER_DAYS_THRESHOLD = 10; // [461] Seuil: 10 jours avant épuisement

/**
 * [460] Calcule la vélocité de consommation par ingrédient
 * Basé sur l'historique des déductions (30 derniers jours par défaut)
 */
async function analyzeVelocity(pool, tenantId, days = 30) {
  // Analyse les déductions sur la période
  const r = await pool.query(`
    SELECT
      il.product_id,
      i.name,
      i.quantity            AS current_qty,
      i.reorder_threshold,
      i.unit,
      i.status,
      COALESCE(SUM(il.deducted_qty), 0)          AS total_consumed,
      COALESCE(SUM(il.deducted_qty) / $2, 0)     AS daily_rate
    FROM tenant_inventory i
    LEFT JOIN tenant_inventory_log il
      ON il.tenant_id = i.tenant_id AND il.product_id = i.product_id
      AND il.created_at >= NOW() - ($2 || ' days')::INTERVAL
    WHERE i.tenant_id = $1
    GROUP BY il.product_id, i.name, i.quantity, i.reorder_threshold, i.unit, i.status, i.product_id
    ORDER BY daily_rate DESC
  `, [tenantId, days]).catch(() => ({ rows: [] }));

  const velocities = r.rows.map(row => {
    const dailyRate = parseFloat(row.daily_rate || 0);
    const currentQty = parseFloat(row.current_qty || 0);
    const daysRemaining = dailyRate > 0 ? Math.floor(currentQty / dailyRate) : 999;
    return {
      productId:       row.product_id,
      name:            row.name,
      currentQty,
      unit:            row.unit || 'g',
      dailyRate:       parseFloat(dailyRate.toFixed(2)),
      daysRemaining:   daysRemaining,
      status:          row.status,
      reorderRequired: daysRemaining <= REORDER_DAYS_THRESHOLD && dailyRate > 0,
    };
  });

  return { tenantId, days, velocities, analyzedAt: new Date().toISOString() };
}

/**
 * [461] Bascule les produits critiques en REORDER_REQUIRED
 * Appelé après chaque analyse de vélocité ou déduction
 */
async function checkAndFlagReorderRequired(pool, tenantId) {
  // Produits en statut low ou dont la qty <= threshold
  const r = await pool.query(`
    UPDATE tenant_inventory
    SET status = 'REORDER_REQUIRED', last_updated = NOW()
    WHERE tenant_id = $1
      AND status IN ('low', 'out_of_stock')
      AND quantity <= reorder_threshold
    RETURNING product_id, name, quantity, unit, reorder_threshold, supplier_id
  `, [tenantId]).catch(() => ({ rows: [] }));

  for (const item of r.rows) {
    bus.system(`[VelocityEngine] 🚨 REORDER_REQUIRED: ${item.name} (${item.quantity}${item.unit} ≤ seuil ${item.reorder_threshold}${item.unit})`);
    bus.emit('inventory:reorder_required', { tenantId, ...item });
  }

  return { flagged: r.rows.length, items: r.rows };
}

/**
 * [461] Vérifie si un produit spécifique doit passer en REORDER_REQUIRED
 */
async function checkProductVelocity(pool, tenantId, productId) {
  const r = await pool.query(
    `SELECT * FROM tenant_inventory WHERE tenant_id=$1 AND product_id=$2`,
    [tenantId, productId]
  ).catch(() => ({ rows: [] }));

  if (!r.rows[0]) return { status: 'not_found' };
  const item = r.rows[0];
  const qty = parseFloat(item.quantity);
  const threshold = parseFloat(item.reorder_threshold);

  if (qty <= threshold) {
    await pool.query(
      `UPDATE tenant_inventory SET status='REORDER_REQUIRED', last_updated=NOW() WHERE tenant_id=$1 AND product_id=$2`,
      [tenantId, productId]
    ).catch(() => {});
    bus.system(`[VelocityEngine] 🔴 ${item.name} → REORDER_REQUIRED (${qty}${item.unit})`);
    bus.emit('inventory:reorder_required', { tenantId, productId, name: item.name, quantity: qty });
    return { status: 'REORDER_REQUIRED', productId, name: item.name, quantity: qty };
  }

  return { status: item.status, productId, name: item.name, quantity: qty };
}

/**
 * Retourne le statut de l'inventaire avec indicateurs de réapprovisionnement
 */
async function getInventoryStatus(pool, tenantId) {
  const r = await pool.query(
    `SELECT * FROM tenant_inventory WHERE tenant_id=$1 ORDER BY status DESC, name`,
    [tenantId]
  ).catch(() => ({ rows: [] }));
  const reorderItems = r.rows.filter(i => i.status === 'REORDER_REQUIRED' || i.status === 'low');
  return { items: r.rows, reorderItems, total: r.rows.length };
}

module.exports = { analyzeVelocity, checkAndFlagReorderRequired, checkProductVelocity, getInventoryStatus, REORDER_DAYS_THRESHOLD };
