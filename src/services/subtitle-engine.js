/**
 * Subtitle Engine — DALEBA Metacortex Points 120-123
 *
 * [120] SRT → ASS (Advanced SubStation Alpha)
 * [121] Hardcode burn-in via FFmpeg subtitles filter
 * [122] Styles premium: Montserrat, blanc pur, or #D4AF37, shadow texturé
 * [123] Max 3 mots simultanés, rythmé avec la voix off
 */

'use strict';

const fs   = require('fs').promises;
const path = require('path');

// ─── MOTS-CLÉS ACTION → OR [122] ─────────────────────────────────────────────

const ACTION_KEYWORDS = new Set([
  // Coiffure
  'transformation', 'résultat', 'regardez', 'avant', 'après', 'maintenant',
  'découvrez', 'unique', 'exclusif', 'premium', 'sublime', 'incroyable',
  // Engagement
  'réservez', 'appelez', 'visitez', 'contactez', 'aujourd\'hui', 'disponible',
  'gratuit', 'offre', 'promotion', 'limité',
  // Anglais (pour hashtags bilingues)
  'transformation', 'look', 'amazing', 'stunning', 'book', 'now', 'watch',
  'wait', 'results', 'incredible', 'exclusive',
]);

// ─── TEMPLATE ASS [120, 122] ──────────────────────────────────────────────────

/**
 * Génère l'en-tête ASS avec les styles premium
 * @param {number} videoW   — largeur vidéo cible
 * @param {number} videoH   — hauteur vidéo cible
 */
function buildASSHeader(videoW = 1080, videoH = 1920) {
  // [122] Taille proportionnelle à la résolution
  const fontSize    = Math.round(videoH * 0.035);  // 3.5% hauteur
  const marginV     = Math.round(videoH * 0.08);   // 8% du bas
  const marginH     = Math.round(videoW * 0.05);   // 5% côtés
  const shadowDepth = Math.round(videoH * 0.002);

  // ASS couleurs : format &HAABBGGRR (alpha, blue, green, red) en hex
  const WHITE  = '&H00FFFFFF';  // Blanc pur
  const GOLD   = '&H0037AFD4';  // #D4AF37 en BGR → &H0037AFD4
  const BLACK  = '&H00000000';  // Noir pour shadow
  const TRANSP = '&HFF000000';  // Transparent

  return `[Script Info]
ScriptType: v4.00+
PlayResX: ${videoW}
PlayResY: ${videoH}
ScaledBorderAndShadow: yes
YCbCr Matrix: TV.709
Collisions: Normal

[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
Style: Default,Montserrat,${fontSize},${WHITE},${GOLD},${BLACK},${TRANSP},-1,0,0,0,100,100,3,0,1,2,${shadowDepth},2,${marginH},${marginH},${marginV},1
Style: Action,Montserrat,${fontSize},${GOLD},${WHITE},${BLACK},${TRANSP},-1,0,0,0,100,100,3,0,1,2,${shadowDepth},2,${marginH},${marginH},${marginV},1
Style: Hook,Montserrat,${Math.round(fontSize * 1.3)},${WHITE},${GOLD},${BLACK},${TRANSP},-1,0,0,0,100,100,4,0,1,3,${shadowDepth * 2},2,${marginH},${marginH},${marginV},1

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
`;
}

// ─── SRT → ASS [120, 123] ────────────────────────────────────────────────────

/**
 * Parse un fichier SRT et retourne les segments
 */
async function parseSRT(srtPath) {
  const content = await fs.readFile(srtPath, 'utf8');
  const blocks  = content.trim().split(/\n\n+/);
  const segments = [];

  for (const block of blocks) {
    const lines = block.trim().split('\n');
    if (lines.length < 3) continue;

    const timecode = lines[1];
    const match = timecode.match(/(\d{2}):(\d{2}):(\d{2}),(\d{3})\s*-->\s*(\d{2}):(\d{2}):(\d{2}),(\d{3})/);
    if (!match) continue;

    const [, h1, m1, s1, ms1, h2, m2, s2, ms2] = match;
    const start = _srtTimeToSeconds(h1, m1, s1, ms1);
    const end   = _srtTimeToSeconds(h2, m2, s2, ms2);
    const text  = lines.slice(2).join(' ').trim();

    segments.push({ start, end, text, duration: end - start });
  }

  return segments;
}

/**
 * [123] Segmente un texte en blocs de max 3 mots avec timecode proportionnel
 */
function segmentToMaxWords(text, startTime, endTime, maxWords = 3) {
  const words    = text.split(/\s+/).filter(Boolean);
  const total    = words.length;
  const duration = endTime - startTime;
  const results  = [];

  if (total === 0) return results;

  // Groupes de max maxWords mots
  const groups = [];
  for (let i = 0; i < words.length; i += maxWords) {
    groups.push(words.slice(i, i + maxWords));
  }

  const durationPerGroup = duration / groups.length;

  groups.forEach((group, idx) => {
    const s = startTime + idx * durationPerGroup;
    const e = s + durationPerGroup - 0.05; // léger gap
    results.push({ start: s, end: e, words: group });
  });

  return results;
}

/**
 * Détermine si un mot est un mot-clé action → style OR [122]
 */
function isActionWord(word) {
  const clean = word.toLowerCase().replace(/[^a-zàâçéèêëîïôùûüæœ]/g, '');
  return ACTION_KEYWORDS.has(clean);
}

/**
 * Formate un groupe de mots avec style ASS inline (or pour mots-clés) [122]
 */
function formatWordGroup(words) {
  return words.map(word => {
    if (isActionWord(word)) {
      // Override couleur → or #D4AF37
      return `{\\c&H0037AFD4&}${word}{\\c&H00FFFFFF&}`;
    }
    return word;
  }).join(' ');
}

/**
 * [120] Convertit un fichier SRT en ASS avec styles avancés
 * @param {string} srtPath    — chemin fichier .srt source
 * @param {number} videoW     — largeur vidéo
 * @param {number} videoH     — hauteur vidéo
 * @returns {string}          — chemin fichier .ass généré
 */
async function srtToAss(srtPath, videoW = 1080, videoH = 1920) {
  const segments  = await parseSRT(srtPath);
  const assPath   = srtPath.replace(/\.srt$/i, '.ass');

  let header  = buildASSHeader(videoW, videoH);
  let events  = '';

  for (const seg of segments) {
    // [123] Segmenter en max 3 mots
    const chunks = segmentToMaxWords(seg.text, seg.start, seg.end, 3);

    for (const chunk of chunks) {
      const startASS = _secondsToASSTime(chunk.start);
      const endASS   = _secondsToASSTime(chunk.end);
      const text     = formatWordGroup(chunk.words);

      // Choisir le style
      const style = chunk.words.some(isActionWord) ? 'Action' : 'Default';
      events += `Dialogue: 0,${startASS},${endASS},${style},,0,0,0,,${text}\n`;
    }
  }

  await fs.writeFile(assPath, header + events, 'utf8');
  return assPath;
}

// ─── UTILITAIRES TEMPS ────────────────────────────────────────────────────────

function _srtTimeToSeconds(h, m, s, ms) {
  return parseInt(h) * 3600 + parseInt(m) * 60 + parseInt(s) + parseInt(ms) / 1000;
}

function _secondsToASSTime(s) {
  const h   = Math.floor(s / 3600);
  const m   = Math.floor((s % 3600) / 60);
  const sec = Math.floor(s % 60);
  const cs  = Math.round((s % 1) * 100); // centièmes de seconde (ASS)
  return `${h}:${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}.${String(cs).padStart(2, '0')}`;
}

// ─── BURN-IN FFmpeg [121] ─────────────────────────────────────────────────────

/**
 * Construit le filtre FFmpeg pour incruster les sous-titres ASS
 * @param {string} assPath — chemin absolu du fichier .ass
 * @returns {string}       — filtre FFmpeg subtitles
 */
function buildSubtitleFilter(assPath, inputLabel = '', outputLabel = '') {
  // Escape les chemins pour FFmpeg (backslashes Windows + espaces)
  const escaped = assPath.replace(/\\/g, '/').replace(/:/g, '\\:');
  return `${inputLabel}subtitles='${escaped}'${outputLabel}`;
}

// ─── EXPORTS ─────────────────────────────────────────────────────────────────

module.exports = {
  srtToAss, parseSRT, segmentToMaxWords,
  buildASSHeader, buildSubtitleFilter,
  isActionWord, formatWordGroup,
  ACTION_KEYWORDS,
};
