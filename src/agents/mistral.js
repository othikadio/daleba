'use strict';
/**
 * DALEBA — Connecteur Mistral AI
 * API REST native — endpoint https://api.mistral.ai/v1
 * Modèles : mistral-large-latest (perf), mistral-small-latest (économique, tier gratuit)
 * Position dans DARE : Fallback #1 après DeepSeek
 *
 * Rate limits tier gratuit : ~1 req/s = 60 RPM
 * Notre rythme actuel : 30 RPM — aucun risque de 429
 */

const DEFAULT_MODEL = process.env.MISTRAL_MODEL || 'mistral-small-latest';

function getKey() {
  const k = process.env.MISTRAL_API_KEY;
  if (!k) throw new Error('MISTRAL_API_KEY non configurée');
  return k;
}

async function query(message, systemPrompt = '', history = []) {
  const messages = [
    { role: 'system', content: systemPrompt || 'Tu es DALEBA, assistant stratégique expert en business et technologie. Réponds en français sauf si la question est en anglais.' },
    ...history,
    { role: 'user', content: message },
  ];

  const res = await fetch('https://api.mistral.ai/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${getKey()}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model:       DEFAULT_MODEL,
      messages,
      max_tokens:  4096,
      temperature: 0.7,
    }),
  });

  const data = await res.json();
  if (!res.ok) throw new Error(data.message || data.error?.message || `Mistral [${res.status}]`);

  return {
    model:   data.model || DEFAULT_MODEL,
    content: data.choices[0].message.content,
    usage:   data.usage,
  };
}

module.exports = { query };
