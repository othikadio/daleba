'use strict';

/**
 * DALEBA — WhatsApp Business Engine
 * Gère : texte auto-réponse · audio transcription · appels manqués
 *
 * Compatible Meta Cloud API + Twilio WhatsApp
 */

const https  = require('https');
const http   = require('http');
const bus    = require('./event-bus');
const twilio = require('./twilio');

// ─── CONFIG ───────────────────────────────────────────────────────────────────

const OPENAI_KEY     = process.env.OPENAI_API_KEY;
const WA_PHONE_ID    = process.env.WHATSAPP_PHONE_NUMBER_ID;   // Meta Cloud API
const WA_TOKEN       = process.env.WHATSAPP_ACCESS_TOKEN || process.env.META_ACCESS_TOKEN;
const TWILIO_WA_FROM = process.env.TWILIO_WHATSAPP_FROM  // ex: whatsapp:+13022328291
                    || `whatsapp:${process.env.TWILIO_PHONE_NUMBER}`;
const ULRICH_PHONE   = process.env.ULRICH_PHONE_NUMBER;

// ─── ENVOI WHATSAPP ───────────────────────────────────────────────────────────

/**
 * Envoie un message texte WhatsApp via Meta Cloud API ou Twilio en fallback
 */
async function sendWhatsApp(to, text) {
  const phone = to.replace('whatsapp:', '');

  // Priorité : Meta Cloud API
  if (WA_PHONE_ID && WA_TOKEN) {
    return _sendMetaWA(phone, text);
  }

  // Fallback : Twilio WhatsApp
  const dest = phone.startsWith('whatsapp:') ? phone : `whatsapp:${phone}`;
  return twilio.sendSMS(dest, text).catch(err => {
    bus.emit('error', `[WA] Envoi Twilio échoué: ${err.message}`);
  });
}

async function _sendMetaWA(to, text) {
  const body = JSON.stringify({
    messaging_product: 'whatsapp',
    to,
    type: 'text',
    text: { body: text },
  });

  return new Promise((resolve, reject) => {
    const req = https.request({
      hostname: 'graph.facebook.com',
      path: `/v19.0/${WA_PHONE_ID}/messages`,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${WA_TOKEN}`,
        'Content-Length': Buffer.byteLength(body),
      },
    }, (res) => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => {
        try { resolve(JSON.parse(data)); }
        catch { reject(new Error(data.slice(0, 100))); }
      });
    });
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

// ─── TRANSCRIPTION AUDIO (OpenAI Whisper) ────────────────────────────────────

/**
 * Télécharge un fichier audio depuis une URL et le transcrit via Whisper
 * @param {string} audioUrl — URL du fichier audio (Meta ou Twilio)
 * @param {string} [mimeType] — ex: 'audio/ogg; codecs=opus'
 * @returns {Promise<string>} texte transcrit
 */
async function transcribeAudio(audioUrl, mimeType = 'audio/ogg') {
  if (!OPENAI_KEY) throw new Error('OPENAI_API_KEY manquant pour la transcription');

  // 1. Télécharger l'audio
  const audioBuffer = await _downloadBuffer(audioUrl);
  const ext = mimeType.includes('ogg') ? 'ogg'
             : mimeType.includes('mp4') ? 'mp4'
             : mimeType.includes('mpeg') ? 'mp3'
             : 'ogg';

  // 2. Envoyer à Whisper via multipart/form-data
  const boundary = `----WA${Date.now()}`;
  const filename  = `audio.${ext}`;

  const formParts = [
    `--${boundary}\r\nContent-Disposition: form-data; name="model"\r\n\r\nwhisper-1`,
    `--${boundary}\r\nContent-Disposition: form-data; name="language"\r\n\r\nfr`,
    `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${filename}"\r\nContent-Type: ${mimeType}\r\n\r\n`,
  ];

  const prelude = Buffer.from(formParts.join('\r\n') + '\r\n');
  const epilog  = Buffer.from(`\r\n--${boundary}--\r\n`);
  const body    = Buffer.concat([prelude, audioBuffer, epilog]);

  return new Promise((resolve, reject) => {
    const req = https.request({
      hostname: 'api.openai.com',
      path: '/v1/audio/transcriptions',
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${OPENAI_KEY}`,
        'Content-Type': `multipart/form-data; boundary=${boundary}`,
        'Content-Length': body.length,
      },
    }, (res) => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => {
        try {
          const json = JSON.parse(data);
          resolve(json.text || '');
        } catch { reject(new Error(data.slice(0, 100))); }
      });
    });
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

function _downloadBuffer(url) {
  return new Promise((resolve, reject) => {
    const client = url.startsWith('https') ? https : http;
    const options = url.startsWith('https://graph.facebook.com')
      ? { headers: { Authorization: `Bearer ${WA_TOKEN}` } }
      : {};

    client.get(url, options, (res) => {
      if (res.statusCode === 301 || res.statusCode === 302) {
        return _downloadBuffer(res.headers.location).then(resolve).catch(reject);
      }
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => resolve(Buffer.concat(chunks)));
      res.on('error', reject);
    }).on('error', reject);
  });
}

// ─── PARSER WEBHOOK META CLOUD API ───────────────────────────────────────────

/**
 * Parse le payload Meta Cloud API (WhatsApp Business)
 * Retourne { from, type, text, audioUrl, mimeType } ou null
 */
function parseMetaCloudWebhook(body) {
  try {
    const changes = body?.entry?.[0]?.changes;
    if (!changes?.length) return null;

    const value = changes[0]?.value;
    if (!value?.messages?.length) return null;

    const msg       = value.messages[0];
    const from      = msg.from;
    const type      = msg.type; // 'text' | 'audio' | 'image' | 'document' | ...

    // Résoudre l'URL du média si présent
    let audioUrl = null;
    let mimeType = 'audio/ogg';
    if (type === 'audio') {
      const mediaId = msg.audio?.id;
      mimeType      = msg.audio?.mime_type || mimeType;
      audioUrl      = mediaId
        ? `https://graph.facebook.com/v19.0/${mediaId}`
        : null;
    }

    const text = type === 'text' ? msg.text?.body : null;

    return { from, type, text, audioUrl, mimeType, raw: msg };
  } catch {
    return null;
  }
}

// ─── HANDLER PRINCIPAL ────────────────────────────────────────────────────────

/**
 * Traite un message WhatsApp entrant (texte ou vocal)
 * @param {object} parsed — résultat de parseMetaCloudWebhook ou parseWhatsAppWebhook
 */
async function handleIncoming(parsed) {
  const { from, type, text, audioUrl, mimeType } = parsed;

  let messageText = text;

  // ── Message vocal → transcription
  if (type === 'audio' && audioUrl) {
    bus.system(`[WA] Message vocal reçu de ${from} — transcription en cours…`);
    try {
      const transcript = await transcribeAudio(audioUrl, mimeType);
      if (!transcript.trim()) {
        await sendWhatsApp(from, 'Je n\'ai pas pu comprendre votre message vocal. Pouvez-vous me l\'écrire ? 🙏');
        return;
      }
      messageText = `[Message vocal transcrit] ${transcript}`;
      bus.system(`[WA] Transcription: "${transcript.slice(0, 80)}"`);
    } catch (err) {
      bus.emit('error', `[WA] Transcription échouée: ${err.message}`);
      await sendWhatsApp(from, 'Je n\'ai pas pu traiter votre message vocal. Écrivez-nous et nous vous répondons tout de suite ! ✍️');
      return;
    }
  }

  if (!messageText) {
    // Image, document, sticker, etc.
    await sendWhatsApp(from, 'Merci pour votre message ! Pour nous contacter, écrivez-nous en texte ou laissez un message vocal. 😊');
    return;
  }

  // ── Déléguer au communication-hub existant
  const commHub = require('./communication-hub');
  await commHub.receiveMessage({
    channel: 'whatsapp',
    from,
    text: messageText,
    sessionId: `wa:${from}`,
  });
}

// ─── APPEL MANQUÉ ─────────────────────────────────────────────────────────────

/**
 * Envoie un message WhatsApp automatique après un appel manqué
 * @param {string} callerPhone — numéro du client qui a appelé
 */
async function handleMissedCall(callerPhone) {
  bus.system(`[WA] Appel manqué de ${callerPhone} — envoi message automatique`);

  const msg =
    `Bonjour ! Vous avez tenté de nous joindre chez Kadio Coiffure. ` +
    `Nous n'avons pas pu répondre à l'instant. 🙏\n\n` +
    `📅 Réservez en ligne dès maintenant : https://kadiocoiffure.vercel.app/hub\n\n` +
    `Ou répondez ici et nous vous rappelons rapidement !`;

  await sendWhatsApp(callerPhone, msg);

  // Alerter Ulrich
  if (ULRICH_PHONE) {
    await twilio.sendSMS(
      ULRICH_PHONE,
      `📞 Appel manqué de ${callerPhone} — message WA automatique envoyé.`
    ).catch(() => {});
  }
}

module.exports = {
  sendWhatsApp,
  transcribeAudio,
  parseMetaCloudWebhook,
  handleIncoming,
  handleMissedCall,
};
