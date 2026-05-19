/**
 * Voice Stress Monitor — DALEBA Metacortex Points 223-226
 *
 * [223] Analyse sentiment + urgence en temps réel — score frustration 0-100
 * [224] Seuil critique 70 → escalade + mots-clés explicites
 * [225] TwiML <Say>+<Dial> vers Commandant
 * [226] SMS d'alerte contextuel au Commandant avec résumé
 */

'use strict';

const bus         = require('./event-bus');
const dare        = require('../agents/dare');
const twimlGen    = require('./twiml-generator');

const ULRICH_PHONE = process.env.ULRICH_PHONE_NUMBER || '+15149845970';
const TWILIO_FROM  = process.env.TWILIO_PHONE_NUMBER  || '+13022328291';
const DALEBA_URL   = process.env.DALEBA_BASE_URL       || 'https://daleba-api-production.up.railway.app';

const FRUSTRATION_THRESHOLD = 70; // [224]

// [224] Mots-clés d'escalade explicites
const ESCALATION_KEYWORDS = [
  'je veux parler à un humain','un humain','gérant','gérant','le gérant',
  'je suis fâché','fâché','en colère','je suis en colère','incompétent',
  'aucun service','dégoûtant','honte','scandale','remboursement',
  'avocat','poursuite','plainte','police','directeur','propriétaire',
  'ulrich','patron','responsable','urgence','urgent','accident','blessé',
  'je raccroche','j\'en ai assez','assez','plus jamais',
];

// ─── [223] ANALYSE SENTIMENT ──────────────────────────────────────────────────

/**
 * Évalue le score de frustration d'une transcription via Claude DARE [223]
 * Retourne { frustrationScore: 0-100, sentiment, keywords, summary }
 * Timeout strict 600ms pour ne pas bloquer le flux vocal
 */
async function analyzeFrustration(speechText, callHistory = []) {
  // Détection rapide locale < 5ms [223]
  const localScore = _quickFrustrationScore(speechText);
  const localKeyword = ESCALATION_KEYWORDS.find(k => speechText.toLowerCase().includes(k));

  if (localScore >= FRUSTRATION_THRESHOLD || localKeyword) {
    return {
      frustrationScore: Math.max(localScore, 80),
      sentiment:        'FRUSTRATED',
      keywords:         localKeyword ? [localKeyword] : [],
      summary:          `Escalade locale: ${localKeyword || 'score élevé'}`,
      source:           'local',
    };
  }

  // Analyse LLM si score ambigu [223]
  try {
    const recentHistory = callHistory.slice(-3).map(h => `${h.role}: ${h.text}`).join('\n');
    const prompt = `Évalue la frustration client dans ce contexte d'appel à un salon de coiffure.

Transcription actuelle: "${speechText}"
${recentHistory ? `\nHistorique récent:\n${recentHistory}` : ''}

Réponds UNIQUEMENT en JSON: {"frustrationScore":42,"sentiment":"NEUTRAL","keywords":[],"summary":"..."}
- frustrationScore: 0 (calme) à 100 (furieux)
- sentiment: CALM | NEUTRAL | IMPATIENT | FRUSTRATED | ANGRY`;

    const result = await dare.executeWithFailover(prompt, '', [], { task: 'sentiment', timeoutMs: 580 });
    const raw    = result?.content || result?.text || '';
    const match  = raw.match(/\{[^}]+\}/);
    if (match) {
      const parsed = JSON.parse(match[0]);
      return {
        frustrationScore: Math.min(100, Math.max(0, parsed.frustrationScore || 0)),
        sentiment:        parsed.sentiment   || 'NEUTRAL',
        keywords:         parsed.keywords    || [],
        summary:          parsed.summary     || '',
        source:           'dare',
      };
    }
  } catch {}

  return { frustrationScore: localScore, sentiment: 'NEUTRAL', keywords: [], summary: '', source: 'fallback' };
}

/**
 * Détection rapide locale — patterns lexicaux de frustration [223]
 */
function _quickFrustrationScore(text) {
  if (!text) return 0;
  const t = text.toLowerCase();
  let score = 0;

  // Marqueurs forts (+30-50)
  if (/fâché|en colère|furieux|inacceptable|honteux|dégoût/.test(t)) score += 50;
  if (/avocat|poursuite|plainte|police|procès/.test(t)) score += 60;
  if (/urgence|blessé|accident/.test(t)) score += 70;

  // Marqueurs moyens (+15-30)
  if (/jamais|plus jamais|c'est pas|n'est pas correct|pas normal/.test(t)) score += 20;
  if (/attendre|trop long|combien de temps/.test(t)) score += 15;
  if (/incompétent|nul|horrible|terrible/.test(t)) score += 30;

  // Marqueurs faibles (+5-10)
  if (/je ne comprends pas|pourquoi|comment ça se fait/.test(t)) score += 10;
  if (/encore|toujours|de nouveau/.test(t)) score += 5;

  return Math.min(100, score);
}

// ─── [224] DÉCISION D'ESCALADE ────────────────────────────────────────────────

/**
 * Détermine si une escalade est requise [224]
 */
function shouldEscalate(frustrationScore, speechText = '') {
  if (frustrationScore >= FRUSTRATION_THRESHOLD) return { escalate: true, reason: `Score frustration: ${frustrationScore}/100` };
  const kw = ESCALATION_KEYWORDS.find(k => speechText.toLowerCase().includes(k));
  if (kw) return { escalate: true, reason: `Mot-clé d'escalade: "${kw}"` };
  return { escalate: false };
}

// ─── [225] TwiML ESCALADE ─────────────────────────────────────────────────────

/**
 * Génère le TwiML <Say>+<Dial> pour transfert vers Ulrich [225]
 */
function buildEscalationTwiML(opts = {}) {
  const { customerName, reason, callSid } = opts;
  const twilio = require('twilio');
  const VR = twilio.twiml.VoiceResponse;
  const response = new VR();

  // [225] Message de réassurance SSML + Polly Lea Neural
  const who   = customerName ? `${customerName}, ` : '';
  const msg   = `${who}je vous transfère immédiatement auprès d'Ulrich, le propriétaire du salon. Veuillez patienter quelques instants.`;

  const say = response.say({ voice: 'Polly.Lea-Neural', language: 'fr-CA' });
  say.break({ time: '300ms' });
  say.addText(msg);
  say.break({ time: '500ms' });

  // [225] <Dial> vers le numéro personnel du Commandant
  const dial = response.dial({
    action:  `${DALEBA_URL}/api/webhook/voice/dial-status`,
    method:  'POST',
    timeout: 30,
    callerId: TWILIO_FROM,
  });
  dial.number({
    statusCallback:       `${DALEBA_URL}/api/webhook/voice/dial-status`,
    statusCallbackEvent:  'completed',
    statusCallbackMethod: 'POST',
  }, ULRICH_PHONE);

  return response.toString();
}

// ─── [226] SMS D'ALERTE AU COMMANDANT ────────────────────────────────────────

/**
 * Envoie le SMS d'alerte contextuel au Commandant [226]
 * Contient: nom client, cause frustration, résumé échanges
 */
async function sendCommanderAlert(opts = {}) {
  const {
    customerName = 'Client inconnu',
    phoneNumber  = 'N/A',
    reason       = 'Frustration détectée',
    frustrationScore = 0,
    callHistory  = [],
    callSid      = '',
  } = opts;

  const recentExchanges = callHistory.slice(-3)
    .map(h => `${h.role === 'user' ? '📞' : '🤖'} ${h.text.slice(0, 60)}`)
    .join('\n');

  const message = [
    `🚨 ESCALADE VOCALE — DALEBA`,
    `Client: ${customerName} (${phoneNumber})`,
    `Frustration: ${frustrationScore}/100`,
    `Cause: ${reason}`,
    recentExchanges ? `\nDerniers échanges:\n${recentExchanges}` : '',
    `\nCallSid: ${callSid.slice(0, 16)}...`,
    `Appel en transfert vers vous ↑`,
  ].filter(Boolean).join('\n');

  try {
    const twilioClient = require('twilio')(
      process.env.TWILIO_ACCOUNT_SID,
      process.env.TWILIO_AUTH_TOKEN
    );
    await twilioClient.messages.create({
      body: message.slice(0, 1600),
      from: TWILIO_FROM,
      to:   ULRICH_PHONE,
    });
    bus.system(`[StressMonitor] 📲 Alerte Commandant envoyée | ${customerName} | score ${frustrationScore}`);
    return { sent: true };
  } catch (err) {
    // Ne jamais bloquer le flux vocal sur l'échec du SMS
    bus.system(`[StressMonitor] ⚠️ SMS alerte échoué: ${err.message}`);
    return { sent: false, error: err.message };
  }
}

// ─── EXPORTS ─────────────────────────────────────────────────────────────────

module.exports = {
  analyzeFrustration,
  shouldEscalate,
  buildEscalationTwiML,
  sendCommanderAlert,
  FRUSTRATION_THRESHOLD,
  ESCALATION_KEYWORDS,
};
