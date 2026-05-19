'use strict';
/**
 * Onboarding Funding Hook — DALEBA [548]
 * Notifie le module financement dès l'inscription d'un nouveau tenant
 */
const bus = require('./event-bus');

async function notifyNewTenantFunding(pool, tenantId, tenantName) {
  bus.system(`[OnboardingFunding] 🚀 Nouveau locataire ${tenantId} — activation module capitaux de démarrage`);
  try {
    const scanner = require('./funding-scanner-worker');
    const prequal = require('./prequalification-engine');
    await scanner.scanAll(pool);
    const opportunities = await scanner.getOpportunities(pool);
    const startupOpps  = opportunities.filter(o=>o.eligibility?.conditions?.some(c=>/démarr|startup|0.*mois/i.test(c))||parseFloat(o.max_amount||0)<=50000);
    if (startupOpps.length > 0) {
      bus.emit('onboarding:funding_opportunities', {tenantId, tenantName, opportunities:startupOpps.slice(0,3)});
      bus.system(`[OnboardingFunding] 💰 ${startupOpps.length} programme(s) de démarrage détecté(s) pour ${tenantName}`);
    }
    return {notified:true, tenantId, startupOpportunities:startupOpps.length};
  } catch(e) {
    bus.system(`[OnboardingFunding] ⚠️ Erreur scan démarrage: ${e.message}`);
    return {notified:false, error:e.message};
  }
}

// Écoute l'événement onboarding:tenant_created (émis par OnboardingAgent)
// Note: bus.on n'est pas exposé par l'event-bus DALEBA — utiliser directement la fonction
module.exports = {notifyNewTenantFunding};
