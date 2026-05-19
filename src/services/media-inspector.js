/**
 * Media Inspector — DALEBA Metacortex Points 103-104
 *
 * Extraction non-bloquante des métadonnées via ffprobe.
 * Résolution · ratio · framerate · bitrate · codec · piste audio.
 */

'use strict';

const ffmpeg = require('fluent-ffmpeg');
const path   = require('path');
const { v4: uuidv4 } = require('uuid');
const maintenance = require('./maintenance');

// ─── INSPECTION [104] ─────────────────────────────────────────────────────────

/**
 * Extrait toutes les métadonnées d'un fichier vidéo via ffprobe
 * Non-bloquant : wrapping en Promise
 */
function inspectFile(filePath) {
  return new Promise((resolve, reject) => {
    ffmpeg.ffprobe(filePath, async (err, metadata) => {
      if (err) return reject(new Error(`ffprobe: ${err.message}`));

      const video = metadata.streams.find(s => s.codec_type === 'video');
      const audio = metadata.streams.find(s => s.codec_type === 'audio');
      const fmt   = metadata.format;

      if (!video) return reject(new Error('Aucun flux vidéo détecté'));

      // Calcul ratio d'aspect
      const gcd = (a, b) => b === 0 ? a : gcd(b, a % b);
      const w = video.width, h = video.height;
      const g = gcd(w, h);
      const aspectRatio = `${w/g}:${h/g}`;

      // Framerate (peut être sous forme "30000/1001" pour 29.97)
      const fpsRaw   = video.r_frame_rate || video.avg_frame_rate || '30/1';
      const [num, den] = fpsRaw.split('/').map(Number);
      const fps = den ? Math.round((num / den) * 100) / 100 : num;

      const result = {
        assetId:      uuidv4(),
        filePath,
        filename:     path.basename(filePath),
        // Vidéo [104]
        resolution:   `${w}x${h}`,
        width: w, height: h,
        aspectRatio,
        isPortrait:   h > w,
        fps,
        codec:        video.codec_name?.toLowerCase(),
        profile:      video.profile,
        bitrate:      fmt.bit_rate ? Math.round(fmt.bit_rate / 1000) + ' kbps' : null,
        bitrateRaw:   fmt.bit_rate ? parseInt(fmt.bit_rate) : null,
        duration:     Math.round(parseFloat(fmt.duration) * 100) / 100,
        sizeBytes:    parseInt(fmt.size),
        sizeMB:       Math.round(fmt.size / 1024 / 1024 * 100) / 100,
        // Audio
        audio: audio ? {
          codec:      audio.codec_name,
          sampleRate: audio.sample_rate,
          channels:   audio.channels,
          bitrate:    audio.bit_rate ? Math.round(audio.bit_rate / 1000) + ' kbps' : null,
        } : null,
        hasAudio:     !!audio,
        // Qualité estimée
        qualityScore: _scoreQuality(w, h, fps, fmt.bit_rate),
        inspectedAt:  new Date().toISOString(),
      };

      // Persistance en DB si disponible [107]
      await _persistAsset(result).catch(() => {});

      resolve(result);
    });
  });
}

function _scoreQuality(w, h, fps, bitrate) {
  let score = 0;
  if (w >= 1920) score += 40;
  else if (w >= 1280) score += 25;
  else if (w >= 720) score += 10;
  if (fps >= 30) score += 20;
  if (fps >= 60) score += 10;
  if (bitrate > 5_000_000) score += 30;
  else if (bitrate > 2_000_000) score += 20;
  return Math.min(score, 100);
}

async function _persistAsset(metadata) {
  const pool = maintenance.getPool();
  if (!pool) return;

  await pool.query(`
    INSERT INTO studio_assets (id, filename, file_path, resolution, fps, codec,
      duration_s, size_mb, has_audio, quality_score, metadata, created_at)
    VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,NOW())
    ON CONFLICT (id) DO NOTHING
  `, [
    metadata.assetId, metadata.filename, metadata.filePath,
    metadata.resolution, metadata.fps, metadata.codec,
    metadata.duration, metadata.sizeMB, metadata.hasAudio,
    metadata.qualityScore, JSON.stringify(metadata),
  ]);
}

// SQL de création de la table [107]
const CREATE_TABLE_SQL = `
CREATE TABLE IF NOT EXISTS studio_assets (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  filename        VARCHAR(500),
  file_path       TEXT,
  resolution      VARCHAR(20),
  fps             DECIMAL(5,2),
  codec           VARCHAR(50),
  duration_s      DECIMAL(10,2),
  size_mb         DECIMAL(10,2),
  has_audio       BOOLEAN DEFAULT true,
  quality_score   INTEGER DEFAULT 0,
  scene_analysis  JSONB,
  trend_tags      TEXT[],
  montage_script  JSONB,
  metadata        JSONB,
  created_at      TIMESTAMPTZ DEFAULT NOW(),
  processed_at    TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_studio_assets_created ON studio_assets(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_studio_assets_scene ON studio_assets USING GIN(scene_analysis);
`;

async function ensureStudioTable() {
  const pool = maintenance.getPool();
  if (!pool) return;
  await pool.query(CREATE_TABLE_SQL).catch(e => console.warn('[MediaInspector] Table:', e.message));
}

module.exports = { inspectFile, ensureStudioTable, CREATE_TABLE_SQL };
