'use strict';
/**
 * Payroll Archiver — DALEBA Metacortex Point 334
 * Archive automatiquement les historiques de paie > 5 ans.
 */
const bus = require('./event-bus');
const ARCHIVE_YEARS = 5;

async function archiveOldPayroll(pool, tenantId) {
  const cutoff = new Date();
  cutoff.setFullYear(cutoff.getFullYear() - ARCHIVE_YEARS);

  try {
    // Crée table d'archive si besoin
    await pool.query(`
      CREATE TABLE IF NOT EXISTS staff_payouts_archive (LIKE staff_payouts INCLUDING ALL)
    `).catch(() => {});

    // Déplace les lignes anciennes
    const moved = await pool.query(`
      WITH archived AS (
        DELETE FROM staff_payouts
        WHERE tenant_id=$1 AND created_at < $2 AND status='PAID'
        RETURNING *
      )
      INSERT INTO staff_payouts_archive SELECT * FROM archived
      RETURNING id
    `, [tenantId, cutoff.toISOString()]);

    bus.system(`[PayrollArchiver] ${moved.rowCount} lignes archivées (tenant: ${tenantId}, avant ${cutoff.toISOString().slice(0,10)})`);
    return { archived: moved.rowCount, cutoffDate: cutoff.toISOString().slice(0,10) };
  } catch (err) {
    bus.system(`[PayrollArchiver] Erreur: ${err.message}`);
    return { archived: 0, error: err.message };
  }
}

module.exports = { archiveOldPayroll, ARCHIVE_YEARS };
