'use strict';
/**
 * Dynamic Stock Tracker — DALEBA Metacortex Points 452, 459
 * [452] Table tenant_inventory: produits botaniques, quantités, seuils, coûts
 * [459] Soustraction automatique formule ingrédients sur transaction Square
 */
const bus = require('./event-bus');

// [452] Ingrédients botaniques emblématiques du Bar à Plantes
const DEFAULT_INGREDIENTS = [
  { product_id: 'moringa-poudre',   name: 'Moringa (poudre)',          unit: 'g',  reorder_threshold: 200, cost_per_unit: 0.08  },
  { product_id: 'chebe-poudre',     name: 'Poudre de Chebe authentique', unit: 'g', reorder_threshold: 100, cost_per_unit: 0.45  },
  { product_id: 'fakoye-extrait',   name: 'Extrait de Fakoye',          unit: 'ml', reorder_threshold: 150, cost_per_unit: 0.35  },
  { product_id: 'argan-huile',      name: "Huile d'Argan pure",         unit: 'ml', reorder_threshold: 300, cost_per_unit: 0.12  },
  { product_id: 'aloe-gel',         name: 'Gel Aloe Vera',              unit: 'ml', reorder_threshold: 500, cost_per_unit: 0.04  },
  { product_id: 'baobab-huile',     name: 'Huile de Baobab',           unit: 'ml', reorder_threshold: 200, cost_per_unit: 0.18  },
  { product_id: 'hibiscus-poudre',  name: 'Poudre d\'Hibiscus',        unit: 'g',  reorder_threshold: 150, cost_per_unit: 0.06  },
  { product_id: 'jojoba-huile',     name: 'Huile de Jojoba',           unit: 'ml', reorder_threshold: 250, cost_per_unit: 0.14  },
];

// [459] Formules de consommation par type de soin (en grammes/ml par service)
const CONSUMPTION_FORMULAS = {
  'soin-capillaire':     { 'argan-huile': 15, 'moringa-poudre': 5, 'aloe-gel': 30 },
  'traitement-chebe':    { 'chebe-poudre': 20, 'baobab-huile': 10, 'fakoye-extrait': 5 },
  'masque-botanique':    { 'moringa-poudre': 10, 'hibiscus-poudre': 8, 'aloe-gel': 20 },
  'soin-cuir-chevelu':   { 'fakoye-extrait': 10, 'jojoba-huile': 12, 'aloe-gel': 15 },
  'default':             { 'argan-huile': 8, 'aloe-gel': 15 },
};

async function initSchema(pool) {
  if (!pool?.query) return;
  await pool.query(`
    CREATE TABLE IF NOT EXISTS tenant_inventory (
      id                SERIAL PRIMARY KEY,
      tenant_id         TEXT NOT NULL,
      product_id        TEXT NOT NULL,
      name              TEXT NOT NULL,
      unit              TEXT DEFAULT 'g',
      quantity          NUMERIC(10,2) DEFAULT 0,
      reorder_threshold NUMERIC(10,2) DEFAULT 100,
      cost_per_unit     NUMERIC(10,4) DEFAULT 0,
      supplier_id       TEXT,
      status            TEXT DEFAULT 'ok',  -- ok | low | REORDER_REQUIRED | out_of_stock
      last_updated      TIMESTAMPTZ DEFAULT NOW(),
      UNIQUE(tenant_id, product_id)
    )
  `).catch(() => {});
  await pool.query('CREATE INDEX IF NOT EXISTS idx_inv_status ON tenant_inventory(tenant_id, status)').catch(() => {});
}

/**
 * [452] Initialise l'inventaire avec les ingrédients par défaut
 */
async function seedDefaultInventory(pool, tenantId, initialQty = 1000) {
  await initSchema(pool);
  for (const ing of DEFAULT_INGREDIENTS) {
    await pool.query(`
      INSERT INTO tenant_inventory (tenant_id, product_id, name, unit, quantity, reorder_threshold, cost_per_unit)
      VALUES ($1,$2,$3,$4,$5,$6,$7)
      ON CONFLICT (tenant_id, product_id) DO NOTHING
    `, [tenantId, ing.product_id, ing.name, ing.unit, initialQty, ing.reorder_threshold, ing.cost_per_unit]).catch(() => {});
  }
  return { seeded: DEFAULT_INGREDIENTS.length };
}

/**
 * [459] Soustrait les ingrédients consommés par un soin/transaction Square
 */
async function deductIngredients(pool, tenantId, { serviceType, quantity = 1, txId }) {
  await initSchema(pool);
  const formula = CONSUMPTION_FORMULAS[serviceType] || CONSUMPTION_FORMULAS['default'];
  const results = {};

  for (const [productId, amountPerService] of Object.entries(formula)) {
    const toDeduct = amountPerService * quantity;
    const r = await pool.query(`
      UPDATE tenant_inventory
      SET quantity = GREATEST(quantity - $3, 0),
          last_updated = NOW(),
          status = CASE
            WHEN (quantity - $3) <= 0                  THEN 'out_of_stock'
            WHEN (quantity - $3) <= reorder_threshold  THEN 'low'
            ELSE 'ok'
          END
      WHERE tenant_id=$1 AND product_id=$2
      RETURNING product_id, name, quantity, status, reorder_threshold
    `, [tenantId, productId, toDeduct]).catch(() => ({ rows: [] }));

    if (r.rows[0]) {
      results[productId] = { deducted: toDeduct, remaining: parseFloat(r.rows[0].quantity), status: r.rows[0].status };
      if (r.rows[0].status === 'low' || r.rows[0].status === 'out_of_stock') {
        bus.system(`[StockTracker] ⚠️ ${r.rows[0].name}: ${r.rows[0].quantity}${r.rows[0].unit || 'g'} restant (${r.rows[0].status})`);
        bus.emit('inventory:low', { tenantId, productId, name: r.rows[0].name, quantity: r.rows[0].quantity, status: r.rows[0].status });
      }
    }
  }

  bus.system(`[StockTracker] 📦 Déduction soin "${serviceType}×${quantity}" (tx: ${txId || '—'})`);
  return { serviceType, txId, deductions: results };
}

/**
 * Retourne l'état complet de l'inventaire
 */
async function getInventoryStatus(pool, tenantId) {
  await initSchema(pool);
  const r = await pool.query(
    `SELECT * FROM tenant_inventory WHERE tenant_id=$1 ORDER BY status DESC, name`,
    [tenantId]
  ).catch(() => ({ rows: [] }));
  return { tenantId, items: r.rows, updatedAt: new Date().toISOString() };
}

module.exports = { initSchema, seedDefaultInventory, deductIngredients, getInventoryStatus, DEFAULT_INGREDIENTS, CONSUMPTION_FORMULAS };
