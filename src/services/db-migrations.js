/**
 * Service de migrations DB — utilitaires avec IF NOT EXISTS
 */

async function createTableIfNotExists(pool, tableName, createSql) {
  try {
    await pool.query(createSql);
  } catch (e) {
    // Ignorer erreurs de "table already exists"
    if (!e.message.includes('already exists')) {
      console.warn(`[DB Migration] ${tableName}:`, e.message);
    }
  }
}

module.exports = { createTableIfNotExists };
