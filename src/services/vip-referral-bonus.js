'use strict';
/**
 * VIP Referral Bonus — DALEBA Metacortex Point 430
 * Si filleul dépense >100$ en 1ère visite → parrain +100 pts VIP supplémentaires
 */
const bus = require('./event-bus');

const VIP_THRESHOLD_CAD = 100;
const VIP_BONUS_POINTS  = 100;

/**
 * [430] Évalue et applique le bonus VIP parrain
 */
async function applyVIPBonus(pool, tenantId, { referralCode, refereeFirstTxAmount, referrerPhone, referrerName }) {
  if (refereeFirstTxAmount < VIP_THRESHOLD_CAD) {
    return { applied: false, reason: `Dépense ${refereeFirstTxAmount}$ < seuil VIP ${VIP_THRESHOLD_CAD}$` };
  }

  // Récupère le parrain depuis le code
  const r = await pool.query(
    `SELECT referrer_id FROM tenant_referrals WHERE tenant_id=$1 AND referral_code=$2 AND status='converted' LIMIT 1`,
    [tenantId, referralCode]
  ).catch(() => ({ rows: [] }));

  if (!r.rows.length) return { applied: false, reason: 'referral_not_found' };
  const referrerId = r.rows[0].referrer_id;

  // Attribue le bonus VIP
  const pts = require('./dynamic-points-engine');
  await pts.awardPoints(pool, tenantId, {
    customerId: referrerId, amountNet: VIP_BONUS_POINTS, itemType: 'vip_referral_bonus',
    txId: `vip_${referralCode}_${Date.now()}`, transactionAt: new Date().toISOString(),
  }).catch(() => {});

  // SMS VIP au parrain
  if (referrerPhone) {
    try {
      const twilio = require('./twilio-sender');
      await twilio.sendSMS({ to: referrerPhone, body: `${referrerName||''}! 🌟 Bonus VIP: votre filleul a dépensé plus de ${VIP_THRESHOLD_CAD}$ lors de sa première visite. Vous recevez un bonus supplémentaire de ${VIP_BONUS_POINTS} points VIP ! 💜 — DALEBA` });
    } catch {}
  }

  bus.system(`[VIPBonus] ✅ Bonus VIP: parrain ${referrerId} +${VIP_BONUS_POINTS}pts (filleul tx=${refereeFirstTxAmount}$)`);
  return { applied: true, bonusPoints: VIP_BONUS_POINTS, referrerId };
}

module.exports = { applyVIPBonus, VIP_THRESHOLD_CAD, VIP_BONUS_POINTS };
