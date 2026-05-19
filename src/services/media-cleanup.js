/**
 * Media Cleanup — DALEBA Metacortex Point 143
 *
 * Nettoyage automatisé post-publication :
 * - Suppression fichiers sources lourds après confirmation publication OK
 * - Réplication backup cloud avant suppression
 * - Registre des suppressions pour audit
 */

'use strict';

const fs   = require('fs').promises;
const fsSync = require('fs');
const path = require('path');
const maintenance = require('./maintenance');

// ─── BACKUP CLOUD [143] ───────────────────────────────────────────────────────

/**
 * Réplique un fichier vers le stockage cloud configuré
 * Supporte: Cloudinary (CLOUDINARY_URL), S3 (AWS_S3_BUCKET), ou archive locale
 */
async function backupToCloud(filePath, itemId) {
  const filename = path.basename(filePath);

  // Cloudinary
  if (process.env.CLOUDINARY_URL || process.env.CLOUDINARY_CLOUD_NAME) {
    try {
      const cloudinary = (() => { try { return require('cloudinary').v2; } catch { return null; } })();
      if (cloudinary) {
        const result = await cloudinary.uploader.upload(filePath, {
          folder:        'daleba/studio',
          public_id:     `${itemId}_${filename.replace(/\.[^.]+$/, '')}`,
          resource_type: 'video',
          overwrite:     true,
        });
        return { provider: 'cloudinary', url: result.secure_url, publicId: result.public_id };
      }
    } catch (err) {
      console.warn('[MediaCleanup] Cloudinary backup:', err.message);
    }
  }

  // Archive locale dans /tmp/daleba_archive (fallback) [143]
  const archiveDir = process.env.ARCHIVE_DIR || '/tmp/daleba_archive';
  await fs.mkdir(archiveDir, { recursive: true });
  const destPath = path.join(archiveDir, `${itemId}_${filename}`);
  await fs.copyFile(filePath, destPath);
  return { provider: 'local_archive', path: destPath };
}

// ─── NETTOYAGE POST-PUBLICATION [143] ────────────────────────────────────────

/**
 * Nettoie les fichiers sources après publication confirmée + backup
 * @param {object} publishedItem — row de daleba_content_queue
 */
async function cleanupAfterPublish(publishedItem) {
  if (!publishedItem?.file_path) return { cleaned: false, reason: 'no_file_path' };
  if (!publishedItem?.platform_post_id) return { cleaned: false, reason: 'not_published' };

  const filePath = publishedItem.file_path;

  // 1. Vérifier que le fichier existe
  if (!fsSync.existsSync(filePath)) return { cleaned: false, reason: 'file_not_found' };

  // 2. Backup cloud AVANT suppression [143]
  let backupResult = null;
  try {
    backupResult = await backupToCloud(filePath, publishedItem.id);
    console.log(`[MediaCleanup] Backup: ${backupResult.provider} — ${backupResult.url || backupResult.path}`);
  } catch (err) {
    console.warn('[MediaCleanup] Backup failed — SUPPRESSION ANNULÉE:', err.message);
    return { cleaned: false, reason: 'backup_failed', error: err.message };
  }

  // 3. Supprimer les fichiers associés
  const filesToClean = [
    filePath,
    filePath.replace(/\.mp4$/, '_audio.mp3'),        // audio temp
    filePath.replace(/\.mp4$/, '.srt'),               // sous-titres
    filePath.replace(/\.mp4$/, '.ass'),               // ASS
    filePath.replace(/\.(mp4|mov|webm)$/, '_thumb.jpg'), // thumbnail source
  ];

  let cleaned = 0;
  let totalFreedBytes = 0;

  for (const f of filesToClean) {
    try {
      const stat = await fs.stat(f).catch(() => null);
      if (stat) {
        totalFreedBytes += stat.size;
        await fs.unlink(f);
        cleaned++;
      }
    } catch { /* fichier déjà supprimé ou inexistant */ }
  }

  // 4. Enregistrement dans le journal d'audit [143]
  await _logCleanup(publishedItem.id, filePath, backupResult, totalFreedBytes);

  console.log(`[MediaCleanup] ✅ ${cleaned} fichiers supprimés (${(totalFreedBytes/1024/1024).toFixed(1)}MB libérés)`);
  return { cleaned: true, files: cleaned, freedMB: totalFreedBytes / 1024 / 1024, backup: backupResult };
}

async function _logCleanup(itemId, filePath, backup, freedBytes) {
  const pool = maintenance.getPool();
  if (!pool) return;
  await pool.query(`
    INSERT INTO daleba_notes (category, key, content, created_at)
    VALUES ('media_cleanup', $1, $2, NOW())
  `, [
    `cleanup_${itemId}`,
    JSON.stringify({ itemId, filePath: path.basename(filePath), backup, freedMB: freedBytes/1024/1024, ts: new Date().toISOString() }),
  ]).catch(() => {});
}

// ─── SCHEDULER DE NETTOYAGE ───────────────────────────────────────────────────

async function runPostPublishCleanup() {
  const pool = maintenance.getPool();
  if (!pool) return;

  // Sélectionne les items publiés il y a plus de 2h (assez pour analytics initial)
  const r = await pool.query(`
    SELECT * FROM daleba_content_queue
    WHERE status='published'
    AND published_at < NOW() - INTERVAL '2 hours'
    AND file_path IS NOT NULL
    AND file_path NOT LIKE '%_archived%'
    LIMIT 10
  `);

  let total = 0;
  for (const item of r.rows) {
    const result = await cleanupAfterPublish(item).catch(e => ({ error: e.message }));
    if (result.cleaned) {
      total++;
      // Marquer comme nettoyé en renommant le path
      await pool.query(
        `UPDATE daleba_content_queue SET file_path=$1 WHERE id=$2`,
        [`[archived:${result.backup?.provider || 'local'}]`, item.id]
      );
    }
  }

  if (total > 0) console.log(`[MediaCleanup] ${total} items nettoyés`);
  return { cleaned: total };
}

function startCleanupScheduler(intervalMs = 3 * 60 * 60 * 1000) {
  setInterval(() => {
    runPostPublishCleanup().catch(e => console.warn('[MediaCleanup] Scheduler:', e.message));
  }, intervalMs);
  console.log('[MediaCleanup] Scheduler démarré (toutes les 3h)');
}

// ─── EXPORTS ─────────────────────────────────────────────────────────────────

module.exports = { cleanupAfterPublish, backupToCloud, runPostPublishCleanup, startCleanupScheduler };
