/**
 * DALEBA V22 — Routes Webhook Twilio Voice
 * POST /api/webhook/voice         → appel entrant (accueil TwiML)
 * POST /api/webhook/voice/gather  → transcription client reçue
 * POST /api/webhook/voice/status  → statut fin d'appel
 * POST /api/webhook/voice/dial-status → résultat du transfert Ulrich
 *
 * Toutes les réponses sont du TwiML (Content-Type: application/xml)
 */

const express = require('express');
const router  = express.Router();
const twilio  = require('twilio');

const voiceAgent  = require('../services/voice-agent');
const { createChatSession, updateSessionStatus, getOrCreateChatSession } = require('../memory/db');
const bus         = require('../services/event-bus');

// ─── VALIDATION SIGNATURE TWILIO ──────────────────────────────────────────────

function validateTwilioSignature(req, res, next) {
  // Désactivé en démo/dev, actif en production
  if (process.env.NODE_ENV !== 'production' || !process.env.TWILIO_AUTH_TOKEN) {
    return next();
  }
  const authToken   = process.env.TWILIO_AUTH_TOKEN;
  const signature   = req.headers['x-twilio-signature'] || '';
  const url         = `${process.env.DALEBA_BASE_URL || ''}${req.originalUrl}`;
  const isValid     = twilio.validateRequest(authToken, signature, url, req.body);
  if (!isValid) {
    bus.system('⚠️ Requête Twilio refusée — signature invalide');
    return res.status(403).send('Forbidden');
  }
  next();
}

function twimlResponse(res, twiml) {
  res.set('Content-Type', 'application/xml');
  res.send(twiml);
}

// ─── ROUTE 1 : APPEL ENTRANT ──────────────────────────────────────────────────

router.post('/voice', validateTwilioSignature, async (req, res) => {
  const { CallSid, From, To } = req.body;

  try {
    // Créer ou récupérer la session chat pour cet appelant
    const session = await getOrCreateChatSession({
      clientId:  From || 'unknown',
      channel:   'voice',
      callSid:   CallSid,
    });

    // Si session humaine en cours → transfert direct sans salutation bot
    if (session.status === 'human_required') {
      bus.system(`👤 Session ${session.id} en mode humain — transfert direct`);
      const { executeEscalation } = voiceAgent;
      const { twiml } = await executeEscalation({
        callSid:      CallSid,
        callerNumber: From,
        speechResult: 'Rappel automatique — session en mode humain',
        reason:       'Session marquée human_required',
        intent:       'escalation',
      });
      return twimlResponse(res, twiml);
    }

    const twiml = voiceAgent.buildWelcomeTwiml(CallSid);
    twimlResponse(res, twiml);
  } catch (err) {
    bus.system(`❌ Voice route error: ${err.message}`);
    // Fallback gracieux
    const fallback = new (require('twilio').twiml.VoiceResponse)();
    fallback.say(
      { voice: 'Polly.Lea-Neural', language: 'fr-CA' },
      'Bonjour, merci d\'appeler Kadio Coiffure. Nous rencontrons un problème technique. Veuillez rappeler dans quelques instants. Au revoir.'
    );
    twimlResponse(res, fallback.toString());
  }
});

// ─── ROUTE 2 : TRANSCRIPTION CLIENT ──────────────────────────────────────────

router.post('/voice/gather', validateTwilioSignature, async (req, res) => {
  const { CallSid, From, SpeechResult, Confidence } = req.body;

  try {
    const speechText = SpeechResult || '';
    bus.system(`🎙️ Gather [${CallSid}] conf=${Confidence || 'N/A'}: "${speechText.slice(0, 80)}"`);

    // Session Human-in-the-loop check
    const session = await getOrCreateChatSession({ clientId: From, channel: 'voice', callSid: CallSid });

    if (session.status === 'human_required') {
      const { twiml } = await voiceAgent.executeEscalation({
        callSid: CallSid, callerNumber: From, speechResult: speechText,
        reason: 'Session human_required active', intent: 'escalation',
      });
      return twimlResponse(res, twiml);
    }

    const result = await voiceAgent.handleSpeechResult({
      speechResult: speechText,
      callSid:      CallSid,
      callerNumber: From,
    });

    // Mettre à jour le statut de session si escalade déclenchée
    if (result.escalated) {
      await updateSessionStatus(session.id, 'human_required', {
        reason:   result.reason,
        lastText: speechText,
        callSid:  CallSid,
      });
    }

    twimlResponse(res, result.twiml);
  } catch (err) {
    bus.system(`❌ Gather route error: ${err.message}`);
    const fallback = new (require('twilio').twiml.VoiceResponse)();
    fallback.say(
      { voice: 'Polly.Lea-Neural', language: 'fr-CA' },
      'Je suis désolée, je n\'ai pas bien compris. Pouvez-vous répéter votre demande s\'il vous plaît ?'
    );
    fallback.gather({
      input: 'speech', action: `${process.env.DALEBA_BASE_URL}/api/webhook/voice/gather`,
      method: 'POST', language: 'fr-CA', speechTimeout: 'auto', timeout: 8,
    });
    twimlResponse(res, fallback.toString());
  }
});

// ─── ROUTE 3 : STATUT DU DIAL (résultat transfert Ulrich) ────────────────────

router.post('/voice/dial-status', validateTwilioSignature, async (req, res) => {
  const { CallSid, DialCallStatus, From } = req.body;
  bus.system(`📞 Dial status [${CallSid}]: ${DialCallStatus}`);

  const twiml = voiceAgent.buildDialStatusTwiml(DialCallStatus);
  twimlResponse(res, twiml);
});

// ─── ROUTE 4 : STATUT FIN D'APPEL ────────────────────────────────────────────

router.post('/voice/status', validateTwilioSignature, async (req, res) => {
  const { CallSid, CallStatus, CallDuration, From } = req.body;
  bus.system(`📊 Call ended [${CallSid}] status=${CallStatus} duration=${CallDuration}s`);

  // Reset session au statut bot_handling après fin d'appel si elle était en escalade
  try {
    const session = await getOrCreateChatSession({ clientId: From, channel: 'voice', callSid: CallSid });
    if (session.status === 'human_required') {
      // Garde le human_required actif — Ulrich doit le reset manuellement via dashboard
    }
  } catch (_) {}

  res.sendStatus(204);
});

// ─── ROUTE 5 : API CONTRÔLE HUMAN-IN-THE-LOOP (dashboard Ulrich) ─────────────

/**
 * GET  /api/webhook/chat-sessions         — liste toutes les sessions actives
 * POST /api/webhook/chat-sessions/:id/takeover   — Ulrich prend la main
 * POST /api/webhook/chat-sessions/:id/release    — Ulrich rend la main au bot
 */
router.get('/chat-sessions', async (req, res) => {
  try {
    const { getAllChatSessions } = require('../memory/db');
    const sessions = await getAllChatSessions();
    res.json({ sessions });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/chat-sessions/:id/takeover', async (req, res) => {
  try {
    const { updateSessionStatus } = require('../memory/db');
    await updateSessionStatus(req.params.id, 'human_required', { takenBy: 'ulrich', at: new Date() });
    bus.system(`👤 Session ${req.params.id} — Ulrich a pris la main`);
    res.json({ status: 'human_required', sessionId: req.params.id });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/chat-sessions/:id/release', async (req, res) => {
  try {
    const { updateSessionStatus } = require('../memory/db');
    await updateSessionStatus(req.params.id, 'bot_handling', { releasedAt: new Date() });
    bus.system(`🤖 Session ${req.params.id} — Rendue au bot`);
    res.json({ status: 'bot_handling', sessionId: req.params.id });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
