'use strict';
/**
 * Funding Scam Sentry — DALEBA [526]
 * Bloque tout programme suspect n'émanant pas de domaines gouvernementaux officiels
 */
const bus = require('./event-bus');

const TRUSTED_DOMAINS = [
  '.gc.ca','.gouv.qc.ca','.bdc.ca','.investquebec.com',
  '.futurpreneur.ca','.desjardins.com','.bnc.ca','.rbc.com','.td.com','.bmo.com',
  '.caisse.com','.revenuquebec.ca','.economie.gouv.qc.ca','.emploiquebec.gouv.qc.ca',
];
const SUSPICIOUS_PATTERNS = [
  /subvention.*gratuite.*immédiat/i, /garantie.*approbation/i, /frais.*dossier.*avance/i,
  /wire.*transfer/i, /bitcoin.*subvention/i, /urgent.*fonds/i, /compte.*offshore/i,
];

function verifyProgram({ name, organism, url, email } = {}) {
  const urlToCheck = (url || email || '').toLowerCase();

  // Vérifie domaine de confiance
  const trusted = TRUSTED_DOMAINS.some(d => urlToCheck.includes(d));

  // Vérifie patterns suspects
  const suspicious = SUSPICIOUS_PATTERNS.some(p =>
    p.test(name || '') || p.test(organism || '') || p.test(url || '')
  );

  if (suspicious || (!trusted && urlToCheck.length > 0)) {
    bus.system(`[ScamSentry] 🚨 Programme suspect BLOQUÉ: "${name}" — domaine non officiel: ${urlToCheck}`);
    return {
      trusted: false, blocked: true,
      reason: suspicious ? 'Pattern frauduleux détecté' : 'Domaine non gouvernemental non reconnu',
      program: name,
    };
  }

  return { trusted: true, blocked: false, program: name };
}

module.exports = { verifyProgram, TRUSTED_DOMAINS };
