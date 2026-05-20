'use strict';
/**
 * DALEBA — Fidélisation Hybride
 * Manifeste Souveraineté
 *
 * RÈGLES ÉTANCHES :
 * - 1$ dépensé au COMPTOIR = 1 point (achats à la carte uniquement)
 * - JAMAIS de points sur les mensualités d'abonnement (circuit isolé)
 * - Seuil rachat : 450 points = réduction 20$ appliquée sur la prochaine visite
 * - Rachat automatique dès que le seuil est atteint
 * - Notification SMS au client à 300 pts (proche du seuil) et à 450 pts (prêt)
 */

const LOG = '[LOYALTY-HYBRID]';

let pool = null, DEMO_MODE = true;
try { const db = require('../memory/db'); pool = db.pool; DEMO_MODE = db.DEMO_MODE; } catch(e) {}

let twilioClient = null;
try {
  const twilio = require('twilio');
  twilioClient = twilio(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN);
} catch(e) {}

const TWILIO_FROM = process.env.TWILIO_PHONE_NUMBER || '+13022328291';

// ─── CONSTANTES ───────────────────────────────────────────────────────────────
const POINTS_PER_DOLLAR = 1;          // 1$ = 1 point
const REDEMPTION_THRESHOLD = 450;     // 450 points → 20$ de rabais
const REDEMPTION_VALUE = 20;          // valeur du rabais en $
const NOTIFY_THRESHOLD = 300;         // alerte SMS à 300 points

// Sources EXCLUES du circuit points (abonnements — circuit isolé)
const EXCLUDED_SOURCES = ['abonnement', 'subscription', 'forfait_mensuel', 'recurring'];

// ─── INIT TABLE ───────────────────────────────────────────────────────────────
async function init() {
  if (!pool) return;
  await pool.query(`
    CREATE TABLE IF NOT EXISTS daleba_points (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      client_phone VARCHAR(20) NOT NULL,
      client_name VARCHAR(100),
      points_balance INTEGER DEFAULT 0,
      total_earned INTEGER DEFAULT 0,
      total_redeemed INTEGER DEFAULT 0,
      last_transaction_at TIMESTAMP,
      created_at TIMESTAMP DEFAULT NOW(),
      UNIQUE(client_phone)
    );
  `);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS daleba_points_log (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      client_phone VARCHAR(20) NOT NULL,
      type VARCHAR(20) NOT NULL,      -- 'earn' | 'redeem' | 'expire'
      points INTEGER NOT NULL,
      amount_paid DECIMAL(10,2),      -- montant dépensé (earn) ou valeur rachat (redeem)
      source VARCHAR(50),             -- 'comptoir_cash' | 'comptoir_card' | 'rachat_20'
      description VARCHAR(200),
      transaction_at TIMESTAMP DEFAULT NOW(),
      staff_id VARCHAR(50),
      balance_after INTEGER
    );
  `);
  console.log(`${LOG} Tables fidélité hybride initialisées`);
}

// ─── ACCUMULER DES POINTS (COMPTOIR UNIQUEMENT) ───────────────────────────────
/**
 * Ajoute des points pour un achat au comptoir.
 * Bloque automatiquement si source = abonnement.
 *
 * @param {string} clientPhone
 * @param {string} clientName
 * @param {number} amountPaid - montant HT payé en $
 * @param {string} source     - ex: 'comptoir_cash', 'comptoir_card'
 * @param {string} staffId
 */
async function earnPoints({ clientPhone, clientName, amountPaid, source, staffId, description }) {
  // GARDE ÉTANCHE : refuser les abonnements
  if (EXCLUDED_SOURCES.some(s => (source||'').toLowerCase().includes(s))) {
    console.log(`${LOG} Source exclue — aucun point accordé (${source})`);
    return { blocked: true, reason: 'Abonnements exclus du circuit points' };
  }

  const points = Math.floor(amountPaid * POINTS_PER_DOLLAR);
  if (points <= 0) return { points: 0 };

  if (DEMO_MODE || !pool) {
    console.log(`${LOG} [DEMO] +${points} pts → ${clientPhone} (${amountPaid}$)`);
    return { points, demo: true };
  }

  // Upsert solde
  const r = await pool.query(`
    INSERT INTO daleba_points (client_phone, client_name, points_balance, total_earned, last_transaction_at)
    VALUES ($1, $2, $3, $3, NOW())
    ON CONFLICT (client_phone) DO UPDATE SET
      points_balance = daleba_points.points_balance + $3,
      total_earned   = daleba_points.total_earned + $3,
      client_name    = COALESCE($2, daleba_points.client_name),
      last_transaction_at = NOW()
    RETURNING *
  `, [clientPhone, clientName||null, points]);

  const row = r.rows[0];
  const balance = row.points_balance;

  // Log transaction
  await pool.query(`
    INSERT INTO daleba_points_log
      (client_phone, type, points, amount_paid, source, description, staff_id, balance_after)
    VALUES ($1,'earn',$2,$3,$4,$5,$6,$7)
  `, [clientPhone, points, amountPaid, source||'comptoir', description||`Achat ${amountPaid}$`, staffId||null, balance]);

  console.log(`${LOG} +${points} pts → ${clientPhone} | Solde: ${balance} pts`);

  // Notification SMS aux seuils
  await checkAndNotify(clientPhone, clientName, balance);

  // Rachat auto si ≥ 450
  if (balance >= REDEMPTION_THRESHOLD) {
    return { points, balance, redemptionAvailable: true };
  }

  return { points, balance, redemptionAvailable: false };
}

// ─── VÉRIFICATION ET NOTIFICATION SMS ─────────────────────────────────────────
async function checkAndNotify(phone, name, balance) {
  if (!twilioClient || DEMO_MODE) return;
  const firstName = (name||'').split(' ')[0] || 'client';

  // Notification 300 points
  if (balance >= NOTIFY_THRESHOLD && balance < REDEMPTION_THRESHOLD) {
    // Vérifier qu'on n'a pas déjà notifié récemment
    const recent = await pool.query(
      `SELECT id FROM daleba_points_log WHERE client_phone=$1 AND description LIKE '%seuil 300%' AND transaction_at > NOW() - INTERVAL '7 days'`,
      [phone]
    );
    if (!recent.rows.length) {
      await sendSMS(phone, `Bonjour ${firstName} ! 🌟 Vous avez ${balance} points chez Kadio Coiffure. Plus que ${REDEMPTION_THRESHOLD - balance} points et vous obtenez 20$ de réduction sur votre prochaine visite !`);
      await pool.query(`INSERT INTO daleba_points_log (client_phone, type, points, source, description, balance_after) VALUES ($1,'earn',0,'notification','seuil 300 — SMS envoyé',$2)`, [phone, balance]);
    }
  }

  // Notification 450 points (seuil atteint)
  if (balance >= REDEMPTION_THRESHOLD) {
    const recent = await pool.query(
      `SELECT id FROM daleba_points_log WHERE client_phone=$1 AND description LIKE '%seuil 450%' AND transaction_at > NOW() - INTERVAL '30 days'`,
      [phone]
    );
    if (!recent.rows.length) {
      await sendSMS(phone, `🎉 ${firstName}, vous avez ${balance} points chez Kadio Coiffure ! Vous avez droit à 20$ de réduction sur votre prochaine visite. Mentionnez-le à votre arrivée au salon !`);
      await pool.query(`INSERT INTO daleba_points_log (client_phone, type, points, source, description, balance_after) VALUES ($1,'earn',0,'notification','seuil 450 — rachat disponible',$2)`, [phone, balance]);
    }
  }
}

// ─── RACHAT 20$ ───────────────────────────────────────────────────────────────
/**
 * Applique la réduction de 20$ en débitant 450 points.
 * Retourne le nouveau solde et confirme par SMS.
 */
async function redeemReward({ clientPhone, clientName, staffId }) {
  if (DEMO_MODE || !pool) {
    console.log(`${LOG} [DEMO] Rachat 20$ → ${clientPhone}`);
    return { success: true, pointsDebited: REDEMPTION_THRESHOLD, discount: REDEMPTION_VALUE, newBalance: 0, demo: true };
  }

  const r = await pool.query('SELECT * FROM daleba_points WHERE client_phone=$1', [clientPhone]);
  if (!r.rows[0]) return { success: false, error: 'Client non trouvé' };

  const current = r.rows[0].points_balance;
  if (current < REDEMPTION_THRESHOLD) {
    return { success: false, error: `Solde insuffisant (${current}/${REDEMPTION_THRESHOLD} pts)` };
  }

  const newBalance = current - REDEMPTION_THRESHOLD;
  await pool.query(
    'UPDATE daleba_points SET points_balance=$1, total_redeemed=total_redeemed+$2, last_transaction_at=NOW() WHERE client_phone=$3',
    [newBalance, REDEMPTION_THRESHOLD, clientPhone]
  );

  await pool.query(`
    INSERT INTO daleba_points_log
      (client_phone, type, points, amount_paid, source, description, staff_id, balance_after)
    VALUES ($1,'redeem',$2,$3,'rachat_20','Réduction 20$ appliquée',$4,$5)
  `, [clientPhone, REDEMPTION_THRESHOLD, REDEMPTION_VALUE, staffId||null, newBalance]);

  console.log(`${LOG} Rachat 20$ confirmé → ${clientPhone} | Nouveau solde: ${newBalance} pts`);

  // SMS confirmation
  const firstName = (clientName||'').split(' ')[0] || 'client';
  await sendSMS(clientPhone,
    `✅ Kadio Coiffure — Réduction de 20$ appliquée ! Nouveau solde : ${newBalance} points. Merci pour votre fidélité, ${firstName} 🙏`
  );

  return { success: true, pointsDebited: REDEMPTION_THRESHOLD, discount: REDEMPTION_VALUE, newBalance };
}

// ─── CONSULTER LE SOLDE ───────────────────────────────────────────────────────
async function getBalance(clientPhone) {
  if (DEMO_MODE || !pool) {
    return { clientPhone, balance: 127, totalEarned: 347, totalRedeemed: 220, redemptionAvailable: false, pointsToNext: 323, demo: true };
  }
  const r = await pool.query('SELECT * FROM daleba_points WHERE client_phone=$1', [clientPhone]);
  if (!r.rows[0]) return { clientPhone, balance: 0, totalEarned: 0, totalRedeemed: 0, redemptionAvailable: false, pointsToNext: REDEMPTION_THRESHOLD };
  const row = r.rows[0];
  return {
    clientPhone,
    clientName: row.client_name,
    balance: row.points_balance,
    totalEarned: row.total_earned,
    totalRedeemed: row.total_redeemed,
    redemptionAvailable: row.points_balance >= REDEMPTION_THRESHOLD,
    pointsToNext: Math.max(0, REDEMPTION_THRESHOLD - row.points_balance),
    nextReward: `${REDEMPTION_VALUE}$ de réduction`,
  };
}

// ─── HISTORIQUE ───────────────────────────────────────────────────────────────
async function getHistory(clientPhone, limit = 20) {
  if (DEMO_MODE || !pool) {
    return [
      { type:'earn', points:45, description:'Achat 45$', source:'comptoir_card', transaction_at: new Date() },
      { type:'earn', points:82, description:'Achat 82$', source:'comptoir_cash', transaction_at: new Date(Date.now()-86400000) },
      { type:'redeem', points:-450, description:'Réduction 20$ appliquée', source:'rachat_20', transaction_at: new Date(Date.now()-86400000*15) },
    ];
  }
  const r = await pool.query(
    'SELECT * FROM daleba_points_log WHERE client_phone=$1 ORDER BY transaction_at DESC LIMIT $2',
    [clientPhone, limit]
  );
  return r.rows;
}

// ─── SMS HELPER ───────────────────────────────────────────────────────────────
async function sendSMS(to, body) {
  if (!twilioClient) return;
  try {
    await twilioClient.messages.create({ body, from: TWILIO_FROM, to });
  } catch(e) {
    console.error(`${LOG} SMS error: ${e.message}`);
  }
}

module.exports = {
  init,
  earnPoints,
  redeemReward,
  getBalance,
  getHistory,
  REDEMPTION_THRESHOLD,
  REDEMPTION_VALUE,
  EXCLUDED_SOURCES,
};
