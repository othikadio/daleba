/**
 * Voice Localizer — DALEBA Metacortex Point 146
 *
 * Génère des variantes linguistiques (FR/EN/ES) des voix off et sous-titres.
 * Région bilingue Québec → FR + EN par défaut.
 */

'use strict';

// ─── LANGUES SUPPORTÉES [146] ─────────────────────────────────────────────────

const SUPPORTED_LOCALES = {
  'fr-CA': { name: 'Français (Québec)', pollyVoice: 'Polly.Lea-Neural',    whisperLang: 'fr' },
  'en-CA': { name: 'English (Canada)',  pollyVoice: 'Polly.Joanna-Neural', whisperLang: 'en' },
  'fr-FR': { name: 'Français (France)', pollyVoice: 'Polly.Lea-Neural',    whisperLang: 'fr' },
  'es':    { name: 'Español',           pollyVoice: 'Polly.Lupe-Neural',   whisperLang: 'es' },
};

// Marché Québec = FR + EN [146]
const DEFAULT_LOCALES = ['fr-CA', 'en-CA'];

// ─── TRADUCTION VOIX OFF [146] ────────────────────────────────────────────────

async function translateVoiceover(text, targetLocale, sourceLocale = 'fr-CA') {
  if (targetLocale === sourceLocale) return text;

  const claude = require('../agents/claude');
  const targetName = SUPPORTED_LOCALES[targetLocale]?.name || targetLocale;

  const prompt = `Traduis ce texte de voix off pour un salon de coiffure premium (Kadio Coiffure, Longueuil, QC).

TEXTE SOURCE (${sourceLocale}):
"${text}"

CIBLE: ${targetName}

Règles:
- Conserve le ton premium et chaleureux
- Adapte les expressions culturellement (pas de traduction littérale)
- Garde les noms propres intacts (Kadio Coiffure, Longueuil)
- Max même longueur que l'original (timing voix off)

Réponds UNIQUEMENT avec le texte traduit, sans guillemets.`;

  const result = await claude.query(prompt, 'Expert en localisation contenu beauté/luxe.', []);
  return result.content.trim();
}

// ─── VARIANTS SOUS-TITRES [146] ───────────────────────────────────────────────

async function generateMultilingualSubtitles(srtPath, targetLocales = DEFAULT_LOCALES) {
  const fs = require('fs').promises;
  const path = require('path');

  const srtContent = await fs.readFile(srtPath, 'utf8');
  const results = {};

  for (const locale of targetLocales) {
    if (locale === 'fr-CA') {
      results[locale] = srtPath; // Déjà en français
      continue;
    }

    // Extraire les textes SRT
    const lines = srtContent.split('\n');
    const translated = [];

    for (const line of lines) {
      // Lignes de texte (pas numéros, pas timecodes)
      if (line.trim() && !line.match(/^\d+$/) && !line.match(/\d{2}:\d{2}:\d{2}/)) {
        const tr = await translateVoiceover(line.trim(), locale).catch(() => line);
        translated.push(tr);
      } else {
        translated.push(line);
      }
    }

    const localePath = srtPath.replace('.srt', `_${locale}.srt`);
    await fs.writeFile(localePath, translated.join('\n'), 'utf8');
    results[locale] = localePath;
  }

  return results;
}

// ─── CAPTION MULTILINGUE [146] ────────────────────────────────────────────────

async function generateMultilingualCaption(frCaption, hashtags = [], locales = DEFAULT_LOCALES) {
  const results = { 'fr-CA': { caption: frCaption, hashtags } };

  for (const locale of locales) {
    if (locale === 'fr-CA') continue;
    const translated = await translateVoiceover(frCaption, locale).catch(() => frCaption);
    results[locale] = {
      caption:  translated,
      hashtags: [...hashtags, `#${SUPPORTED_LOCALES[locale]?.name.split(' ')[0] || locale}`],
    };
  }

  return results;
}

// ─── SÉLECTION LOCALE PAR PUBLICATION [146] ──────────────────────────────────

function selectLocaleForPlatform(platform) {
  // TikTok: bilingual FR+EN pour max reach au Québec
  if (platform === 'tiktok') return ['fr-CA', 'en-CA'];
  // Instagram: FR principal, EN alterné
  if (platform === 'instagram') return ['fr-CA'];
  return DEFAULT_LOCALES;
}

// ─── EXPORTS ─────────────────────────────────────────────────────────────────

module.exports = {
  translateVoiceover, generateMultilingualSubtitles,
  generateMultilingualCaption, selectLocaleForPlatform,
  SUPPORTED_LOCALES, DEFAULT_LOCALES,
};
