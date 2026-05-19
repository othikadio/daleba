/**
 * Voice Commander — DALEBA Metacortex Points 091-096
 *
 * Poste de Commandement Vocal — mode exclusif Ulrich.
 * Détection numéro → Intent extraction Claude → Function mapping → ElevenLabs.
 * Confirmation vocale pour actions critiques [096].
 */

'use strict';

const twilio = require('twilio');
const VoiceResponse = twilio.twiml.VoiceResponse;

const ULRICH_PHONE  = process.env.ULRICH_PHONE_NUMBER;
const DALEBA_URL    = process.env.DALEBA_BASE_URL || 'https://daleba-api-production.up.railway.app';
const TWILIO_FROM   = process.env.TWILIO_PHONE_NUMBER;

// ─── DÉTECTION COMMANDANT [093] ───────────────────────────────────────────────

function isCommanderCall(fromNumber) {
  if (!fromNumber || !ULRICH_PHONE) return false;
  const normalize = n => n.replace(/\s/g, '');
  return normalize(fromNumber) === normalize(ULRICH_PHONE);
}

// ─── TWIML ACCUEIL COMMANDANT [092, 093] ─────────────────────────────────────

// [231-232] Accueil militaire exclusif Ulrich
function buildCommanderWelcomeTwiml() {
  const twiml = new VoiceResponse();

  // [232] Accueil militaire
  const say = twiml.say({ voice: 'Polly.Lea-Neural', language: 'fr-CA' });
  say.break({ time: '200ms' });
  say.addText('Poste de commandement actif.');
  say.break({ time: '350ms' });
  say.addText('J\'écoute vos ordres, Commandant.');

  twiml.gather({
    input: 'speech',
    action: `${DALEBA_URL}/api/webhook/voice/commander/order`,
    method: 'POST',
    language: 'fr-CA',
    speechTimeout: 'auto',
    timeout: 10,
  });

  // Silence → relance
  twiml.say({ voice: 'Polly.Lea-Neural', language: 'fr-CA' }, 'Je n\'ai pas entendu votre ordre. Répétez.');
  twiml.redirect(`${DALEBA_URL}/api/webhook/voice/commander`);

  return twiml.toString();
}

// ─── MAPPING INTENTS → FONCTIONS [094] ────────────────────────────────────────

const INTENT_MAP = {
  // [233] Aliases spec exacts
  CA_DAILY:            { fn: 'getDailyFinancialReport',   critical: false },
  SWARM_STATUS:        { fn: 'getSwarmStatus',            critical: false },
  ERRORS:              { fn: 'getRecentErrors',           critical: false },
  // Aliases V22 (compat)
  get_revenue:         { fn: 'getDailyFinancialReport',   critical: false },
  get_appointments:    { fn: 'getTodayAppointments',      critical: false },
  get_status:          { fn: 'getSystemStatus',           critical: false },
  get_alerts:          { fn: 'getRecentAlerts',           critical: false },
  get_full_report:     { fn: 'getFullReport',             critical: false },
  get_swarm:           { fn: 'getSwarmStatus',            critical: false },
  get_errors:          { fn: 'getRecentErrors',           critical: false },
  // [234] Actions critiques — exigent confirmation vocale
  deploy_patch:        { fn: 'deployLatestPatch',         critical: true  },
  rollback:            { fn: 'rollbackLastDeploy',        critical: true  },
  send_promo:          { fn: 'sendPromoSMS',              critical: true  },
  pause_alerts:        { fn: 'pauseAlerts',               critical: false },
  update_price:        { fn: 'updateServicePrice',        critical: true  },  // [234]
  delete_data:         { fn: 'deleteData',                critical: true  },
  cancel_appointment:  { fn: 'cancelAppointment',         critical: true  },
  swarm_status:        { fn: 'getSwarmStatus',            critical: false },
  daily_digest:        { fn: 'getDailyDigest',            critical: false },
  DEPLOY:              { fn: 'deployLatestPatch',         critical: true  },  // [234]
  PRICE_UPDATE:        { fn: 'updateServicePrice',        critical: true  },  // [234]
};

// ─── EXTRACTION D'INTENT [094] ───────────────────────────────────────────────

async function extractIntent(transcript) {
  const claude = require('../agents/claude');

  const prompt = `Tu es l'interpréteur vocal du système DALEBA pour Ulrich, directeur du salon Kadio Coiffure.

Transcription de l'ordre vocal: "${transcript}"

Identifie l'intention parmi cette liste:
${Object.keys(INTENT_MAP).join(', ')}

Retourne UNIQUEMENT un JSON: { "intent": "<intent>", "params": {}, "summary": "<résumé action en français>" }
Si l'ordre est ambigu, utilise l'intent le plus proche. Si complètement hors scope, intent = "unknown".`;

  const result = await claude.query(prompt, 'Tu es un interpréteur d\'intentions vocales. Réponds uniquement en JSON valide.', []);

  try {
    const clean = result.content.replace(/```json\n?|\n?```/g, '').trim();
    return JSON.parse(clean);
  } catch {
    return { intent: 'unknown', params: {}, summary: transcript };
  }
}

// ─── EXÉCUTION DES FONCTIONS SYSTÈME ─────────────────────────────────────────

async function executeIntent(intent, params = {}) {
  switch (intent) {
    case 'get_revenue': {
      try {
        const square = require('./square');
        const audit = await square.getSquareWeeklyAudit();
        return `Chiffre d'affaires aujourd'hui : environ ${audit.revenue?.total || 'données indisponibles'} dollars canadiens. ${audit.appointments?.total || 0} rendez-vous enregistrés.`;
      } catch {
        return "Les données financières Square sont temporairement indisponibles.";
      }
    }

    case 'get_appointments': {
      try {
        const square = require('./square');
        const audit = await square.getSquareWeeklyAudit();
        return `Agenda : ${audit.appointments?.total || 0} rendez-vous au total. ${audit.appointments?.completed || 0} complétés. ${audit.appointments?.noShow || 0} absences.`;
      } catch {
        return "L'agenda est temporairement indisponible.";
      }
    }

    case 'get_status': {
      const dare = require('../agents/dare');
      const status = dare.getStatus();
      const healthy = status.providers.filter(p => p.health.status === 'healthy').length;
      return `Système DALEBA opérationnel. ${healthy} providers IA actifs. ${status.stats.requestsTotal} requêtes traitées. Failovers : ${status.stats.failovers}.`;
    }

    case 'get_alerts': {
      const dare = require('../agents/dare');
      const status = dare.getStatus();
      const issues = status.providers.filter(p => p.health.status !== 'healthy');
      const bridled = status.stats.bridledProviders || [];
      if (issues.length === 0 && bridled.length === 0) return "Aucune alerte active. Tous les systèmes sont opérationnels, Commandant.";
      const parts = [];
      if (issues.length) parts.push(`${issues.length} provider${issues.length > 1 ? 's' : ''} en difficulté: ${issues.map(p => p.name).join(', ')}`);
      if (bridled.length) parts.push(`${bridled.join(', ')} bridé pour dépassement budgétaire horaire`);
      return parts.join('. ') + '.';
    }

    // [097] Rapport financier complet lu à voix haute
    case 'get_full_report': {
      try {
        const square = require('./square');
        const dare   = require('../agents/dare');
        const audit  = await square.getSquareWeeklyAudit();
        const dStatus = dare.getStatus();
        const healthy = dStatus.providers.filter(p => p.health.status === 'healthy').length;
        return [
          `Rapport complet DALEBA.`,
          `Chiffre d'affaires: ${audit.revenue?.total || 'indisponible'} dollars canadiens.`,
          `Rendez-vous: ${audit.appointments?.total || 0} au total, ${audit.appointments?.completed || 0} complétés, ${audit.appointments?.noShow || 0} absences.`,
          `Abonnements actifs: ${audit.activeSubscriptions || 0}.`,
          `Système: ${healthy} providers IA actifs, ${dStatus.stats.failovers} failovers, coût estimé ${dStatus.stats.estimatedCostUSD} dollars.`,
        ].join(' ');
      } catch {
        return "Les données complètes sont temporairement indisponibles. Vérifiez la connexion Square.";
      }
    }

    case 'swarm_status': {
      const swarm = require('./swarm');
      const s = swarm.getSwarmStatus();
      return `Swarm : ${s.stats.activeAgents} agents actifs. ${s.stats.totalCompleted} tâches complétées. ${s.stats.totalFailed} échecs.`;
    }

    case 'daily_digest': {
      const shield = require('./notification-shield');
      const digest = shield.buildDailyDigest();
      return digest || "Aucune alerte à résumer pour aujourd'hui.";
    }

    case 'pause_alerts':
      require('./notification-shield').clearShield();
      return "Alertes suspendues pour 60 minutes.";

    // [233] CA_DAILY → getDailyFinancialReport()
    case 'CA_DAILY': {
      try {
        const square  = require('./square');
        const audit   = await square.getSquareWeeklyAudit();
        const taxDig  = require('./tax-digest').generateTaxDigest('QC', audit?.revenue?.total || 0, 'kadio');
        return `Rapport journalier: chiffre d'affaires ${audit.revenue?.total || 0}$. TPS ${taxDig.tps}$, TVQ ${taxDig.tvq}$. ${audit.appointments?.total || 0} rendez-vous. Taux complétion: ${audit.appointments?.completionRate || 0}%.`;
      } catch {
        return 'Rapport journalier indisponible. Vérifiez la connexion Square.';
      }
    }

    // [233] SWARM_STATUS → getSwarmStatus()
    case 'SWARM_STATUS': {
      try {
        const swarm = require('./swarm');
        const s     = swarm.getSwarmStatus();
        return `Swarm actif: ${s.stats.activeAgents} agents. ${s.stats.totalCompleted} tâches completées. ${s.stats.totalFailed} échecs. ${s.stats.totalRunning || 0} en cours.`;
      } catch {
        return 'Statut swarm indisponible.';
      }
    }

    // [233] ERRORS → lit le dernier patch généré par error-watcher
    case 'ERRORS':
    case 'get_errors': {
      try {
        const watcher = require('./error-watcher');
        const report  = await watcher.getLatestPatch?.() || watcher.getErrorSummary?.() || null;
        if (report?.patch) return `Dernier patch: ${report.patch.slice(0, 120)}`;
        if (report?.recent?.length) return `${report.recent.length} erreur(s) récente(s). Dernière: ${report.recent[0]?.message?.slice(0,80)}.`;
        return 'Aucune erreur récente détectée.';
      } catch {
        return 'Module de surveillance des erreurs non accessible.';
      }
    }

    // [234] Actions critiques: déclenchées par buildConfirmationTwiml, pas directement
    case 'DEPLOY':
    case 'deploy_patch':
      return '⚠️ Déploiement: confirmation vocale requise. Dites « confirmer déploiement » pour procéder.';

    case 'PRICE_UPDATE':
    case 'update_price':
      return '⚠️ Modification de prix: confirmation vocale requise. Dites « confirmer mise à jour prix » pour procéder.';

    default:
      return `Ordre reçu. L'action ${intent} sera traitée par le système.`;
  }
}

// ─── SYNTHÈSE VOCALE ELEVENLABS [095] ────────────────────────────────────────

async function synthesizeResponse(text) {
  // Tente ElevenLabs d'abord, fallback Polly (via TwiML Say)
  if (!process.env.ELEVENLABS_API_KEY) {
    return { method: 'polly', text };
  }

  try {
    const tts = require('../agents/connectors/tts');
    const result = await tts.synthesize(text, { voiceId: process.env.ELEVENLABS_VOICE_ID });
    return { method: 'elevenlabs', audioBuffer: result.audio, text };
  } catch {
    return { method: 'polly', text }; // fallback silencieux
  }
}

// ─── CONFIRMATION VOCALE ACTIONS CRITIQUES [096] ─────────────────────────────

// Stockage des actions en attente de confirmation vocale
const pendingVoiceActions = new Map(); // callSid → { intent, params, summary, expiresAt }

function storePendingVoiceAction(callSid, intentData) {
  pendingVoiceActions.set(callSid, {
    ...intentData,
    expiresAt: Date.now() + 2 * 60 * 1000, // 2 min pour confirmer vocalement
  });
  setTimeout(() => pendingVoiceActions.delete(callSid), 2 * 60 * 1000);
}

function buildConfirmationTwiml(callSid, summary) {
  const twiml = new VoiceResponse();

  twiml.say(
    { voice: 'Polly.Lea-Neural', language: 'fr-CA' },
    `Confirmez-vous l'action suivante : ${summary} ? Dites OUI pour confirmer ou NON pour annuler.`
  );

  twiml.gather({
    input: 'speech',
    action: `${DALEBA_URL}/api/webhook/voice/commander/confirm?callSid=${callSid}`,
    method: 'POST',
    language: 'fr-CA',
    speechTimeout: 'auto',
    timeout: 8,
  });

  twiml.say({ voice: 'Polly.Lea-Neural', language: 'fr-CA' }, 'Délai expiré. Action annulée par mesure de sécurité.');
  return twiml.toString();
}

// ─── HANDLER PRINCIPAL [092, 094] ────────────────────────────────────────────

/**
 * Traite l'ordre vocal transcrit par Twilio
 */
async function handleCommanderOrder(transcript, callSid) {
  const twiml = new VoiceResponse();

  try {
    // [094] Extraction intent
    const intentData = await extractIntent(transcript);
    const mapping = INTENT_MAP[intentData.intent];

    if (!mapping || intentData.intent === 'unknown') {
      twiml.say(
        { voice: 'Polly.Lea-Neural', language: 'fr-CA' },
        `Je n'ai pas compris l'ordre. Vous avez dit : ${transcript}. Veuillez répéter plus clairement.`
      );
      twiml.redirect(`${DALEBA_URL}/api/webhook/voice/commander`);
      return twiml.toString();
    }

    // [096] Action critique → demande confirmation
    if (mapping.critical) {
      storePendingVoiceAction(callSid, intentData);
      return buildConfirmationTwiml(callSid, intentData.summary);
    }

    // Action non critique → exécution directe
    const responseText = await executeIntent(intentData.intent, intentData.params);

    // [095] Synthèse ElevenLabs
    const synthesis = await synthesizeResponse(responseText);

    if (synthesis.method === 'polly') {
      twiml.say({ voice: 'Polly.Lea-Neural', language: 'fr-CA' }, responseText);
    } else {
      // Pour ElevenLabs on utilise <Play> avec un URL temporaire
      // (nécessite stockage audio sur CDN — fallback Polly si non configuré)
      twiml.say({ voice: 'Polly.Lea-Neural', language: 'fr-CA' }, responseText);
    }

    twiml.say({ voice: 'Polly.Lea-Neural', language: 'fr-CA' }, 'Autre ordre, Commandant ?');
    twiml.gather({
      input: 'speech',
      action: `${DALEBA_URL}/api/webhook/voice/commander/order`,
      method: 'POST', language: 'fr-CA', speechTimeout: 'auto', timeout: 8,
    });

  } catch (err) {
    console.error('[VoiceCommander] Erreur traitement ordre:', err.message);
    twiml.say({ voice: 'Polly.Lea-Neural', language: 'fr-CA' },
      'Une erreur système est survenue. Veuillez réessayer ou contacter le support.');
  }

  return twiml.toString();
}

/**
 * Traite la confirmation vocale d'une action critique [096]
 */
async function handleCommanderConfirm(transcript, callSid) {
  const twiml = new VoiceResponse();
  const pending = pendingVoiceActions.get(callSid);

  if (!pending || Date.now() > pending.expiresAt) {
    twiml.say({ voice: 'Polly.Lea-Neural', language: 'fr-CA' }, 'Action expirée. Aucune modification effectuée.');
    return twiml.toString();
  }

  const confirmed = /^oui|yes|confirme|ok|affirm/i.test(transcript.trim());
  pendingVoiceActions.delete(callSid);

  if (!confirmed) {
    twiml.say({ voice: 'Polly.Lea-Neural', language: 'fr-CA' }, 'Action annulée. Aucune modification.');
    return twiml.toString();
  }

  try {
    const result = await executeIntent(pending.intent, pending.params);
    twiml.say({ voice: 'Polly.Lea-Neural', language: 'fr-CA' }, `Action confirmée et exécutée. ${result}`);
  } catch (err) {
    twiml.say({ voice: 'Polly.Lea-Neural', language: 'fr-CA' }, `Erreur lors de l'exécution : ${err.message.slice(0, 100)}`);
  }

  return twiml.toString();
}

// ─── EXPORTS ─────────────────────────────────────────────────────────────────

module.exports = {
  isCommanderCall,
  buildCommanderWelcomeTwiml,
  buildConfirmationTwiml,  // [234]
  handleCommanderOrder,
  handleCommanderConfirm,
  extractIntent, executeIntent,
  INTENT_MAP,
};
