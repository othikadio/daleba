'use strict';
/**
 * Backup Manager — DALEBA Metacortex Point 295
 * Sauvegardes automatisées à 03h00 isolées par tenant actif.
 */
const bus = require('./event-bus');
const fs  = require('fs');
const path = require('path');

const BACKUP_DIR = process.env.BACKUP_DIR || '/tmp/daleba-backups';

async function initBackupDir() {
  if (!fs.existsSync(BACKUP_DIR)) fs.mkdirSync(BACKUP_DIR, { recursive: true });
}

/**
 * Exporte la structure + données d'un tenant en JSON isolé
 * [295] Chaque tenant a son propre fichier — aucune mutualisation
 */
async function backupTenant(pool, tenantId) {
  if (!pool) return { backed: false, reason: 'No pool' };

  const tables = [
    'tenant_settings', 'tenant_credentials', 'tenant_env_vars',
    'tenant_cron_registry', 'tenant_fixed_costs', 'tenant_catalog',
    'tenant_staff', 'staff_profiles', 'tenant_appointments',
    'tenant_call_logs', 'tenant_ledgers', 'saas_billing',
  ];

  const backup = { tenantId, exportedAt: new Date().toISOString(), tables: {} };

  for (const table of tables) {
    try {
      const r = await pool.query(`SELECT * FROM ${table} WHERE tenant_id=$1`, [tenantId]);
      backup.tables[table] = r.rows;
    } catch { backup.tables[table] = []; }
  }

  await initBackupDir();
  const date     = new Date().toISOString().split('T')[0];
  const filename = `backup_${tenantId}_${date}.json`;
  const filepath = path.join(BACKUP_DIR, filename);

  fs.writeFileSync(filepath, JSON.stringify(backup, null, 2));
  bus.system(`[Backup] ✅ ${tenantId} → ${filename} (${Object.values(backup.tables).reduce((s,t)=>s+t.length,0)} rows)`);
  return { backed: true, filepath, filename, rowCount: Object.values(backup.tables).reduce((s,t)=>s+t.length,0) };
}

/**
 * [295] Lance les sauvegardes de TOUS les tenants actifs — isolation stricte
 */
async function runNightlyBackup(pool) {
  if (!pool) { bus.system('[Backup] Pool indisponible — sauvegarde annulée'); return; }

  bus.system('[Backup] 🌙 Démarrage sauvegarde nightly 03h00');
  const tenants = await pool.query(`SELECT tenant_id, tenant_name FROM tenant_settings WHERE status='active'`).catch(()=>({rows:[]}));

  const results = [];
  for (const t of tenants.rows) {
    const r = await backupTenant(pool, t.tenant_id).catch(e => ({ backed: false, error: e.message }));
    results.push({ ...r, tenantId: t.tenant_id, tenantName: t.tenant_name });
  }

  const ok      = results.filter(r => r.backed).length;
  const failed  = results.filter(r => !r.backed).length;
  bus.system(`[Backup] Nightly terminé: ${ok} OK, ${failed} échecs sur ${results.length} tenants`);
  return { ok, failed, total: results.length, results };
}

/**
 * Purge les backups > 30 jours
 */
function purgeOldBackups(daysToKeep = 30) {
  if (!fs.existsSync(BACKUP_DIR)) return 0;
  const cutoff = Date.now() - daysToKeep * 86400000;
  let purged = 0;
  for (const file of fs.readdirSync(BACKUP_DIR)) {
    const fp   = path.join(BACKUP_DIR, file);
    const stat = fs.statSync(fp);
    if (stat.mtimeMs < cutoff) { fs.unlinkSync(fp); purged++; }
  }
  if (purged) bus.system(`[Backup] 🗑️ ${purged} backups purgés (>${daysToKeep}j)`);
  return purged;
}

module.exports = { backupTenant, runNightlyBackup, purgeOldBackups };
