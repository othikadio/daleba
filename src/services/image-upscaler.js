/**
 * DALEBA V29 — Laboratoire de Finition (Image Upscaler)
 * Upscaling 4K + correction artefacts + optimisation web
 * Modèles: Real-ESRGAN (Replicate) → Sharp fallback (local)
 */

const bus  = require('./event-bus');
const path = require('path');
const fs   = require('fs');
const os   = require('os');
const https = require('https');
const http  = require('http');

// ─── UTILITAIRES ─────────────────────────────────────────────────────────────

function tmpFile(ext) {
  return path.join(os.tmpdir(), `daleba_up_${Date.now()}_${Math.random().toString(36).slice(2)}.${ext}`);
}

/** Télécharge une image depuis une URL → buffer */
async function downloadImage(url) {
  return new Promise((resolve, reject) => {
    const client = url.startsWith('https') ? https : http;
    const chunks = [];
    client.get(url, (res) => {
      res.on('data', c => chunks.push(c));
      res.on('end', () => resolve(Buffer.concat(chunks)));
      res.on('error', reject);
    }).on('error', reject);
  });
}

// ─── UPSCALING VIA REPLICATE (Real-ESRGAN) ───────────────────────────────────

/**
 * Upscale via Real-ESRGAN x4 sur Replicate
 * Excellent pour photos réelles (salon, portraits, botaniques)
 */
async function upscaleRealESRGAN(imageUrl, scale = 4) {
  if (!process.env.REPLICATE_API_TOKEN) {
    throw new Error('REPLICATE_API_TOKEN requis pour Real-ESRGAN');
  }

  const Replicate = require('replicate');
  const replicate = new Replicate({ auth: process.env.REPLICATE_API_TOKEN });

  bus.system(`[UPSCALER] Real-ESRGAN x${scale} en cours...`);

  const output = await replicate.run(
    'nightmareai/real-esrgan:f121d640bd286e1fdc67f9799164c1d5be36ff74576ee2d96b07ea52a8ea3f96',
    {
      input: {
        image:   imageUrl,
        scale,
        face_enhance: false, // true pour portraits (GFPGAN activé)
      },
    }
  );

  return {
    url:      output?.toString(),
    scale,
    method:   'real-esrgan',
    provider: 'replicate',
  };
}

/**
 * Upscale portrait avec restauration visage (GFPGAN + Real-ESRGAN)
 */
async function upscalePortrait(imageUrl) {
  if (!process.env.REPLICATE_API_TOKEN) {
    throw new Error('REPLICATE_API_TOKEN requis');
  }

  const Replicate = require('replicate');
  const replicate = new Replicate({ auth: process.env.REPLICATE_API_TOKEN });

  bus.system('[UPSCALER] Portrait enhancement (GFPGAN + ESRGAN)...');

  const output = await replicate.run(
    'nightmareai/real-esrgan:f121d640bd286e1fdc67f9799164c1d5be36ff74576ee2d96b07ea52a8ea3f96',
    { input: { image: imageUrl, scale: 4, face_enhance: true } }
  );

  return {
    url:      output?.toString(),
    scale:    4,
    method:   'real-esrgan-gfpgan',
    provider: 'replicate',
  };
}

// ─── FINITION LOCALE (Sharp) ──────────────────────────────────────────────────

/**
 * Pipeline de finition local via Sharp
 * - Upscale 2x Lanczos (fallback si pas de Replicate)
 * - Correction automatique : sharpening, saturation, contraste
 * - Export WebP optimisé pour le web
 */
async function localFinishing(imageInput, options = {}) {
  const sharp = require('sharp');

  const {
    upscaleFactor  = 2,
    sharpness      = 0.8,   // 0-2
    saturation     = 1.1,   // 1.0 = neutre
    brightness     = 1.02,
    outputFormat   = 'webp',
    quality        = 90,
    targetWidth    = null,  // null = upscale proportionnel
  } = options;

  bus.system(`[UPSCALER] Finition locale Sharp — x${upscaleFactor}`);

  // Charger l'image (URL ou buffer ou chemin)
  let pipeline;
  if (typeof imageInput === 'string' && imageInput.startsWith('http')) {
    const buffer = await downloadImage(imageInput);
    pipeline = sharp(buffer);
  } else if (Buffer.isBuffer(imageInput)) {
    pipeline = sharp(imageInput);
  } else {
    pipeline = sharp(imageInput);
  }

  // Métadonnées pour calcul dimensions
  const meta = await pipeline.metadata();
  const newWidth  = targetWidth || Math.round(meta.width  * upscaleFactor);
  const newHeight = Math.round(meta.height * upscaleFactor);

  // Pipeline de finition
  const outputPath = tmpFile(outputFormat);

  await pipeline
    .resize(newWidth, newHeight, { kernel: sharp.kernel.lanczos3 })
    .sharpen({ sigma: sharpness })
    .modulate({ saturation, brightness })
    .toFormat(outputFormat, { quality })
    .toFile(outputPath);

  const stats = fs.statSync(outputPath);
  bus.system(`[UPSCALER] Finition OK — ${newWidth}×${newHeight} — ${(stats.size / 1024).toFixed(0)} KB`);

  return {
    outputPath,
    width:    newWidth,
    height:   newHeight,
    format:   outputFormat,
    sizeBytes: stats.size,
    method:   'sharp-lanczos3',
    provider: 'local',
  };
}

// ─── CORRECTION D'ARTEFACTS ───────────────────────────────────────────────────

/**
 * Détecte et corrige les artefacts visuels courants (JPEG artifacts, bruit)
 */
async function removeArtifacts(imageInput, strength = 'medium') {
  const sharp = require('sharp');

  const params = {
    light:  { sigma: 0.3, floor: 10 },
    medium: { sigma: 0.5, floor: 5  },
    strong: { sigma: 0.8, floor: 3  },
  };
  const p = params[strength] || params.medium;

  let buffer;
  if (typeof imageInput === 'string' && imageInput.startsWith('http')) {
    buffer = await downloadImage(imageInput);
  } else {
    buffer = imageInput;
  }

  const outputPath = tmpFile('webp');
  await sharp(buffer)
    .median(3)              // Réduit le bruit haute fréquence
    .sharpen(p)             // Restitue la netteté après débruitage
    .toFormat('webp', { quality: 92 })
    .toFile(outputPath);

  return { outputPath, method: 'median-sharpen', strength };
}

// ─── PIPELINE COMPLET ─────────────────────────────────────────────────────────

/**
 * Pipeline complet: download → upscale → finition → correction → export
 *
 * @param {string} imageUrl    — URL de l'image générée
 * @param {string} imageType   — 'portrait' | 'product' | 'landscape' | 'social'
 * @param {object} options     — { targetResolution, saveToDb, tenantId }
 */
async function runUpscalePipeline(imageUrl, imageType = 'product', options = {}) {
  const startMs = Date.now();
  bus.system(`[UPSCALER] Pipeline complet — ${imageType} — ${imageUrl?.slice(0, 50)}`);

  const result = {
    original:  imageUrl,
    imageType,
    steps:     [],
    final:     null,
    error:     null,
  };

  try {
    // Étape 1 : Upscaling haute qualité
    let upscaled;
    if (process.env.REPLICATE_API_TOKEN) {
      try {
        upscaled = imageType === 'portrait'
          ? await upscalePortrait(imageUrl)
          : await upscaleRealESRGAN(imageUrl, 4);
        result.steps.push({ step: 'upscale', method: upscaled.method, status: 'ok' });
      } catch (e) {
        bus.system(`[UPSCALER] Replicate échoué, fallback Sharp: ${e.message}`);
        upscaled = null;
      }
    }

    // Étape 2 : Finition locale (toujours)
    const finishInput = upscaled?.url || imageUrl;
    const finished    = await localFinishing(finishInput, {
      upscaleFactor:  upscaled ? 1 : 2, // si déjà upscalé, juste finition
      sharpness:      imageType === 'portrait' ? 0.6 : 0.9,
      saturation:     imageType === 'botanique' ? 1.2 : 1.1,
      outputFormat:   'webp',
      quality:        92,
    });
    result.steps.push({ step: 'finishing', method: finished.method, size: finished.sizeBytes, status: 'ok' });

    // Étape 3 : Correction artefacts si image générée par IA
    const corrected = await removeArtifacts(finished.outputPath, 'light');
    result.steps.push({ step: 'artifacts', method: corrected.method, status: 'ok' });

    const latencyMs = Date.now() - startMs;
    result.final    = corrected.outputPath;
    result.latencyMs = latencyMs;
    result.dimensions = { width: finished.width, height: finished.height };

    bus.system(`[UPSCALER] ✅ Pipeline terminé en ${latencyMs}ms — ${finished.width}×${finished.height}`);

  } catch (err) {
    result.error = err.message;
    bus.system(`[UPSCALER] ❌ Pipeline error: ${err.message}`);
  }

  return result;
}

// ─── STATS QUALITÉ ────────────────────────────────────────────────────────────

async function analyzeImageQuality(imagePath) {
  try {
    const sharp  = require('sharp');
    const meta   = await sharp(imagePath).metadata();
    const stats  = await sharp(imagePath).stats();

    const channels = stats.channels || [];
    const avgSharpness = channels.reduce((s, c) => s + (c.stdev || 0), 0) / (channels.length || 1);

    return {
      width:       meta.width,
      height:      meta.height,
      format:      meta.format,
      sizeBytes:   fs.existsSync(imagePath) ? fs.statSync(imagePath).size : 0,
      megapixels:  +((meta.width * meta.height) / 1e6).toFixed(2),
      is4K:        meta.width >= 3840 || meta.height >= 3840,
      isHD:        meta.width >= 1920 || meta.height >= 1920,
      sharpnessScore: +avgSharpness.toFixed(1),
      qualityGrade:
        meta.width >= 3840 ? 'A+ (4K)' :
        meta.width >= 1920 ? 'A (HD)'  :
        meta.width >= 1080 ? 'B (FHD)' : 'C (SD)',
    };
  } catch (err) {
    return { error: err.message };
  }
}

module.exports = {
  runUpscalePipeline,
  localFinishing,
  upscaleRealESRGAN,
  upscalePortrait,
  removeArtifacts,
  analyzeImageQuality,
  downloadImage,
};
