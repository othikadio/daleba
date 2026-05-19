/**
 * MediaAgent — Agent Média DALEBA
 * DALEBA Metacortex Vol.2 — Point 101
 *
 * Hérite de BaseAgent. Scope strict : médias, vidéo, studio.
 * Capacités : inspect · keyframe · subtitle · render · publish
 */

'use strict';

const path = require('path');
const { BaseAgent } = require('./base-agent');

// ─── CONSTANTES SCOPE [101] ───────────────────────────────────────────────────

const MEDIA_SCOPE = [
  '/tmp',
  path.resolve(__dirname, '../../public/videos'),
  path.resolve(__dirname, '../../public/images'),
  path.resolve(__dirname, '../../public/studio'),
  path.resolve(__dirname, '../../studio'),
];

const MEDIA_CAPABILITIES = [
  'video_inspect',      // [104] Extraction métadonnées
  'keyframe_analyze',   // [105-106] Analyse Gemini Vision
  'trend_analyze',      // [108-110] Scraping tendances
  'montage_direct',     // [111-112] Script montage Claude
  'video_render',       // [113-118] Pipeline FFmpeg
  'subtitle_generate',  // [119] Whisper + timing
];

// Formats acceptés [103]
const ACCEPTED_FORMATS = new Set(['.mp4', '.mov', '.webm', '.avi', '.mkv']);
const ACCEPTED_CODECS  = new Set(['h264', 'hevc', 'h265', 'av1', 'vp9', 'vp8']);

// ─── MEDIA AGENT ──────────────────────────────────────────────────────────────

class MediaAgent extends BaseAgent {

  constructor(config = {}) {
    super({
      type: 'MEDIA',
      name: 'DALEBA Media Agent',
      scope: [...MEDIA_SCOPE, ...(config.scope || [])],
      capabilities: MEDIA_CAPABILITIES,
      config: {
        timeoutMs:  5 * 60 * 1000,  // 5 min max par tâche vidéo
        maxRetries: 1,
        budgetUSD:  0.25,
        ...config.config,
      },
      ...config,
    });

    this.outputDir = config.outputDir || path.resolve(__dirname, '../../public/videos/processed');
    this.studioDir = config.studioDir || path.resolve(__dirname, '../../public/studio');
  }

  // ─── EXECUTE [101] — dispatcher principal ──────────────────────────────────

  async execute(payload) {
    const { action, ...params } = payload;

    switch (action) {

      // [104] Inspecter les métadonnées d'un rush
      case 'inspect': {
        const inspector = require('../services/media-inspector');
        return inspector.inspectFile(params.filePath);
      }

      // [105-106] Analyser les keyframes avec Gemini
      case 'analyze_keyframes': {
        const analyzer = require('../services/keyframe-analyzer');
        const result = await analyzer.analyzeRush(params.filePath, params.assetId);
        return result;
      }

      // [108-110] Scraper les tendances
      case 'scrape_trends': {
        const scraper = require('../services/trend-scraper');
        return scraper.fetchTrends(params.categories || ['coiffure', 'beauté', 'luxe', 'botanique']);
      }

      // [111-112] Générer un script de montage
      case 'direct_montage': {
        const director = require('../services/montage-director');
        return director.generateScript(params.assetMetadata, params.trends);
      }

      // [113-118] Pipeline FFmpeg complet
      case 'render': {
        const pipeline = require('../services/ffmpeg-pipeline');
        return pipeline.processRush(params.filePath, params.script, params.options);
      }

      // [119] Générer les sous-titres
      case 'subtitle': {
        const pipeline = require('../services/ffmpeg-pipeline');
        return pipeline.generateSubtitles(params.filePath);
      }

      // Pipeline complet : inspect → analyze → direct → render
      case 'full_pipeline': {
        return this._runFullPipeline(params);
      }

      default:
        throw new Error(`MediaAgent: action inconnue — "${action}"`);
    }
  }

  // ─── PIPELINE COMPLET ──────────────────────────────────────────────────────

  async _runFullPipeline({ filePath, formats = ['reels', 'square', 'landscape', 'story'] }) {
    this._log('info', `Pipeline complet: ${path.basename(filePath)}`);
    const bus = (() => { try { return require('../services/event-bus'); } catch { return null; } })();

    // 1. Inspection métadonnées
    const inspector = require('../services/media-inspector');
    const metadata  = await inspector.inspectFile(filePath);
    bus?.system(`🎬 Rush analysé: ${metadata.resolution} · ${metadata.duration}s · ${metadata.codec}`);

    // 2. Analyse keyframes Gemini
    let sceneAnalysis = null;
    try {
      const analyzer = require('../services/keyframe-analyzer');
      sceneAnalysis = await analyzer.analyzeRush(filePath, metadata.assetId);
      bus?.system(`🔍 ${sceneAnalysis.keyframesAnalyzed} keyframes analysées par Gemini`);
    } catch (err) {
      this._log('warn', `Keyframe analysis skipped: ${err.message}`);
    }

    // 3. Tendances
    let trends = null;
    try {
      const scraper = require('../services/trend-scraper');
      trends = await scraper.getLatestTrends();
    } catch (err) {
      this._log('warn', `Trends unavailable: ${err.message}`);
    }

    // 4. Script de montage
    const director = require('../services/montage-director');
    const script = await director.generateScript(
      { ...metadata, sceneAnalysis },
      trends
    );

    // 5. Render tous les formats
    const pipeline = require('../services/ffmpeg-pipeline');
    const renders = {};
    for (const fmt of formats) {
      try {
        renders[fmt] = await pipeline.processRush(filePath, script, { format: fmt });
        bus?.system(`✅ ${fmt.toUpperCase()} rendu: ${path.basename(renders[fmt].outputPath)}`);
      } catch (err) {
        renders[fmt] = { error: err.message };
      }
    }

    return { metadata, sceneAnalysis, script, renders };
  }

  // ─── VALIDATION FORMAT [103] ───────────────────────────────────────────────

  static validateFormat(filePath) {
    const ext = path.extname(filePath).toLowerCase();
    if (!ACCEPTED_FORMATS.has(ext)) {
      throw new Error(`Format non supporté: ${ext}. Acceptés: ${[...ACCEPTED_FORMATS].join(', ')}`);
    }
    return true;
  }
}

// ─── EXPORTS ─────────────────────────────────────────────────────────────────

module.exports = { MediaAgent, MEDIA_SCOPE, ACCEPTED_FORMATS, ACCEPTED_CODECS };
