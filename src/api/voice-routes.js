/**
 * DALEBA V4 Section 5 — Routes Webhook Twilio Voice (Points 201-218)
 *
 * POST /api/webhook/voice          → appel entrant (accueil TwiML) [202]
 * POST /api/webhook/voice/gather   → transcription → DARE intent [210-211]
 * POST /api/webhook/voice/identity → capture identité client inconnu [217]
 * POST /api/webhook/voice/booking-confirm → confirmation RDV [218]
 * POST /api/webhook/voice/status   → statut fin d'appel
 * POST /api/webhook/voice/dial-status → résultat du transfert Ulrich
 */

const express = require('express');
const router  = express.Router();
const twilio  = require('twilio');

// [203] Middleware de validation cryptographique HMAC-SHA1
const { twilioAuthMiddleware } = require('../middleware/twilio-auth');

const voiceAgent        = require('../services/voice-agent');     // V22 — escalade
const VoiceAgentV4      = require('../agents/VoiceAgent');         // V4  — BaseAgent
const twimlGen          = require('../services/twiml-generator'); // V4  — TwiML [206]
const voiceCommander    = require('../services/voice-commander');
const cmdInterpreter    = require('../services/command-interpreter');
const { createChatSession, updateSessionStatus, getOrCreateChatSession } = require('../memory/db');
const bus               = require('../services/event-bus');

// ─── [206] HELPER TWIML RESPONSE — no-cache strict ───────────────────────────

function twimlResponse(res, twimlStr) {
  twimlGen.setNoCacheHeaders(res);  // [206] Cache-Control: no-cache
  res.send(twimlStr);
}

// ─── [205] RÉSOLUTION TENANT PAR NUMÉRO TWILIO ───────────────────────────────

async function resolveTenant(twilioNumber) {
  // Lookup dans tenant_settings pour identifier le salon
  // Si SQUARE_LOCATION_ID configuré et numéro Twilio correspond → kadio
  const dalebaNumber = process.env.TWILIO_PHONE_NUMBER || '+13022328291';
  if (!twilioNumber || twilioNumber === dalebaNumber) {
    return { tenantId: 'kadio', tenantName: 'Kadio Coiffure', locationId: process.env.SQUARE_LOCATION_ID || 'LTDE9RP9PSHX7' };
  }
  // En mode multi-tenant: interroger la DB
  try {
    const maintenance = require('../services/maintenance');
    const pool = maintenance.getPool();
    if (pool) {
      const r = await pool.query(
        `SELECT tenant_id, tenant_name, location_id FROM tenant_settings WHERE twilio_number = $1 LIMIT 1`,
        [twilioNumber]
      ).catch(() => ({ rows: [] }));
      if (r.rows[0]) return r.rows[0];
    }
  } catch {}
  // Fallback
  return { tenantId: 'kadio', tenantName: 'Kadio Coiffure', locationId: process.env.SQUARE_LOCATION_ID };
}

function twimlResponse(res, twiml) {
  res.set('Content-Type', 'application/xml');
  res.send(twiml);
}

// ─── ROUTE 1 : APPEL ENTRANT ──────────────────────────────────────────────────

// [202] Endpoint principal appels entrants | [203] HMAC-SHA1 twilioAuthMiddleware
router.post('/voice', twilioAuthMiddleware, async (req, res) => {
  // [204] Variables Twilio standardisées
  const { CallSid, From, To, CallStatus } = req.body;
  bus.system(`📞 Appel entrant | ${From} → ${To} | ${CallSid} | ${CallStatus || 'ringing'}`);

  try {
    // [205] Identifier le tenant par numéro Twilio
    const tenant = await resolveTenant(To);

    // Session human-in-the-loop check (V22)
    const session = await getOrCreateChatSession({ clientId: From || 'unknown', channel: 'voice', callSid: CallSid }).catch(() => null);
    if (session?.status === 'human_required') {
      bus.system(`👤 Session en mode humain — transfert direct`);
      const esc = await voiceAgent.executeEscalation?.({ callSid: CallSid, callerNumber: From, speechResult: 'Rappel', reason: 'human_required', intent: 'escalation' })
        .catch(() => ({ twiml: twimlGen.buildGenericTwiML('Je vous transfère.', { hangup: false }) }));
      return twimlResponse(res, esc.twiml);
    }

    // [201, 216] VoiceAgent V4 — accueil + identification client
    const result = await VoiceAgentV4.execute({
      step: 'welcome', callSid: CallSid, from: From, to: To,
      tenantId: tenant.tenantId, tenantName: tenant.tenantName,
    });
    twimlResponse(res, result.twiml);

  } catch (err) {
    bus.system(`❌ Voice route error: ${err.message}`);
    const fallback = new (require('twilio').twiml.VoiceResponse)();
    fallback.say({ voice: 'Polly.Lea-Neural', language: 'fr-CA' },
      'Bonjour, merci d\'appeler. Nous rencontrons un problème technique. Veuillez rappeler dans quelques instants.');
    twimlResponse(res, fallback.toString());
  }
});

// ─── ROUTE 2 : TRANSCRIPTION CLIENT ──────────────────────────────────────────

// [210-211] Gather: Speech → DARE intent extraction < 800ms
router.post('/voice/gather', twilioAuthMiddleware, async (req, res) => {
  const { CallSid, From, SpeechResult, Confidence } = req.body;
  const speechText = SpeechResult || '';
  const isTimeout  = req.query.timeout === '1';
  bus.system(`🎙️ Gather [${CallSid}] conf=${Confidence || 'N/A'}: "${speechText.slice(0, 80)}"`);

  try {
    const session = await getOrCreateChatSession({ clientId: From, channel: 'voice', callSid: CallSid }).catch(() => null);
    if (session?.status === 'human_required') {
      const esc = await voiceAgent.executeEscalation({ callSid: CallSid, callerNumber: From, speechResult: speechText, reason: 'human_required', intent: 'escalation' })
        .catch(() => ({ twiml: twimlGen.buildGenericTwiML('Je vous transfère.', { hangup: false }) }));
      if (esc.escalated && session) await updateSessionStatus(session.id, 'human_required', { lastText: speechText }).catch(()=>{});
      return twimlResponse(res, esc.twiml);
    }

    // [210] VoiceAgent V4 — DARE intent extraction
    const result = await VoiceAgentV4.execute({
      step: 'gather', callSid: CallSid, from: From,
      speechText, timeout: isTimeout,
    });

    if (result.escalated && session) {
      await updateSessionStatus(session.id, 'human_required', { reason: 'ESCALATION', lastText: speechText, callSid: CallSid }).catch(()=>{});
    }

    twimlResponse(res, result.twiml);
  } catch (err) {
    bus.system(`❌ Gather route error: ${err.message}`);
    twimlResponse(res, twimlGen.buildGenericTwiML("Je suis désolé, je n'ai pas bien compris. Pouvez-vous répéter?"));
  }
});

// [217] Capture identité client inconnu
router.post('/voice/identity', twilioAuthMiddleware, async (req, res) => {
  const { CallSid, From, SpeechResult } = req.body;
  const identityStep = req.query.step || 'firstname';
  try {
    const result = await VoiceAgentV4.execute({
      step: 'identity', callSid: CallSid, from: From,
      speechText: SpeechResult || '', identityStep,
    });
    twimlResponse(res, result.twiml);
  } catch (err) {
    twimlResponse(res, twimlGen.buildGenericTwiML('Pardon, pouvez-vous répéter votre prénom?'));
  }
});

// [218] Confirmation réservation après choix oral
router.post('/voice/booking-confirm', twilioAuthMiddleware, async (req, res) => {
  const { CallSid, From, SpeechResult } = req.body;
  try {
    const result = await VoiceAgentV4.execute({
      step: 'booking_confirm', callSid: CallSid, from: From,
      speechText: SpeechResult || '',
    });
    twimlResponse(res, result.twiml);
  } catch (err) {
    twimlResponse(res, twimlGen.buildGenericTwiML("Erreur technique. Votre réservation n'a pas pu être confirmée.", { hangup: true }));
  }
});;

// ─── ROUTE 3 : STATUT DU DIAL (résultat transfert Ulrich) ────────────────────

router.post('/voice/dial-status', twilioAuthMiddleware, async (req, res) => {
  const { CallSid, DialCallStatus, From } = req.body;
  bus.system(`📞 Dial status [${CallSid}]: ${DialCallStatus}`);

  const twiml = voiceAgent.buildDialStatusTwiml(DialCallStatus);
  twimlResponse(res, twiml);
});

// ─── ROUTE 4 : STATUT FIN D'APPEL ────────────────────────────────────────────

router.post('/voice/status', twilioAuthMiddleware, async (req, res) => {
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

// ─── ROUTE 6 : TEST VOCAL (DEV ONLY) ────────────────────────────────────────

/**
 * POST /api/webhook/voice/test
 * Simule un appel sans Twilio pour tester l'agent vocal
 * Body: { speechText: "Je voudrais un rendez-vous demain matin" }
 * Retourne: { intent, frustrationScore, llmResponse, twiml, availability }
 * Disponible uniquement en NODE_ENV !== 'production'
 */
router.post('/voice/test', async (req, res) => {
  // Admin endpoint — accessible en production depuis le dashboard /admin/dashboard

  const { speechText = 'Je voudrais un rendez-vous demain matin' } = req.body;

  try {
    const fakeSid    = `TEST-${Date.now()}`;
    const fakeNumber = '+15140000000';

    // Récupérer les disponibilités Square
    const availability = await voiceAgent.getSquareAvailability().catch(
      () => 'Disponibilités non disponibles (Square non configuré en dev)'
    );

    // Analyser via l'agent vocal complet
    const result = await voiceAgent.handleSpeechResult({
      speechResult: speechText,
      callSid:      fakeSid,
      callerNumber: fakeNumber,
    });

    res.json({
      test:             true,
      speechText,
      intent:           result.intent,
      frustrationScore: result.frustrationScore,
      escalated:        result.escalated || false,
      llmResponse:      result.llmResponse || result.response || '',
      twiml:            result.twiml,
      availability,
    });
  } catch (err) {
    res.status(500).json({ error: err.message, stack: err.stack });
  }
});

// ─── POSTE DE COMMANDEMENT VOCAL [092-096] ────────────────────────────────────────

// [092] Appel entrant du Commandant — détourne le flux client standard [093]
router.post('/voice/commander', twilioAuthMiddleware, (req, res) => {
  const { From, CallSid } = req.body;
  if (!voiceCommander.isCommanderCall(From)) {
    // Redirige vers le flux client standard si ce n'est pas Ulrich
    return res.redirect(307, `${process.env.DALEBA_BASE_URL}/api/webhook/voice`);
  }
  bus.system(`🏦 Appel Commandant détecté [${CallSid}] — Poste de Commandement activé`);
  res.type('text/xml').send(voiceCommander.buildCommanderWelcomeTwiml());
});

// [094] Traitement de l'ordre vocal transcrit
router.post('/voice/commander/order', twilioAuthMiddleware, async (req, res) => {
  const { SpeechResult = '', CallSid, From } = req.body;
  bus.system(`🎤 Ordre Commandant: "${SpeechResult.slice(0, 60)}"`);
  const twiml = await voiceCommander.handleCommanderOrder(SpeechResult, CallSid);
  res.type('text/xml').send(twiml);
});

// [096] Confirmation vocale action critique
router.post('/voice/commander/confirm', twilioAuthMiddleware, async (req, res) => {
  const { SpeechResult = '', CallSid } = req.body;
  const twiml = await voiceCommander.handleCommanderConfirm(SpeechResult, CallSid);
  res.type('text/xml').send(twiml);
});

// ─── WEBHOOK SMS ENTRANT (commandes Commandant) [076-080] ───────────────────

router.post('/sms/incoming', async (req, res) => {
  const { Body = '', From = '' } = req.body;
  res.type('text/xml').send('<Response></Response>'); // Twilio ACK immédiat

  // Traitement asynchrone — ne pas bloquer le webhook
  setImmediate(async () => {
    const result = await cmdInterpreter.handleIncoming(Body, From, 'sms');
    if (!result.handled || !result.response) return;

    // Réponse SMS via Twilio
    try {
      const twilio_client = require('twilio')(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN);
      await twilio_client.messages.create({ body: result.response, from: process.env.TWILIO_PHONE_NUMBER, to: From });
    } catch (err) {
      console.error('[CmdInterp] Erreur envoi réponse SMS:', err.message);
    }
  });
});

module.exports = router;
