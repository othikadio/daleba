'use strict';
/**
 * Loyalty Token Cleaner — DALEBA Metacortex Points 427, 428, 438
 * [427] Tokens feedback expirés après 7 jours
 * [428] Conformité politique Google anti-spam d'avis
 * [438] Purge tokens expirés toutes les 24h
 */
const bus = require('./event-bus');

const TOKEN_TTL_DAYS = 7;

/**
 * [427,438] Purge les tokens de feedback expirés (>7 jours)
 */
async function purgeExpiredTokens(pool) {
  const r = await pool.query(`
    DELETE FROM tenant_review_tokens
    WHERE created_at < NOW() - INTERVAL '${TOKEN_TTL_DAYS} days'
      AND status IN ('pending', 'sent')
    RETURNING id, tenant_id, tx_id
  `).catch(() => ({ rows: [], rowCount: 0 }));

  const count = r.rowCount || r.rows?.length || 0;
  if (count > 0) bus.system(`[TokenCleaner] 🗑️ ${count} token(s) feedback expirés purgés`);
  return { purged: count };
}

/**
 * [427] Vérifie si un token est encore valide (< 7 jours)
 */
async function isTokenValid(pool, token) {
  const r = await pool.query(`
    SELECT id, created_at, status FROM tenant_review_tokens
    WHERE token=$1 AND created_at >= NOW() - INTERVAL '${TOKEN_TTL_DAYS} days'
  `, [token]).catch(() => ({ rows: [] }));
  return r.rows.length > 0 && r.rows[0].status !== 'expired';
}

/**
 * [428] Disclaimer de conformité Google (affiché dans les SMS/emails)
 * Règle: le système récompense le FEEDBACK PRIVÉ, pas le fait de mettre 5★ sur Google.
 * Récompense basée sur "avoir donné un retour", pas sur la note publique.
 */
const GOOGLE_COMPLIANCE_DISCLAIMER = 'Votre retour privé nous aide à progresser. L\'action de laisser un avis public sur Google est entièrement volontaire et ne conditionne aucune récompense.';

function getComplianceDisclaimer() { return GOOGLE_COMPLIANCE_DISCLAIMER; }

/**
 * [428] Valide qu'un SMS de review request est conforme (pas d'incitation directe 5★)
 */
function validateSMSCompliance(smsBody) {
  const forbidden = [
    /5 étoiles.*récompense/i,
    /récompense.*5 étoiles/i,
    /points.*google/i,
    /gagner.*avis.*(google|public)/i,
    /bonus.*mettre.*étoile/i,
  ];
  const violations = forbidden.filter(p => p.test(smsBody));
  return { compliant: violations.length === 0, violations: violations.map(v => v.toString()) };
}

module.exports = { purgeExpiredTokens, isTokenValid, validateSMSCompliance, getComplianceDisclaimer, TOKEN_TTL_DAYS };
