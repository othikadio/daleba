'use strict';
/**
 * Aesthetic Inventory — DALEBA Metacortex Point 367
 * Déduit automatiquement les ingrédients utilisés lors d'un soin.
 * Lié à la table aesthetic_product_formulations [365].
 */
const bus = require('./event-bus');

async function initSchema(pool) {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS aesthetic_product_formulations (
      id              SERIAL PRIMARY KEY,
      tenant_id       TEXT NOT NULL,
      formulation_name TEXT NOT NULL,
      category        TEXT DEFAULT 'masque',  -- masque | sérum | mélange | huile
      ingredients     JSONB NOT NULL,   -- [{ name, qty_grams, unit }]
      instructions    TEXT,
      created_by      TEXT DEFAULT 'admin',
      active          BOOL DEFAULT true,
      created_at      TIMESTAMPTZ DEFAULT NOW()
    )
  `).catch(() => {});

  await pool.query(`
    CREATE TABLE IF NOT EXISTS aesthetic_inventory (
      id              SERIAL PRIMARY KEY,
      tenant_id       TEXT NOT NULL,
      ingredient_name TEXT NOT NULL,
      qty_available   NUMERIC(10,3),  -- grammes/ml disponibles
      unit            TEXT DEFAULT 'g',
      low_stock_alert NUMERIC(10,3) DEFAULT 50,
      updated_at      TIMESTAMPTZ DEFAULT NOW(),
      UNIQUE(tenant_id, ingredient_name)
    )
  `).catch(() => {});
}

/**
 * [367] Déduit les ingrédients utilisés lors d'un soin
 * @param {object[]} quantitiesUsed - [{ name, qty_grams }]
 */
async function deduct(pool, tenantId, formulationId, quantitiesUsed = []) {
  await initSchema(pool);
  const deductions = [];

  for (const item of quantitiesUsed) {
    const r = await pool.query(`
      UPDATE aesthetic_inventory
        SET qty_available = GREATEST(qty_available - $3, 0), updated_at = NOW()
      WHERE tenant_id=$1 AND ingredient_name=$2
      RETURNING ingredient_name, qty_available, low_stock_alert
    `, [tenantId, item.name, item.qty_grams]).catch(() => ({ rows: [] }));

    const updated = r.rows[0];
    if (updated) {
      deductions.push({ name: updated.ingredient_name, remaining: parseFloat(updated.qty_available) });
      // Alerte stock faible
      if (parseFloat(updated.qty_available) <= parseFloat(updated.low_stock_alert)) {
        bus.system(`[AestheticInventory] ⚠️ STOCK FAIBLE: ${updated.ingredient_name} — ${updated.qty_available}g restants`);
      }
    }
  }

  bus.system(`[AestheticInventory] Déduction: ${deductions.length} ingrédients (formulation ${formulationId})`);
  return { deducted: deductions.length, deductions };
}

async function getInventory(pool, tenantId) {
  await initSchema(pool);
  const r = await pool.query(
    `SELECT * FROM aesthetic_inventory WHERE tenant_id=$1 ORDER BY ingredient_name`,
    [tenantId]
  );
  return r.rows;
}

module.exports = { initSchema, deduct, getInventory };
