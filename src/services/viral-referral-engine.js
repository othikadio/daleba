'use strict';
/**
 * Viral Referral Engine — DALEBA Metacortex Points 411-414
 * [411] Code parrainage unique REF-PRENOM-XXX par client
 * [412] Intégré widget + SMS confirmation RDV
 * [413] Parrain: +500pts | Filleul: -15% premier soin
 * [414] Table tenant_referrals + anti-fraude auto-parrainage
 */
const bus    = require('./event-bus');
const crypto = require('crypto');

async function initSchema(pool) {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS tenant_referrals (
      id              SERIAL PRIMARY KEY,
      tenant_id       TEXT NOT NULL,
      referrer_id     TEXT NOT NULL,      -- parrain (customer_id)
      referrer_phone  TEXT,
      referee_id      TEXT,               -- filleul (customer_id)
      referee_phone   TEXT,
      referral_code   TEXT NOT NULL,
      status          TEXT DEFAULT 'pending',  -- pending | converted | fraud | expired
      bonus_awarded   BOOL DEFAULT false,
      discount_applied BOOL DEFAULT false,
      created_at      TIMESTAMPTZ DEFAULT NOW(),
      converted_at    TIMESTAMPTZ,
      UNIQUE(tenant_id, referral_code)
    )
  `).catch(() => {});
  await pool.query('CREATE INDEX IF NOT EXISTS idx_referrals_code ON tenant_referrals(referral_code, status)').catch(() => {});
  await pool.query('CREATE INDEX IF NOT EXISTS idx_referrals_referrer ON tenant_referrals(tenant_id, referrer_id)').catch(() => {});
}

/**
 * [411] Génère un code de parrainage unique
 */
function generateCode(customerName, customerId) {
  const prefix = (customerName || 'CLIENT').split(' ')[0].toUpperCase().slice(0, 6).replace(/[^A-Z]/g, 'X');
  const suffix = crypto.createHash('md5').update(customerId).digest('hex').slice(0, 3).toUpperCase();
  return `REF-${prefix}-${suffix}`;
}

/**
 * [411] Crée le code de parrainage pour un client
 */
async function createReferralCode(pool, tenantId, { customerId, customerName, customerPhone }) {
  await initSchema(pool);
  const code = generateCode(customerName, customerId);

  // Enregistre dans loyalty_cards si possible
  await pool.query(`
    UPDATE tenant_loyalty_cards SET referral_code=$3 WHERE tenant_id=$1 AND customer_id=$2
  `, [tenantId, customerId, code]).catch(() => {});

  // Crée l'entrée dans referrals (en tant que parrain sans filleul encore)
  await pool.query(`
    INSERT INTO tenant_referrals (tenant_id, referrer_id, referrer_phone, referral_code)
    VALUES ($1,$2,$3,$4)
    ON CONFLICT (tenant_id, referral_code) DO NOTHING
  `, [tenantId, customerId, customerPhone, code]).catch(() => {});

  bus.system(`[ViralReferral] Code créé: ${code} pour ${customerName||customerId}`);
  return { code, shareUrl: `https://kadiocoiffure.vercel.app/hub?ref=${code}`, message: `Partagez votre code ${code} et gagnez 500 points par filleul !` };
}

/**
 * [414] Anti-fraude: détecte auto-parrainage par numéro de téléphone
 */
async function detectFraud(pool, tenantId, referralCode, refereePhone) {
  // Récupère le numéro du parrain
  const r = await pool.query(
    `SELECT referrer_phone FROM tenant_referrals WHERE tenant_id=$1 AND referral_code=$2 LIMIT 1`,
    [tenantId, referralCode]
  ).catch(() => ({ rows: [] }));

  const referrerPhone = r.rows[0]?.referrer_phone;

  // Auto-parrainage si même numéro
  if (referrerPhone && refereePhone && referrerPhone === refereePhone) {
    bus.system(`[ViralReferral] 🚨 FRAUDE: auto-parrainage détecté (même téléphone: ${refereePhone})`);
    return { fraud: true, reason: 'auto_referral_same_phone' };
  }

  // Double parrainage sur même code par même filleul
  const existing = await pool.query(
    `SELECT id FROM tenant_referrals WHERE tenant_id=$1 AND referral_code=$2 AND referee_phone=$3`,
    [tenantId, referralCode, refereePhone]
  ).catch(() => ({ rows: [] }));

  if (existing.rows.length > 0) return { fraud: true, reason: 'duplicate_referee' };

  return { fraud: false };
}

/**
 * [413] Valide et applique le parrainage lors de la 1ère transaction du filleul
 */
async function validateAndApply(pool, tenantId, { referralCode, refereeId, refereePhone, refereeName }) {
  await initSchema(pool);
  if (!referralCode) return { applied: false, reason: 'no_code' };

  // Anti-fraude [414]
  const fraudCheck = await detectFraud(pool, tenantId, referralCode, refereePhone);
  if (fraudCheck.fraud) {
    await pool.query(`UPDATE tenant_referrals SET status='fraud' WHERE tenant_id=$1 AND referral_code=$2`, [tenantId, referralCode]).catch(() => {});
    return { applied: false, reason: fraudCheck.reason };
  }

  // Récupère le parrain
  const r = await pool.query(
    `SELECT * FROM tenant_referrals WHERE tenant_id=$1 AND referral_code=$2 AND status='pending' LIMIT 1`,
    [tenantId, referralCode]
  ).catch(() => ({ rows: [] }));

  if (!r.rows.length) return { applied: false, reason: 'code_invalid_or_used' };
  const ref = r.rows[0];

  // Marque converti
  await pool.query(`
    UPDATE tenant_referrals SET status='converted', referee_id=$3, referee_phone=$4, converted_at=NOW()
    WHERE id=$1 AND tenant_id=$2
  `, [ref.id, tenantId, refereeId, refereePhone]).catch(() => {});

  // [413] +500 pts au parrain
  const pts = require('./dynamic-points-engine');
  await pts.awardPoints(pool, tenantId, { customerId: ref.referrer_id, amountNet: 500, itemType: 'referral_bonus', txId: `ref_${ref.id}`, transactionAt: new Date() }).catch(() => {});

  bus.system(`[ViralReferral] ✅ Parrainage converti: ${ref.referral_code} — parrain +500pts, filleul -15%`);

  // SMS au parrain
  if (ref.referrer_phone) {
    try {
      const twilio = require('./twilio-sender');
      await twilio.sendSMS({ to: ref.referrer_phone, body: `🎉 Votre filleul ${refereeName||'un nouveau client'} vient de compléter sa première visite ! Vous recevez 500 points de fidélité DALEBA. Merci de nous recommander ! 💜` });
    } catch {}
  }

  return { applied: true, referrerBonus: 500, refereeDiscount: 15, code: referralCode };
}

/**
 * [413] Applique la remise de 15% au filleul sur son premier soin
 */
function applyDiscount(pool, tenantId, { customerId, amount }) {
  const discount = Math.round(amount * 0.15 * 100) / 100;
  bus.system(`[ViralReferral] 💰 Remise 15% appliquée: -${discount}$ sur ${amount}$ pour ${customerId}`);
  return { discountApplied: true, discountAmount: discount, amountAfterDiscount: Math.round((amount - discount) * 100) / 100 };
}

/**
 * Top parrains du mois
 */
async function listTopReferrers(pool, tenantId, limit = 10) {
  await initSchema(pool);
  const r = await pool.query(`
    SELECT referrer_id, COUNT(*) AS conversions
    FROM tenant_referrals WHERE tenant_id=$1 AND status='converted'
    AND created_at >= NOW() - INTERVAL '30 days'
    GROUP BY referrer_id ORDER BY conversions DESC LIMIT $2
  `, [tenantId, limit]).catch(() => ({ rows: [] }));
  return r.rows;
}

module.exports = { createReferralCode, validateAndApply, applyDiscount, listTopReferrers, detectFraud, generateCode, initSchema };
