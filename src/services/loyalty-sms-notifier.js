'use strict';
/**
 * Loyalty SMS Notifier — DALEBA Metacortex Points 420, 425, 436
 * [420] SMS automatisé à chaque changement de solde
 * [425] Relance 60j inactivité + récompenses non réclamées
 * [436] SMS parrainage avec prénom filleul
 */
const bus = require('./event-bus');

/**
 * [420] SMS de confirmation de gain de points
 */
async function sendPointsGainSMS({ phone, name, pointsGained, newBalance, tierReached }) {
  if (!phone) return { sent: false, reason: 'no_phone' };
  const tierMsg = tierReached ? ` 🎁 Vous avez débloqué le palier "${tierReached.name}" !` : '';
  const body    = `Félicitations ${name||''}! Vous venez de gagner ${pointsGained} points 🌿 Votre nouveau solde est de ${newBalance} points.${tierMsg} — Kadio Coiffure DALEBA 💜`;
  try {
    const twilio = require('./twilio-sender');
    await twilio.sendSMS({ to: phone, body });
    bus.system(`[LoyaltySMS] ✅ SMS gains envoyé: ${name} +${pointsGained}pts → ${newBalance}pts`);
    return { sent: true, body };
  } catch(e) {
    bus.system(`[LoyaltySMS] ⚠️ SMS échoué: ${e.message}`);
    return { sent: false, error: e.message, body };
  }
}

/**
 * [425] Relance clients inactifs 60j avec récompenses non réclamées
 */
async function processExpiryReminders(pool) {
  const r = await pool.query(`
    SELECT lc.customer_id, lc.customer_name, lc.customer_phone, lc.points_balance, lc.tenant_id
    FROM tenant_loyalty_cards lc
    WHERE lc.points_balance >= 500
      AND lc.updated_at <= NOW() - INTERVAL '60 days'
      AND lc.customer_phone IS NOT NULL
    LIMIT 50
  `).catch(() => ({ rows: [] }));

  let sent = 0;
  for (const c of r.rows) {
    try {
      const twilio = require('./twilio-sender');
      const body = `Bonjour ${c.customer_name||''}! Vous avez ${c.points_balance} points de fidélité chez Kadio Coiffure qui vous attendent 🌿 Récompenses disponibles à utiliser lors de votre prochaine visite. Ne laissez pas vos points expirer ! Réservez sur daleba.vercel.app 💜`;
      await twilio.sendSMS({ to: c.customer_phone, body });
      sent++;
      bus.system(`[LoyaltySMS] 📩 Relance inactivité: ${c.customer_name} (${c.points_balance}pts)`);
    } catch {}
  }
  return { processed: r.rows.length, sent };
}

/**
 * [436] SMS parrainage réussi avec prénom du filleul
 */
async function sendReferralSuccessSMS({ referrerPhone, referrerName, refereeName, bonusPoints }) {
  if (!referrerPhone) return { sent: false };
  const firstName = (refereeName || '').split(' ')[0];
  const body = `${referrerName||''}! 🎉 Votre ami${firstName ? ` ${firstName}` : ''} vient de finaliser son premier soin chez nous grâce à votre recommandation. Vous recevez ${bonusPoints||500} points de fidélité en remerciement ! Merci de faire rayonner notre salon 💜 — DALEBA`;
  try {
    const twilio = require('./twilio-sender');
    await twilio.sendSMS({ to: referrerPhone, body });
    bus.system(`[LoyaltySMS] ✅ SMS parrainage: ${referrerName} ← ${firstName} converti`);
    return { sent: true, body };
  } catch(e) { return { sent: false, error: e.message, body }; }
}

module.exports = { sendPointsGainSMS, processExpiryReminders, sendReferralSuccessSMS };
