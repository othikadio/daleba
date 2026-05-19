'use strict';
/**
 * Stock Waste Tracker — DALEBA [494]
 * Employés déclarent les grammes gaspillés ou périmés depuis leur interface.
 */
const bus = require('./event-bus');

async function initSchema(pool) {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS tenant_stock_waste (
      id          SERIAL PRIMARY KEY,
      tenant_id   TEXT NOT NULL,
      product_id  TEXT NOT NULL,
      quantity    NUMERIC(10,2) NOT NULL,
      unit        TEXT DEFAULT 'g',
      reason      TEXT DEFAULT 'waste', -- waste | expired | broken | spillage
      declared_by TEXT,
      declared_at TIMESTAMPTZ DEFAULT NOW()
    )
  `).catch(() => {});
  await pool.query('CREATE INDEX IF NOT EXISTS idx_waste ON tenant_stock_waste(tenant_id, product_id, declared_at DESC)').catch(() => {});
}

/**
 * [494] Déclare une perte/gaspillage et soustrait de l'inventaire
 */
async function declareWaste(pool, tenantId, { productId, quantity, reason, declaredBy }) {
  await initSchema(pool);
  // Soustrait de l'inventaire
  await pool.query(`
    UPDATE tenant_inventory SET quantity = GREATEST(quantity - $3, 0), last_updated=NOW()
    WHERE tenant_id=$1 AND product_id=$2
  `, [tenantId, productId, quantity]).catch(() => {});
  // Enregistre la perte
  await pool.query(`
    INSERT INTO tenant_stock_waste (tenant_id, product_id, quantity, reason, declared_by)
    VALUES ($1,$2,$3,$4,$5)
  `, [tenantId, productId, quantity, reason || 'waste', declaredBy || 'staff']).catch(() => {});
  bus.system(`[WasteTracker] 🗑️ Perte déclarée: ${quantity}g de ${productId} (${reason||'waste'}) par ${declaredBy||'staff'}`);
  return { declared: true, productId, quantity, reason };
}

/**
 * Rapport des pertes par période
 */
async function getWasteReport(pool, tenantId, days = 30) {
  const r = await pool.query(`
    SELECT product_id, SUM(quantity) AS total_wasted, reason, COUNT(*) AS incidents
    FROM tenant_stock_waste WHERE tenant_id=$1 AND declared_at >= NOW() - ($2 || ' days')::INTERVAL
    GROUP BY product_id, reason ORDER BY total_wasted DESC
  `, [tenantId, days]).catch(() => ({ rows: [] }));
  return { period: `${days}d`, wasteEntries: r.rows };
}

module.exports = { declareWaste, getWasteReport, initSchema };
