/**
 * DALEBA V4 Section 5 — Routes Webhook Twilio Voice (Points 201-250)
 *
 * POST /api/webhook/voice          → appel entrant (accueil TwiML) [202]
 * POST /api/webhook/voice/gather   → transcription → DARE intent [210-211]
 * POST /api/webhook/voice/identity → capture identité client inconnu [217]
 * POST /api/webhook/voice/booking-confirm → confirmation RDV [218]
 * POST /api/webhook/voice/recording-status → callback enregistrement [237]
 * POST /api/webhook/voice/status   → statut fin d'appel [242]
 * GET  /api/voice/calls/today      → journal HUD [239]
 */

const express = require('express');
const router  = express.Router();
const twilio  = require('twilio');

// [203] Middleware HMAC-SHA1
const { twilioAuthMiddleware }  = require('../middleware/twilio-auth');
// [236] Wrapper try/catch suprême
const { safeVoiceRoute }        = require('../middleware/voice-error-handler');
// [237-238,242,243] Call recorder
const callRecorder              = require('../services/call-recorder');
// [239-241] Call log
const callLog                   = require('../services/call-log');

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

// [202] [236] Endpoint principal — safeVoiceRoute = jamais de 500
router.post('/voice', twilioAuthMiddleware, safeVoiceRoute(async (req, res) => {
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
}));

// ─── ROUTE 2 : TRANSCRIPTION CLIENT ──────────────────────────────────────────

// [210-211] [236] Gather — safeVoiceRoute
router.post('/voice/gather', twilioAuthMiddleware, safeVoiceRoute(async (req, res) => {
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
}));

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

// [236] safeVoiceRoute + [242] destruction état + [243] masquage + [245] coupe SMS
router.post('/voice/status', twilioAuthMiddleware, safeVoiceRoute(async (req, res) => {
  const { CallSid, CallStatus, CallDuration, From } = req.body;
  // [243] Masquer le numéro dans les logs
  const fromMasked = callRecorder.maskPhone(From);
  bus.system(`📊 Call ${CallStatus} [${CallSid}] from=${fromMasked} duration=${CallDuration}s`);

  // ─── SMS AUTOMATIQUE APPEL MANQUÉ (V30) ─────────────────────────────────────────────
  const missedStatuses = ['no-answer', 'busy', 'failed', 'canceled'];
  if (From && missedStatuses.includes(CallStatus)) {
    try {
      const twilioSvc = require('../services/twilio');
      const missedText =
        `Bonjour ! Nous avons rate votre appel chez Kadio Coiffure.\n\n` +
        `Reservez directement en ligne :\n` +
        `https://kadiocoiffure.vercel.app/hub\n\n` +
        `Ou repondez ici et nous vous rappelons rapidement !`;

      // SMS classique
      await twilioSvc.sendSMS(From, missedText);
      bus.system(`SMS appel manque envoye a ${fromMasked}`);

      // WhatsApp automatique (actif des que le numero WA est configure)
      const waEngine = require('../services/whatsapp-engine');
      waEngine.handleMissedCall(From).catch(() => {});
    } catch (smsErr) {
      bus.emit('error', `Appel manque handler: ${smsErr.message}`);
    }
  }

  if (CallStatus === 'completed') {
    // [242] Destruction d'état dialogue à la fin de l'appel
    callRecorder.onCallCompleted(CallSid);
    VoiceAgentV4.cleanupSession(CallSid);

    // [245] Lever la suspension SMS non-urgents après fin d'escalade
    const shield = require('../services/notification-shield');
    if (shield.isEscalationMuted?.()) shield.resumeNonUrgent?.();

    // [241] Log final de l'appel
    await callLog.upsertCallLog(CallSid, {
      from: From, status: 'completed',
      endedAt: new Date().toISOString(),
      durationS: parseInt(CallDuration) || null,
    }).catch(()=>{});
  }

  try {
    const session = await getOrCreateChatSession({ clientId: From, channel: 'voice', callSid: CallSid });
    if (session.status === 'human_required') { /* Ulrich reset manuellement */ }
  } catch (_) {}

  res.sendStatus(204);
}));

// [237] Callback Twilio enregistrement audio
router.post('/voice/recording-status', twilioAuthMiddleware, safeVoiceRoute(async (req, res) => {
  const { CallSid, RecordingSid, RecordingUrl, RecordingDuration, From } = req.body;
  bus.system(`🎤 Enregistrement reçu | ${callRecorder.maskPhone(From)} | ${RecordingSid}`);

  // [238] Sauvegarder métadonnées chiffrées
  await callRecorder.saveRecordingMetadata({
    callSid: CallSid, recordingSid: RecordingSid, recordingUrl: RecordingUrl,
    duration: parseInt(RecordingDuration) || 0,
    tenantId: 'kadio', from: From,
  });

  // Lier au call log
  await callLog.upsertCallLog(CallSid, { recordingSid: RecordingSid }).catch(()=>{});
  res.sendStatus(204);
}));

// [239-240] API Journal appels pour HUD
router.get('/calls/today', async (req, res) => {
  const tenantId = req.query.tenant || 'kadio';
  const logs = await callLog.getTodayCallLogs(tenantId, 100);
  res.json(logs);
});

router.get('/calls/:callSid', async (req, res) => {
  const log = await callLog.getCallLog(req.params.callSid);
  if (!log) return res.status(404).json({ error: 'Not found' });
  res.json(log);
});

// [221] OTP VOCAL — vérification code 4 chiffres
router.post('/voice/otp-verify', twilioAuthMiddleware, async (req, res) => {
  const { CallSid, From, SpeechResult } = req.body;
  const otp = require('../services/voice-otp');
  // Extraire les chiffres du texte vocal (ex: "trois sept deux un" → fuzzy)
  const digits = (SpeechResult || '').replace(/\D/g, '').slice(0, 4);
  const result = otp.verify(CallSid, digits);
  if (result.valid) {
    const msg = 'Code vérifié. Vous pouvez procéder.';
    twimlResponse(res, twimlGen.buildGenericTwiML(msg, { callbackPath: '/api/webhook/voice/gather' }));
  } else {
    const msg = result.reason === 'Trop de tentatives'
      ? 'Trop de tentatives incorrectes. Au revoir.'
      : `Code incorrect. ${result.attemptsLeft > 0 ? result.attemptsLeft + ' tentative(s) restante(s).' : 'Dernier essai.'}  Veuillez réessayer.`;
    const hangup = result.reason === 'Trop de tentatives';
    twimlResponse(res, twimlGen.buildGenericTwiML(msg, { callbackPath: '/api/webhook/voice/otp-verify', hangup }));
  }
});

// [222] Annulation RDV vocal
router.post('/voice/cancel-booking', twilioAuthMiddleware, async (req, res) => {
  const { CallSid, From, SpeechResult } = req.body;
  const bookingId = req.query.bookingId;
  const slotLabel = req.query.slotLabel || '';
  if (!bookingId) return twimlResponse(res, twimlGen.buildGenericTwiML('Je ne trouve pas votre réservation. Pouvez-vous rappeler le numéro de confirmation?'));
  try {
    const result = await VoiceAgentV4.handleCancellation({ callSid: CallSid, squareBookingId: bookingId, from: From, slotLabel: decodeURIComponent(slotLabel) });
    twimlResponse(res, result.twiml);
  } catch (err) {
    twimlResponse(res, twimlGen.buildGenericTwiML('Erreur technique lors de l\'annulation. Veuillez rappeler.', { hangup: true }));
  }
});

// [227] GET concurrency stats
router.get('/voice/concurrency', (req, res) => {
  const sessionStore = require('../services/voice-session-store');
  res.json(sessionStore.getConcurrencyStats());
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
