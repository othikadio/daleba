/**
 * Keyframe Analyzer — DALEBA Metacortex Points 105-107
 *
 * Extrait les keyframes via FFmpeg (toutes les 2s) → Gemini 1.5 Pro Vision.
 * Retourne une analyse sémantique complète de la scène.
 * Stocke dans studio_assets [107].
 */

'use strict';

const ffmpeg  = require('fluent-ffmpeg');
const fs      = require('fs').promises;
const fsSync  = require('fs');
const path    = require('path');
const { GoogleGenerativeAI } = require('@google/generative-ai');
const maintenance = require('./maintenance');

// ─── CONFIG ───────────────────────────────────────────────────────────────────

const KF_INTERVAL = 2;       // secondes entre keyframes [105]
const KF_DIR      = '/tmp/daleba_keyframes';
const MAX_FRAMES  = 12;      // max frames envoyées à Gemini (coût)

// ─── EXTRACTION KEYFRAMES [105] ──────────────────────────────────────────────

async function extractKeyframes(filePath, interval = KF_INTERVAL) {
  const sessionId = Date.now();
  const outDir = path.join(KF_DIR, String(sessionId));
  await fs.mkdir(outDir, { recursive: true });

  return new Promise((resolve, reject) => {
    ffmpeg(filePath)
      .outputOptions([
        `-vf fps=1/${interval},scale=640:-1`,  // 1 frame / interval, resize pour API
        '-q:v 3',                               // qualité JPEG
      ])
      .output(path.join(outDir, 'frame_%04d.jpg'))
      .on('end', async () => {
        const files = (await fs.readdir(outDir))
          .filter(f => f.endsWith('.jpg'))
          .map(f => path.join(outDir, f))
          .sort();
        resolve({ frames: files, dir: outDir });
      })
      .on('error', reject)
      .run();
  });
}

// ─── ANALYSE GEMINI [105-106] ────────────────────────────────────────────────

async function analyzeFramesWithGemini(framePaths) {
  if (!process.env.GEMINI_API_KEY) {
    return _fallbackAnalysis(framePaths.length);
  }

  const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
  const model = genAI.getGenerativeModel({ model: 'gemini-1.5-pro' });

  // Limite le nombre de frames pour contrôler le coût
  const selected = framePaths.length <= MAX_FRAMES
    ? framePaths
    : framePaths.filter((_, i) => i % Math.ceil(framePaths.length / MAX_FRAMES) === 0).slice(0, MAX_FRAMES);

  // Construction du prompt multimodal [106]
  const prompt = `Tu es un expert en analyse cinématique et beauté pour salon de coiffure.
Analyse ces ${selected.length} keyframes extraites d'une vidéo de salon.

Pour CHAQUE frame, identifie:
1. action: (ex: "coupe de cheveux", "application soin", "brushing", "tresses", "coloration", "texture locks", "défrisage")
2. sujet: qui est visible (coiffeur, client, produit, outil)
3. éclairage: ("naturel", "studio", "faible", "surexposé", "parfait")
4. netteté: ("nette", "légèrement floue", "floue")
5. esthétique: ("cinématique", "amateur", "professionnelle", "brute")
6. composition: ("cadrage centré", "rule of tiers", "gros plan", "plan large", "détail")

Retourne un JSON structuré:
{
  "overall": {
    "primary_action": "string",
    "style": "string",
    "mood": "string",
    "production_quality": "low|medium|high|premium",
    "recommended_formats": ["reels", "square", "landscape"],
    "color_grade_suggestion": "string",
    "marketing_angle": "string"
  },
  "frames": [
    { "index": 0, "timecode": "0:00", "action": "...", "sujet": "...", "éclairage": "...", "netteté": "...", "esthétique": "...", "composition": "...", "usable": true }
  ]
}`;

  // Lecture des frames en base64
  const parts = [{ text: prompt }];
  for (const framePath of selected) {
    const buffer = await fs.readFile(framePath);
    const b64 = buffer.toString('base64');
    parts.push({ inlineData: { mimeType: 'image/jpeg', data: b64 } });
  }

  const result = await model.generateContent(parts);
  const text   = result.response.text();

  try {
    const clean = text.replace(/```json\n?|\n?```/g, '').trim();
    return JSON.parse(clean);
  } catch {
    return { overall: { primary_action: 'salon_service', production_quality: 'medium' }, frames: [], raw: text };
  }
}

function _fallbackAnalysis(frameCount) {
  return {
    overall: {
      primary_action: 'salon_service',
      style: 'beauty',
      mood: 'professional',
      production_quality: 'medium',
      recommended_formats: ['reels', 'square'],
      color_grade_suggestion: 'warm, natural',
      marketing_angle: 'service_showcase',
    },
    frames: [],
    source: 'fallback_no_gemini',
  };
}

// ─── PIPELINE COMPLET [105-107] ──────────────────────────────────────────────

async function analyzeRush(filePath, assetId = null) {
  // 1. Extraction keyframes
  const { frames, dir } = await extractKeyframes(filePath);

  // 2. Analyse Gemini
  const analysis = await analyzeFramesWithGemini(frames);

  const result = {
    assetId,
    filePath,
    keyframesAnalyzed: frames.length,
    ...analysis,
    analyzedAt: new Date().toISOString(),
  };

  // 3. Persistance [107]
  await _updateAssetAnalysis(assetId, result);

  // 4. Nettoyage frames temporaires
  await fs.rm(dir, { recursive: true, force: true }).catch(() => {});

  return result;
}

async function _updateAssetAnalysis(assetId, analysis) {
  if (!assetId) return;
  const pool = maintenance.getPool();
  if (!pool) return;

  await pool.query(
    `UPDATE studio_assets SET scene_analysis = $1, processed_at = NOW() WHERE id = $2`,
    [JSON.stringify(analysis), assetId]
  ).catch(() => {});
}

// ─── EXPORTS ─────────────────────────────────────────────────────────────────

module.exports = { extractKeyframes, analyzeFramesWithGemini, analyzeRush };
