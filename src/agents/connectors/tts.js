/**
 * DALEBA — Connecteur TTS (Text-to-Speech) [045]
 * OpenAI TTS (primaire) · ElevenLabs (voix naturelle fr-CA)
 *
 * Utilisé par l'agent vocal Daleba pour les appels entrants.
 * Voix par défaut : Polly Lea-Neural fr-CA (Twilio) ou nova (OpenAI)
 */

'use strict';

const OpenAI = require('openai');
const axios = require('axios');
let _openai = null;

function getOpenAI() {
  if (!process.env.OPENAI_API_KEY) throw new Error('OPENAI_API_KEY manquante pour TTS');
  if (!_openai) _openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  return _openai;
}

// Voix OpenAI disponibles
const OPENAI_VOICES = { female_fr: 'nova', male_fr: 'onyx', neutral: 'alloy', warm: 'shimmer' };

// ElevenLabs voice IDs (fr-CA naturel)
const ELEVENLABS_VOICES = {
  daleba: process.env.ELEVENLABS_VOICE_ID || 'pNInz6obpgDQGcFmaJgB', // Adam par défaut
};

/**
 * Synthèse via OpenAI TTS
 * @returns {Buffer} audio/mp3
 */
async function openaiTTS(text, voice = 'nova', model = 'tts-1-hd') {
  const client = getOpenAI();
  const mp3 = await client.audio.speech.create({ model, voice, input: text });
  return Buffer.from(await mp3.arrayBuffer());
}

/**
 * Synthèse via ElevenLabs (qualité supérieure pour fr-CA)
 * @returns {Buffer} audio/mp3
 */
async function elevenLabsTTS(text, voiceId = ELEVENLABS_VOICES.daleba) {
  const apiKey = process.env.ELEVENLABS_API_KEY;
  if (!apiKey) throw new Error('ELEVENLABS_API_KEY manquante');

  const response = await axios.post(
    `https://api.elevenlabs.io/v1/text-to-speech/${voiceId}`,
    {
      text,
      model_id: 'eleven_multilingual_v2',
      voice_settings: { stability: 0.5, similarity_boost: 0.75 },
    },
    {
      headers: { 'xi-api-key': apiKey, 'Content-Type': 'application/json' },
      responseType: 'arraybuffer',
      timeout: 15000,
    }
  );

  return Buffer.from(response.data);
}

/**
 * Interface principale — sélection automatique du provider
 * ElevenLabs si clé dispo, sinon OpenAI
 */
async function synthesize(text, options = {}) {
  const useElevenLabs = !!process.env.ELEVENLABS_API_KEY && !options.forceOpenAI;

  if (useElevenLabs) {
    return { audio: await elevenLabsTTS(text, options.voiceId), provider: 'elevenlabs', format: 'mp3' };
  }

  const voice = options.voice || OPENAI_VOICES.warm;
  return { audio: await openaiTTS(text, voice, options.model), provider: 'openai-tts', format: 'mp3' };
}

/**
 * Interface DARE standardisée — retourne l'audio en base64
 */
async function query(text, systemPrompt = '', history = [], options = {}) {
  const result = await synthesize(text, options);
  return {
    model: result.provider,
    content: result.audio.toString('base64'),
    format: 'audio/mp3',
    usage: { input_tokens: Math.ceil(text.length / 4), output_tokens: 0 },
  };
}

module.exports = { query, synthesize, openaiTTS, elevenLabsTTS, OPENAI_VOICES };
