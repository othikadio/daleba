/**
 * DALEBA — Connecteur Llama Local (Ollama)
 * DARE Metacortex — Point 029 : anti-blocage régional / air-gap
 *
 * Activé automatiquement si les APIs cloud sont inaccessibles depuis la région.
 * Nécessite Ollama sur un serveur GPU secondaire.
 * Configurer : OLLAMA_BASE_URL=http://<gpu-server>:11434
 *              OLLAMA_MODEL=llama3:70b (optionnel, défaut: llama3:8b)
 */

'use strict';

const axios = require('axios');

function getBaseUrl() {
  return process.env.OLLAMA_BASE_URL || 'http://localhost:11434';
}

function getModel() {
  return process.env.OLLAMA_MODEL || 'llama3:8b';
}

/**
 * Interface DARE standardisée : query(message, systemPrompt, history)
 */
async function query(message, systemPrompt = '', history = []) {
  const baseUrl = getBaseUrl();
  const model = getModel();

  // Conversion historique → format Ollama
  const messages = [
    ...(systemPrompt ? [{ role: 'system', content: systemPrompt }] : []),
    ...history,
    { role: 'user', content: message },
  ];

  const response = await axios.post(
    `${baseUrl}/api/chat`,
    { model, messages, stream: false },
    { timeout: 60000, headers: { 'Content-Type': 'application/json' } }
  );

  const msg = response.data?.message;
  if (!msg) throw new Error('Ollama: réponse vide ou format inattendu');

  return {
    model: `ollama/${model}`,
    content: msg.content,
    usage: {
      input_tokens: response.data.prompt_eval_count || 0,
      output_tokens: response.data.eval_count || 0,
    },
  };
}

/**
 * Vérifie si Ollama est disponible et quel modèle est chargé
 */
async function healthCheck() {
  const baseUrl = getBaseUrl();
  try {
    const res = await axios.get(`${baseUrl}/api/tags`, { timeout: 3000 });
    const models = res.data?.models?.map(m => m.name) || [];
    return { available: true, models, baseUrl };
  } catch {
    return { available: false, models: [], baseUrl };
  }
}

module.exports = { query, healthCheck };
