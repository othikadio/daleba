'use strict';
/**
 * DALEBA — Comptabilité Neuronale
 * Manifeste Souveraineté — Module Finances
 *
 * - Flux abonnements Square/Stripe
 * - Dépenses fixes (loyer, stocks, frais)
 * - Paliers commissions staff
 * - Rapprochements TPS/TVQ
 * - Rapports mensuels auto
 */

const LOG = '[ACCOUNTING]';
let pool = null;
let DEMO_MODE = true;

try {
  const db = require('../memory/db');
  pool = db.pool;
  DEMO_MODE = db.DEMO_MODE;
} catch(e) {}

// ─── TAUX TAXES QC ────────────────────────────────────────────────────────────
const TPS  = 0.05;
const TVQ  = 0.09975;
const TOTAL_TAX = TPS + TVQ; // 0.14975

// ─── PALIERS COMMISSIONS STAFF ────────────────────────────────────────────────
// Commission fixe par abonnement inscrit par l'employé + bonus volume
const COMMISSION_TIERS = [
  { minSubs: 0,  rate: 10 },  // 0–4 abonnés : 10$/abonné
  { minSubs: 5,  rate: 12 },  // 5–9 abonnés : 12$/abonné
  { minSubs: 10, rate: 15 },  // 10+ abonnés : 15$/abonné
];

// ─── INIT TABLES ──────────────────────────────────────────────────────────────
async function init() {
  if (!pool) return;
  await pool.query(`
    CREATE TABLE IF NOT EXISTS daleba_expenses (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      category VARCHAR(50) NOT NULL,  -- 'loyer' | 'stock' | 'frais_fixes' | 'marketing' | 'autre'
      description VARCHAR(200),
      amount DECIMAL(10,2) NOT NULL,
      currency VARCHAR(3) DEFAULT 'CAD',
      expense_date DATE NOT NULL,
      is_recurring BOOLEAN DEFAULT false,
      recurring_day INTEGER,           -- jour du mois pour récurrent
      created_at TIMESTAMP DEFAULT NOW()
    );
  `);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS daleba_revenue_records (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      source VARCHAR(30) NOT NULL,     -- 'square' | 'stripe' | 'cash' | 'abonnement'
      client_id VARCHAR(100),
      description VARCHAR(200),
      amount_ht DECIMAL(10,2) NOT NULL,
      tps DECIMAL(10,2),
      tvq DECIMAL(10,2),
      amount_ttc DECIMAL(10,2),
      transaction_date DATE NOT NULL,
      staff_id VARCHAR(50),
      forfait_id VARCHAR(100),
      created_at TIMESTAMP DEFAULT NOW()
    );
  `);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS daleba_commission_records (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      staff_id VARCHAR(50) NOT NULL,
      period_month VARCHAR(7) NOT NULL,  -- 'YYYY-MM'
      subscriber_count INTEGER DEFAULT 0,
      commission_per_sub DECIMAL(10,2),
      total_commission DECIMAL(10,2),
      bonus DECIMAL(10,2) DEFAULT 0,
      paid BOOLEAN DEFAULT false,
      paid_at TIMESTAMP,
      created_at TIMESTAMP DEFAULT NOW()
    );
  `);
  console.log(`${LOG} Tables comptabilité initialisées`);
}

// ─── CALCUL TAXES ─────────────────────────────────────────────────────────────
function calcTaxes(amountHT) {
  const tps = parseFloat((amountHT * TPS).toFixed(2));
  const tvq = parseFloat((amountHT * TVQ).toFixed(2));
  const ttc = parseFloat((amountHT + tps + tvq).toFixed(2));
  return { amountHT: parseFloat(amountHT.toFixed(2)), tps, tvq, ttc };
}

// ─── CALCUL COMMISSION STAFF ───────────────────────────────────────────────────
function calcCommission(staffId, subscriberCount) {
  const tier = [...COMMISSION_TIERS].reverse().find(t => subscriberCount >= t.minSubs);
  const rate = tier ? tier.rate : 10;
  const base = subscriberCount * rate;
  // Bonus: +50$ si > 15 abonnés ce mois
  const bonus = subscriberCount > 15 ? 50 : 0;
  return {
    staffId,
    subscriberCount,
    ratePerSub: rate,
    baseCommission: parseFloat(base.toFixed(2)),
    bonus,
    total: parseFloat((base + bonus).toFixed(2)),
  };
}

// ─── ENREGISTRER UNE DÉPENSE ───────────────────────────────────────────────────
async function recordExpense({ category, description, amount, expenseDate, isRecurring, recurringDay }) {
  if (!pool || DEMO_MODE) {
    console.log(`${LOG} [DEMO] Dépense: ${category} ${amount}$`);
    return { id: 'demo-' + Date.now(), category, amount };
  }
  const r = await pool.query(
    `INSERT INTO daleba_expenses (category, description, amount, expense_date, is_recurring, recurring_day)
     VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`,
    [category, description||'', amount, expenseDate||new Date(), isRecurring||false, recurringDay||null]
  );
  console.log(`${LOG} Dépense enregistrée: ${category} — ${amount}$`);
  return r.rows[0];
}

// ─── RAPPORT MENSUEL ───────────────────────────────────────────────────────────
async function getMonthlyReport(year, month) {
  const period = `${year}-${String(month).padStart(2,'0')}`;
  const periodStart = `${period}-01`;
  const periodEnd = new Date(year, month, 0).toISOString().split('T')[0]; // dernier jour

  if (!pool || DEMO_MODE) {
    // Données démo
    return buildDemoReport(period);
  }

  // Revenus
  const revenues = await pool.query(
    'SELECT * FROM daleba_revenue_records WHERE transaction_date BETWEEN $1 AND $2 ORDER BY transaction_date',
    [periodStart, periodEnd]
  );

  // Dépenses
  const expenses = await pool.query(
    'SELECT * FROM daleba_expenses WHERE expense_date BETWEEN $1 AND $2 ORDER BY expense_date',
    [periodStart, periodEnd]
  );

  // Abonnements actifs (depuis daleba_loyalty comme proxy)
  let activeSubCount = 0;
  try {
    const subs = await pool.query("SELECT COUNT(*) FROM daleba_loyalty WHERE status='active'");
    activeSubCount = parseInt(subs.rows[0].count) || 0;
  } catch(e) {}

  const totalRevHT = revenues.rows.reduce((s,r) => s + parseFloat(r.amount_ht||0), 0);
  const totalTPS   = revenues.rows.reduce((s,r) => s + parseFloat(r.tps||0), 0);
  const totalTVQ   = revenues.rows.reduce((s,r) => s + parseFloat(r.tvq||0), 0);
  const totalTTC   = revenues.rows.reduce((s,r) => s + parseFloat(r.amount_ttc||0), 0);
  const totalExp   = expenses.rows.reduce((s,e) => s + parseFloat(e.amount||0), 0);
  const benefice   = parseFloat((totalRevHT - totalExp).toFixed(2));

  return {
    period,
    revenue: { ht: parseFloat(totalRevHT.toFixed(2)), tps: parseFloat(totalTPS.toFixed(2)), tvq: parseFloat(totalTVQ.toFixed(2)), ttc: parseFloat(totalTTC.toFixed(2)) },
    expenses: { total: parseFloat(totalExp.toFixed(2)), items: expenses.rows },
    net: { benefice, margin: totalRevHT > 0 ? parseFloat((benefice/totalRevHT*100).toFixed(1)) : 0 },
    activeSubscribers: activeSubCount,
    lines: revenues.rows,
  };
}

function buildDemoReport(period) {
  const subs = [
    {forfaitId:'locs-illimite',price:129.99},
    {forfaitId:'knotless-tresses-signature',price:139.99},
    {forfaitId:'barbier-coupe-barbe',price:64.99},
    {forfaitId:'microlocks-sisterlocks',price:149.99},
    {forfaitId:'combo-locs-barbier',price:154.99},
  ];
  const revHT = subs.reduce((s,x)=>s+x.price,0);
  const taxes = calcTaxes(revHT);
  const expenses = [
    {category:'loyer',description:'Loyer local 100',amount:1800},
    {category:'stock',description:'Produits capillaires',amount:320},
    {category:'frais_fixes',description:'Wi-Fi + énergie',amount:85},
    {category:'marketing',description:'Publicité IG/FB',amount:150},
  ];
  const totalExp = expenses.reduce((s,e)=>s+e.amount,0);
  const benefice = parseFloat((revHT - totalExp).toFixed(2));
  return {
    period, demo: true,
    revenue: { ht: parseFloat(revHT.toFixed(2)), ...taxes },
    expenses: { total: totalExp, items: expenses },
    net: { benefice, margin: parseFloat((benefice/revHT*100).toFixed(1)) },
    activeSubscribers: subs.length,
    commissions: [
      calcCommission('maya', 3),
      calcCommission('mariel', 2),
    ],
  };
}

// ─── CALCUL COMMISSIONS MENSUEL ───────────────────────────────────────────────
async function computeMonthlyCommissions(year, month) {
  const period = `${year}-${String(month).padStart(2,'0')}`;
  if (!pool || DEMO_MODE) {
    return [calcCommission('maya', 3), calcCommission('mariel', 2)];
  }
  // Compter les abonnés par staff ce mois
  const r = await pool.query(
    `SELECT created_by_staff AS staff_id, COUNT(*) AS count
     FROM daleba_loyalty
     WHERE DATE_TRUNC('month', created_at) = $1
     GROUP BY created_by_staff`,
    [`${period}-01`]
  );
  const result = r.rows.map(row => calcCommission(row.staff_id, parseInt(row.count)));
  // Sauvegarder
  for (const c of result) {
    await pool.query(
      `INSERT INTO daleba_commission_records
       (staff_id, period_month, subscriber_count, commission_per_sub, total_commission)
       VALUES ($1,$2,$3,$4,$5)
       ON CONFLICT DO NOTHING`,
      [c.staffId, period, c.subscriberCount, c.ratePerSub, c.total]
    );
  }
  return result;
}

// ─── EXPORT ───────────────────────────────────────────────────────────────────
module.exports = {
  init,
  calcTaxes,
  calcCommission,
  recordExpense,
  getMonthlyReport,
  computeMonthlyCommissions,
  COMMISSION_TIERS,
};
