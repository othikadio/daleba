/**
 * DALEBA — Communication Hub Omnicanal
 * Centralise WhatsApp Business, Facebook Messenger, Instagram DMs, SMS Twilio
 * Analyse via brain-context.js + réservation autonome via Square
 */

const bus = require('./event-bus');

// ─── CANAUX SUPPORTÉS ─────────────────────────────────────────────────────────
const CHANNELS = {
  WHATSAPP: 'whatsapp',
  FACEBOOK: 'facebook',
  INSTAGRAM: 'instagram',
  SMS:       'sms',
};

// ─── ROUTEUR DE MESSAGES ENTRANTS ────────────────────────────────────────────

/**
 * Point d'entrée universel — analyse et route chaque message entrant
 * @param {Object} msg
 * @param {string} msg.channel   — 'whatsapp'|'facebook'|'instagram'|'sms'
 * @param {string} msg.from      — numéro ou PSID expéditeur
 * @param {string} msg.text      — contenu du message
 * @param {string} msg.sessionId — ID de session (from + channel)
 */
async function receiveMessage({ channel, from, text, sessionId }) {
  bus.chat(`[${channel.toUpperCase()}] De: ${from} — ${text.slice(0, 60)}`);

  // ─── V22 : Human-in-the-loop — vérification avant tout traitement bot ─────
  const { isHumanRequired, getOrCreateChatSession } = require('../memory/db');
  const humanRequired = await isHumanRequired(from, channel).catch(() => false);
  if (humanRequired) {
    bus.system(`👤 [${channel.toUpperCase()}] Session ${from} en mode HUMAN — réponse bot gelée`);
    // Notifie Ulrich du message entrant sans répondre au client
    const { alertUlrich } = require('./twilio');
    alertUlrich(
      `Message entrant (${channel}) de ${from} en attente de ta réponse :\n"${text.slice(0, 120)}"`
    ).catch(() => {});
    return { intent: 'human_required', response: null, frozen: true };
  }
  // ─── Fin du bloc Human-in-the-loop ─────────────────────────────────────────

  // Déterminer l'intent du message
  const intent = detectIntent(text);

  let response;

  if (intent === 'booking') {
    response = await handleBookingIntent({ channel, from, text, sessionId });
  } else if (intent === 'info') {
    response = await handleInfoIntent({ text, sessionId });
  } else if (intent === 'cancel' || intent === 'reschedule') {
    response = await handleModifyIntent({ channel, from, text, intent, sessionId });
  } else {
    response = await handleGeneralIntent({ channel, from, text, sessionId });
  }

  // Envoyer la réponse sur le bon canal
  await sendResponse({ channel, to: from, text: response });
  bus.chat(`[${channel.toUpperCase()}] Réponse envoyée à: ${from}`);

  return { intent, response };
}

// ─── DÉTECTION D'INTENT ───────────────────────────────────────────────────────

function detectIntent(text) {
  const t = text.toLowerCase();
  if (/rendez|rdv|réserv|book|appoint|créneau|disponib/.test(t)) return 'booking';
  if (/annul|cancel|supprimer/.test(t))                            return 'cancel';
  if (/changer|modifier|déplacer|reschedul/.test(t))               return 'reschedule';
  if (/prix|tarif|service|coût|combien|horaire|adresse/.test(t))   return 'info';
  return 'general';
}

// ─── HANDLERS D'INTENT ───────────────────────────────────────────────────────

async function handleBookingIntent({ text, sessionId }) {
  try {
    // Récupérer les disponibilités Square
    const square = require('./square');
    const now = new Date();
    const in7days = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);
    const { bookings = [] } = await square.getBookings(now.toISOString(), in7days.toISOString()).catch(() => ({ bookings: [] }));

    const slotsCount = bookings.filter(b => b.status === 'ACCEPTED' || b.status === 'APPROVED').length;

    // Appel LLM pour construire une réponse naturelle
    const { enrichSystemPrompt } = require('./brain-context');
    const claude = require('../agents/claude');
    const { DALEBA_SYSTEM_PROMPT } = require('../agents/persona');

    const enriched = await enrichSystemPrompt(text, DALEBA_SYSTEM_PROMPT);
    const result = await claude.query(
      `Client demande un rendez-vous: "${text}". Il y a actuellement ${slotsCount} RDV cette semaine. Propose de l'aider à trouver un créneau en demandant service souhaité et date préférée.`,
      enriched,
      []
    );
    return result.content;
  } catch (err) {
    return `Bonjour ! Je suis Daleba chez Kadio Coiffure ✨ Je serais ravie de vous aider à prendre un rendez-vous. Quel service souhaitez-vous et quand êtes-vous disponible ?`;
  }
}

async function handleInfoIntent({ text, sessionId }) {
  try {
    const claude = require('../agents/claude');
    const { DALEBA_SYSTEM_PROMPT } = require('../agents/persona');
    const result = await claude.query(text, DALEBA_SYSTEM_PROMPT, []);
    return result.content;
  } catch {
    return `Bonjour ! Pour toute information sur nos services et tarifs, contactez-nous au 514-919-5970 ou visitez daleba.vercel.app 💇✨`;
  }
}

async function handleModifyIntent({ from, text, intent }) {
  return intent === 'cancel'
    ? `Je comprends que vous souhaitez annuler votre rendez-vous. Pour confirmer, pouvez-vous me donner votre nom et la date de votre RDV ? Notre équipe traitera votre demande dans les plus brefs délais.`
    : `Vous souhaitez modifier votre rendez-vous — pas de problème ! Donnez-moi votre nom et votre créneau actuel, et je vous propose de nouvelles disponibilités.`;
}

async function handleGeneralIntent({ text, sessionId }) {
  try {
    const claude = require('../agents/claude');
    const { DALEBA_SYSTEM_PROMPT } = require('../agents/persona');
    const result = await claude.query(text, DALEBA_SYSTEM_PROMPT, []);
    return result.content;
  } catch {
    return `Bonjour ! Je suis Daleba, votre assistante chez Kadio Coiffure ✨ Comment puis-je vous aider ?`;
  }
}

// ─── ENVOI DE RÉPONSES ────────────────────────────────────────────────────────

async function sendResponse({ channel, to, text }) {
  switch (channel) {
    case CHANNELS.SMS:
    case CHANNELS.WHATSAPP: {
      const twilio = require('./twilio');
      const dest = channel === CHANNELS.WHATSAPP ? `whatsapp:${to}` : to;
      return twilio.sendSMS(dest, text).catch(err => {
        bus.emit('error', `Envoi ${channel} échoué: ${err.message}`);
      });
    }
    case CHANNELS.FACEBOOK:
    case CHANNELS.INSTAGRAM: {
      const meta = require('./meta-social');
      if (typeof meta.sendMessengerMessage === 'function') {
        return meta.sendMessengerMessage(to, text).catch(err => {
          bus.emit('error', `Envoi Meta échoué: ${err.message}`);
        });
      }
      bus.system(`[META] Réponse non envoyée (sendMessengerMessage non implémenté): ${text.slice(0, 60)}`);
      return;
    }
    default:
      bus.system(`[HUB] Canal inconnu: ${channel}`);
  }
}

// ─── PARSEURS DE WEBHOOKS PAR PLATEFORME ─────────────────────────────────────

/**
 * Parse un webhook WhatsApp Business (Twilio ou Meta Cloud API)
 */
function parseWhatsAppWebhook(body) {
  // Format Meta Cloud API
  if (body?.entry?.[0]?.changes?.[0]?.value?.messages) {
    const msg = body.entry[0].changes[0].value.messages[0];
    const from = msg.from;
    const text = msg.type === 'text' ? msg.text?.body : `[${msg.type}]`;
    return { channel: CHANNELS.WHATSAPP, from, text, sessionId: `wa:${from}` };
  }
  // Format Twilio WhatsApp
  if (body?.From && body?.Body) {
    const from = body.From.replace('whatsapp:', '');
    return { channel: CHANNELS.WHATSAPP, from, text: body.Body, sessionId: `wa:${from}` };
  }
  return null;
}

/**
 * Parse un webhook Facebook Messenger
 */
function parseFacebookWebhook(body) {
  const entry = body?.entry?.[0];
  const messaging = entry?.messaging?.[0];
  if (!messaging?.message?.text) return null;
  return {
    channel: CHANNELS.FACEBOOK,
    from: messaging.sender.id,
    text: messaging.message.text,
    sessionId: `fb:${messaging.sender.id}`,
  };
}

/**
 * Parse un webhook Instagram DM
 */
function parseInstagramWebhook(body) {
  const entry = body?.entry?.[0];
  const messaging = entry?.messaging?.[0];
  if (!messaging?.message?.text) return null;
  return {
    channel: CHANNELS.INSTAGRAM,
    from: messaging.sender.id,
    text: messaging.message.text,
    sessionId: `ig:${messaging.sender.id}`,
  };
}

/**
 * Parse un webhook SMS Twilio entrant
 */
function parseSMSWebhook(body) {
  if (!body?.From || !body?.Body) return null;
  return {
    channel: CHANNELS.SMS,
    from: body.From,
    text: body.Body,
    sessionId: `sms:${body.From}`,
  };
}

module.exports = {
  CHANNELS,
  receiveMessage,
  sendResponse,
  detectIntent,
  parseWhatsAppWebhook,
  parseFacebookWebhook,
  parseInstagramWebhook,
  parseSMSWebhook,
};
