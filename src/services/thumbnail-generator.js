/**
 * Thumbnail Generator — DALEBA Metacortex Points 141-142
 *
 * [141] Génération miniature Flux.1 Pro / DALL-E 3 / Imagen 3
 * [142] Upscaling Real-ESRGAN x4 + GFPGAN polissage visages
 * Connecté à la content-queue pour auto-génération à chaque vidéo.
 */

'use strict';

const path = require('path');
const fs   = require('fs').promises;

const THUMB_DIR = process.env.THUMB_OUTPUT_DIR || '/tmp/daleba_thumbnails';

// ─── GÉNÉRATION MINIATURE [141] ───────────────────────────────────────────────

/**
 * Génère une miniature percutante pour une vidéo
 * @param {object} options
 *   sceneAnalysis  — analyse Gemini de la vidéo
 *   seoTitle       — titre SEO de la publication
 *   platform       — 'instagram'|'tiktok'|'youtube'
 *   style          — style tenant (beauty, botanique, coiffure...)
 */
async function generateThumbnail(options = {}) {
  await fs.mkdir(THUMB_DIR, { recursive: true });

  const imageEngine = require('./image-engine');
  const { sceneAnalysis, seoTitle, platform, style = 'beauty', assetId } = options;

  // Construction du prompt basé sur l'analyse sémantique [141]
  const action   = sceneAnalysis?.overall?.primary_action || 'salon service';
  const angle    = sceneAnalysis?.overall?.marketing_angle || 'professional beauty';
  const quality  = sceneAnalysis?.overall?.production_quality || 'high';

  const platformSpec = {
    instagram: 'Instagram Reels thumbnail 1080x1920, portrait format, bold text overlay space at top',
    tiktok:    'TikTok thumbnail 1080x1920, vertical, high contrast, face-centered',
    youtube:   'YouTube thumbnail 1280x720, landscape, face visible, bright saturated colors',
  }[platform] || 'social media thumbnail, bold, vibrant';

  const prompt = [
    `Premium salon thumbnail for: ${seoTitle || action}`,
    `Scene: ${action} — ${angle}`,
    `Format: ${platformSpec}`,
    `Style: luxury afro hair salon, professional photography, dramatic lighting`,
    `Production quality: ${quality}`,
    `KADIO COIFFURE brand, Longueuil QC`,
  ].join('. ');

  // [141] Génération via orchestrateur Flux.1 → DALL-E 3 → Imagen 3
  const genResult = await imageEngine.generateEliteVisual(prompt, {
    style: style === 'botanique' ? 'botanique' : 'beauty',
    width:  platform === 'youtube' ? 1280 : 1080,
    height: platform === 'youtube' ? 720  : 1920,
    quality: 'premium',
    negative: 'blur, low resolution, watermark, text, logo, amateur, dark, underexposed',
  });

  if (!genResult?.imagePath && !genResult?.imageUrl) {
    throw new Error('Thumbnail generation failed: no image returned');
  }

  const sourcePath = genResult.imagePath || await _downloadImage(genResult.imageUrl, assetId);

  // [142] Upscaling Real-ESRGAN x4 + GFPGAN
  const upscaledPath = await upscaleThumbnail(sourcePath, { faceEnhance: true });

  return {
    thumbnailPath: upscaledPath,
    sourcePath,
    model: genResult.model || genResult.provider,
    prompt,
    generatedAt: new Date().toISOString(),
  };
}

async function _downloadImage(url, assetId) {
  const axios = require('axios');
  const ext   = url.includes('.png') ? '.png' : '.jpg';
  const dest  = path.join(THUMB_DIR, `thumb_${assetId || Date.now()}${ext}`);
  const r     = await axios.get(url, { responseType: 'arraybuffer', timeout: 30000 });
  await fs.writeFile(dest, Buffer.from(r.data));
  return dest;
}

// ─── UPSCALING + GFPGAN [142] ────────────────────────────────────────────────

async function upscaleThumbnail(imagePath, options = {}) {
  const upscaler = require('./image-upscaler');

  // [142] Real-ESRGAN x4
  const upscaleResult = await upscaler.upscaleImage(imagePath, {
    scale:  4,
    model:  'real-esrgan',
  });

  if (!upscaleResult?.outputPath) return imagePath; // fallback si indisponible

  // [142] GFPGAN polissage visages si portrait
  if (options.faceEnhance !== false) {
    const faceResult = await upscaler.enhanceFaces(upscaleResult.outputPath, {
      model: 'gfpgan',
    }).catch(() => null);

    if (faceResult?.outputPath) return faceResult.outputPath;
  }

  return upscaleResult.outputPath;
}

// ─── INTÉGRATION CONTENT QUEUE [141] ─────────────────────────────────────────

/**
 * Génère et attache automatiquement une miniature à un item de queue
 */
async function attachThumbnailToQueueItem(queueItemId, sceneAnalysis, seoTitle, platform) {
  try {
    const thumbnail = await generateThumbnail({ sceneAnalysis, seoTitle, platform, assetId: queueItemId });

    // Mettre à jour l'item avec le chemin miniature
    const pool = require('./maintenance').getPool();
    if (pool) {
      await pool.query(
        `UPDATE daleba_content_queue SET targeting = targeting || $1 WHERE id=$2`,
        [JSON.stringify({ thumbnailPath: thumbnail.thumbnailPath }), queueItemId]
      );
    }

    console.log(`[ThumbnailGen] ✅ Miniature attachée: ${path.basename(thumbnail.thumbnailPath)}`);
    return thumbnail;
  } catch (err) {
    console.warn(`[ThumbnailGen] Erreur: ${err.message}`);
    return null;
  }
}

// ─── EXPORTS ─────────────────────────────────────────────────────────────────

module.exports = {
  generateThumbnail, upscaleThumbnail, attachThumbnailToQueueItem,
  THUMB_DIR,
};
