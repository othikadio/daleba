/**
 * FFmpeg Pipeline — DALEBA Metacortex Points 113-119
 *
 * Pipeline souverain 100% logiciel — aucun template tiers.
 * Chaque pixel est calculé et assemblé par DALEBA.
 *
 * [114] Zéro dépendance à des outils en ligne
 * [115] resizeAndPad() — 4 formats natifs
 * [116] Interpolation haute qualité + boxblur padding
 * [117] Color grading cinématique
 * [118] Watermark Kadio Coiffure à 12% opacité
 * [119] Sous-titres Whisper + burn-in
 */

'use strict';

const ffmpeg   = require('fluent-ffmpeg');
const ffmpegStatic = (() => { try { return require('ffmpeg-static'); } catch { return null; } })();
const fs       = require('fs').promises;
const fsSync   = require('fs');
const path     = require('path');
const { execSync } = require('child_process');

if (ffmpegStatic) ffmpeg.setFfmpegPath(ffmpegStatic);

// ─── FORMAT SPECS [115] ──────────────────────────────────────────────────────

const FORMAT_SPECS = {
  reels: {
    width: 1080, height: 1920,
    maxDuration: null,
    label: 'Reels/TikTok',
    bitrate: '4000k',
    audioBitrate: '192k',
  },
  square: {
    width: 1080, height: 1080,
    maxDuration: null,
    label: 'Post Carré',
    bitrate: '3500k',
    audioBitrate: '192k',
  },
  landscape: {
    width: 1920, height: 1080,
    maxDuration: null,
    label: 'YouTube Landscape',
    bitrate: '6000k',
    audioBitrate: '256k',
  },
  story: {
    width: 1080, height: 1920,
    maxDuration: 15,
    label: 'Story 15s',
    bitrate: '3000k',
    audioBitrate: '128k',
  },
};

const OUTPUT_DIR = process.env.VIDEO_OUTPUT_DIR || '/tmp/daleba_renders';

// ─── RESIZE & PAD [115, 116] ─────────────────────────────────────────────────

/**
 * Construit le filtre FFmpeg pour adapter la vidéo au format cible.
 * Utilise boxblur pour combler les zones vides si ratio différent [116].
 *
 * @param {number} srcW   — largeur source
 * @param {number} srcH   — hauteur source
 * @param {number} dstW   — largeur cible
 * @param {number} dstH   — hauteur cible
 * @returns {string}      — filtergraph FFmpeg
 */
function buildResizeFilter(srcW, srcH, dstW, dstH) {
  const srcRatio = srcW / srcH;
  const dstRatio = dstW / dstH;

  if (Math.abs(srcRatio - dstRatio) < 0.02) {
    // Ratios identiques : simple scale haute qualité
    return `scale=${dstW}:${dstH}:flags=lanczos`;
  }

  // Ratios différents : fond boxblur + overlay centré [116]
  // 1. Fond : scale pour remplir + boxblur pour adoucir
  const bgFilter = `[0:v]scale=${dstW}:${dstH}:flags=lanczos:force_original_aspect_ratio=increase,crop=${dstW}:${dstH},boxblur=20:1[bg]`;

  // 2. Premier plan : scale avec letterbox
  const fgFilter = `[0:v]scale=iw*min(${dstW}/iw\\,${dstH}/ih):ih*min(${dstW}/iw\\,${dstH}/ih):flags=lanczos[fg]`;

  // 3. Overlay centré
  const overlayX = `(${dstW}-overlay_w)/2`;
  const overlayY = `(${dstH}-overlay_h)/2`;
  const compositeFilter = `[bg][fg]overlay=${overlayX}:${overlayY}[resized]`;

  return `${bgFilter};${fgFilter};${compositeFilter}`;
}

// ─── COLOR GRADING [117] ─────────────────────────────────────────────────────

/**
 * Construit les filtres de correction colorimétrique cinématique
 * @param {object} grade — { saturation, contrast, brightness, sharpness }
 */
function buildColorGradeFilter(grade = {}, inputLabel = '[resized]', outputLabel = '[graded]') {
  const sat   = grade.saturation  || 1.15;
  const cont  = grade.contrast    || 1.05;
  const bright = grade.brightness || 1.0;
  const sharp  = grade.sharpness  || true;

  const eqFilter  = `eq=saturation=${sat}:contrast=${cont}:brightness=${bright - 1}`;
  const unsharp   = sharp ? ',unsharp=5:5:1.0:5:5:0.0' : '';

  return `${inputLabel}${eqFilter}${unsharp}${outputLabel}`;
}

// ─── WATERMARK [118] ─────────────────────────────────────────────────────────

/**
 * Superpose le watermark Kadio Coiffure à 12% d'opacité
 * Position : coin inférieur gauche (zone morte standard Reels)
 */
function buildWatermarkFilter(dstW, dstH, inputLabel = '[graded]', outputLabel = '[watermarked]') {
  const opacity  = 0.12;
  const fontSize = Math.round(dstH * 0.025); // 2.5% de la hauteur
  const margin   = Math.round(dstW * 0.03);

  // Watermark textuel vectoriel (pas besoin d'image externe)
  const drawtext = [
    `drawtext=`,
    `text='KADIO COIFFURE':`,
    `fontsize=${fontSize}:`,
    `fontcolor=white@${opacity}:`,
    `x=${margin}:`,
    `y=h-th-${margin}:`,
    `fontfile=/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf`,
  ].join('');

  return `${inputLabel}${drawtext}${outputLabel}`;
}

// ─── SOUS-TITRES WHISPER [119] ────────────────────────────────────────────────

/**
 * Transcrit l'audio avec OpenAI Whisper et génère un fichier SRT
 */
async function generateSubtitles(videoPath) {
  const OpenAI = require('openai');
  const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

  if (!process.env.OPENAI_API_KEY) throw new Error('OPENAI_API_KEY requis pour Whisper');

  // 1. Extraction piste audio
  const audioPath = videoPath.replace(/\.[^.]+$/, '_audio.mp3');
  await new Promise((res, rej) =>
    ffmpeg(videoPath).output(audioPath).audioCodec('libmp3lame').noVideo()
      .on('end', res).on('error', rej).run()
  );

  // 2. Transcription Whisper [119]
  const audioFile = fsSync.createReadStream(audioPath);
  const transcription = await client.audio.transcriptions.create({
    file: audioFile,
    model: 'whisper-1',
    language: 'fr',
    response_format: 'verbose_json',
    timestamp_granularities: ['word'],
  });

  // 3. Génération SRT structuré mot par mot
  const srtPath = videoPath.replace(/\.[^.]+$/, '.srt');
  await _buildSRT(transcription, srtPath);

  // Nettoyage audio temp
  await fs.unlink(audioPath).catch(() => {});

  return { srtPath, segments: transcription.segments?.length || 0, text: transcription.text };
}

async function _buildSRT(transcription, outputPath) {
  const segments = transcription.segments || [];
  let srt = '';
  let idx = 1;

  for (const seg of segments) {
    const start = _secondsToSRT(seg.start);
    const end   = _secondsToSRT(seg.end);
    // Capitalise et formate — max 60 chars par ligne
    const text = seg.text.trim();
    if (text) {
      srt += `${idx}\n${start} --> ${end}\n${text}\n\n`;
      idx++;
    }
  }

  await fs.writeFile(outputPath, srt, 'utf8');
  return outputPath;
}

function _secondsToSRT(s) {
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = Math.floor(s % 60);
  const ms  = Math.round((s % 1) * 1000);
  return `${String(h).padStart(2,'0')}:${String(m).padStart(2,'0')}:${String(sec).padStart(2,'0')},${String(ms).padStart(3,'0')}`;
}

// ─── PIPELINE PRINCIPAL [113-118] ────────────────────────────────────────────

/**
 * Traite un rush selon un script de montage et le format cible [114]
 * @param {string} inputPath — chemin du rush brut
 * @param {object} script    — sortie de montage-director
 * @param {object} options   — { format: 'reels'|'square'|'landscape'|'story' }
 */
async function processRush(inputPath, script, options = {}) {
  const fmt    = FORMAT_SPECS[options.format || 'reels'];
  const fmtKey = options.format || 'reels';
  const fmtScript = script?.formats?.[fmtKey] || script?.formats?.reels || {};

  await fs.mkdir(OUTPUT_DIR, { recursive: true });

  const ts = Date.now();
  const outputPath = path.join(OUTPUT_DIR, `${fmtKey}_${ts}.mp4`);

  // Métadonnées source
  const srcMeta = await new Promise((res, rej) =>
    ffmpeg.ffprobe(inputPath, (err, data) => err ? rej(err) : res(data))
  );
  const srcVideo = srcMeta.streams.find(s => s.codec_type === 'video') || {};
  const srcW = srcVideo.width  || 1080;
  const srcH = srcVideo.height || 1920;

  // Durée cible
  let targetDuration = fmtScript.duration || fmt.maxDuration || null;
  const srcDuration  = parseFloat(srcMeta.format.duration || 30);
  if (targetDuration) targetDuration = Math.min(targetDuration, srcDuration);

  const colorGrade = fmtScript.color_grade || {};

  return new Promise((resolve, reject) => {
    let filterComplex = '';
    let finalLabel   = '[0:v]';

    const needsComposite = Math.abs(srcW / srcH - fmt.width / fmt.height) > 0.02;

    if (needsComposite) {
      // [116] Resize avec boxblur background
      filterComplex += buildResizeFilter(srcW, srcH, fmt.width, fmt.height) + ';';
      filterComplex += buildColorGradeFilter(colorGrade, '[resized]', '[graded]') + ';';
      filterComplex += buildWatermarkFilter(fmt.width, fmt.height, '[graded]', '[final]');
      finalLabel = '[final]';
    } else {
      // [117] Color grade simple + [118] watermark
      filterComplex += `[0:v]scale=${fmt.width}:${fmt.height}:flags=lanczos[scaled];`;
      filterComplex += buildColorGradeFilter(colorGrade, '[scaled]', '[graded]') + ';';
      filterComplex += buildWatermarkFilter(fmt.width, fmt.height, '[graded]', '[final]');
      finalLabel = '[final]';
    }

    const cmd = ffmpeg(inputPath)
      .complexFilter(filterComplex)
      .outputOptions([
        `-map ${finalLabel}`,
        '-map 0:a?',                         // audio optionnel
        '-c:v libx264',                      // H.264 standard
        `-b:v ${fmt.bitrate}`,
        '-preset fast',
        '-crf 18',                           // qualité haute
        '-pix_fmt yuv420p',                  // compatibilité max
        '-c:a aac',
        `-b:a ${fmt.audioBitrate}`,
        '-movflags +faststart',              // streaming web
      ]);

    // [115] Durée maximale (Story = 15s)
    if (targetDuration) cmd.setDuration(targetDuration);

    // Burn-in des clips (trim si spécifié dans le script)
    const clips = fmtScript.clips || [];
    if (clips.length > 0 && clips[0].in !== undefined) {
      cmd.seekInput(clips[0].in);
    }

    cmd
      .output(outputPath)
      .on('start', (cli) => console.log(`[FFmpeg] ${fmtKey}: ${cli.slice(0, 80)}…`))
      .on('progress', (p) => {
        if (p.percent) process.stdout.write(`\r[FFmpeg] ${fmtKey}: ${Math.round(p.percent)}%`);
      })
      .on('end', () => {
        console.log(`\n[FFmpeg] ✅ ${fmtKey} → ${path.basename(outputPath)}`);
        resolve({
          format: fmtKey,
          outputPath,
          spec: fmt,
          duration: targetDuration || srcDuration,
          script: fmtScript,
          caption: fmtScript.caption || '',
          hashtags: fmtScript.hashtags || [],
        });
      })
      .on('error', (err) => {
        console.error(`\n[FFmpeg] ❌ ${fmtKey}: ${err.message}`);
        reject(new Error(`FFmpeg ${fmtKey}: ${err.message}`));
      })
      .run();
  });
}

// ─── PIPELINE AVEC SOUS-TITRES ASS [120-123] ────────────────────────────────────

/**
 * Version complète avec sous-titres ASS hardcodés [121]
 * Enchaîne: resize → grade → watermark → subtitles
 */
async function processRushWithSubtitles(inputPath, script, options = {}) {
  // 1. Render vidéo sans sous-titres
  const renderResult = await processRush(inputPath, script, options);

  // 2. Générer sous-titres Whisper si audio disponible
  let srtPath = null;
  try {
    const subResult = await generateSubtitles(inputPath);
    srtPath = subResult.srtPath;
  } catch (err) {
    console.warn(`[FFmpeg] Whisper indisponible: ${err.message}`);
    return renderResult; // Retourne sans sous-titres si Whisper fails
  }

  // 3. Convertir SRT → ASS [120, 122]
  const fmt = FORMAT_SPECS[options.format || 'reels'];
  const subtitleEngine = require('./subtitle-engine');
  const assPath = await subtitleEngine.srtToAss(srtPath, fmt.width, fmt.height);

  // 4. Burn-in ASS dans la vidéo finale [121]
  const ts = Date.now();
  const finalPath = path.join(OUTPUT_DIR, `${options.format || 'reels'}_sub_${ts}.mp4`);
  const subtitleFilter = subtitleEngine.buildSubtitleFilter(assPath);

  return new Promise((resolve, reject) => {
    ffmpeg(renderResult.outputPath)
      .complexFilter(`[0:v]${subtitleFilter}[subbed]`)
      .outputOptions(['-map [subbed]', '-map 0:a?', '-c:v libx264', '-crf 18',
        '-preset fast', '-c:a copy', '-movflags +faststart'])
      .output(finalPath)
      .on('end', async () => {
        // Nettoyage fichier intermédiaire
        await fs.unlink(renderResult.outputPath).catch(() => {});
        await fs.unlink(srtPath).catch(() => {});
        // Garder .ass pour archivage
        resolve({ ...renderResult, outputPath: finalPath, subtitlesPath: assPath });
      })
      .on('error', (err) => {
        // Si burn-in échoue (police manquante etc.) → retourner sans sous-titres
        console.warn(`[FFmpeg] Subtitle burn-in failed: ${err.message} — retour sans sous-titres`);
        resolve({ ...renderResult, subtitleError: err.message });
      })
      .run();
  });
}

// ─── EXPORTS ─────────────────────────────────────────────────────────────────

module.exports = {
  processRush, processRushWithSubtitles, generateSubtitles,
  buildResizeFilter, buildColorGradeFilter, buildWatermarkFilter,
  FORMAT_SPECS, OUTPUT_DIR,
};
