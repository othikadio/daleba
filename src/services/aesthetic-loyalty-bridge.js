'use strict';
/**
 * Aesthetic Loyalty Bridge — DALEBA Metacortex Point 393
 * Lie les améliorations cutanées au système de fidélisation (loyalty-engine.js).
 * Déblocage de points/récompenses botaniques aux clients assidus.
 */
const bus = require('./event-bus');

const IMPROVEMENT_REWARDS = [
  { minPercent: 5,  points: 50,  badge: '🌱 Peau Éveillée',      reward: 'Masque Aloe offert' },
  { minPercent: 15, points: 100, badge: '🌿 Peau Rayonnante',     reward: 'Sérum Botanique offert' },
  { minPercent: 30, points: 200, badge: '✨ Transformation Peau',  reward: 'Soin Cabine 30min offert' },
  { minPercent: 50, points: 500, badge: '🏆 Peau d\'Exception',   reward: 'Traitement Premium offert' },
];

/**
 * [393] Évalue l'amélioration cutanée et déclenche les récompenses
 */
async function rewardSkinImprovement(pool, tenantId, clientId, improvementPercent) {
  const eligible = IMPROVEMENT_REWARDS.filter(r => improvementPercent >= r.minPercent).pop();
  if (!eligible) return { rewarded: false, reason: 'Amélioration insuffisante (<5%)' };

  // Crédite les points via loyalty-engine
  let loyaltyResult = null;
  try {
    const loyalty = require('./loyalty-engine');
    loyaltyResult = await loyalty.addPoints(pool, tenantId, clientId, eligible.points, `Amélioration cutanée: +${improvementPercent}%`);
  } catch {}

  // Notifie Ulrich via Event Bus
  bus.system(`[AestheticLoyalty] 🎁 ${clientId}: +${eligible.points} pts — ${eligible.badge} (${improvementPercent}% amélioration)`);
  bus.emit('loyalty:aesthetic:reward', { tenantId, clientId, badge: eligible.badge, points: eligible.points, reward: eligible.reward });

  return {
    rewarded:    true,
    badge:       eligible.badge,
    points:      eligible.points,
    reward:      eligible.reward,
    loyaltyResult,
  };
}

/**
 * [393] Envoie un SMS de félicitations avec la récompense
 */
async function sendRewardSMS(clientPhone, clientName, badge, reward, salonName = 'votre salon') {
  if (!clientPhone) return;
  try {
    const twilio = require('./twilio-sender');
    const msg = `${clientName||'Chère cliente'} 🎉 Votre peau a progressé de façon remarquable ! Vous débloquez le badge "${badge}" et votre récompense: ${reward} chez ${salonName}. Merci de votre fidélité 💜 — DALEBA`;
    await twilio.sendSMS({ to: clientPhone, body: msg });
  } catch {}
}

module.exports = { rewardSkinImprovement, sendRewardSMS, IMPROVEMENT_REWARDS };
