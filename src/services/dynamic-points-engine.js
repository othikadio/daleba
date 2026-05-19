'use strict';
/**
 * Dynamic Points Engine — DALEBA Metacortex Points 402, 408-410, 415-417
 * [402] Table tenant_loyalty_cards
 * [408] Connecté à tenant_ledgers
 * [409] 1pt/$ net services | 2pts/$ net produits Bar Botanique
 * [410] Happy Hour Multiplier ×2 sur créneaux historiquement vides
 * [415] Balance endpoint
 * [416] 4 paliers de récompenses luxe configurables
 * [417] Notification StaffAgent/AestheticsAgent au palier atteint
 */
const bus = require('./event-bus');

// ── PALIERS PAR DÉFAUT [416] ──────────────────────────────────────────────────
const DEFAULT_TIERS = [
  { id: 'tier1', name: 'Brume Botanique',      points: 500,  reward: 'Brume Botanique offerte',         emoji: '💧' },
  { id: 'tier2', name: 'Soin Capillaire Profond', points: 1000, reward: 'Soin Capillaire Profond offert', emoji: '🌿' },
  { id: 'tier3', name: 'Crédit Salon 25$',     points: 1500, reward: '25$ de crédit au salon',           emoji: '✨' },
  { id: 'tier4', name: 'Crédit Salon 50$',     points: 2000, reward: '50$ de crédit au salon',           emoji: '🏆' },
];

// [410] Créneaux "Happy Hour" par défaut (historiquement creux)
const DEFAULT_HAPPY_HOURS = [
  { day: 2, startH: 10, endH: 12 },  // Mardi 10h-12h
  { day: 3, startH: 14, endH: 16 },  // Mercredi 14h-16h
  { day: 4, startH: 10, endH: 11 },  // Jeudi 10h-11h
];

async function initSchema(pool) {
  if (!pool) return;
  await pool.query(`
    CREATE TABLE IF NOT EXISTS tenant_loyalty_cards (
      id              SERIAL PRIMARY KEY,
      tenant_id       TEXT NOT NULL,
      customer_id     TEXT NOT NULL,
      customer_name   TEXT,
      customer_phone  TEXT,
      customer_email  TEXT,
      points_balance  INTEGER DEFAULT 0,
      points_lifetime INTEGER DEFAULT 0,
      tier_id         TEXT DEFAULT 'none',
      referral_code   TEXT UNIQUE,
      referred_by     TEXT,
      created_at      TIMESTAMPTZ DEFAULT NOW(),
      updated_at      TIMESTAMPTZ DEFAULT NOW(),
      UNIQUE(tenant_id, customer_id)
    )
  `).catch(() => {});

  await pool.query(`
    CREATE TABLE IF NOT EXISTS tenant_loyalty_history (
      id           SERIAL PRIMARY KEY,
      tenant_id    TEXT NOT NULL,
      customer_id  TEXT NOT NULL,
      tx_id        TEXT,
      points       INTEGER NOT NULL,
      reason       TEXT,
      multiplier   NUMERIC DEFAULT 1,
      balance_after INTEGER,
      created_at   TIMESTAMPTZ DEFAULT NOW()
    )
  `).catch(() => {});
  await pool.query('CREATE INDEX IF NOT EXISTS idx_loyalty_cust ON tenant_loyalty_cards(tenant_id, customer_id)').catch(() => {});
  await pool.query('CREATE INDEX IF NOT EXISTS idx_loyalty_hist ON tenant_loyalty_history(tenant_id, customer_id, created_at DESC)').catch(() => {});
}

/**
 * [410] Vérifie si un timestamp tombe dans un créneau Happy Hour
 */
function isHappyHour(timestamp, happyHours = DEFAULT_HAPPY_HOURS) {
  const d   = new Date(timestamp);
  const dow = d.getDay() === 0 ? 7 : d.getDay(); // 1=Lun, 7=Dim
  const h   = d.getHours();
  return happyHours.some(hh => hh.day === dow && h >= hh.startH && h < hh.endH);
}

/**
 * [409-410] Calcule les points à attribuer pour une transaction
 */
function calculatePoints(amountNet, itemType, transactionAt) {
  const baseRate   = itemType === 'product' ? 2 : 1;  // [409] 2pts/$ produit, 1pt/$ service
  const multiplier = isHappyHour(transactionAt) ? 2 : 1; // [410] Happy Hour ×2
  const points     = Math.floor(amountNet * baseRate * multiplier);
  return { points, baseRate, multiplier, amountNet };
}

/**
 * [408-409] Attribue des points suite à une transaction validée
 */
async function awardPoints(pool, tenantId, { customerId, customerName, customerPhone, amountNet, itemType, txId, transactionAt }) {
  await initSchema(pool);
  const { points, multiplier } = calculatePoints(amountNet || 0, itemType || 'service', transactionAt || new Date());

  if (points <= 0) return { awarded: 0 };

  // Upsert loyalty card
  const r = await pool.query(`
    INSERT INTO tenant_loyalty_cards (tenant_id, customer_id, customer_name, customer_phone, points_balance, points_lifetime)
    VALUES ($1,$2,$3,$4,$5,$5)
    ON CONFLICT (tenant_id, customer_id) DO UPDATE
      SET points_balance  = tenant_loyalty_cards.points_balance + $5,
          points_lifetime = tenant_loyalty_cards.points_lifetime + $5,
          customer_name   = COALESCE($3, tenant_loyalty_cards.customer_name),
          updated_at      = NOW()
    RETURNING *
  `, [tenantId, customerId, customerName, customerPhone, points]);

  const card = r.rows[0];
  await pool.query(`
    INSERT INTO tenant_loyalty_history (tenant_id, customer_id, tx_id, points, reason, multiplier, balance_after)
    VALUES ($1,$2,$3,$4,$5,$6,$7)
  `, [tenantId, customerId, txId, points, `Transaction ${itemType}`, multiplier, card.points_balance]);

  // [417] Vérifie si un palier est atteint
  const tierReached = await checkAndNotifyTier(pool, tenantId, customerId, card.points_balance, card.customer_phone);

  const happyHourMsg = multiplier > 1 ? ` 🎉 Bonus Happy Hour ×${multiplier} !` : '';
  bus.system(`[DynamicPoints] +${points} pts → ${customerName||customerId} (${itemType}, ×${multiplier})${happyHourMsg}`);

  return { awarded: points, balance: card.points_balance, multiplier, tierReached };
}

/**
 * [415] Retourne le solde et les récompenses disponibles
 */
async function getBalance(pool, tenantId, customerId) {
  await initSchema(pool);
  const r = await pool.query(
    `SELECT * FROM tenant_loyalty_cards WHERE tenant_id=$1 AND customer_id=$2`,
    [tenantId, customerId]
  );
  const card = r.rows[0];
  if (!card) return { customerId, balance: 0, lifetime: 0, tier: 'none', availableRewards: [] };

  const availableRewards = DEFAULT_TIERS.filter(t => card.points_balance >= t.points);
  return {
    customerId,
    balance:          card.points_balance,
    lifetime:         card.points_lifetime,
    tier:             card.tier_id,
    referralCode:     card.referral_code,
    availableRewards,
    nextTier:         DEFAULT_TIERS.find(t => t.points > card.points_balance) || null,
  };
}

/**
 * [416-417] Vérifie et notifie si un palier est atteint
 */
async function checkAndNotifyTier(pool, tenantId, customerId, balance, phone) {
  const tier = [...DEFAULT_TIERS].reverse().find(t => balance >= t.points);
  if (!tier) return null;

  await pool.query(`
    UPDATE tenant_loyalty_cards SET tier_id=$3 WHERE tenant_id=$1 AND customer_id=$2
  `, [tenantId, customerId, tier.id]).catch(() => {});

  bus.system(`[DynamicPoints] 🏆 Palier atteint: ${tier.name} (${balance} pts) → ${customerId}`);
  bus.emit('loyalty:tier:reached', { tenantId, customerId, tier, balance, phone });

  // [417] SMS si téléphone disponible
  if (phone) {
    try {
      const twilio = require('./twilio-sender');
      await twilio.sendSMS({ to: phone, body: `${tier.emoji} Félicitations ! Vous avez débloqué la récompense "${tier.reward}" grâce à vos ${balance} points de fidélité DALEBA ! Présentez ce SMS au salon pour l'encaisser. 💜` });
    } catch {}
  }

  return tier;
}

async function checkTier(pool, tenantId, customerId) {
  const balance = await getBalance(pool, tenantId, customerId);
  return checkAndNotifyTier(pool, tenantId, customerId, balance.balance, null);
}

async function redeemPoints(pool, tenantId, { customerId, points, reason }) {
  await initSchema(pool);
  const r = await pool.query(`
    UPDATE tenant_loyalty_cards SET points_balance = GREATEST(points_balance - $3, 0), updated_at=NOW()
    WHERE tenant_id=$1 AND customer_id=$2 AND points_balance >= $3
    RETURNING points_balance
  `, [tenantId, customerId, points]);
  if (!r.rows.length) throw new Error('Solde insuffisant ou client introuvable');
  bus.system(`[DynamicPoints] -${points} pts (rachat) → ${customerId}: ${reason||'—'}`);
  return { redeemed: points, balance: r.rows[0].points_balance };
}

async function applyHappyHourMultiplier(pool, tenantId, { timestamp }) {
  const hh = isHappyHour(timestamp);
  return { happyHour: hh, multiplier: hh ? 2 : 1, timestamp };
}

async function notifyTierReached(pool, tenantId, { customerId, tierId }) {
  const tier = DEFAULT_TIERS.find(t => t.id === tierId);
  if (!tier) return { notified: false };
  bus.emit('loyalty:tier:notify_staff', { tenantId, customerId, tier });
  return { notified: true, tier };
}

module.exports = { initSchema, awardPoints, getBalance, redeemPoints, checkTier, calculatePoints, isHappyHour, applyHappyHourMultiplier, notifyTierReached, DEFAULT_TIERS, DEFAULT_HAPPY_HOURS };
