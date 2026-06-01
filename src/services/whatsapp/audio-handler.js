'use strict';
/**
 * DALEBA WhatsApp Salon — Audio Handler
 * STT: Whisper open-source (via API OpenAI ou local)
 * TTS: pyttsx3-like via espeak-ng (open-source, gratuit, CPU)
 *       Fallback: Amazon Polly Lea-Neural (déjà dans l'infra)
 */
const fs   = require('fs');
const path = require('path');
const { execSync } = require('child_process');
const FormData = require('form-data');
const fetch = (...args) => import('node-fetch').then(m => m.default(...args)).catch(() => global.fetch(...args));

const OPENAI_KEY = process.env.OPENAI_API_KEY;
const TMP        = '/tmp/daleba-wa';
fs.mkdirSync(TMP, { recursive: true });

// ─── TRANSCRIPTION AUDIO (STT) ───────────────────────────────────────────────
/**
 * Transcrit un fichier audio via Whisper (open-source, gratuit via OpenAI API)
 * @param {string} audioPath - chemin local du fichier audio (ogg/mp4/mp3/wav)
 * @returns {string} texte transcrit
 */
async function transcribeAudio(audioPath) {
  if (!OPENAI_KEY) return '[Transcription non disponible — OPENAI_API_KEY manquant]';

  // Convertir OGG → WAV si nécessaire (ffmpeg présent dans l'infra)
  let inputPath = audioPath;
  if (audioPath.endsWith('.ogg') || audioPath.endsWith('.opus')) {
    const wavPath = audioPath.replace(/\.(ogg|opus)$/, '.wav');
    try {
      execSync(`ffmpeg -y -i "${audioPath}" -ar 16000 -ac 1 "${wavPath}" 2>/dev/null`);
      inputPath = wavPath;
    } catch(_) { inputPath = audioPath; }
  }

  const form = new FormData();
  form.append('file', fs.createReadStream(inputPath), { filename: path.basename(inputPath) });
  form.append('model', 'whisper-1');
  form.append('language', 'fr');
  form.append('response_format', 'json');

  const res = await fetch('https://api.openai.com/v1/audio/transcriptions', {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${OPENAI_KEY}`, ...form.getHeaders() },
    body: form,
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Whisper STT [${res.status}]: ${err.slice(0, 100)}`);
  }
  const data = await res.json();
  return data.text || '';
}

/**
 * Télécharge un fichier audio depuis une URL et le sauvegarde localement
 * @param {string} url - URL du fichier audio
 * @param {string} ext - extension (ogg, mp4, mp3)
 * @returns {string} chemin local
 */
async function downloadAudio(url, ext = 'ogg') {
  const filename = path.join(TMP, `audio_${Date.now()}.${ext}`);
  const res = await fetch(url);
  const buffer = Buffer.from(await res.arrayBuffer());
  fs.writeFileSync(filename, buffer);
  return filename;
}

// ─── SYNTHÈSE VOCALE (TTS) ────────────────────────────────────────────────────
/**
 * Génère un fichier audio à partir de texte
 * Priorité : espeak-ng (open-source) → Amazon Polly (infra existante)
 * @param {string} text
 * @returns {string|null} chemin du fichier MP3 généré, ou null si échec
 */
async function synthesizeSpeech(text) {
  const outPath = path.join(TMP, `tts_${Date.now()}.mp3`);

  // Option 1: espeak-ng (open-source, CPU, gratuit)
  try {
    const espeakAvail = execSync('which espeak-ng 2>/dev/null || which espeak 2>/dev/null').toString().trim();
    if (espeakAvail) {
      const cmd = `espeak-ng -v fr -a 150 -s 140 -p 50 "${text.replace(/"/g, "'").slice(0, 300)}" --ipa -w /tmp/daleba-wa/raw_${Date.now()}.wav`;
      const wavTmp = path.join(TMP, `raw_${Date.now()}.wav`);
      execSync(`espeak-ng -v fr+f3 -a 150 -s 140 "${text.replace(/"/g, "'").slice(0, 400)}" -w "${wavTmp}" 2>/dev/null`);
      execSync(`ffmpeg -y -i "${wavTmp}" -codec:a libmp3lame -qscale:a 4 "${outPath}" 2>/dev/null`);
      fs.unlinkSync(wavTmp);
      if (fs.existsSync(outPath) && fs.statSync(outPath).size > 1000) return outPath;
    }
  } catch(_) {}

  // Option 2: Google Cloud TTS (tier gratuit 1M chars/mois)
  if (process.env.GOOGLE_TTS_KEY) {
    try {
      const body = {
        input: { text: text.slice(0, 500) },
        voice: { languageCode: 'fr-CA', name: 'fr-CA-Neural2-C', ssmlGender: 'FEMALE' },
        audioConfig: { audioEncoding: 'MP3', speakingRate: 0.95, pitch: 1.0 },
      };
      const r = await fetch(`https://texttospeech.googleapis.com/v1/text:synthesize?key=${process.env.GOOGLE_TTS_KEY}`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
      });
      const d = await r.json();
      if (d.audioContent) {
        fs.writeFileSync(outPath, Buffer.from(d.audioContent, 'base64'));
        return outPath;
      }
    } catch(_) {}
  }

  // Option 3: Twilio Polly — retourne null (Polly est via TwiML seulement)
  // On envoie le message en texte si aucun TTS disponible
  return null;
}

// Nettoyage fichiers tmp > 1h
setInterval(() => {
  try {
    const files = fs.readdirSync(TMP);
    const cutoff = Date.now() - 60 * 60 * 1000;
    files.forEach(f => {
      const fp = path.join(TMP, f);
      try { if (fs.statSync(fp).mtimeMs < cutoff) fs.unlinkSync(fp); } catch(_) {}
    });
  } catch(_) {}
}, 30 * 60 * 1000);

module.exports = { transcribeAudio, downloadAudio, synthesizeSpeech };
