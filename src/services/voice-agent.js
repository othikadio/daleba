/**
 * DALEBA V22 — Agent Vocal & Dispatcher d'Urgence
 * Gère 100% des appels entrants via Twilio Voice + TwiML
 * Escalade automatique vers Ulrich sur urgence détectée
 */

const twilio = require('twilio');
const VoiceResponse = twilio.twiml.VoiceResponse;
const bus = require('./event-bus');

// ─── CONFIG ──────────────────────────────────────────────────────────────────

const ULRICH_PHONE    = process.env.ULRICH_PHONE_NUMBER;   // ex: +15141234567
const TWILIO_NUMBER   = process.env.TWILIO_PHONE_NUMBER;
const DALEBA_BASE_URL = process.env.DALEBA_BASE_URL || process.env.RAILWAY_PUBLIC_DOMAIN
  ? `https://${process.env.RAILWAY_PUBLIC_DOMAIN}`
  : 'https://daleba-production.up.railway.app';

/** Mots-clés déclenchant le transfert immédiat */
const ESCALATION_KEYWORDS = [
  'urgence', 'urgent', 'ulrich', 'directeur', 'propriétaire', 'patron',
  'responsable', 'plainte', 'avocat', 'police', 'blessé', 'accident',
];

/** Score de frustration LLM au-delà duquel on escalade (0–100) */
const FRUSTRATION_THRESHOLD = 70;

// ─── TWIML : ACCUEIL INITIAL ──────────────────────────────────────────────────

/**
 * TwiML retourné lorsque Twilio reçoit un appel entrant
 * DALEBA décroche, accueille, collecte la voix du client
 */
function buildWelcomeTwiml(callSid) {
  const twiml = new VoiceResponse();

  // Message d'accueil vocal naturel
  twiml.say(
    {
      voice: 'Polly.Lea-Neural',   // Voix française naturelle AWS Polly
      language: 'fr-CA',
    },
    'Bonjour et bienvenue chez Kadio Coiffure. ' +
    'Je suis Béatrice, l\'assistante du salon. ' +
    'Je peux vous aider à prendre un rendez-vous, vous donner nos horaires ou annuler une réservation. ' +
    'Dites-moi en quelques mots comment je peux vous aider.'
  );

  // Collecte vocale — 8 secondes max, avec profondeur de 2 essais
  twiml.gather({
    input:          'speech',
    action:         `${DALEBA_BASE_URL}/api/webhook/voice/gather`,
    method:         'POST',
    language:       'fr-CA',
    speechTimeout:  'auto',
    speechModel:    'phone_call',
    enhanced:       'true',
    timeout:        8,
    actionOnEmptyResult: true,
  }).say(
    { voice: 'Polly.Lea-Neural', language: 'fr-CA' },
    'Je vous écoute.'
  );

  // Si aucune voix détectée après le gather
  twiml.say(
    { voice: 'Polly.Lea-Neural', language: 'fr-CA' },
    'Je n\'ai pas entendu votre réponse. Je vous transfère maintenant à notre équipe. Un instant s\'il vous plaît.'
  );
  _appendDial(twiml, callSid, 'Aucune réponse vocale détectée');

  bus.system(`📞 Appel entrant — CallSid: ${callSid}`);
  return twiml.toString();
}

// ─── TWIML : TRAITEMENT DE LA PAROLE ─────────────────────────────────────────

/**
 * Traite la transcription vocale du client
 * @param {string} speechResult   Transcription Twilio
 * @param {string} callSid
 * @param {string} callerNumber   Numéro appelant (From)
 * @returns {{ twiml: string, escalated: boolean, intent: string }}
 */
async function handleSpeechResult({ speechResult, callSid, callerNumber }) {
  bus.system(`🎙️ Parole reçue [${callSid}]: "${speechResult}"`);

  // 1. Détection d'escalade par mots-clés (prioritaire, instantané)
  const keywordEscalation = detectKeywordEscalation(speechResult);

  // 2. Analyse LLM : intent + score de frustration
  const { intent, frustrationScore, llmResponse } = await analyzeWithLLM(speechResult, callerNumber);

  const mustEscalate = keywordEscalation || frustrationScore >= FRUSTRATION_THRESHOLD;

  if (mustEscalate) {
    const reason = keywordEscalation
      ? `Mot-clé d'urgence détecté: "${keywordEscalation}"`
      : `Frustration critique détectée (score: ${frustrationScore}/100)`;

    return executeEscalation({ callSid, callerNumber, speechResult, reason, intent });
  }

  // 3. Réponse DALEBA normale
  const twiml = buildResponseTwiml({ intent, llmResponse, callSid, callerNumber });
  return { twiml, escalated: false, intent, frustrationScore };
}

// ─── DÉTECTION MOT-CLÉ ───────────────────────────────────────────────────────

function detectKeywordEscalation(text) {
  const normalized = text.toLowerCase()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, ''); // strip accents

  for (const kw of ESCALATION_KEYWORDS) {
    const kwNorm = kw.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
    if (normalized.includes(kwNorm)) return kw;
  }
  return null;
}

// ─── ANALYSE LLM ─────────────────────────────────────────────────────────────

async function analyzeWithLLM(speechText, callerNumber) {
  try {
    const { enrichSystemPrompt } = require('./brain-context');
    const claude = require('../agents/claude');
    const { DALEBA_SYSTEM_PROMPT } = require('../agents/persona');

    const voiceSystemPrompt = `${DALEBA_SYSTEM_PROMPT}

Tu es en train de traiter un appel vocal entrant pour Kadio Coiffure.
Analyse le message du client et réponds avec un JSON STRICT (sans markdown) :
{
  "intent": "booking|cancel|reschedule|info|complaint|general",
  "frustrationScore": <0-100>,
  "response": "<réponse vocale naturelle en français canadien, max 2 phrases>",
  "bookingDetails": { "service": null, "date": null, "time": null }
}

RÈGLES :
- frustrationScore > 70 si le client est très en colère, impoli, ou répète sa demande plusieurs fois
- response doit être courte (vocale), chaleureuse, concrète
- Pour un RDV, confirme toujours ce que tu comprends et demande les infos manquantes`;

    const enriched = await enrichSystemPrompt(speechText, voiceSystemPrompt).catch(() => voiceSystemPrompt);
    const raw = await claude.chat(speechText, [], enriched);

    // Parser le JSON LLM
    const jsonMatch = raw.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      const parsed = JSON.parse(jsonMatch[0]);
      return {
        intent:           parsed.intent || 'general',
        frustrationScore: parsed.frustrationScore || 0,
        llmResponse:      parsed.response || buildFallbackResponse(speechText),
        bookingDetails:   parsed.bookingDetails || {},
      };
    }
  } catch (err) {
    bus.system(`⚠️ LLM voice error: ${err.message}`);
  }

  // Fallback sans LLM
  return {
    intent:           detectSimpleIntent(speechText),
    frustrationScore: 0,
    llmResponse:      buildFallbackResponse(speechText),
    bookingDetails:   {},
  };
}

function detectSimpleIntent(text) {
  const t = text.toLowerCase();
  if (/rendez|rdv|réserv|book/.test(t))       return 'booking';
  if (/annul|cancel/.test(t))                  return 'cancel';
  if (/horaire|heure|ouvert|fermé/.test(t))    return 'info';
  if (/changer|déplacer|reporter/.test(t))     return 'reschedule';
  return 'general';
}

function buildFallbackResponse(text) {
  const intent = detectSimpleIntent(text);
  const responses = {
    booking:    'Je vais vous aider à prendre un rendez-vous. Quel service souhaitez-vous et à quelle date ?',
    cancel:     'Je comprends que vous souhaitez annuler. Pouvez-vous me donner votre nom et la date de votre rendez-vous ?',
    info:       'Kadio Coiffure est ouvert du mardi au samedi, de 9h à 19h. Est-ce que je peux vous aider à prendre un rendez-vous ?',
    reschedule: 'Bien sûr, je peux modifier votre rendez-vous. Donnez-moi votre nom et votre date actuelle.',
    general:    'Je suis là pour vous aider. Souhaitez-vous prendre, modifier ou annuler un rendez-vous ?',
  };
  return responses[intent] || responses.general;
}

// ─── TWIML : RÉPONSE NORMALE ──────────────────────────────────────────────────

function buildResponseTwiml({ intent, llmResponse, callSid, callerNumber }) {
  const twiml = new VoiceResponse();

  twiml.say(
    { voice: 'Polly.Lea-Neural', language: 'fr-CA' },
    llmResponse
  );

  if (intent === 'booking' || intent === 'cancel' || intent === 'reschedule') {
    // Continue la collecte pour compléter le flux
    twiml.gather({
      input:         'speech',
      action:        `${DALEBA_BASE_URL}/api/webhook/voice/gather`,
      method:        'POST',
      language:      'fr-CA',
      speechTimeout: 'auto',
      speechModel:   'phone_call',
      enhanced:      'true',
      timeout:       8,
    }).say(
      { voice: 'Polly.Lea-Neural', language: 'fr-CA' },
      'Continuez, je vous écoute.'
    );

    // Fin propre si silence
    twiml.say(
      { voice: 'Polly.Lea-Neural', language: 'fr-CA' },
      'Vous pouvez également nous rappeler au salon ou prendre rendez-vous en ligne sur notre site. Au revoir et bonne journée !'
    );
  } else {
    twiml.say(
      { voice: 'Polly.Lea-Neural', language: 'fr-CA' },
      'N\'hésitez pas à nous rappeler si vous avez d\'autres questions. Bonne journée !'
    );
    twiml.hangup();
  }

  return twiml.toString();
}

// ─── PROTOCOLE D'ESCALADE ─────────────────────────────────────────────────────

/**
 * Exécute le transfert d'urgence :
 *   1. TwiML <Say> d'annonce + <Dial> vers Ulrich
 *   2. Notification WhatsApp prioritaire à Ulrich (async, non bloquant)
 */
async function executeEscalation({ callSid, callerNumber, speechResult, reason, intent }) {
  bus.system(`🚨 ESCALADE VOIX [${callSid}] — Raison: ${reason}`);

  // Notification WhatsApp async (on ne bloque pas le TwiML)
  _notifyUlrichEscalation({ callerNumber, speechResult, reason, callSid }).catch(err =>
    bus.system(`⚠️ WhatsApp escalade failed: ${err.message}`)
  );

  // TwiML : annonce + transfert
  const twiml = new VoiceResponse();
  twiml.say(
    { voice: 'Polly.Lea-Neural', language: 'fr-CA' },
    'Je comprends l\'importance de votre demande. Je vous transfère immédiatement à notre responsable. Un instant s\'il vous plaît.'
  );
  _appendDial(twiml, callSid, reason);

  return { twiml: twiml.toString(), escalated: true, reason, intent };
}

/** Ajoute l'instruction <Dial> vers Ulrich avec fallback SMS */
function _appendDial(twiml, callSid, reason) {
  if (!ULRICH_PHONE) {
    twiml.say(
      { voice: 'Polly.Lea-Neural', language: 'fr-CA' },
      'Notre équipe vous rappellera dans les plus brefs délais. Merci de votre patience. Au revoir.'
    );
    twiml.hangup();
    return;
  }

  const dial = twiml.dial({
    callerId:    TWILIO_NUMBER,
    timeout:     30,
    action:      `${DALEBA_BASE_URL}/api/webhook/voice/dial-status`,
    method:      'POST',
  });
  dial.number(ULRICH_PHONE);
}

/** Envoie une notification WhatsApp prioritaire à Ulrich */
async function _notifyUlrichEscalation({ callerNumber, speechResult, reason, callSid }) {
  if (!ULRICH_PHONE) return;

  const summary =
    `🚨 *DALEBA — Transfert d'urgence*\n\n` +
    `📞 Appelant: ${callerNumber || 'Numéro masqué'}\n` +
    `⚡ Raison: ${reason}\n\n` +
    `💬 Dernières paroles du client:\n_"${speechResult}"_\n\n` +
    `🆔 CallSid: \`${callSid}\`\n` +
    `⏰ ${new Date().toLocaleString('fr-CA', { timeZone: 'America/Toronto' })}`;

  // Tentative WhatsApp via Twilio (si configuré)
  try {
    const twilioClient = twilio(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN);
    await twilioClient.messages.create({
      from: `whatsapp:${TWILIO_NUMBER}`,
      to:   `whatsapp:${ULRICH_PHONE}`,
      body: summary,
    });
    bus.system('✅ WhatsApp escalade envoyé à Ulrich');
  } catch (waErr) {
    // Fallback SMS si WhatsApp échoue
    const { sendSMS } = require('./twilio');
    const smsText = `🚨 DALEBA URGENCE — ${callerNumber}: "${speechResult.slice(0, 100)}" — Raison: ${reason}`;
    await sendSMS(ULRICH_PHONE, smsText);
    bus.system('✅ SMS escalade fallback envoyé à Ulrich');
  }
}

// ─── ÉTAT DU DIAL (post-transfert) ───────────────────────────────────────────

/**
 * Gère le cas où Ulrich ne répond pas au transfert
 */
function buildDialStatusTwiml(dialCallStatus) {
  const twiml = new VoiceResponse();

  if (dialCallStatus !== 'completed' && dialCallStatus !== 'answered') {
    twiml.say(
      { voice: 'Polly.Lea-Neural', language: 'fr-CA' },
      'Notre responsable est momentanément indisponible. Votre appel est important pour nous. ' +
      'Nous vous rappellerons dans les 15 prochaines minutes. Merci pour votre patience. Au revoir.'
    );

    // SMS de backup à Ulrich si vraiment injoignable
    _smsUlrichMissedEscalation(dialCallStatus).catch(() => {});
  }

  twiml.hangup();
  return twiml.toString();
}

async function _smsUlrichMissedEscalation(status) {
  if (!ULRICH_PHONE) return;
  const { sendSMS } = require('./twilio');
  await sendSMS(
    ULRICH_PHONE,
    `⚠️ DALEBA — Client urgent non transféré (dial status: ${status}). Rappele-le dès que possible.`
  );
}

// ─── EXPORTS ─────────────────────────────────────────────────────────────────

module.exports = {
  buildWelcomeTwiml,
  handleSpeechResult,
  executeEscalation,
  buildDialStatusTwiml,
  detectKeywordEscalation,
  ESCALATION_KEYWORDS,
  FRUSTRATION_THRESHOLD,
};
