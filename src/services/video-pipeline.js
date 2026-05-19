/**
 * DALEBA V27 — Pipeline Vidéo IA (Omnicore Alpha)
 * FFmpeg managé par IA : découpe, rythme, sous-titres, colorisation
 * Sortie multi-plateforme : Reels 9:16, Post 1:1, YouTube 16:9
 *
 * Dépendance: fluent-ffmpeg (npm install fluent-ffmpeg)
 * Runtime: FFmpeg doit être présent sur le serveur (Railway OK via Nixpacks)
 */

const ffmpeg   = require('fluent-ffmpeg');
const path     = require('path');
const fs       = require('fs');
const os       = require('os');
const { execSync, exec } = require('child_process');
const bus      = require('./event-bus');

// ─── FORMATS PAR PLATEFORME ──────────────────────────────────────────────────

const PLATFORM_PROFILES = {
  reels: {
    label:     'Instagram Reels / TikTok',
    width:     1080,
    height:    1920,
    fps:       30,
    maxSec:    90,
    bitrate:   '4000k',
    audioBit:  '128k',
    format:    'mp4',
    watermark: { text: 'Kadio Coiffure', x: 40, y: 40 },
  },
  post: {
    label:     'Instagram Post / Facebook',
    width:     1080,
    height:    1080,
    fps:       30,
    maxSec:    60,
    bitrate:   '3000k',
    audioBit:  '128k',
    format:    'mp4',
    watermark: { text: 'Kadio Coiffure', x: 40, y: 40 },
  },
  youtube: {
    label:     'YouTube Shorts / Horizontal',
    width:     1920,
    height:    1080,
    fps:       30,
    maxSec:    180,
    bitrate:   '6000k',
    audioBit:  '192k',
    format:    'mp4',
    watermark: { text: 'Kadio Coiffure', x: 60, y: 60 },
  },
  story: {
    label:     'Story Instagram / WhatsApp',
    width:     1080,
    height:    1920,
    fps:       25,
    maxSec:    15,
    bitrate:   '2500k',
    audioBit:  '96k',
    format:    'mp4',
    watermark: { text: 'Kadio Coiffure', x: 40, y: 40 },
  },
};

// ─── UTILITAIRES ─────────────────────────────────────────────────────────────

function tmpFile(ext) {
  return path.join(os.tmpdir(), `daleba_${Date.now()}_${Math.random().toString(36).slice(2)}.${ext}`);
}

function ffmpegAvailable() {
  try { execSync('ffmpeg -version', { stdio: 'ignore' }); return true; }
  catch { return false; }
}

/** Génère un fichier SRT à partir de lignes de sous-titres */
function buildSRT(lines) {
  return lines.map((line, i) => {
    const start = i * line.duration;
    const end   = start + line.duration;
    const fmt   = (s) => {
      const h = Math.floor(s / 3600).toString().padStart(2, '0');
      const m = Math.floor((s % 3600) / 60).toString().padStart(2, '0');
      const sec = Math.floor(s % 60).toString().padStart(2, '0');
      const ms  = Math.floor((s % 1) * 1000).toString().padStart(3, '0');
      return `${h}:${m}:${sec},${ms}`;
    };
    return `${i + 1}\n${fmt(start)} --> ${fmt(end)}\n${line.text}\n`;
  }).join('\n');
}

/** Génère des sous-titres via Claude si ANTHROPIC_API_KEY dispo, sinon fallback basique */
async function generateSubtitles(script, durationSec) {
  const lines = [];
  if (!script || !durationSec) return lines;

  const sentences = script.split(/[.!?]+/).map(s => s.trim()).filter(Boolean);
  const durPerLine = durationSec / sentences.length;

  // Tentative LLM pour rythmer intelligemment
  if (process.env.ANTHROPIC_API_KEY) {
    try {
      const claude = require('../agents/claude');
      const prompt = `Découpe ce script en ${Math.min(sentences.length, 12)} sous-titres courts (max 6 mots chacun) pour une vidéo de ${durationSec} secondes. Retourne un JSON: [{"text":"...","duration":X}] uniquement, sans markdown.\n\nScript: ${script}`;
      const result = await claude.query(prompt, '', []);
      const raw    = typeof result === 'string' ? result : (result.content || '');
      const match  = raw.match(/\[[\s\S]*\]/);
      if (match) {
        const parsed = JSON.parse(match[0]);
        return parsed.map(p => ({ text: p.text, duration: p.duration || durPerLine }));
      }
    } catch (e) {
      bus.system(`[VIDEO] LLM subtitles fallback: ${e.message}`);
    }
  }

  // Fallback: découpe mécanique
  return sentences.slice(0, 12).map(text => ({ text: text.slice(0, 60), duration: durPerLine }));
}

// ─── PIPELINE PRINCIPAL ───────────────────────────────────────────────────────

/**
 * Traite une vidéo source et génère les versions multi-plateformes
 *
 * @param {object} params
 * @param {string} params.inputPath     — chemin vidéo source (mp4/mov)
 * @param {string} params.script        — texte du script pour les sous-titres
 * @param {string[]} params.platforms   — ['reels','post','youtube','story']
 * @param {object} params.branding      — { salonName, color, font }
 * @param {number} params.trimStart     — coupe début (secondes)
 * @param {number} params.trimEnd       — coupe fin (secondes, 0 = pas de coupe)
 * @param {string} params.outputDir     — répertoire de sortie (défaut: /tmp)
 */
async function processVideo(params) {
  const {
    inputPath,
    script        = '',
    platforms     = ['reels'],
    branding      = {},
    trimStart     = 0,
    trimEnd       = 0,
    outputDir     = os.tmpdir(),
  } = params;

  if (!ffmpegAvailable()) {
    throw new Error('FFmpeg non disponible sur ce serveur');
  }
  if (!inputPath || !fs.existsSync(inputPath)) {
    throw new Error(`Fichier source introuvable: ${inputPath}`);
  }

  bus.system(`[VIDEO] Pipeline démarré — ${platforms.length} plateforme(s)`);

  const results = [];

  for (const platform of platforms) {
    const profile = PLATFORM_PROFILES[platform];
    if (!profile) { bus.system(`[VIDEO] Plateforme inconnue: ${platform}`); continue; }

    bus.system(`[VIDEO] Rendu ${profile.label}...`);
    const outputPath = path.join(outputDir, `daleba_${platform}_${Date.now()}.${profile.format}`);

    try {
      await new Promise((resolve, reject) => {
        const cmd = ffmpeg(inputPath);

        // Découpe temporelle
        if (trimStart > 0) cmd.seekInput(trimStart);
        if (trimEnd   > 0) cmd.duration(trimEnd - trimStart);
        if (profile.maxSec) cmd.duration(Math.min(profile.maxSec, trimEnd > 0 ? trimEnd - trimStart : 9999));

        // Redimensionnement + letterbox/pillarbox propre
        const vf = [
          `scale=${profile.width}:${profile.height}:force_original_aspect_ratio=decrease`,
          `pad=${profile.width}:${profile.height}:(ow-iw)/2:(oh-ih)/2:color=black`,
          `fps=${profile.fps}`,
        ];

        // Colorisation légère (boost saturation + contraste)
        vf.push('eq=saturation=1.15:contrast=1.05:brightness=0.02');

        // Watermark texte (nom du salon)
        const wm = branding.salonName || profile.watermark.text;
        const wmColor = branding.color || 'white';
        vf.push(
          `drawtext=text='${wm}':fontsize=36:fontcolor=${wmColor}@0.85:` +
          `x=${profile.watermark.x}:y=${profile.watermark.y}:` +
          `shadowcolor=black@0.6:shadowx=2:shadowy=2`
        );

        cmd
          .videoFilter(vf.join(','))
          .videoBitrate(profile.bitrate)
          .audioBitrate(profile.audioBit)
          .audioFrequency(44100)
          .audioChannels(2)
          .outputOption('-movflags faststart')  // streaming-ready
          .outputOption('-pix_fmt yuv420p')     // compatibilité maximale
          .outputOption('-preset fast')
          .output(outputPath)
          .on('end', resolve)
          .on('error', reject)
          .run();
      });

      const size = fs.statSync(outputPath).size;
      bus.system(`[VIDEO] ✅ ${platform} — ${(size / 1024 / 1024).toFixed(1)} MB`);
      results.push({ platform, profile: profile.label, outputPath, sizeBytes: size, status: 'ok' });

    } catch (err) {
      bus.system(`[VIDEO] ❌ ${platform}: ${err.message}`);
      results.push({ platform, status: 'error', error: err.message });
    }
  }

  return { results, generatedAt: new Date().toISOString() };
}

// ─── SOUS-TITRES STANDALONE ───────────────────────────────────────────────────

/**
 * Incruste des sous-titres sur une vidéo existante
 * @param {string} inputPath  — vidéo source
 * @param {string} srtPath    — fichier .srt (généré ou fourni)
 * @param {string} outputPath — vidéo de sortie
 */
async function burnSubtitles(inputPath, srtPath, outputPath) {
  if (!ffmpegAvailable()) throw new Error('FFmpeg non disponible');

  return new Promise((resolve, reject) => {
    ffmpeg(inputPath)
      .videoFilter(`subtitles=${srtPath}:force_style='FontName=Arial,FontSize=24,PrimaryColour=&HFFFFFF,OutlineColour=&H000000,Outline=2,Alignment=2'`)
      .outputOption('-c:a copy')
      .output(outputPath)
      .on('end', resolve)
      .on('error', reject)
      .run();
  });
}

/**
 * Flux complet : génère les sous-titres + les incruste
 */
async function addSubtitlesToVideo(inputPath, script, durationSec, outputPath) {
  const subtitleLines = await generateSubtitles(script, durationSec);
  if (!subtitleLines.length) return inputPath; // rien à faire

  const srtPath = tmpFile('srt');
  fs.writeFileSync(srtPath, buildSRT(subtitleLines), 'utf8');

  const out = outputPath || tmpFile('mp4');
  await burnSubtitles(inputPath, srtPath, out);

  fs.unlinkSync(srtPath);
  bus.system(`[VIDEO] Sous-titres incrusté — ${subtitleLines.length} lignes`);
  return out;
}

// ─── SCHEDULER MULTI-PLATEFORME ───────────────────────────────────────────────

/**
 * Planifie la publication d'une vidéo traitée sur les réseaux sociaux
 * Connecté au social-scheduler.js existant
 */
async function scheduleVideoPost({ outputPath, platform, caption, scheduledAt, topic }) {
  try {
    const scheduler = require('./social-scheduler');
    const result = await scheduler.schedulePost({
      platform,
      content:     caption || 'Nouveau contenu Kadio Coiffure 💇‍♀️',
      caption:     caption,
      mediaUrl:    outputPath,
      scheduledAt: scheduledAt || new Date(Date.now() + 60 * 60 * 1000).toISOString(),
      topic:       topic || 'video_pipeline',
      style:       'video_original',
    });
    bus.system(`[VIDEO] Post planifié sur ${platform} pour ${scheduledAt}`);
    return result;
  } catch (err) {
    bus.system(`[VIDEO] Scheduler error: ${err.message}`);
    throw err;
  }
}

// ─── ENDPOINT TEST (SANITY CHECK) ────────────────────────────────────────────

/** Génère une vidéo de test (color bars) sans fichier source externe */
async function generateTestVideo(outputDir = os.tmpdir()) {
  if (!ffmpegAvailable()) return { available: false };

  const outputPath = path.join(outputDir, `daleba_test_${Date.now()}.mp4`);

  await new Promise((resolve, reject) => {
    ffmpeg()
      .input('color=c=black:s=1080x1920:r=30')
      .inputOption('-f lavfi')
      .input('anullsrc=r=44100:cl=stereo')
      .inputOption('-f lavfi')
      .videoFilter([
        "drawtext=text='DALEBA PIPELINE':fontsize=64:fontcolor=white:x=(w-text_w)/2:y=(h-text_h)/2",
        "drawtext=text='Kadio Coiffure':fontsize=36:fontcolor=#00FF9F:x=(w-text_w)/2:y=(h-text_h)/2+80",
      ].join(','))
      .duration(5)
      .videoBitrate('1500k')
      .audioBitrate('96k')
      .outputOption('-pix_fmt yuv420p')
      .outputOption('-shortest')
      .output(outputPath)
      .on('end', resolve)
      .on('error', reject)
      .run();
  });

  const size = fs.statSync(outputPath).size;
  bus.system(`[VIDEO] Test vidéo générée: ${(size/1024).toFixed(0)} KB`);
  return { available: true, outputPath, sizeBytes: size };
}

module.exports = {
  processVideo,
  addSubtitlesToVideo,
  generateSubtitles,
  burnSubtitles,
  buildSRT,
  scheduleVideoPost,
  generateTestVideo,
  PLATFORM_PROFILES,
};
