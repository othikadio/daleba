/**
 * DALEBA — Database Pool Helper
 * Export central pour accès au pool PostgreSQL
 */

const { pool } = require('../memory/db');

function getPool() {
  if (!pool) {
    throw new Error('Database pool not initialized (running in DEMO mode?)');
  }
  return pool;
}

module.exports = { getPool, pool };
