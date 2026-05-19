/**
 * Maintenance Service — DALEBA Metacortex Points 089-090
 *
 * [089] Nettoyage disque : logs build, caches vidéo, fichiers temp
 * [090] pg-pool optimisé + indexations stratégiques
 */

'use strict';

const fs    = require('fs').promises;
const fsSync = require('fs');
const path  = require('path');

const ROOT = process.env.REPO_PATH || path.resolve(__dirname, '../../');

// ─── NETTOYAGE DISQUE [089] ───────────────────────────────────────────────────

const CLEANUP_TARGETS = [
  { dir: '/tmp',              pattern: /\.(mp4|webm|mp3|wav|png|jpg|jpeg)$/i, maxAgeHours: 2  },
  { dir: path.join(ROOT, 'logs'),    pattern: /\.log$/,   maxAgeHours: 72 },
  { dir: path.join(ROOT, 'public', 'videos'), pattern: /\.(mp4|webm)$/, maxAgeHours: 48 },
  { dir: path.join(ROOT, 'public', 'images', 'generated'), pattern: /\.(png|jpg|jpeg|webp)$/, maxAgeHours: 24 },
];

async function cleanupDir(dir, pattern, maxAgeHours) {
  if (!fsSync.existsSync(dir)) return { dir, cleaned: 0, freedBytes: 0 };

  const entries = await fs.readdir(dir).catch(() => []);
  const cutoff = Date.now() - maxAgeHours * 3600 * 1000;
  let cleaned = 0;
  let freedBytes = 0;

  for (const entry of entries) {
    if (!pattern.test(entry)) continue;
    const filePath = path.join(dir, entry);
    try {
      const stat = await fs.stat(filePath);
      if (stat.mtimeMs < cutoff) {
        freedBytes += stat.size;
        await fs.unlink(filePath);
        cleaned++;
      }
    } catch {}
  }

  return { dir, cleaned, freedBytes };
}

async function runCleanup() {
  const results = await Promise.allSettled(
    CLEANUP_TARGETS.map(t => cleanupDir(t.dir, t.pattern, t.maxAgeHours))
  );

  const summary = results
    .filter(r => r.status === 'fulfilled')
    .map(r => r.value)
    .filter(r => r.cleaned > 0);

  const totalFreed = summary.reduce((a, r) => a + r.freedBytes, 0);
  const totalCleaned = summary.reduce((a, r) => a + r.cleaned, 0);

  if (totalCleaned > 0) {
    console.log(`[Maintenance] Nettoyage: ${totalCleaned} fichiers supprimés, ${(totalFreed / 1024 / 1024).toFixed(1)} MB libérés`);
    const bus = (() => { try { return require('./event-bus'); } catch { return null; } })();
    if (bus) bus.system(`🧹 Maintenance: ${totalCleaned} fichiers temp supprimés (${(totalFreed / 1024 / 1024).toFixed(1)} MB)`);
  }

  return { totalCleaned, totalFreedMB: totalFreed / 1024 / 1024, details: summary };
}

// Nettoyage automatique toutes les 4h [047]
let cleanupInterval = null;
function startAutoCleanup(intervalMs = 4 * 60 * 60 * 1000) {
  if (cleanupInterval) return;
  setTimeout(runCleanup, 30000); // Premier run 30s après boot
  cleanupInterval = setInterval(runCleanup, intervalMs);
  console.log('[Maintenance] Auto-cleanup démarré (toutes les', intervalMs / 3600000, 'h)');
}

// ─── PG-POOL OPTIMISÉ [090] ───────────────────────────────────────────────────

let _pool = null;

function getPool() {
  if (_pool) return _pool;

  try {
    const { Pool } = require('pg');
    _pool = new Pool({
      connectionString: process.env.DATABASE_URL,
      max: 10,             // Max connexions simultanées
      min: 2,              // Connexions maintenues en pool
      idleTimeoutMillis: 30000,    // Ferme connexions inactives après 30s
      connectionTimeoutMillis: 5000,
      ssl: process.env.NODE_ENV === 'production'
        ? { rejectUnauthorized: false }
        : false,
    });

    _pool.on('error', (err) => {
      console.error('[PG Pool] Erreur connexion:', err.message);
    });

    console.log('[Maintenance] pg-pool initialisé (max: 10 connexions)');
    return _pool;
  } catch (err) {
    console.warn('[Maintenance] pg non disponible:', err.message);
    return null;
  }
}

/**
 * [090] Crée les indexes stratégiques sur les tables DALEBA
 * À appeler une seule fois au démarrage ou en migration
 */
async function ensureIndexes() {
  const pool = getPool();
  if (!pool) return { skipped: true };

  const indexes = [
    // Chat sessions — lookup rapide par statut
    `CREATE INDEX IF NOT EXISTS idx_chat_sessions_status ON daleba_chat_sessions(status)`,
    `CREATE INDEX IF NOT EXISTS idx_chat_sessions_phone ON daleba_chat_sessions(phone_number)`,
    // Loyalty — lookup client
    `CREATE INDEX IF NOT EXISTS idx_loyalty_phone ON daleba_loyalty(phone_number)`,
    `CREATE INDEX IF NOT EXISTS idx_loyalty_points ON daleba_loyalty(points DESC)`,
    // Content queue — publications en attente
    `CREATE INDEX IF NOT EXISTS idx_content_queue_status ON daleba_content_queue(status)`,
    `CREATE INDEX IF NOT EXISTS idx_content_queue_scheduled ON daleba_content_queue(scheduled_at)`,
    // Notes stratégiques — recherche par catégorie
    `CREATE INDEX IF NOT EXISTS idx_notes_category ON daleba_notes(category)`,
    `CREATE INDEX IF NOT EXISTS idx_notes_created ON daleba_notes(created_at DESC)`,
  ];

  const results = [];
  for (const sql of indexes) {
    try {
      await pool.query(sql);
      results.push({ sql: sql.slice(0, 60), ok: true });
    } catch (err) {
      results.push({ sql: sql.slice(0, 60), ok: false, error: err.message });
    }
  }

  const success = results.filter(r => r.ok).length;
  console.log(`[Maintenance] Indexes: ${success}/${indexes.length} ok`);
  return { success, total: indexes.length, results };
}

/**
 * Query helper avec pool (remplace les connexions directes)
 */
async function query(sql, params = []) {
  const pool = getPool();
  if (!pool) throw new Error('pg-pool non disponible');
  return pool.query(sql, params);
}

// ─── EXPORTS ─────────────────────────────────────────────────────────────────

module.exports = {
  runCleanup, startAutoCleanup,
  getPool, query, ensureIndexes,
};
