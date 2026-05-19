'use strict';
/**
 * Loyalty Voice Anchor — DALEBA Metacortex Point 424
 * Point d'ancrage vocal pour le solde de points.
 * Utilisé par voice-agent.js quand un client demande ses points.
 */
const bus = require('./event-bus');

const BALANCE_PATTERNS = [
  /combien.*points?/i,
  /mon\s+solde.*points?/i,
  /points?\s+de\s+fidélité/i,
  /points?\s+j'ai/i,
  /fidélité.*solde/i,
  /how\s+many\s+points?/i,
  /my\s+points?\s+balance/i,
];

/**
 * [424] Détecte l'intention "solde de points" dans un énoncé vocal
 */
function detectBalanceIntent(utterance) {
  const text = (utterance || '').toLowerCase();
  return BALANCE_PATTERNS.some(p => p.test(text));
}

/**
 * [424] Formule la réponse vocale pour le solde de points
 */
async function getBalanceForVoice(pool, tenantId, customerPhone) {
  let balance = 0, name = 'client', tierName = null;
  try {
    const r = await pool.query(
      `SELECT customer_name, points_balance, tier_id FROM tenant_loyalty_cards WHERE tenant_id=$1 AND customer_phone=$2 LIMIT 1`,
      [tenantId, customerPhone]
    ).catch(() => ({ rows: [] }));
    if (r.rows[0]) {
      balance  = r.rows[0].points_balance;
      name     = r.rows[0].customer_name?.split(' ')[0] || 'client';
      tierName = r.rows[0].tier_id !== 'none' ? r.rows[0].tier_id : null;
    }
  } catch {}

  const tierMsg = tierName && tierName !== 'none' ? ` Vous êtes au niveau ${tierName}.` : '';
  const spoken  = `${name}, vous avez actuellement ${balance} points de fidélité.${tierMsg} ${balance >= 500 ? 'Vous avez des récompenses disponibles !' : `Il vous manque ${500 - balance} points pour débloquer votre première récompense.`}`;

  bus.system(`[LoyaltyVoice] Solde vocal: ${name} → ${balance} pts`);
  return { spoken, balance, name };
}

module.exports = { detectBalanceIntent, getBalanceForVoice, BALANCE_PATTERNS };
