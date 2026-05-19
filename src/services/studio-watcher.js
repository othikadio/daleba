/**
 * Studio Watcher — DALEBA Metacortex Point 102
 *
 * Worker permanent qui surveille /public/studio pour détecter
 * en temps réel tout nouveau fichier vidéo brut (rush).
 * Déclenche MediaAgent en mode full_pipeline automatiquement.
 */

'use strict';

const chokidar = require('chokidar');
const path     = require('path');
const fsSync   = require('fs');
const { MediaAgent, ACCEPTED_FORMATS } = require('../agents/MediaAgent');

// ─── CONFIG [102] ─────────────────────────────────────────────────────────────

const WATCH_DIR = process.env.STUDIO_WATCH_DIR ||
  path.resolve(__dirname, '../../public/studio');

// Anti-doublon : évite de traiter le même fichier deux fois
const processed = new Set();
// File d'attente des rushes (traitement séquentiel pour pas saturer CPU)
const queue = [];
let isProcessing = false;

// ─── WATCHER [102] ───────────────────────────────────────────────────────────

let _watcher = null;

function start() {
  // Crée le dossier si inexistant
  if (!fsSync.existsSync(WATCH_DIR)) {
    fsSync.mkdirSync(WATCH_DIR, { recursive: true });
  }

  console.log(`[StudioWatcher] 👁️ Surveillance: ${WATCH_DIR}`);

  _watcher = chokidar.watch(WATCH_DIR, {
    persistent:    true,
    ignoreInitial: false,   // traite aussi les fichiers déjà présents au démarrage
    awaitWriteFinish: {
      stabilityThreshold: 2000,  // attend 2s de stabilité avant de déclencher
      pollInterval:        500,
    },
    depth: 2,
  });

  _watcher
    .on('add', (filePath) => _onNewFile(filePath, 'new'))
    .on('change', (filePath) => _onNewFile(filePath, 'updated'))
    .on('error', (err) => console.error('[StudioWatcher] Erreur:', err.message))
    .on('ready', () => console.log('[StudioWatcher] ✅ Watcher prêt — en attente de rushes…'));

  return _watcher;
}

function stop() {
  if (_watcher) { _watcher.close(); _watcher = null; }
}

// ─── DÉTECTION [103] ─────────────────────────────────────────────────────────

function _onNewFile(filePath, event) {
  const ext = path.extname(filePath).toLowerCase();

  // [103] Filtre sur les formats acceptés
  if (!ACCEPTED_FORMATS.has(ext)) return;

  // Anti-doublon
  if (processed.has(filePath)) return;

  console.log(`[StudioWatcher] 🎬 Rush détecté (${event}): ${path.basename(filePath)}`);

  const bus = (() => { try { return require('./event-bus'); } catch { return null; } })();
  bus?.system(`🎬 Nouveau rush détecté: ${path.basename(filePath)}`);

  queue.push(filePath);
  _processQueue();
}

// ─── QUEUE DE TRAITEMENT ─────────────────────────────────────────────────────

async function _processQueue() {
  if (isProcessing || queue.length === 0) return;
  isProcessing = true;

  const filePath = queue.shift();
  processed.add(filePath);

  const bus = (() => { try { return require('./event-bus'); } catch { return null; } })();

  try {
    const agent = new MediaAgent({ config: { timeoutMs: 10 * 60 * 1000 } }); // 10 min max

    bus?.system(`🤖 MediaAgent ${agent.agentId} — pipeline lancé pour ${path.basename(filePath)}`);

    const result = await agent.run({
      action: 'full_pipeline',
      filePath,
      formats: ['reels', 'square', 'story'],
    });

    console.log(`[StudioWatcher] ✅ Pipeline terminé: ${path.basename(filePath)}`);
    bus?.system(`✅ Renders prêts: ${Object.keys(result.renders || {}).join(', ')} — ${path.basename(filePath)}`);

  } catch (err) {
    console.error(`[StudioWatcher] ❌ Pipeline échoué: ${err.message}`);
    bus?.system(`❌ Erreur pipeline: ${path.basename(filePath)} — ${err.message.slice(0, 80)}`);
    processed.delete(filePath); // Permet retry
  }

  isProcessing = false;
  if (queue.length > 0) _processQueue();
}

// ─── TRIGGER MANUEL ──────────────────────────────────────────────────────────

function triggerFile(filePath) {
  processed.delete(filePath); // Reset pour forcer re-traitement
  _onNewFile(filePath, 'manual');
}

function getStatus() {
  return {
    watching: WATCH_DIR,
    active: !!_watcher,
    queueLength: queue.length,
    isProcessing,
    processedCount: processed.size,
  };
}

// ─── EXPORTS ─────────────────────────────────────────────────────────────────

module.exports = { start, stop, triggerFile, getStatus };
