/**
 * DALEBA — Connecteur Analyse de Sentiments [045]
 * Score frustration · Détection intent · Escalade vocale
 *
 * Utilisé par : voice-agent.js, communication-hub.js
 * Optimisé coût : DeepSeek pour volume, Claude pour précision critique
 */

'use strict';

// ─── ANALYSE RAPIDE (règles locales, 0 coût API) ─────────────────────────────

const FRUSTRATION_KEYWORDS = {
  fr: {
    high: ['scandale', 'inacceptable', 'remboursement', 'avocat', 'procès', 'honte', 'arnaque', 'voleur', 'incompétent'],
    medium: ['frustré', 'déçu', 'en colère', 'énervé', 'pas content', 'problème', 'réclamation', 'plainte'],
    low: ['pas satisfait', 'bizarre', 'étrange', 'incorrect', 'erreur'],
  },
  en: {
    high: ['lawsuit', 'lawyer', 'scam', 'fraud', 'unacceptable', 'outrageous', 'disgusting'],
    medium: ['frustrated', 'angry', 'upset', 'disappointed', 'unhappy', 'complaint'],
    low: ['wrong', 'incorrect', 'issue', 'problem', 'weird'],
  },
};

const ESCALATION_KEYWORDS = ['urgence', 'urgent', 'directeur', 'gérant', 'patron', 'responsable',
  'ulrich', 'humain', 'vrai personne', 'quelqu\'un', 'manager', 'supervisor'];

/**
 * Score de frustration local (0-100) sans appel API
 */
function localFrustrationScore(text) {
  const lower = text.toLowerCase();
  let score = 0;

  for (const lang of Object.values(FRUSTRATION_KEYWORDS)) {
    for (const kw of lang.high)   { if (lower.includes(kw)) score += 30; }
    for (const kw of lang.medium) { if (lower.includes(kw)) score += 15; }
    for (const kw of lang.low)    { if (lower.includes(kw)) score += 5;  }
  }

  // Majuscules = intensité
  const capsRatio = (text.match(/[A-Z]/g) || []).length / Math.max(text.length, 1);
  if (capsRatio > 0.3) score += 15;

  // Points d'exclamation multiples
  const exclamations = (text.match(/!/g) || []).length;
  score += Math.min(exclamations * 5, 20);

  return Math.min(score, 100);
}

/**
 * Détection escalade requise
 */
function requiresEscalation(text, frustrationScore = 0) {
  const lower = text.toLowerCase();
  const keywordMatch = ESCALATION_KEYWORDS.some(kw => lower.includes(kw));
  return keywordMatch || frustrationScore >= 70;
}

// ─── ANALYSE LLM (précision maximale) ────────────────────────────────────────

/**
 * Analyse complète via LLM (Claude ou DeepSeek selon volume)
 * Retourne sentiment, intent, frustration, langue détectée
 */
async function analyzeWithLLM(text, useDeepSeek = false) {
  const prompt = `Analyse ce message client de salon de coiffure.

Message: "${text}"

Retourne UNIQUEMENT un JSON valide :
{
  "sentiment": "positive|neutral|negative",
  "intent": "booking|info|complaint|compliment|cancel|unknown",
  "frustration_score": <0-100>,
  "language": "fr|en|other",
  "requires_escalation": <true|false>,
  "summary": "<résumé en 1 phrase>"
}`;

  const systemPrompt = 'Tu es un expert en analyse de sentiment pour salon de coiffure. Retourne uniquement du JSON valide, sans markdown.';

  let agent;
  if (useDeepSeek && process.env.DEEPSEEK_API_KEY) {
    agent = require('../deepseek');
  } else if (process.env.ANTHROPIC_API_KEY) {
    agent = require('../claude');
  } else if (process.env.DEEPSEEK_API_KEY) {
    agent = require('../deepseek');
  } else {
    throw new Error('[Sentiment] Aucun provider LLM disponible');
  }

  const result = await agent.query(prompt, systemPrompt, []);

  try {
    const clean = result.content.replace(/```json\n?|\n?```/g, '').trim();
    return JSON.parse(clean);
  } catch {
    // Fallback si JSON malformé
    const score = localFrustrationScore(text);
    return {
      sentiment: score > 50 ? 'negative' : 'neutral',
      intent: 'unknown',
      frustration_score: score,
      language: 'fr',
      requires_escalation: requiresEscalation(text, score),
      summary: 'Analyse dégradée (fallback local)',
    };
  }
}

/**
 * Interface principale — hybride local + LLM si nécessaire
 * Optimisation coût : local d'abord, LLM uniquement si score ambigu
 */
async function analyze(text, options = {}) {
  const localScore = localFrustrationScore(text);
  const escalation = requiresEscalation(text, localScore);

  // Court-circuit : score clair → pas besoin de LLM
  if (!options.forceLLM && (localScore === 0 || localScore >= 70)) {
    return {
      sentiment: localScore >= 50 ? 'negative' : 'positive',
      intent: 'unknown',
      frustration_score: localScore,
      language: 'fr',
      requires_escalation: escalation,
      source: 'local',
    };
  }

  // Score ambigu → LLM pour précision
  const llmResult = await analyzeWithLLM(text, options.useDeepSeek);
  return { ...llmResult, source: 'llm' };
}

/**
 * Interface DARE standardisée
 */
async function query(text, systemPrompt = '', history = [], options = {}) {
  const result = await analyze(text, options);
  return {
    model: `sentiment-${result.source}`,
    content: JSON.stringify(result),
    structured: result,
    usage: { input_tokens: Math.ceil(text.length / 4), output_tokens: 50 },
  };
}

module.exports = { query, analyze, analyzeWithLLM, localFrustrationScore, requiresEscalation };
