// src/services/ai-router.js
// Routeur neuronal universel DALEBA — sélection automatique du meilleur modèle IA
// Complète DARE avec exposition API admin + injection dynamique de clés

'use strict';

const Anthropic = require('@anthropic-ai/sdk');

// Config des providers disponibles
const PROVIDERS = {
  claude: {
    name: 'Claude (Anthropic)',
    envKey: 'ANTHROPIC_API_KEY',
    models: ['claude-opus-4-5', 'claude-sonnet-4-5', 'claude-haiku-4-5'],
    strengths: ['chat', 'reasoning', 'code', 'accounting'],
    costTier: 'medium',
    priority: 1,
  },
  openai: {
    name: 'GPT-4o (OpenAI)',
    envKey: 'OPENAI_API_KEY',
    models: ['gpt-4o', 'gpt-4o-mini'],
    strengths: ['chat', 'media', 'vision', 'general'],
    costTier: 'medium',
    priority: 2,
  },
  gemini: {
    name: 'Gemini (Google)',
    envKey: 'GEMINI_API_KEY',
    models: ['gemini-1.5-pro', 'gemini-1.5-flash'],
    strengths: ['media', 'multimodal', 'long-context'],
    costTier: 'low',
    priority: 3,
  },
  deepseek: {
    name: 'DeepSeek',
    envKey: 'DEEPSEEK_API_KEY',
    models: ['deepseek-chat', 'deepseek-reasoner'],
    strengths: ['code', 'reasoning', 'accounting'],
    costTier: 'very-low',
    priority: 4,
  },
};

// Matrice de routing par tâche
const TASK_ROUTING = {
  accounting: ['claude', 'deepseek', 'openai', 'gemini'],
  code:       ['deepseek', 'claude', 'openai', 'gemini'],
  media:      ['gemini', 'openai', 'claude', 'deepseek'],
  chat:       ['claude', 'openai', 'gemini', 'deepseek'],
  reasoning:  ['claude', 'deepseek', 'openai', 'gemini'],
  default:    ['claude', 'openai', 'gemini', 'deepseek'],
};

// Stats en mémoire (reset au redémarrage)
const stats = {};
Object.keys(PROVIDERS).forEach(k => {
  stats[k] = { calls: 0, errors: 0, totalMs: 0, lastError: null, lastUsed: null };
});

function getAvailableProviders() {
  return Object.entries(PROVIDERS)
    .filter(([key]) => !!process.env[PROVIDERS[key].envKey])
    .map(([key]) => key);
}

function getProviderStatus() {
  return Object.entries(PROVIDERS).map(([key, cfg]) => ({
    id: key,
    name: cfg.name,
    connected: !!process.env[cfg.envKey],
    models: cfg.models,
    strengths: cfg.strengths,
    costTier: cfg.costTier,
    stats: stats[key],
  }));
}

function detectTask(message = '') {
  const m = message.toLowerCase();
  if (m.match(/comptab|taxe|tps|tvq|facture|revenus?|dépenses?|finances?/)) return 'accounting';
  if (m.match(/code|bug|fonction|script|api|debug|erreur/)) return 'code';
  if (m.match(/image|vidéo|photo|visuel|graphique|design/)) return 'media';
  if (m.match(/calcul|logique|raisonne|analyse|compare/)) return 'reasoning';
  return 'chat';
}

async function callClaude(messages, systemPrompt) {
  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  const res = await client.messages.create({
    model: 'claude-opus-4-5',
    max_tokens: 1024,
    system: systemPrompt || 'Tu es DALEBA, l\'assistant IA du salon Kadio Coiffure.',
    messages,
  });
  return res.content[0].text;
}

async function callOpenAI(messages, systemPrompt) {
  const OpenAI = require('openai');
  const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  const chatMessages = [
    { role: 'system', content: systemPrompt || 'Tu es DALEBA, l\'assistant IA du salon Kadio Coiffure.' },
    ...messages,
  ];
  const res = await client.chat.completions.create({
    model: 'gpt-4o-mini',
    messages: chatMessages,
    max_tokens: 1024,
  });
  return res.choices[0].message.content;
}

async function callGemini(messages, systemPrompt) {
  const { GoogleGenerativeAI } = require('@google/generative-ai');
  const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
  const model = genAI.getGenerativeModel({ model: 'gemini-1.5-flash' });
  const lastMsg = messages[messages.length - 1]?.content || '';
  const result = await model.generateContent(lastMsg);
  return result.response.text();
}

async function callDeepSeek(messages, systemPrompt) {
  const axios = require('axios');
  const res = await axios.post(
    'https://api.deepseek.com/v1/chat/completions',
    {
      model: 'deepseek-chat',
      messages: [
        { role: 'system', content: systemPrompt || 'Tu es DALEBA, assistant IA du salon Kadio Coiffure.' },
        ...messages,
      ],
      max_tokens: 200,
    },
    { headers: { Authorization: `Bearer ${process.env.DEEPSEEK_API_KEY}`, 'Content-Type': 'application/json' } }
  );
  return res.data.choices[0].message.content;
}

const CALLERS = { claude: callClaude, openai: callOpenAI, gemini: callGemini, deepseek: callDeepSeek };

async function route(messages, options = {}) {
  const { systemPrompt, forceProvider, taskHint } = options;
  const task = taskHint || detectTask(messages[messages.length - 1]?.content || '');
  const priority = TASK_ROUTING[task] || TASK_ROUTING.default;
  const available = getAvailableProviders();

  const ordered = forceProvider
    ? [forceProvider, ...priority.filter(p => p !== forceProvider)]
    : priority;

  const candidates = ordered.filter(p => available.includes(p));

  if (candidates.length === 0) {
    return {
      text: 'Aucune clé IA configurée. Veuillez ajouter une clé API dans le Cerveau Central DALEBA.',
      provider: null,
      task,
      fallback: true,
    };
  }

  for (const provider of candidates) {
    const start = Date.now();
    try {
      const text = await CALLERS[provider](messages, systemPrompt);
      const ms = Date.now() - start;
      stats[provider].calls++;
      stats[provider].totalMs += ms;
      stats[provider].lastUsed = new Date().toISOString();
      return { text, provider, task, model: PROVIDERS[provider].models[0], latencyMs: ms };
    } catch (err) {
      stats[provider].errors++;
      stats[provider].lastError = err.message;
      console.warn(`[AI Router] ${provider} failed (${err.message}), trying next...`);
    }
  }

  return {
    text: 'Je suis temporairement indisponible. Contactez le salon directement.',
    provider: null,
    task,
    fallback: true,
  };
}

// ───────────────────────────────────────────────────────────────────────────
// ARCHITECTURE TTS PREMIUM — prêt pour Deepgram Aura & ElevenLabs
// Pour activer : injecter DEEPGRAM_API_KEY ou ELEVENLABS_API_KEY dans Railway
// ───────────────────────────────────────────────────────────────────────────

const https = require('https');

/**
 * Synthèse vocale Deepgram Aura (ultra-réaliste, <300ms latence)
 * @param {string} text   Texte à synthétiser
 * @param {string} voice  Modèle Deepgram : 'aura-luna-fr', 'aura-stella-en', etc.
 * @returns {Promise<Buffer|null>} Audio MP3 ou null si clé absente
 */
async function ttsDeepgram(text, voice = 'aura-luna-fr') {
  const key = process.env.DEEPGRAM_API_KEY;
  if (!key) return null; // clé pas encore injectée — silent fallback

  const body = JSON.stringify({ text });
  return new Promise((resolve) => {
    const req = https.request({
      hostname: 'api.deepgram.com',
      path: `/v1/speak?model=${voice}&encoding=mp3`,
      method: 'POST',
      headers: {
        'Authorization': `Token ${key}`,
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(body),
      },
    }, (res) => {
      if (res.statusCode !== 200) return resolve(null);
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => resolve(Buffer.concat(chunks)));
    });
    req.on('error', () => resolve(null));
    req.setTimeout(8000, () => { req.destroy(); resolve(null); });
    req.end(body);
  });
}

/**
 * Synthèse vocale ElevenLabs (clone de voix humaine)
 * @param {string} text     Texte à synthétiser
 * @param {string} voiceId  ID de la voix ElevenLabs (ex: 'pMsXgVXv3BLzUgSXRplE' = Maya fr)
 * @returns {Promise<Buffer|null>} Audio MP3 ou null si clé absente
 */
async function ttsElevenLabs(text, voiceId = 'pMsXgVXv3BLzUgSXRplE') {
  const key = process.env.ELEVENLABS_API_KEY;
  if (!key) return null;

  const body = JSON.stringify({
    text,
    model_id: 'eleven_turbo_v2',  // ultra-rapide
    voice_settings: { stability: 0.45, similarity_boost: 0.8, style: 0.1, use_speaker_boost: true },
  });
  return new Promise((resolve) => {
    const req = https.request({
      hostname: 'api.elevenlabs.io',
      path: `/v1/text-to-speech/${voiceId}/stream`,
      method: 'POST',
      headers: {
        'xi-api-key': key,
        'Content-Type': 'application/json',
        'Accept': 'audio/mpeg',
        'Content-Length': Buffer.byteLength(body),
      },
    }, (res) => {
      if (res.statusCode !== 200) return resolve(null);
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => resolve(Buffer.concat(chunks)));
    });
    req.on('error', () => resolve(null));
    req.setTimeout(10000, () => { req.destroy(); resolve(null); });
    req.end(body);
  });
}

/**
 * Synthèse vocale OpenAI TTS — voix naturelle, latence ~500ms
 * Voix recommandées FR : 'nova' (féminine, chaleureuse), 'onyx' (masculine, grave)
 * Modèles : 'tts-1' (rapide) ou 'tts-1-hd' (haute définition)
 */
async function ttsOpenAI(text, voice = 'nova', model = 'tts-1') {
  const key = process.env.OPENAI_API_KEY;
  if (!key) return null;

  const body = JSON.stringify({ model, input: text, voice, speed: 1.0 });
  return new Promise((resolve) => {
    const req = https.request({
      hostname: 'api.openai.com',
      path: '/v1/audio/speech',
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${key}`,
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(body),
      },
    }, (res) => {
      if (res.statusCode !== 200) {
        // Lire et ignorer le corps d'erreur
        res.resume();
        return resolve(null);
      }
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => resolve(Buffer.concat(chunks)));
    });
    req.on('error', () => resolve(null));
    req.setTimeout(12000, () => { req.destroy(); resolve(null); });
    req.end(body);
  });
}

/**
 * Router TTS universel : Deepgram > ElevenLabs > OpenAI > fallback Web Speech
 * Priorité : qualité + latence. OpenAI TTS est le fallback premium si pas de Deepgram/ElevenLabs.
 * Retourne { audio: Buffer, provider: string } ou { audio: null, provider: 'browser' }
 */
/**
 * Google Translate TTS proxy (gratuit, voix naturelle FR, aucune clé requise)
 * Limite : ~200 chars par requête. Pour les textes longs, découper en chunks.
 */
async function ttsGoogleFree(text, lang = 'fr') {
  // Découper en chunks de 180 chars max sur les espaces
  const maxLen = 180;
  const chunks = [];
  let remaining = text.trim();
  while (remaining.length > 0) {
    if (remaining.length <= maxLen) { chunks.push(remaining); break; }
    let cut = remaining.lastIndexOf(' ', maxLen);
    if (cut < 50) cut = maxLen;
    chunks.push(remaining.slice(0, cut));
    remaining = remaining.slice(cut).trim();
  }

  const buffers = [];
  for (const chunk of chunks) {
    const encoded = encodeURIComponent(chunk);
    const buf = await new Promise((resolve) => {
      const req = https.request({
        hostname: 'translate.google.com',
        path: `/translate_tts?ie=UTF-8&q=${encoded}&tl=${lang}&client=tw-ob`,
        method: 'GET',
        headers: {
          'User-Agent': 'Mozilla/5.0 (compatible; KadioBot/1.0)',
          'Referer': 'https://translate.google.com/',
        },
      }, (res) => {
        if (res.statusCode !== 200) { res.resume(); return resolve(null); }
        const parts = [];
        res.on('data', c => parts.push(c));
        res.on('end', () => resolve(Buffer.concat(parts)));
      });
      req.on('error', () => resolve(null));
      req.setTimeout(8000, () => { req.destroy(); resolve(null); });
      req.end();
    });
    if (buf) buffers.push(buf);
  }
  if (buffers.length === 0) return null;
  return Buffer.concat(buffers);
}

async function ttsRoute(text, opts = {}) {
  // 1. Deepgram Aura — ultra-rapide (<300ms), excellent FR
  if (process.env.DEEPGRAM_API_KEY) {
    const audio = await ttsDeepgram(text, opts.deepgramVoice);
    if (audio) return { audio, provider: 'deepgram', mimeType: 'audio/mpeg' };
  }
  // 2. ElevenLabs — clone voix humaine, meilleure naturalité
  if (process.env.ELEVENLABS_API_KEY) {
    const audio = await ttsElevenLabs(text, opts.voiceId);
    if (audio) return { audio, provider: 'elevenlabs', mimeType: 'audio/mpeg' };
  }
  // 3. OpenAI TTS — voix 'nova' (chaleureuse), quota consumé si clé hors-quota
  if (process.env.OPENAI_API_KEY && process.env.OPENAI_TTS_ENABLED !== 'false') {
    const voice = opts.voice || (process.env.TTS_OPENAI_VOICE || 'nova');
    const model = opts.model || (process.env.TTS_OPENAI_MODEL || 'tts-1');
    const audio = await ttsOpenAI(text, voice, model);
    if (audio) return { audio, provider: 'openai', mimeType: 'audio/mpeg' };
  }
  // 4. Google Translate TTS — gratuit, voix naturelle FR, aucune clé
  if (process.env.TTS_GOOGLE_FREE !== 'false') {
    const lang = opts.lang || 'fr';
    const audio = await ttsGoogleFree(text, lang);
    if (audio && audio.length > 1000) return { audio, provider: 'google-free', mimeType: 'audio/mpeg' };
  }
  // 5. Fallback navigateur — Web Speech API
  return { audio: null, provider: 'browser' };
}

module.exports = { route, getProviderStatus, getAvailableProviders, detectTask, stats, PROVIDERS, ttsRoute, ttsDeepgram, ttsElevenLabs, ttsOpenAI };
