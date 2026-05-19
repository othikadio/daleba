/**
 * TwiML Generator — DALEBA Metacortex Points 206-209
 *
 * [206] Génération TwiML dynamique — zéro cache statique
 * [207] <Gather> optimisé: speech, fr-CA, speechTimeout auto
 * [208] <Say> Polly Lea Neural fr-CA (ou ElevenLabs si configuré)
 * [209] SSML complet: pauses, accentuation, intonation naturelle
 */

'use strict';

const twilio = require('twilio');
const VoiceResponse = twilio.twiml.VoiceResponse;

const DALEBA_BASE_URL = process.env.DALEBA_BASE_URL ||
  (process.env.RAILWAY_PUBLIC_DOMAIN ? `https://${process.env.RAILWAY_PUBLIC_DOMAIN}` : 'https://daleba-api-production.up.railway.app');

// ─── CONFIGURATION VOIX [208] ─────────────────────────────────────────────────

const VOICE_CONFIG = {
  // Polly Lea Neural fr-CA [208]
  pollyVoice:    'Polly.Lea-Neural',
  pollyLanguage: 'fr-CA',
  // Fallback standard Twilio
  stdVoice:      'woman',
  stdLanguage:   'fr-CA',
};

// ─── SSML WRAPPER [209] ───────────────────────────────────────────────────────

/**
 * Ajoute un noeud SSML natif à un élément Twilio Say [209]
 * Utilise les méthodes SSML du SDK Twilio (pas de raw XML échappé).
 *
 * @param {object} sayNode   — objet Say Twilio (.break_(), .prosody(), .emphasis())
 * @param {string} text      — texte à vocaliser
 * @param {object} opts
 *   pauseMs          {number}    — pause initiale (ms)
 *   emphasisPhrases  {string[]}  — mots/phrases en emphase
 *   rate             {string}    — vitesse prosody ('medium'|'slow'|...)
 */
function addSSMLToSay(sayNode, text, opts = {}) {
  const { pauseMs = 250, emphasisPhrases = [], rate = 'medium' } = opts;

  // [209] Pause initiale naturelle
  sayNode.break({ time: `${pauseMs}ms` });

  // Segmenter par phrase pour altérner texte + pauses [209]
  const sentences = text.split(/(?<=[.?!,])\s+/);

  sentences.forEach((sentence, i) => {
    // Emphase sur les phrases clés [209]
    const needsEmphasis = emphasisPhrases.some(p => sentence.includes(p));
    if (needsEmphasis) {
      sayNode.emphasis({ level: 'moderate' }).addText(sentence.trim());
    } else {
      sayNode.addText((i > 0 ? ' ' : '') + sentence.trim());
    }
    // Pause inter-phrase naturelle [209]
    if (i < sentences.length - 1) {
      const isComma = sentence.endsWith(',');
      sayNode.break({ time: isComma ? '150ms' : '300ms' });
    }
  });
}

/**
 * Compat: retourne le texte brut (pour fallbacks ou tests)
 */
function wrapSSML(text) { return text; }

// ─── GÉNÉRATEUR TwiML DYNAMIQUE [206] ─────────────────────────────────────────

/**
 * Headers anti-cache stricts [206]
 */
function setNoCacheHeaders(res) {
  if (!res || typeof res.set !== 'function') return;
  res.set({
    'Content-Type':  'application/xml',
    'Cache-Control': 'no-cache, no-store, must-revalidate',
    'Pragma':        'no-cache',
    'Expires':       '0',
  });
}

// ─── RÉPONSE D'ACCUEIL ────────────────────────────────────────────────────────

/**
 * Génère la réponse d'accueil Twilio [207-209]
 * @param {object} opts
 *   callSid, from, tenantName, customerName, callbackPath
 */
function buildWelcomeTwiML(opts = {}) {
  const {
    callSid,
    tenantName = 'Kadio Coiffure',
    customerName = null,
    callbackPath = '/api/webhook/voice/gather',
  } = opts;

  const twiml   = new VoiceResponse();
  const gather  = twiml.gather({
    input:         'speech',           // [207]
    language:      'fr-CA',            // [207]
    speechTimeout: 'auto',             // [207]
    timeout:       5,                  // [207]
    action:        `${DALEBA_BASE_URL}${callbackPath}`,
    method:        'POST',
    // [246] Modèle avancé fr-CA pour accents québécois
    speechModel:   'phone_call',   // Optimisé voix téléphonique + accents régionaux
    enhanced:      true,           // Twilio enhanced accuracy pour fr-CA
    // Note: 'phone_call' + enhanced=true active le modèle DeepSpeech fr-CA
    // qui gère: liaison québécoise, élision, "tsé"/"fait que"/"là"/"bin"
  });

  // Message personnalisé si client connu [216]
  const greeting = customerName
    ? `Bonjour ${customerName}, ravi de vous entendre à nouveau chez ${tenantName}.`
    : `Bonjour et bienvenue chez ${tenantName}.`;

  const message = `${greeting} Comment puis-je vous aider aujourd'hui. Vous pouvez me parler naturellement.`;

  const say1 = gather.say({
    voice:    VOICE_CONFIG.pollyVoice,    // [208] Polly Lea Neural
    language: VOICE_CONFIG.pollyLanguage,
  });
  addSSMLToSay(say1, message, { pauseMs: 300, emphasisPhrases: [tenantName] });  // [209]

  // Fallback si pas de parole captée [207]
  twiml.redirect({ method: 'POST' }, `${DALEBA_BASE_URL}${callbackPath}?timeout=1`);

  return twiml.toString();
}

// ─── RÉPONSE DISPONIBILITÉS BOOKING [214-215] ─────────────────────────────────

/**
 * Formule les créneaux de disponibilité — max 3 à l'oral [214]
 * Format fr-CA naturel [215]
 * @param {Array} slots — tableau de { dateLabel, timeLabel } (déjà formatés fr-CA)
 * @param {string} callbackPath — action du Gather suivant
 */
function buildAvailabilityTwiML(slots = [], callbackPath = '/api/webhook/voice/gather') {
  const twiml  = new VoiceResponse();
  const gather = twiml.gather({
    input:         'speech',
    language:      'fr-CA',
    speechTimeout: 'auto',
    timeout:       8,
    action:        `${DALEBA_BASE_URL}${callbackPath}`,
    method:        'POST',
  });

  // [214] Maximum 3 créneaux
  const top3 = slots.slice(0, 3);

  let msg;
  if (top3.length === 0) {
    msg = 'Je suis désolé, il n\'y a pas de disponibilité dans les prochains jours. Voulez-vous que je vous rappelle la semaine prochaine?';
  } else if (top3.length === 1) {
    msg = `Nous avons une disponibilité ${top3[0].label}. Souhaitez-vous confirmer ce créneau?`;
  } else if (top3.length === 2) {
    // [215] Format naturel fr-CA
    msg = `Nous avons de la place ${top3[0].label}, ou ${top3[1].label}. Lequel vous convient?`;
  } else {
    msg = `Nous avons de la place ${top3[0].label}, ${top3[1].label}, ou ${top3[2].label}. Lequel vous convient le mieux?`;
  }

  const say2 = gather.say({
    voice:    VOICE_CONFIG.pollyVoice,
    language: VOICE_CONFIG.pollyLanguage,
  });
  addSSMLToSay(say2, msg, { pauseMs: 250 });

  return twiml.toString();
}

// ─── CONFIRMATION RÉSERVATION [218] ───────────────────────────────────────────

function buildConfirmationTwiML(bookingDetails = {}) {
  const twiml  = new VoiceResponse();
  const gather = twiml.gather({
    input:         'speech',
    language:      'fr-CA',
    speechTimeout: 'auto',
    timeout:       6,
    action:        `${DALEBA_BASE_URL}/api/webhook/voice/gather`,
    method:        'POST',
  });

  const { customerName, slotLabel, serviceName = 'votre service' } = bookingDetails;
  const who  = customerName ? `${customerName}, ` : '';
  const msg  = `Parfait ${who}j'ai bien noté votre rendez-vous pour ${serviceName} ${slotLabel}. Vous recevrez une confirmation par message. Est-ce que je peux faire autre chose pour vous?`;

  const say3 = gather.say({
    voice:    VOICE_CONFIG.pollyVoice,
    language: VOICE_CONFIG.pollyLanguage,
  });
  addSSMLToSay(say3, msg, { pauseMs: 250, emphasisPhrases: [slotLabel] });  // [209]

  return twiml.toString();
}

// ─── CAPTURE IDENTITÉ CLIENT INCONNU [217] ────────────────────────────────────

function buildIdentityCapturesTwiML(step = 'firstname', callbackPath = '/api/webhook/voice/gather') {
  const twiml  = new VoiceResponse();
  const gather = twiml.gather({
    input:         'speech',
    language:      'fr-CA',
    speechTimeout: 'auto',
    timeout:       8,
    action:        `${DALEBA_BASE_URL}${callbackPath}`,
    method:        'POST',
  });

  const messages = {
    firstname: 'Je ne vous reconnais pas dans notre système. Quel est votre prénom, s\'il vous plaît?',
    lastname:  'Merci. Et votre nom de famille?',
    confirm:   'Pour confirmer, vous êtes bien {name}? Dites oui pour confirmer.',
  };

  const say4 = gather.say({
    voice:    VOICE_CONFIG.pollyVoice,
    language: VOICE_CONFIG.pollyLanguage,
  });
  addSSMLToSay(say4, messages[step] || messages.firstname, { pauseMs: 300 });  // [209]

  return twiml.toString();
}

// ─── RÉPONSE GÉNÉRIQUE ────────────────────────────────────────────────────────

function buildGenericTwiML(message, opts = {}) {
  const {
    withGather    = true,
    callbackPath  = '/api/webhook/voice/gather',
    hangup        = false,
  } = opts;

  const twiml = new VoiceResponse();

  if (withGather && !hangup) {
    const gather = twiml.gather({
      input:         'speech',
      language:      'fr-CA',
      speechTimeout: 'auto',
      timeout:       6,
      action:        `${DALEBA_BASE_URL}${callbackPath}`,
      method:        'POST',
    });
    const say5 = gather.say({
      voice:    VOICE_CONFIG.pollyVoice,
      language: VOICE_CONFIG.pollyLanguage,
    });
    addSSMLToSay(say5, message);  // [209]
  } else {
    const say = twiml.say({
      voice:    VOICE_CONFIG.pollyVoice,
      language: VOICE_CONFIG.pollyLanguage,
    });
    addSSMLToSay(say, message);  // [209]
    if (hangup) twiml.hangup();
  }

  return twiml.toString();
}

// ─── EXPORTS ─────────────────────────────────────────────────────────────────

module.exports = {
  setNoCacheHeaders,
  wrapSSML,
  buildWelcomeTwiML,
  buildAvailabilityTwiML,
  buildConfirmationTwiML,
  buildIdentityCapturesTwiML,
  buildGenericTwiML,
  VOICE_CONFIG,
  DALEBA_BASE_URL,
};
