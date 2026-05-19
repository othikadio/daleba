/**
 * Fiscal Engine — DALEBA Metacortex Points 155-159
 *
 * Moteur fiscal canadien natif.
 * [156] QC (Client Zéro Kadio Coiffure) : TPS 5.0% + TVQ 9.975%
 * [157] TVQ non-cumulatif : calculé sur le montant brut avant taxes
 * [158] Ventilation 4 variables : amount_net, amount_tps, amount_tvq, amount_gross
 * [159] Arithmétique sécurisée : conversion cents → évite float JS
 */

'use strict';

// ─── BARÈME FISCAL PAR PROVINCE [155-156] ────────────────────────────────────

const TAX_RATES = {
  // Québec — TPS + TVQ (non-cumulatif depuis 2013) [156-157]
  QC: { tps: 0.05, tvq: 0.09975, label: 'TPS+TVQ', province: 'QC', country: 'CA' },
  // Ontario — TVH (fédérale+provinciale fusionnée)
  ON: { tps: 0.13, tvq: 0,       label: 'TVH',     province: 'ON', country: 'CA' },
  // Colombie-Britannique — TPS + PST
  BC: { tps: 0.05, tvq: 0.07,    label: 'TPS+PST', province: 'BC', country: 'CA' },
  // Alberta — TPS seulement (pas de taxe provinciale)
  AB: { tps: 0.05, tvq: 0,       label: 'TPS',     province: 'AB', country: 'CA' },
  // Manitoba — TPS + RST
  MB: { tps: 0.05, tvq: 0.07,    label: 'TPS+RST', province: 'MB', country: 'CA' },
  // Saskatchewan — TPS + PST
  SK: { tps: 0.05, tvq: 0.06,    label: 'TPS+PST', province: 'SK', country: 'CA' },
  // Nova Scotia — TVH
  NS: { tps: 0.15, tvq: 0,       label: 'TVH',     province: 'NS', country: 'CA' },
  // Nouveau-Brunswick — TVH
  NB: { tps: 0.15, tvq: 0,       label: 'TVH',     province: 'NB', country: 'CA' },
  // Île-du-Prince-Édouard — TVH
  PE: { tps: 0.15, tvq: 0,       label: 'TVH',     province: 'PE', country: 'CA' },
  // Terre-Neuve — TVH
  NL: { tps: 0.15, tvq: 0,       label: 'TVH',     province: 'NL', country: 'CA' },
  // Par défaut — TPS seulement
  DEFAULT: { tps: 0.05, tvq: 0,  label: 'TPS',     province: null, country: 'CA' },
};

function getTaxProfile(province = 'QC') {
  return TAX_RATES[province?.toUpperCase()] || TAX_RATES.DEFAULT;
}

// ─── ARITHMÉTIQUE SÉCURISÉE [159] ────────────────────────────────────────────

/**
 * Arrondi exact en cents (évite les erreurs float IEEE-754 de JS)
 * Ex: 0.1 + 0.2 = 0.30000000000000004 → roundCents → 0.30
 */
function roundCents(amount) {
  // Multiplication par 100, arrondi entier, redivision
  return Math.round(amount * 100) / 100;
}

/**
 * Multiplication sécurisée en cents
 */
function safeMul(a, b) {
  // Opère en entiers pour éviter float drift
  const aCents = Math.round(a * 100);
  const bBasis = Math.round(b * 100000); // 5 décimales pour les taux
  return Math.round((aCents * bBasis) / 100000) / 100;
}

// ─── DÉCOMPOSITION FISCALE [156-158] ─────────────────────────────────────────

/**
 * Calcule la ventilation fiscale complète depuis un montant BRUT (TTC) reçu.
 *
 * [157] Méthode non-cumulative (norme QC depuis 2013) :
 *   amount_net = amount_gross / (1 + tps_rate + tvq_rate)
 *   amount_tps = amount_net × tps_rate
 *   amount_tvq = amount_net × tvq_rate
 *
 * @param {number} grossAmount — montant total payé par le client (TTC)
 * @param {string} province    — code province (ex: 'QC')
 * @returns {{ amount_net, amount_tps, amount_tvq, amount_gross, taxProfile }}
 */
function decomposeFromGross(grossAmount, province = 'QC') {
  const profile = getTaxProfile(province);
  const gross = roundCents(grossAmount);
  const divisor = 1 + profile.tps + profile.tvq;

  // [157] Non-cumulatif — TVQ sur net, pas sur (net + TPS)
  const net = roundCents(gross / divisor);

  // [159] Calcul sécurisé en cents
  const tps = safeMul(net, profile.tps);
  const tvq = safeMul(net, profile.tvq);

  // Ajustement d'arrondi (assure que net+tps+tvq == gross exactement)
  const recomputed = roundCents(net + tps + tvq);
  const drift = roundCents(gross - recomputed);

  return {
    amount_net:   net,
    amount_tps:   tps,
    amount_tvq:   roundCents(tvq + drift), // absorbé dans TVQ
    amount_gross: gross,
    taxProfile: profile,
    // Vérification interne
    _check: roundCents(net + tps + roundCents(tvq + drift)) === gross,
  };
}

/**
 * Calcule la ventilation fiscale depuis un montant NET (HT).
 *
 * @param {number} netAmount — montant hors taxes
 * @param {string} province
 */
function decomposeFromNet(netAmount, province = 'QC') {
  const profile = getTaxProfile(province);
  const net = roundCents(netAmount);
  const tps = safeMul(net, profile.tps);
  const tvq = safeMul(net, profile.tvq); // [157] non-cumulatif
  const gross = roundCents(net + tps + tvq);

  return {
    amount_net:   net,
    amount_tps:   tps,
    amount_tvq:   tvq,
    amount_gross: gross,
    taxProfile:   profile,
    _check: true,
  };
}

/**
 * Formate un rapport fiscal lisible
 */
function formatFiscalBreakdown(breakdown) {
  const { amount_net, amount_tps, amount_tvq, amount_gross, taxProfile } = breakdown;
  return [
    `Montant HT    : $${amount_net.toFixed(2)} CAD`,
    `TPS (${(taxProfile.tps * 100).toFixed(1)}%)  : $${amount_tps.toFixed(2)}`,
    taxProfile.tvq > 0
      ? `${taxProfile.label.split('+')[1] || 'TVQ'} (${(taxProfile.tvq * 100).toFixed(3)}%): $${amount_tvq.toFixed(2)}`
      : null,
    `─────────────────────────`,
    `TOTAL TTC     : $${amount_gross.toFixed(2)} CAD`,
  ].filter(Boolean).join('\n');
}

// ─── TAUX EFFECTIF ────────────────────────────────────────────────────────────

function effectiveTaxRate(province = 'QC') {
  const p = getTaxProfile(province);
  return roundCents((p.tps + p.tvq) * 100);
}

// ─── EXPORTS ─────────────────────────────────────────────────────────────────

module.exports = {
  getTaxProfile,
  decomposeFromGross,
  decomposeFromNet,
  formatFiscalBreakdown,
  effectiveTaxRate,
  roundCents,
  safeMul,
  TAX_RATES,
};
