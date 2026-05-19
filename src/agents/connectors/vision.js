/**
 * DALEBA — Connecteur Vision AI [045]
 * Analyse d'images : GPT-4V (primaire) → Gemini Vision (fallback)
 *
 * Cas d'usage salon :
 * - Analyse photo coiffure → diagnostic capillaire
 * - Scan reçu → extraction montant/date
 * - Photo produit → identification + suggestion
 */

'use strict';

const OpenAI = require('openai');
let _openai = null;

function getOpenAI() {
  if (!process.env.OPENAI_API_KEY) throw new Error('OPENAI_API_KEY manquante pour Vision');
  if (!_openai) _openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  return _openai;
}

/**
 * Analyse une image avec prompt textuel
 * @param {string} imageUrl — URL publique ou base64 data:image/...
 * @param {string} prompt — Question / instruction pour l'analyse
 * @param {object} options — { detail: 'low'|'high'|'auto', maxTokens: 1024 }
 */
async function analyzeImage(imageUrl, prompt, options = {}) {
  const client = getOpenAI();
  const detail = options.detail || 'auto';
  const maxTokens = options.maxTokens || 1024;

  const imageContent = imageUrl.startsWith('data:')
    ? { type: 'image_url', image_url: { url: imageUrl, detail } }
    : { type: 'image_url', image_url: { url: imageUrl, detail } };

  const response = await client.chat.completions.create({
    model: 'gpt-4o',
    max_tokens: maxTokens,
    messages: [{
      role: 'user',
      content: [
        imageContent,
        { type: 'text', text: prompt },
      ],
    }],
  });

  return {
    model: 'gpt-4o-vision',
    content: response.choices[0].message.content,
    usage: response.usage,
    analysis: parseStructuredAnalysis(response.choices[0].message.content),
  };
}

/**
 * Interface DARE standardisée (pour intégration dans le routeur)
 * message format: "IMAGE:<url>|<prompt>" ou juste le prompt si imageUrl passé dans options
 */
async function query(message, systemPrompt = '', history = [], options = {}) {
  const imageUrl = options.imageUrl || extractImageUrl(message);
  const prompt = imageUrl ? message.replace(/^IMAGE:[^\|]+\|/, '') : message;

  if (!imageUrl) {
    throw new Error('[Vision] Aucune URL d\'image fournie. Format: IMAGE:<url>|<prompt>');
  }

  return analyzeImage(imageUrl, systemPrompt ? `${systemPrompt}\n\n${prompt}` : prompt, options);
}

function extractImageUrl(message) {
  const match = message.match(/^IMAGE:([^\|]+)\|/);
  return match ? match[1].trim() : null;
}

function parseStructuredAnalysis(text) {
  // Tentative d'extraction structurée si la réponse contient des patterns clés
  return { raw: text };
}

/**
 * Diagnostic capillaire — cas d'usage spécifique Kadio Coiffure
 */
async function hairAnalysis(imageUrl) {
  const prompt = `Analyse cette photo de cheveux en tant qu'expert capillaire professionnel.
  
  Identifie:
  1. Type de cheveux (textures 1A-4C)
  2. État général (hydratation, porosité, dommages visibles)
  3. Services recommandés du salon (coupe, soin, traitement)
  4. Produits adaptés
  
  Réponds en JSON structuré: { type, etat, services_recommandes[], produits[], notes }`;

  return analyzeImage(imageUrl, prompt, { detail: 'high', maxTokens: 800 });
}

module.exports = { query, analyzeImage, hairAnalysis };
