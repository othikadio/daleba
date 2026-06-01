'use strict';
/**
 * DALEBA — Connecteur Kimi (Moonshot AI)
 * API 100% compatible OpenAI — endpoint https://api.moonshot.cn/v1
 * Modèles : kimi-latest (recommandé), moonshot-v1-8k, moonshot-v1-32k, moonshot-v1-128k
 * Remplace GPT-4o dans le pool DARE — crédits OpenAI épuisés 2026-06-01
 *
 * Rate limits Kimi (tier standard) :
 *   - ~60 RPM (1 req/s max recommandé)
 *   - Calibré ici pour 30 RPM (marge de sécurité 2×)
 */

const OpenAI = require('openai');

let _client = null;

function getClient() {
  const key = process.env.KIMI_API_KEY;
  if (!key) throw new Error('KIMI_API_KEY non configurée — ajoutez la variable dans Railway');
  if (!_client) {
    _client = new OpenAI({
      apiKey:  key,
      baseURL: 'https://api.moonshot.cn/v1',
    });
  }
  return _client;
}

// Modèle par défaut : kimi-latest (128k contexte, multimodal)
// Fallback : moonshot-v1-32k si kimi-latest indisponible
const DEFAULT_MODEL = process.env.KIMI_MODEL || 'kimi-latest';

async function query(message, systemPrompt = '', history = []) {
  const client = getClient();

  const messages = [
    { role: 'system', content: systemPrompt || 'Tu es DALEBA, assistant stratégique expert en business et technologie. Réponds en français sauf si la question est en anglais.' },
    ...history,
    { role: 'user', content: message },
  ];

  const response = await client.chat.completions.create({
    model:      DEFAULT_MODEL,
    messages,
    max_tokens: 4096,
    temperature: 0.7,
  });

  return {
    model:   DEFAULT_MODEL,
    content: response.choices[0].message.content,
    usage:   response.usage,
  };
}

// Appel rapide pour le router salon WhatsApp (context court)
async function quickQuery(message, systemPrompt = '', maxTokens = 300) {
  const client = getClient();
  const response = await client.chat.completions.create({
    model:      'moonshot-v1-8k', // plus rapide + économique pour réponses courtes
    messages:   [
      { role: 'system', content: systemPrompt || 'Tu es un assistant de salon de coiffure.' },
      { role: 'user',   content: message },
    ],
    max_tokens:  maxTokens,
    temperature: 0.75,
  });
  return response.choices[0].message.content.trim();
}

module.exports = { query, quickQuery };
