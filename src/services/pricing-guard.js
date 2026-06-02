/**
 * DALEBA — Prix Plancher & Filtre de Sécurité
 * =============================================
 * Verrou de tarification : aucune proposition ne part à 0 $.
 *
 * Règle absolue :
 *  - Budget 0, null, ou non spécifié → forfait plancher 150 CAD
 *  - Tout envoi d'email avec budget ≤ 0 est BLOQUÉ et génère une alerte
 */
'use strict';

const PRICE_FLOOR_CAD      = 150;
const PRICE_FLOOR_CURRENCY = 'CAD';
const PRICE_FLOOR_LABEL    = '150 $ CAD (forfait audit/intégration DALEBA — tarif de base)';

/**
 * Normalise le budget d'une opportunité.
 * Si budget_estimated est 0, null, vide ou "0" → injecte le plancher DALEBA.
 *
 * @param {Object} opp - Ligne daleba_opportunities
 * @returns {{ budget_estimated: number, budget_currency: string, budget_display: string, was_floored: boolean }}
 */
function normalizeBudget(opp) {
  const raw      = parseFloat(opp.budget_estimated) || 0;
  const currency = (opp.budget_currency || '').trim() || 'USD';

  if (raw > 0) {
    return {
      budget_estimated: raw,
      budget_currency:  currency,
      budget_display:   `${raw.toLocaleString('fr-CA')} ${currency}`,
      was_floored:      false,
    };
  }

  // ── Budget absent ou zéro : on applique le plancher ─────────────────────
  console.warn(
    `[pricing-guard] ⚠️  Budget à 0 détecté pour "${(opp.title || '').slice(0, 60)}" ` +
    `— plancher ${PRICE_FLOOR_LABEL} appliqué automatiquement.`
  );

  return {
    budget_estimated: PRICE_FLOOR_CAD,
    budget_currency:  PRICE_FLOOR_CURRENCY,
    budget_display:   PRICE_FLOOR_LABEL,
    was_floored:      true,
  };
}

/**
 * Filtre de sécurité strict : lève une erreur et bloque l'envoi si le budget
 * normalisé est toujours à 0. Doit être appelé avant TOUT envoi d'email.
 *
 * @param {Object} opp - Ligne daleba_opportunities (budget_estimated déjà normalisé ou non)
 * @throws {Error} si budget ≤ 0 après normalisation
 */
function assertPriceNotZero(opp) {
  const normalized = normalizeBudget(opp);
  if (normalized.budget_estimated <= 0) {
    const msg =
      `[PRICE_GUARD] 🚫 ENVOI BLOQUÉ — budget nul pour "${(opp.title || '').slice(0, 60)}". ` +
      `Corriger manuellement avant toute livraison. Alerte maintenance levée.`;
    console.error(msg);
    throw new Error(msg);
  }
  return normalized;
}

/**
 * Retourne un résumé du budget à injecter dans les prompts LLM.
 * Toujours un montant lisible, jamais "0" ou "Non précisé".
 *
 * @param {Object} opp
 * @returns {string}
 */
function budgetForPrompt(opp) {
  const { budget_display, was_floored } = normalizeBudget(opp);
  if (was_floored) {
    return `${budget_display} *(tarif DALEBA appliqué — budget client non précisé)*`;
  }
  return budget_display;
}

module.exports = {
  normalizeBudget,
  assertPriceNotZero,
  budgetForPrompt,
  PRICE_FLOOR_CAD,
  PRICE_FLOOR_CURRENCY,
  PRICE_FLOOR_LABEL,
};
