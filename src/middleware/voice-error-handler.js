/**
 * Voice Error Handler — DALEBA Metacortex Point 236
 *
 * [236] Wrapper suprême try/catch pour toutes les routes vocales.
 * Jamais de HTTP 500 vers Twilio — toujours un TwiML de courtoisie.
 *
 * Usage:
 *   router.post('/voice/endpoint', twilioAuth, safeVoiceRoute(async (req, res) => { ... }));
 */

'use strict';

const bus = require('../services/event-bus');

const DALEBA_URL = process.env.DALEBA_BASE_URL || 'https://daleba-api-production.up.railway.app';

// ─── TWIML DE COURTOISIE [236] ────────────────────────────────────────────────

function buildCourtesyTwiML(context = '') {
  const twilio = require('twilio');
  const VR     = twilio.twiml.VoiceResponse;
  const r      = new VR();

  const say = r.say({ voice: 'Polly.Lea-Neural', language: 'fr-CA' });
  say.break({ time: '300ms' });
  say.addText('Je suis désolé, une erreur technique est survenue.');
  say.break({ time: '300ms' });
  say.addText('Veuillez rappeler dans quelques instants ou envoyer un SMS au');
  say.break({ time: '150ms' });
  say.addText('cinq un quatre, neuf un neuf, cinq neuf soixante-dix.');
  say.break({ time: '200ms' });
  say.addText('Merci de votre compréhension.');

  r.hangup();
  return r.toString();
}

// ─── WRAPPER SUPRÊME [236] ────────────────────────────────────────────────────

/**
 * Enveloppe un handler de route vocale dans un try/catch suprême.
 * Garantit: jamais de crash non-géré → Twilio reçoit toujours du TwiML valide.
 *
 * @param {Function} handler — async (req, res) => void
 * @param {string}   context — nom de la route (pour les logs)
 */
function safeVoiceRoute(handler, context = 'voice') {
  return async (req, res) => {
    try {
      await handler(req, res);
    } catch (err) {
      const callSid = req.body?.CallSid || 'unknown';
      bus.system(`🔴 [VoiceError][${context}] CallSid=${callSid} | ${err.message}`);
      console.error(`[VoiceError][${context}]`, err.stack || err.message);

      // [236] Ne jamais laisser Twilio sans réponse TwiML
      if (!res.headersSent) {
        res.set({
          'Content-Type':  'application/xml',
          'Cache-Control': 'no-cache',
        });
        res.status(200).send(buildCourtesyTwiML(context));
      }
    }
  };
}

// ─── EXPORTS ─────────────────────────────────────────────────────────────────

module.exports = { safeVoiceRoute, buildCourtesyTwiML };
