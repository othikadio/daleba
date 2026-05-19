'use strict';
/**
 * Funding Voice Anchor — DALEBA [525]
 * Intent vocal: état des demandes de subventions
 */
const bus = require('./event-bus');

const FUNDING_PATTERNS = [
  /subvention/i, /financement/i, /demande.*fond/i, /fond.*demand/i,
  /dossier.*subvention/i, /où.*en.*subvention/i, /état.*financement/i,
  /avancement.*dossier/i, /BDC|Investissement Québec|programme.*aide/i,
];

function detectFundingIntent(utterance = '') {
  return FUNDING_PATTERNS.some(p => p.test(utterance));
}

async function handleFundingVoiceQuery(pool, tenantId, utterance) {
  if (!detectFundingIntent(utterance)) return null;
  try {
    const prequal = require('./prequalification-engine');
    const apps    = await prequal.getApplications(pool, tenantId);
    if (!apps.length) return { spoken: 'Aucune demande de subvention active pour le moment, Commandant.' };

    const inProgress = apps.filter(a => a.status === 'application_in_progress').length;
    const matched    = apps.filter(a => a.status === 'opportunity_matched').length;
    const submitted  = apps.filter(a => a.status === 'submitted').length;
    const approved   = apps.filter(a => a.status === 'approved').length;

    let spoken = `Commandant, voici l'état de vos demandes de financement. `;
    if (approved)    spoken += `${approved} dossier${approved>1?'s':''} approuvé${approved>1?'s':''}. `;
    if (submitted)   spoken += `${submitted} en attente de réponse. `;
    if (inProgress)  spoken += `${inProgress} en cours de constitution. `;
    if (matched)     spoken += `${matched} opportunité${matched>1?'s':''} à valider. `;
    if (!inProgress && !submitted && !approved && matched)
      spoken += `Répondez OUI à l'alerte SMS pour démarrer le dossier.`;

    bus.system(`[FundingVoice] 🎤 Query état financement: ${apps.length} dossiers`);
    return { spoken, apps: { inProgress, matched, submitted, approved } };
  } catch(e) {
    return { spoken: 'Je ne peux pas accéder aux dossiers de financement en ce moment.' };
  }
}

module.exports = { detectFundingIntent, handleFundingVoiceQuery, FUNDING_PATTERNS };
