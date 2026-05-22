/**
 * DALEBA — Style Extractor
 * Analyse les paires d'entraînement pour extraire le style de communication
 * unique du salon Kadio Coiffure : chaleur, patterns, formules récurrentes.
 *
 * Produit un "Style DNA" injecté dynamiquement dans le prompt Claude.
 */

const { Pool } = require('pg');
const pool = new Pool({ connectionString: process.env.DATABASE_URL });

// ─── EXTRACTION STYLE DNA ─────────────────────────────────────────────────────

/**
 * Analyse statistique des réponses staff pour extraire :
 * - Formules d'ouverture les plus utilisées
 * - Mots chaleureux signature
 * - Structure type des réponses par intent
 * - Exemples few-shot top qualité (score ≥ 0.7)
 */
async function extractStyleDNA() {
  const { rows: topPairs } = await pool.query(`
    SELECT client_msg, staff_reply, intent, quality_score, source
    FROM daleba_training_data
    WHERE quality_score >= 0.65
    ORDER BY quality_score DESC
    LIMIT 200
  `);

  if (!topPairs.length) return null;

  // Analyse des ouvertures (premiers mots)
  const openings = {};
  const warmWords = {};
  const byIntent  = {};

  for (const pair of topPairs) {
    // Ouverture
    const firstSentence = pair.staff_reply.split(/[.!?]/)[0].trim();
    if (firstSentence.length < 80) {
      openings[firstSentence] = (openings[firstSentence] || 0) + 1;
    }

    // Mots chaleureux
    const words = pair.staff_reply.toLowerCase().match(/\b(bonjour|bienvenue|ravie?|plaisir|merci|parfait|absolument|chaleureusement|enchanté|volontiers|avec joie|bien sûr|certainement)\b/g) || [];
    words.forEach(w => { warmWords[w] = (warmWords[w] || 0) + 1; });

    // Par intent
    if (!byIntent[pair.intent]) byIntent[pair.intent] = [];
    if (byIntent[pair.intent].length < 5) {
      byIntent[pair.intent].push({ q: pair.client_msg, a: pair.staff_reply, score: pair.quality_score });
    }
  }

  // Top 5 ouvertures
  const topOpenings = Object.entries(openings)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([phrase]) => phrase);

  // Top mots signature
  const signatureWords = Object.entries(warmWords)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10)
    .map(([word]) => word);

  return { topOpenings, signatureWords, byIntent, totalAnalyzed: topPairs.length };
}

// ─── SÉLECTION FEW-SHOT ───────────────────────────────────────────────────────

/**
 * Sélectionne les N meilleures paires par intent pour le few-shot
 * Retourne un prompt-fragment prêt à injecter dans Claude
 */
async function buildFewShotBlock(intent = null, limit = 3) {
  let query = `
    SELECT client_msg, staff_reply, intent, quality_score
    FROM daleba_training_data
    WHERE quality_score >= 0.7
  `;
  const params = [];
  if (intent && intent !== 'general') {
    params.push(intent);
    query += ` AND intent = $${params.length}`;
  }
  query += ` ORDER BY quality_score DESC, RANDOM() LIMIT $${params.length + 1}`;
  params.push(limit);

  const { rows } = await pool.query(query, params);
  if (!rows.length) return '';

  const examples = rows.map((r, i) =>
    `Exemple ${i + 1} (${r.intent}) :\n` +
    `CLIENT : "${r.client_msg.slice(0, 200)}"\n` +
    `RÉPONSE : "${r.staff_reply.slice(0, 300)}"`
  ).join('\n\n');

  return `\n\n=== EXEMPLES DE TON STYLE (conversations réelles du salon) ===\n${examples}\n` +
         `=== Adapte-toi à ce ton chaleureux et naturel dans ta réponse. ===\n`;
}

// ─── CONSTRUCTION SYSTEM PROMPT ENRICHI ──────────────────────────────────────

/**
 * Génère le bloc de style à injecter dans le system prompt de Claude
 * Combine Style DNA + Few-shot examples
 */
async function buildStylePromptBlock(intent = null) {
  try {
    const [dna, fewShot] = await Promise.all([
      extractStyleDNA(),
      buildFewShotBlock(intent, 3),
    ]);

    let block = '';

    if (dna && dna.totalAnalyzed > 0) {
      block += `\n\n=== TON STYLE DE COMMUNICATION (appris des vraies conversations du salon) ===\n`;
      if (dna.topOpenings.length) {
        block += `Formules d'ouverture signature : ${dna.topOpenings.slice(0, 3).join(' | ')}\n`;
      }
      if (dna.signatureWords.length) {
        block += `Vocabulaire chaleureux à privilégier : ${dna.signatureWords.join(', ')}\n`;
      }
      block += `Basé sur ${dna.totalAnalyzed} conversations réelles analysées.\n`;
    }

    block += fewShot;
    return block;

  } catch (err) {
    console.warn('[STYLE] Erreur extraction style:', err.message);
    return ''; // fail silencieux — le prompt fonctionne sans
  }
}

/**
 * Marque les paires utilisées dans le prompt actif
 */
async function markUsedInPrompt(ids) {
  if (!ids?.length) return;
  await pool.query(
    'UPDATE daleba_training_data SET used_in_prompt = true WHERE id = ANY($1)',
    [ids]
  );
}

module.exports = {
  extractStyleDNA,
  buildFewShotBlock,
  buildStylePromptBlock,
};
