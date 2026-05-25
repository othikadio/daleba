/**
 * DALEBA — Moteur d'Abonnements Souverains
 * Section 15 — Forfaits Mensuels RÉELS Kadio Coiffure
 *
 * Tous les prix sont HORS TAXES.
 * Québec : TPS 5% + TVQ 9.975% = 14.975% total
 */

'use strict';

const { pool, DEMO_MODE } = require('../memory/db');
const bus = require('./event-bus');

// ─── TAXES QC ────────────────────────────────────────────────────────────────
function calculateTaxes(price) {
  const tps    = parseFloat((price * 0.05).toFixed(2));
  const tvq    = parseFloat((price * 0.09975).toFixed(2));
  const total  = parseFloat((price + tps + tvq).toFixed(2));
  return { subtotal: price, tps, tvq, total };
}

// ─── PASSES PRÉPAYÉES KADIO COIFFURE ──────────────────────────────────────────
// Engagement = prépaiement sur plusieurs mois — réduction appliquée sur chaque service

const PASS_PLANS = {
  '3months': {
    id: '3months',
    months: 3,
    discount: 0.05,
    label: '3 mois — 5% de réduction',
    description: 'Engagement 3 mois — 5% de réduction sur tous vos services.',
    badge: null,
  },
  '6months': {
    id: '6months',
    months: 6,
    discount: 0.10,
    label: '6 mois — 10% de réduction',
    description: 'Engagement 6 mois — 10% de réduction sur tous vos services.',
    badge: '⭐ Meilleur rapport',
  },
  '12months': {
    id: '12months',
    months: 12,
    discount: 0.10,
    label: '12 mois — 10% de réduction',
    description: 'Engagement 12 mois — 10% de réduction sur tous vos services.',
    badge: "🔥 Maximum d'économies",
  },
};

// Alias pour compatibilité rétro si d'autres modules lisent FORFAITS
const FORFAITS = {};

// ─── UTILITAIRES PASSES ─────────────────────────────────────────────────────────────

function getAllPassPlans() {
  return Object.values(PASS_PLANS);
}

function getPassPlan(id) {
  const p = PASS_PLANS[id];
  if (!p) throw new Error(`Plan inconnu: ${id}`);
  return p;
}

/**
 * Calculer le montant total d'une passe prépayée
 * @param {string} planId - '3months', '6months', '12months'
 * @param {number} avgMonthlySpend - dépense mensuelle estimée en $ HT
 */
function calculatePassAmount(planId, avgMonthlySpend) {
  const plan = getPassPlan(planId);
  const gross   = avgMonthlySpend * plan.months;
  const savings = Math.round(gross * plan.discount * 100) / 100;
  const amount  = Math.round((gross - savings) * 100) / 100;
  return { amountCAD: amount, gross, savings, discount: plan.discount, months: plan.months };
}

// Stubs de compatibilité (utilisés par d'autres modules)
function getAllForfaits() { return []; }
function getForfait(id) { throw new Error(`FORFAITS supprimés — utiliser PASS_PLANS. id: ${id}`); }
function calculateCommission() { return 0; }
function applyFamilyDiscount(totalPrice) { return { original: totalPrice, discount: 0, final: totalPrice }; }
function getForfaitsByCategory() { return {}; }

// ─── GÉNÉRATION CODE SCAN ────────────────────────────────────────────────────
function generateScanCode() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let code = 'KC';
  for (let i = 0; i < 6; i++) code += chars[Math.floor(Math.random() * chars.length)];
  return code;
}

// ─── TABLES SQL ───────────────────────────────────────────────────────────────
/*
CREATE TABLE IF NOT EXISTS daleba_subscriptions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_phone VARCHAR(20) NOT NULL,
  client_name VARCHAR(100),
  forfait_id VARCHAR(60) NOT NULL,
  status VARCHAR(20) DEFAULT 'active',
  square_subscription_id VARCHAR(100),
  weekly_wash_used BOOLEAN DEFAULT false,
  weekly_wash_reset_at TIMESTAMP,
  start_date TIMESTAMP DEFAULT NOW(),
  next_billing_date TIMESTAMP,
  created_by_staff VARCHAR(50),
  commission_paid BOOLEAN DEFAULT false,
  family_group_id VARCHAR(50),
  scan_code VARCHAR(20) UNIQUE,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS daleba_otp_codes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  phone VARCHAR(20) NOT NULL,
  code VARCHAR(6) NOT NULL,
  expires_at TIMESTAMP NOT NULL,
  used BOOLEAN DEFAULT false,
  created_at TIMESTAMP DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS daleba_staff_commissions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  staff_id VARCHAR(50) NOT NULL,
  staff_name VARCHAR(100),
  client_phone VARCHAR(20),
  forfait_id VARCHAR(60) NOT NULL,
  commission_amount DECIMAL(10,2) NOT NULL,
  subscription_id UUID,
  paid BOOLEAN DEFAULT false,
  created_at TIMESTAMP DEFAULT NOW()
);
*/

async function initTables() {
  if (DEMO_MODE || !pool) { console.log('[SUBSCRIPTION] Mode démo — DB non initialisée'); return; }
  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS daleba_subscriptions (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        client_phone VARCHAR(20) NOT NULL,
        client_name VARCHAR(100),
        forfait_id VARCHAR(60) NOT NULL,
        status VARCHAR(20) DEFAULT 'active',
        square_subscription_id VARCHAR(100),
        weekly_wash_used BOOLEAN DEFAULT false,
        weekly_wash_reset_at TIMESTAMP,
        start_date TIMESTAMP DEFAULT NOW(),
        next_billing_date TIMESTAMP,
        created_by_staff VARCHAR(50),
        commission_paid BOOLEAN DEFAULT false,
        family_group_id VARCHAR(50),
        scan_code VARCHAR(20) UNIQUE,
        created_at TIMESTAMP DEFAULT NOW(),
        updated_at TIMESTAMP DEFAULT NOW()
      );
      CREATE TABLE IF NOT EXISTS daleba_otp_codes (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        phone VARCHAR(20) NOT NULL,
        code VARCHAR(6) NOT NULL,
        expires_at TIMESTAMP NOT NULL,
        used BOOLEAN DEFAULT false,
        created_at TIMESTAMP DEFAULT NOW()
      );
      CREATE TABLE IF NOT EXISTS daleba_staff_commissions (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        staff_id VARCHAR(50) NOT NULL,
        staff_name VARCHAR(100),
        client_phone VARCHAR(20),
        forfait_id VARCHAR(60) NOT NULL,
        commission_amount DECIMAL(10,2) NOT NULL,
        subscription_id UUID,
        paid BOOLEAN DEFAULT false,
        created_at TIMESTAMP DEFAULT NOW()
      );
    `);
    console.log('[SUBSCRIPTION] Tables initialisées ✓');
  } catch (e) {
    console.error('[SUBSCRIPTION] Erreur init tables:', e.message);
  }
}

// ─── CRUD ABONNEMENTS ─────────────────────────────────────────────────────────

async function createSubscription({ clientPhone, clientName, forfaitId, staffId }) {
  const forfait = getForfait(forfaitId);
  const scanCode = generateScanCode();
  const commission = calculateCommission(forfaitId);
  const nextBilling = new Date();
  nextBilling.setMonth(nextBilling.getMonth() + 1);

  if (DEMO_MODE || !pool) {
    console.log(`[SUBSCRIPTION] DEMO — Abonnement créé: ${clientPhone} → ${forfait.name}`);
    return { id: 'demo-' + Date.now(), scanCode, forfait, commission };
  }

  const result = await pool.query(`
    INSERT INTO daleba_subscriptions
      (client_phone, client_name, forfait_id, scan_code, created_by_staff, next_billing_date)
    VALUES ($1,$2,$3,$4,$5,$6)
    RETURNING *
  `, [clientPhone, clientName, forfaitId, scanCode, staffId || null, nextBilling]);

  if (staffId) {
    await pool.query(`
      INSERT INTO daleba_staff_commissions (staff_id, client_phone, forfait_id, commission_amount, subscription_id)
      VALUES ($1,$2,$3,$4,$5)
    `, [staffId, clientPhone, forfaitId, commission, result.rows[0].id]);
  }

  bus.emit('subscription:created', { phone: clientPhone, forfait: forfait.name, scanCode });
  return { ...result.rows[0], forfait, commission };
}

async function getSubscriptionByScanCode(scanCode) {
  if (DEMO_MODE || !pool) return null;
  const r = await pool.query('SELECT * FROM daleba_subscriptions WHERE scan_code=$1', [scanCode]);
  if (!r.rows[0]) return null;
  const sub = r.rows[0];
  return { ...sub, forfait: getForfait(sub.forfait_id) };
}

async function getSubscriptionByPhone(phone) {
  if (DEMO_MODE || !pool) return null;
  const r = await pool.query('SELECT * FROM daleba_subscriptions WHERE client_phone=$1 AND status=$2', [phone, 'active']);
  if (!r.rows[0]) return null;
  return { ...r.rows[0], forfait: getForfait(r.rows[0].forfait_id) };
}

async function blockSubscription(phone, reason) {
  if (DEMO_MODE || !pool) return;
  await pool.query(`UPDATE daleba_subscriptions SET status='blocked', updated_at=NOW() WHERE client_phone=$1`, [phone]);
  bus.emit('subscription:blocked', { phone, reason });
  console.log(`[SUBSCRIPTION] Bloqué: ${phone} — ${reason}`);
}

async function checkWeeklyWash(phone) {
  if (DEMO_MODE || !pool) return { canWash: true, used: false };
  const r = await pool.query('SELECT weekly_wash_used FROM daleba_subscriptions WHERE client_phone=$1 AND status=$2', [phone, 'active']);
  if (!r.rows[0]) return { canWash: false, error: 'Abonnement non trouvé' };
  return { canWash: !r.rows[0].weekly_wash_used, used: r.rows[0].weekly_wash_used };
}

async function consumeWeeklyWash(phone) {
  if (DEMO_MODE || !pool) return { success: true };
  const check = await checkWeeklyWash(phone);
  if (!check.canWash) return { success: false, message: 'Lavage de la semaine déjà utilisé' };
  await pool.query(`UPDATE daleba_subscriptions SET weekly_wash_used=true, updated_at=NOW() WHERE client_phone=$1`, [phone]);
  return { success: true };
}

async function resetWeeklyWashes() {
  if (DEMO_MODE || !pool) return;
  const r = await pool.query(`UPDATE daleba_subscriptions SET weekly_wash_used=false, weekly_wash_reset_at=NOW(), updated_at=NOW() WHERE status='active'`);
  console.log(`[SUBSCRIPTION] Reset lavages hebdo ✓ — ${r.rowCount} abonnements mis à jour`);
  bus.emit('subscription:wash_reset', { count: r.rowCount, at: new Date().toISOString() });
}

async function getStaffCommissions(staffId, month) {
  if (DEMO_MODE || !pool) return [];
  const r = await pool.query(`
    SELECT c.*, s.client_name, s.forfait_id FROM daleba_staff_commissions c
    LEFT JOIN daleba_subscriptions s ON c.subscription_id = s.id
    WHERE c.staff_id=$1 AND TO_CHAR(c.created_at,'YYYY-MM')=$2
  `, [staffId, month]);
  return r.rows;
}


// ─── PASSES PRÉPAYÉES — TABLE + DÉDUCTION ────────────────────────────────────

async function ensurePassesTable() {
  if (DEMO_MODE || !pool) return;
  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS subscription_passes (
        id SERIAL PRIMARY KEY,
        subscriber_id VARCHAR(255),
        plan_name VARCHAR(255),
        total_sessions INT,
        sessions_remaining INT,
        paid_amount DECIMAL(10,2),
        valid_until DATE,
        created_at TIMESTAMP DEFAULT NOW()
      );
    `);
  } catch (e) {
    console.warn('[subscription-engine] ensurePassesTable:', e.message);
  }
}
ensurePassesTable();

/**
 * deductPass(subscriberId, serviceUsed)
 * Décrémente le compteur sessions_remaining sur la passe active du subscriber.
 * Returns: { success, sessionsRemaining, message }
 */
async function deductPass(subscriberId, serviceUsed = '') {
  if (DEMO_MODE || !pool) {
    return { success: false, error: 'Mode démo — DB non disponible' };
  }
  try {
    // Chercher passe active
    const r = await pool.query(
      `SELECT * FROM subscription_passes
       WHERE subscriber_id = $1
         AND sessions_remaining > 0
         AND (valid_until IS NULL OR valid_until >= CURRENT_DATE)
       ORDER BY created_at ASC
       LIMIT 1`,
      [subscriberId]
    );
    if (r.rowCount === 0) {
      return { success: false, message: 'Aucune passe active trouvée pour ce client.' };
    }
    const pass = r.rows[0];
    const newRemaining = pass.sessions_remaining - 1;
    const exhausted = newRemaining === 0;

    await pool.query(
      `UPDATE subscription_passes
       SET sessions_remaining = $1
       WHERE id = $2`,
      [newRemaining, pass.id]
    );

    console.log(`[subscription-engine] deductPass: subscriber=${subscriberId} service="${serviceUsed}" remaining=${newRemaining}`);
    return {
      success: true,
      passId: pass.id,
      planName: pass.plan_name,
      sessionsRemaining: newRemaining,
      totalSessions: pass.total_sessions,
      exhausted,
      message: exhausted
        ? `Passe épuisée. Toutes les ${pass.total_sessions} séances ont été utilisées.`
        : `Séance déduite. Il vous reste ${newRemaining} séance${newRemaining > 1 ? 's' : ''}.`,
    };
  } catch (e) {
    console.error('[subscription-engine] deductPass:', e.message);
    return { success: false, error: e.message };
  }
}

module.exports = {
  // Passes prépayées (nouvelle logique)
  PASS_PLANS,
  getAllPassPlans,
  getPassPlan,
  calculatePassAmount,
  // Stubs de compatibilité
  FORFAITS,
  calculateTaxes,
  getAllForfaits,
  getForfait,
  calculateCommission,
  applyFamilyDiscount,
  getForfaitsByCategory,
  generateScanCode,
  initTables,
  createSubscription,
  getSubscriptionByScanCode,
  getSubscriptionByPhone,
  blockSubscription,
  checkWeeklyWash,
  consumeWeeklyWash,
  resetWeeklyWashes,
  getStaffCommissions,
  deductPass,
  ensurePassesTable,
};
