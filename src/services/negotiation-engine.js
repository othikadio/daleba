/**
 * DALEBA — Negotiation Engine (Squad #801-#850)
 * ===============================================
 * Algorithme de tarification dynamique B2B.
 *
 * Stratégie de négociation :
 *  - Budget marché élevé  (≥ $1 200) → position agressive à 78% du marché
 *  - Budget marché moyen  ($400-$1 199) → position compétitive à 82% du marché
 *  - Budget marché faible (< $400) → plancher DALEBA 150 CAD
 *  - Budget non détecté   → plancher DALEBA 150 CAD
 *  - Jamais < 150 CAD ni < 60% du marché (préserver la valeur perçue)
 */
'use strict';

const { PRICE_FLOOR_CAD, PRICE_FLOOR_CURRENCY } = require('./pricing-guard');

// ── USD → CAD taux approximatif (mis à jour manuellement si besoin) ────────────
const USD_TO_CAD = parseFloat(process.env.USD_TO_CAD_RATE || '1.36');

// ── Stratégies de négociation ─────────────────────────────────────────────────
const STRATEGIES = {
  AGGRESSIVE:    { label: 'Agressif',   discountRatio: 0.78, emoji: '🔥' },
  COMPETITIVE:   { label: 'Compétitif', discountRatio: 0.82, emoji: '⚡' },
  STANDARD:      { label: 'Standard',   discountRatio: 0.88, emoji: '✅' },
  FLOOR_APPLIED: { label: 'Plancher',   discountRatio: null, emoji: '🛡' },
};

/**
 * Choisit la stratégie selon le taux de marché détecté.
 * @param {number} marketRateUSD
 * @returns {Object} strategie
 */
function chooseStrategy(marketRateUSD) {
  if (!marketRateUSD || marketRateUSD <= 0) return STRATEGIES.FLOOR_APPLIED;
  if (marketRateUSD >= 1200) return STRATEGIES.AGGRESSIVE;
  if (marketRateUSD >= 400)  return STRATEGIES.COMPETITIVE;
  return STRATEGIES.FLOOR_APPLIED;
}

/**
 * Calcule le prix final DALEBA pour une opportunité donnée.
 *
 * @param {Object} marketAnalysis  - résultat de analyzeMarketRate()
 * @param {Object} opp             - ligne daleba_opportunities
 * @returns {{
 *   finalPrice: number,        // Prix en CAD, arrondi à l'entier
 *   currency: 'CAD',
 *   strategy: Object,
 *   marketRateUSD: number,
 *   marketRateCAD: number,
 *   discountPct: number,       // % de réduction vs marché
 *   floorApplied: boolean,
 *   summary: string,           // Phrase à insérer dans la proposition
 *   summaryEn: string,
 * }}
 */
function calculatePrice(marketAnalysis, opp = {}) {
  const { marketRate: mUSD = 0, confidence, category, method } = marketAnalysis;

  const strategy = chooseStrategy(mUSD);
  const mCAD     = Math.round(mUSD * USD_TO_CAD);

  let finalPrice;
  let floorApplied = false;

  if (strategy === STRATEGIES.FLOOR_APPLIED || mUSD <= 0) {
    // Plancher absolu
    finalPrice   = PRICE_FLOOR_CAD;
    floorApplied = true;
  } else {
    // Prix calculé = taux_marché_CAD * ratio_stratégie
    const raw = mCAD * strategy.discountRatio;

    // Arrondir au billet le plus proche ($50 CAD)
    finalPrice = Math.max(
      PRICE_FLOOR_CAD,
      Math.round(raw / 50) * 50
    );

    // Vérifier qu'on ne descend pas sous 60% du marché (ne jamais brader)
    const minAcceptable = Math.round(mCAD * 0.60);
    if (finalPrice < minAcceptable) {
      finalPrice   = Math.max(PRICE_FLOOR_CAD, minAcceptable);
      floorApplied = true;
    }
  }

  const discountPct = mCAD > 0
    ? Math.round((1 - finalPrice / mCAD) * 100)
    : 0;

  // ── Messages à insérer dans la proposition ────────────────────────────────
  const priceStr    = `${finalPrice.toLocaleString('fr-CA')} $CAD`;
  const marketStr   = mUSD > 0 ? `${mUSD.toLocaleString('en-US')} USD (≈ ${mCAD.toLocaleString('fr-CA')} $CAD)` : 'non spécifié';

  const summary = floorApplied
    ? `Basé sur notre barème de référence DALEBA, notre offre optimale pour ce projet est de **${priceStr}**.`
    : `Basé sur l'analyse en temps réel du marché pour ce projet (taux moyen constaté : ${marketStr}), notre offre optimale est de **${priceStr}** — soit ${discountPct}% en dessous du tarif marché pour vous assurer le meilleur rapport qualité/investissement.`;

  const summaryEn = floorApplied
    ? `Based on DALEBA's reference pricing, our optimal offer for this project is **${priceStr}**.`
    : `Based on real-time market analysis for this type of project (market average: ${marketStr}), our optimal offer is **${priceStr}** — ${discountPct}% below market rate to give you the best value for your investment.`;

  console.log(
    `[negotiation-engine] #802 — "${(opp.title || '').slice(0, 50)}" ` +
    `| marché: ${mUSD}$ USD → DALEBA: ${finalPrice}$ CAD ` +
    `| stratégie: ${strategy.emoji} ${strategy.label} ` +
    `| remise: ${discountPct}% ` +
    `| plancher: ${floorApplied}`
  );

  return {
    finalPrice,
    currency:     'CAD',
    strategy,
    marketRateUSD: mUSD,
    marketRateCAD: mCAD,
    discountPct,
    floorApplied,
    confidence,
    category,
    method,
    summary,
    summaryEn,
  };
}

module.exports = { calculatePrice, chooseStrategy, STRATEGIES, USD_TO_CAD };
