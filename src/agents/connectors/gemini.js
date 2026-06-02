/**
 * DALEBA — Connecteur Gemini 1.5 Pro (Google)
 * Structure standardisée DARE — Points 021-023
 * Contexte : 1M tokens — idéal pour documents lourds et analyse volumineuse
 */

const { GoogleGenerativeAI } = require('@google/generative-ai');

let _client = null;

function getClient() {
  if (!process.env.GEMINI_API_KEY) throw new Error('GEMINI_API_KEY non configurée');
  if (!_client) _client = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
  return _client;
}

async function query(message, systemPrompt = '', history = []) {
  const genAI = getClient();
  const model = genAI.getGenerativeModel({
    model: 'gemini-2.0-flash',
    systemInstruction: systemPrompt || 'Tu es DALEBA, assistant stratégique et analytique.',
  });

  // Conversion historique vers format Gemini
  const geminiHistory = history.map(msg => ({
    role: msg.role === 'assistant' ? 'model' : 'user',
    parts: [{ text: msg.content }],
  }));

  const chat = model.startChat({ history: geminiHistory });
  const result = await chat.sendMessage(message);
  const response = await result.response;

  return {
    model: 'gemini-2.0-flash',
    content: response.text(),
    usage: {
      input_tokens: response.usageMetadata?.promptTokenCount || 0,
      output_tokens: response.usageMetadata?.candidatesTokenCount || 0,
    },
  };
}

module.exports = { query };
