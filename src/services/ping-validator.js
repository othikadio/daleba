'use strict';
/**
 * Ping Network Validator — DALEBA Metacortex Point 267
 * Valide le transfert d'appel par micro-call Twilio.
 */
const twilio = require('twilio');
const bus    = require('./event-bus');

const DALEBA_BASE = process.env.DALEBA_BASE_URL || 'https://daleba-api-production.up.railway.app';

function buildValidationTwiML() {
  const VR  = twilio.twiml.VoiceResponse;
  const r   = new VR();
  r.say({ voice: 'Polly.Lea-Neural', language: 'fr-CA' }, 'Transfert DALEBA actif. Test de connexion réussi.');
  r.pause({ length: 1 });
  r.hangup();
  return r.toString();
}

async function validateForwarding({ tenantPhone, dalebaNumber, tenantId, accountSid, authToken }) {
  const sid   = accountSid || process.env.TWILIO_ACCOUNT_SID;
  const token = authToken  || process.env.TWILIO_AUTH_TOKEN;
  const from  = dalebaNumber || process.env.TWILIO_PHONE_NUMBER || '+13022328291';

  if (!sid || !token || sid.startsWith('AC_TEST') || sid.startsWith('SIMULATED')) {
    bus.system(`[PingValidator] Mode simulé — ${tenantId}`);
    return { validated: true, simulated: true, callSid: 'SIMULATED', reason: 'Twilio non configuré — simulation OK' };
  }

  try {
    const client = twilio(sid, token);
    const call   = await client.calls.create({
      to:   tenantPhone,
      from,
      twiml: buildValidationTwiML(),
      timeout: 30,
      machineDetection: 'DetectMessageEnd',
    });

    bus.system(`[PingValidator] Call lancé: ${call.sid} → ${tenantPhone}`);

    // Poll statut 3 fois (max 15s)
    for (let i = 0; i < 3; i++) {
      await new Promise(r => setTimeout(r, 5000));
      const updated = await client.calls(call.sid).fetch();
      if (['completed', 'in-progress'].includes(updated.status)) {
        return { validated: true, callSid: call.sid, duration: updated.duration, status: updated.status };
      }
      if (['busy', 'failed', 'no-answer'].includes(updated.status)) {
        return { validated: false, callSid: call.sid, reason: `Statut: ${updated.status}` };
      }
    }
    return { validated: false, callSid: call.sid, reason: 'Timeout validation' };
  } catch (err) {
    bus.system(`[PingValidator] Erreur: ${err.message}`);
    return { validated: false, reason: err.message };
  }
}

module.exports = { validateForwarding, buildValidationTwiML };
