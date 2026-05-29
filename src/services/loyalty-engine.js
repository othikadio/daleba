/**
 * DALEBA — Loyalty Engine (Fidélisation Kadio Coiffure)
 * 1 point par dollar dépensé. Réengagement automatique SMS/WhatsApp.
 * Table PostgreSQL: daleba_loyalty
 */

const { pool, DEMO_MODE } = require('../memory/db');
const bus = require('./event-bus');

// Ratio: 1 CAD = 1 point
const POINTS_PER_DOLLAR = 1;

// Seuils de récompense
const REWARDS = [
  { points: 50,  reward: '10$ de rabais sur votre prochain service' },
  { points: 100, reward: '20$ de rabais ou soin capillaire gratuit' },
  { points: 200, reward: '40$ de rabais ou extension de service offerte' },
  { points: 500, reward: 'Service VIP au choix (valeur 80$)' },
];

// ─── POINTS ───────────────────────────────────────────────────────────────────

/**
 * Crédite des points pour un achat
 * @param {Object} opts
 * @param {string} opts.squareCustomerId
 * @param {string} opts.phone
 * @param {string} opts.name
 * @param {number} opts.amountCAD
 * @param {string} opts.source — 'square'|'stripe'|'manual'
 */
async function awardPoints({ squareCustomerId, phone, name, amountCAD, source = 'square' }) {
  const points = Math.floor(amountCAD * POINTS_PER_DOLLAR);
  if (points <= 0) return null;

  if (DEMO_MODE) {
    bus.system(`[LOYALTY] +${points} pts pour ${name || phone}`);
    return { points, total: points, demo: true };
  }

  try {
    const res = await pool.query(`
      INSERT INTO daleba_loyalty (square_customer_id, phone, name, points, total_spent, last_visit, source)
      VALUES ($1, $2, $3, $4, $5, NOW(), $6)
      ON CONFLICT (phone) DO UPDATE SET
        points        = daleba_loyalty.points + $4,
        total_spent   = daleba_loyalty.total_spent + $5,
        last_visit    = NOW(),
        name          = COALESCE($3, daleba_loyalty.name),
        square_customer_id = COALESCE($1, daleba_loyalty.square_customer_id),
        updated_at    = NOW()
      RETURNING *
    `, [squareCustomerId, phone, name, points, amountCAD, source]);

    const record = res.rows[0];
    bus.system(`[LOYALTY] ${name || phone}: +${points} pts → total ${record.points} pts`);

    // Vérifier si un palier de récompense est atteint
    const reward = checkRewardThreshold(record.points - points, record.points);
    if (reward) {
      bus.payment(`🏆 Palier atteint: ${name || phone} → "${reward.reward}"`);
      await sendRewardNotification(record, reward);
    }

    return record;
  } catch (err) {
    bus.emit('error', `Loyalty award failed: ${err.message}`);
    return null;
  }
}

/**
 * Vérifie si un palier de récompense vient d'être franchi
 */
function checkRewardThreshold(pointsBefore, pointsAfter) {
  return REWARDS.find(r => pointsBefore < r.points && pointsAfter >= r.points) || null;
}

/**
 * Récupère le profil fidélité d'un client
 */
async function getLoyaltyProfile(phone) {
  if (DEMO_MODE) return null;
  try {
    const res = await pool.query('SELECT * FROM daleba_loyalty WHERE phone = $1', [phone]);
    return res.rows[0] || null;
  } catch { return null; }
}

// ─── CAMPAGNES DE RÉENGAGEMENT ────────────────────────────────────────────────

/**
 * Identifie les clients inactifs (pas de visite depuis X jours)
 * @param {number} inactiveDays — seuil d'inactivité (défaut: 30 jours)
 */
async function getInactiveClients(inactiveDays = 30) {
  if (DEMO_MODE) return [];
  try {
    const res = await pool.query(`
      SELECT * FROM daleba_loyalty
      WHERE last_visit < NOW() - INTERVAL '${parseInt(inactiveDays)} days'
        AND phone IS NOT NULL
        AND reengagement_sent_at < NOW() - INTERVAL '14 days'
      ORDER BY total_spent DESC
      LIMIT 50
    `);
    return res.rows;
  } catch { return []; }
}

/**
 * Envoie une campagne de réengagement aux clients inactifs
 * Déclencher manuellement ou via cron
 */
async function runReengagementCampaign(inactiveDays = 30) {
  const clients = await getInactiveClients(inactiveDays);
  if (clients.length === 0) {
    bus.system('[LOYALTY] Campagne réengagement: aucun client inactif');
    return { sent: 0 };
  }

  const twilio = require('./twilio');
  let sent = 0;

  for (const client of clients) {
    try {
      const nextReward = REWARDS.find(r => r.points > client.points);
      const pointsLeft = nextReward ? nextReward.points - client.points : 0;

      const message = client.points > 0
        ? `Bonjour ${client.name || 'cher(e) client(e)'} ! 💇 Chez Kadio Coiffure, vous nous manquez. Vous avez ${client.points} points fidélité${pointsLeft > 0 ? ` (encore ${pointsLeft} pts pour "${nextReward.reward}")` : ''}. Réservez en ligne : kadiocoiffure.vercel.app/hub ✨`
        : `Bonjour ${client.name || ''} ! On ne vous a pas vu ce mois-ci chez Kadio Coiffure 💫 Votre prochaine visite mérite une attention particulière. Prenez RDV : kadiocoiffure.vercel.app/hub 📱`;

      await twilio.sendSMS(client.phone, message);

      // Marquer comme contacté
      await pool.query(
        'UPDATE daleba_loyalty SET reengagement_sent_at = NOW() WHERE phone = $1',
        [client.phone]
      );

      bus.sms(`Réengagement envoyé: ${client.name || client.phone}`);
      sent++;
    } catch (err) {
      bus.emit('error', `Réengagement échoué (${client.phone}): ${err.message}`);
    }
  }

  bus.system(`[LOYALTY] Campagne terminée: ${sent}/${clients.length} messages envoyés`);
  return { sent, total: clients.length };
}

/**
 * Notification SMS/WhatsApp quand un palier est atteint
 */
async function sendRewardNotification(client, reward) {
  if (!client.phone) return;
  try {
    const twilio = require('./twilio');
    const msg = `🏆 Félicitations ${client.name || ''} ! Vous avez atteint ${client.points} points chez Kadio Coiffure et débloqué : "${reward.reward}" ! Mentionnez-le lors de votre prochain RDV. Merci de votre fidélité 💇✨`;
    await twilio.sendSMS(client.phone, msg);
  } catch (err) {
    bus.emit('error', `Reward notification failed: ${err.message}`);
  }
}

/**
 * Résumé du programme fidélité (pour HUD + brain-context)
 */
async function getLoyaltySummary() {
  if (DEMO_MODE) return { totalMembers: 0, totalPoints: 0, activeThisMonth: 0, demo: true };
  try {
    const res = await pool.query(`
      SELECT
        COUNT(*) as total_members,
        SUM(points) as total_points,
        COUNT(*) FILTER (WHERE last_visit > NOW() - INTERVAL '30 days') as active_this_month,
        AVG(total_spent) as avg_spend
      FROM daleba_loyalty
    `);
    const r = res.rows[0];
    return {
      totalMembers: parseInt(r.total_members) || 0,
      totalPoints: parseInt(r.total_points) || 0,
      activeThisMonth: parseInt(r.active_this_month) || 0,
      avgSpend: parseFloat(r.avg_spend || 0).toFixed(2),
    };
  } catch { return { totalMembers: 0, totalPoints: 0, activeThisMonth: 0 }; }
}

module.exports = {
  awardPoints,
  getLoyaltyProfile,
  getInactiveClients,
  runReengagementCampaign,
  sendRewardNotification,
  getLoyaltySummary,
  REWARDS,
  POINTS_PER_DOLLAR,
};
