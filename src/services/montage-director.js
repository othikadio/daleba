/**
 * Montage Director — DALEBA Metacortex Points 111-112
 *
 * Claude génère un script de montage sur mesure :
 * rush brut + tendances virales → timing précis + sous-titres + instructions couleur.
 */

'use strict';

// ─── GÉNÉRATION DU SCRIPT [111-112] ──────────────────────────────────────────

/**
 * @param {object} assetMetadata — sortie de media-inspector + keyframe-analyzer
 * @param {object} trends         — sortie de trend-scraper
 * @returns {object} script de montage structuré
 */
async function generateScript(assetMetadata, trends) {
  const claude = require('../agents/claude');

  const duration = assetMetadata.duration || 30;
  const action   = assetMetadata.sceneAnalysis?.overall?.primary_action || 'salon_service';
  const quality  = assetMetadata.sceneAnalysis?.overall?.production_quality || 'medium';
  const frames   = assetMetadata.sceneAnalysis?.frames || [];

  const viralStructures = trends?.viralStructures || [];
  const textHooks       = trends?.textHooks || [];
  const hashtags        = trends?.trendingHashtags?.slice(0, 5).map(h => h.tag).join(' ') || '#naturalhair #salon';
  const optDurations    = trends?.optimalDurations || { reels: 30, tiktok: 45 };

  const prompt = `Tu es le directeur artistique vidéo de DALEBA, le système IA de Kadio Coiffure.

RUSH BRUT — INFORMATIONS:
- Durée source: ${duration}s
- Action principale: ${action}
- Qualité production: ${quality}
- Résolution: ${assetMetadata.resolution || 'inconnue'}
- Frames analysées: ${frames.length} keyframes
- A de l'audio: ${assetMetadata.hasAudio ? 'oui' : 'non'}

TENDANCES VIRALES ACTUELLES:
${viralStructures.length ? viralStructures.slice(0, 3).map((s, i) => `${i+1}. ${s.name || JSON.stringify(s)}`).join('\n') : 'Structures standard'}

HOOKS TEXTUELS PERFORMANTS:
${textHooks.slice(0, 3).map(h => `"${h.text}" (score: ${h.engagement_score})`).join('\n') || 'Voir suggestions'}

FORMATS CIBLES: Reels (${optDurations.reels}s), TikTok (${optDurations.tiktok}s)
HASHTAGS: ${hashtags}

Génère un script de montage précis et actionnable en JSON:
{
  "title": "string",
  "hook": "string (texte affiché 0-3s)",
  "formats": {
    "reels": {
      "duration": ${optDurations.reels},
      "clips": [{ "in": 0.0, "out": 3.5, "label": "string", "transition": "jump_cut|fade|zoom|wipe" }],
      "subtitles": [{ "start": 0.0, "end": 2.5, "text": "string", "style": "impact|clean|gradient" }],
      "color_grade": { "saturation": 1.15, "contrast": 1.05, "brightness": 1.0, "vignette": false },
      "music_cue": "string",
      "caption": "string (légende réseau social)",
      "hashtags": ["#tag1", "#tag2"]
    },
    "tiktok": { "duration": ${optDurations.tiktok}, "clips": [], "subtitles": [], "color_grade": {}, "caption": "", "hashtags": [] },
    "square": { "duration": 30, "clips": [], "subtitles": [], "color_grade": {}, "caption": "", "hashtags": [] }
  },
  "production_notes": "string",
  "estimated_reach": "string"
}

Assure-toi que les points in/out des clips ne dépassent pas ${duration}s.
Utilise les tendances virales pour maximiser la rétention.`;

  const result = await claude.query(prompt,
    'Tu es un directeur artistique expert en vidéo virale pour réseaux sociaux. Retourne uniquement du JSON valide.',
    []
  );

  try {
    const clean = result.content.replace(/```json\n?|\n?```/g, '').trim();
    const script = JSON.parse(clean);
    return {
      ...script,
      generatedAt: new Date().toISOString(),
      sourceAsset: assetMetadata.assetId,
      trendsSnapshot: { fetchedAt: trends?.fetchedAt, sources: [trends?.youtube?.source, trends?.tiktok?.source].filter(Boolean) },
    };
  } catch {
    // Fallback script si JSON malformé
    return _fallbackScript(assetMetadata, duration);
  }
}

function _fallbackScript(meta, duration) {
  const end = Math.min(duration, 30);
  return {
    title: `Kadio Coiffure — ${new Date().toLocaleDateString('fr-CA')}`,
    hook: 'WAIT FOR IT 😱',
    formats: {
      reels: {
        duration: end,
        clips: [{ in: 0, out: end * 0.3, label: 'hook', transition: 'jump_cut' },
                { in: end * 0.3, out: end * 0.7, label: 'process', transition: 'smooth_cut' },
                { in: end * 0.7, out: end, label: 'reveal', transition: 'fade' }],
        subtitles: [
          { start: 0, end: 2.5, text: 'Kadio Coiffure ✨', style: 'impact' },
          { start: end - 3, end: end, text: 'Longueuil, QC | 514-919-5970', style: 'clean' },
        ],
        color_grade: { saturation: 1.15, contrast: 1.05, brightness: 1.0 },
        caption: 'Transformation disponible chez Kadio Coiffure 💜',
        hashtags: ['#naturalhair', '#salondecoiffure', '#coiffurequebec'],
      },
    },
    generatedAt: new Date().toISOString(),
    _fallback: true,
  };
}

// ─── EXPORTS ─────────────────────────────────────────────────────────────────

module.exports = { generateScript };
