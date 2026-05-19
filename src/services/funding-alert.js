'use strict';
/**
 * Funding Alert — DALEBA [511-512]
 * SMS/Telegram Ulrich pour opportunités OPPORTUNITY_MATCHED
 * Réponse OUI → APPLICATION_IN_PROGRESS
 */
const bus = require('./event-bus');

/**
 * [511] Envoie l'alerte SMS [DALEBA FINANCEMENT] à Ulrich
 */
async function sendOpportunityAlert(tenantId, opportunity, eligibilityPct) {
  const phone = process.env.ULRICH_PHONE_NUMBER;
  if (!phone) {
    bus.system(`[FundingAlert] ⚠️ ULRICH_PHONE_NUMBER non configuré — alerte loguée uniquement`);
    return { sent: false, reason: 'phone_missing' };
  }

  const pct       = Math.round((eligibilityPct || 0.85) * 100);
  const amount    = (opportunity.max_amount || 25000).toLocaleString('fr-CA');
  const approveToken = require('crypto').randomBytes(8).toString('hex');

  const body = `[DALEBA FINANCEMENT] 💼 Opportunité détectée : ${opportunity.name} par ${opportunity.organism}. Montant potentiel : ${amount} $ CAD. Dossier pré-qualifié à ${pct}%. Valider le début des démarches ? OUI → /api/v1/funding/approve/${approveToken} | Répondez NON pour ignorer.`;

  // [512] Stocke le token pour traiter la réponse OUI
  await storeApprovalToken(approveToken, { tenantId, opportunity, eligibilityPct });

  try {
    const twilio = require('./twilio-sender');
    await twilio.sendSMS({ to: phone, body });
    bus.system(`[FundingAlert] 📱 Alerte financement → Ulrich: "${opportunity.name}" (${pct}%)`);
    return { sent: true, body, approveToken };
  } catch (e) {
    bus.system(`[FundingAlert] ⚠️ SMS simulé: ${e.message}`);
    return { sent: false, error: e.message, body, approveToken };
  }
}

// Store in-memory (Railway → utiliser DB en production)
const _pendingApprovals = new Map();
async function storeApprovalToken(token, data) {
  _pendingApprovals.set(token, { ...data, expiresAt: Date.now() + 48 * 3600000 });
}

async function getApprovalData(token) {
  const data = _pendingApprovals.get(token);
  if (!data || Date.now() > data.expiresAt) return null;
  return data;
}

/**
 * [512] Traite la réponse OUI → passe en APPLICATION_IN_PROGRESS
 */
async function processApproval(pool, token) {
  const data = await getApprovalData(token);
  if (!data) throw new Error('Token d\'approbation invalide ou expiré');
  _pendingApprovals.delete(token);

  const prequal = require('./prequalification-engine');
  // Trouve l'application correspondante
  const apps = await prequal.getApplications(pool, data.tenantId);
  const app  = apps.find(a => a.program_name === data.opportunity.name && a.status === 'opportunity_matched');

  if (app) {
    await prequal.updateApplicationStatus(pool, data.tenantId, {
      appId:  app.application_id,
      status: 'application_in_progress',
      notes:  'Ulrich a répondu OUI — DALEBA initie le dossier de financement',
    });
    bus.system(`[FundingAlert] ✅ Application en cours: "${data.opportunity.name}"`);
    return { started: true, appId: app.application_id, programName: data.opportunity.name };
  }
  return { started: false, reason: 'application_not_found' };
}

module.exports = { sendOpportunityAlert, processApproval, getApprovalData };
