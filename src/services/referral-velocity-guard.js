'use strict';
/**
 * Referral Velocity Guard — DALEBA Metacortex Point 447
 * Suspend un code de parrainage si >10 inscriptions en 24h (fraude).
 */
const bus = require('./event-bus');

const MAX_REFERRALS_24H = 10;
const SUSPENSION_HOURS  = 48;

async function checkVelocity(pool, tenantId, referralCode) {
  const r = await pool.query(`
    SELECT COUNT(*) AS cnt FROM tenant_referrals
    WHERE tenant_id=$1 AND referral_code=$2
      AND created_at >= NOW() - INTERVAL '24 hours'
  `, [tenantId, referralCode]).catch(() => ({ rows: [{ cnt: 0 }] }));

  const cnt = parseInt(r.rows[0]?.cnt || 0);
  if (cnt >= MAX_REFERRALS_24H) {
    // Suspend le code
    await pool.query(`
      UPDATE tenant_referrals SET status='suspended' WHERE tenant_id=$1 AND referral_code=$2 AND status='pending'
    `, [tenantId, referralCode]).catch(() => {});
    bus.system(`[ReferralVelocity] 🚨 Code ${referralCode} SUSPENDU: ${cnt} inscriptions en 24h (seuil: ${MAX_REFERRALS_24H})`);
    bus.emit('referral:velocity:alert', { tenantId, referralCode, cnt });
    return { suspended: true, count: cnt, reason: 'velocity_exceeded' };
  }
  return { suspended: false, count: cnt };
}

async function isCodeSuspended(pool, tenantId, referralCode) {
  const r = await pool.query(
    `SELECT status FROM tenant_referrals WHERE tenant_id=$1 AND referral_code=$2 LIMIT 1`,
    [tenantId, referralCode]
  ).catch(() => ({ rows: [] }));
  return r.rows[0]?.status === 'suspended';
}

module.exports = { checkVelocity, isCodeSuspended, MAX_REFERRALS_24H };
