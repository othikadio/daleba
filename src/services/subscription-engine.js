/**
 * DALEBA — Moteur d'Abonnements Souverains
 * Section 15 — Abonnements Mensuels Kadio Coiffure
 *
 * Tous les prix sont HORS TAXES.
 * Québec : TPS 5% + TVQ 9.975% = 14.975% total
 */

'use strict';

const { calculateTaxes } = require('./menu-catalogue');
const { pool, DEMO_MODE } = require('../memory/db');
const bus = require('./event-bus');

// ─── FORFAITS ────────────────────────────────────────────────────────────────
// Tous les prix HORS TAXES — "(+ taxes)" affiché partout côté client

const PLANS = [
  {
    id:          'essentiel',
    name:        'Essentiel',
    priceMonthly: 49,
    priceLabel:  '49$/mois (+ taxes)',
    badge:       null,
    featured:    false,
    vip:         false,
    features: [
      '2 coupes par mois',
      'Priorité à la réservation',
      'Pas de dépôt requis',
      'Confirmation SMS instantanée',
    ],
    ctaText: 'Commencer',
    description: 'Idéal pour les clients réguliers qui veulent un entretien soigné sans contrainte.',
  },
  {
    id:          'premium',
    name:        'Premium',
    priceMonthly: 89,
    priceLabel:  '89$/mois (+ taxes)',
    badge:       '⭐ Le plus choisi',
    featured:    true,
    vip:         false,
    features: [
      '4 coupes par mois',
      '1 traitement capillaire offert',
      'Pas de dépôt',
      'Priorité absolue à la réservation',
      '−10% sur boutique',
    ],
    ctaText: 'Choisir Premium',
    description: 'Le meilleur rapport qualité-prix pour une image impeccable toute l\'année.',
  },
  {
    id:          'vip',
    name:        'VIP',
    priceMonthly: 149,
    priceLabel:  '149$/mois (+ taxes)',
    badge:       '👑 VIP',
    featured:    false,
    vip:         true,
    features: [
      'Coupes illimitées',
      'Tous services inclus',
      'Accès prioritaire garanti',
      '−15% sur boutique',
      'Consultation personnalisée mensuelle',
    ],
    ctaText: 'Devenir VIP',
    description: 'Pour ceux qui ne font aucun compromis sur leur image. L\'expérience ultime.',
  },
];

// ─── FONCTIONS UTILITAIRES ───────────────────────────────────────────────────

/**
 * Retourne tous les forfaits avec calcul des taxes.
 */
function getAllPlansWithTaxes() {
  return PLANS.map(plan => ({
    ...plan,
    taxes: calculateTaxes(plan.priceMonthly),
  }));
}

/**
 * Retourne un forfait par ID avec taxes calculées.
 * @param {string} id — 'essentiel' | 'premium' | 'vip'
 */
function getPlanWithTaxes(id) {
  const plan = PLANS.find(p => p.id === id);
  if (!plan) throw new Error(`Forfait inconnu: ${id}. Options: essentiel, premium, vip`);
  return { ...plan, taxes: calculateTaxes(plan.priceMonthly) };
}

/**
 * Calcule le coût annuel d'un forfait (12 mois, taxes incluses).
 * @param {string} id
 */
function getAnnualCost(id) {
  const plan = getPlanWithTaxes(id);
  const annualHT = plan.priceMonthly * 12;
  const taxes    = calculateTaxes(annualHT);
  return {
    plan: plan.name,
    monthlyHT:  plan.priceMonthly,
    annualHT,
    taxes,
    savings:    `${(plan.priceMonthly * 2).toFixed(2)} $ économisés vs mensuel`,
  };
}

// ─── GESTION DES ABONNEMENTS (DB) ────────────────────────────────────────────

/**
 * Initialise la table subscriptions si elle n'existe pas.
 */
async function initSubscriptionsTable() {
  if (DEMO_MODE || !pool) return;
  await pool.query(`
    CREATE TABLE IF NOT EXISTS subscriptions (
      id             SERIAL PRIMARY KEY,
      tenant_id      VARCHAR(64)  NOT NULL DEFAULT 'kadio',
      client_name    VARCHAR(128) NOT NULL,
      client_phone   VARCHAR(32)  NOT NULL,
      client_email   VARCHAR(128),
      plan_id        VARCHAR(32)  NOT NULL,
      plan_name      VARCHAR(64)  NOT NULL,
      price_ht       NUMERIC(10,2) NOT NULL,
      price_tps      NUMERIC(10,2) NOT NULL,
      price_tvq      NUMERIC(10,2) NOT NULL,
      price_ttc      NUMERIC(10,2) NOT NULL,
      status         VARCHAR(32)  NOT NULL DEFAULT 'active',
      started_at     TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
      renewed_at     TIMESTAMPTZ,
      cancelled_at   TIMESTAMPTZ,
      stripe_sub_id  VARCHAR(128),
      notes          TEXT,
      created_at     TIMESTAMPTZ  NOT NULL DEFAULT NOW()
    );

    CREATE INDEX IF NOT EXISTS idx_subs_tenant  ON subscriptions(tenant_id);
    CREATE INDEX IF NOT EXISTS idx_subs_phone   ON subscriptions(client_phone);
    CREATE INDEX IF NOT EXISTS idx_subs_status  ON subscriptions(status);
  `);
  bus.system('[SUBS] Table subscriptions initialisée ✓');
}

/**
 * Crée un nouvel abonnement.
 * @param {object} opts
 */
async function createSubscription({ tenantId = 'kadio', clientName, clientPhone, clientEmail, planId, notes, stripeSubId }) {
  const plan = getPlanWithTaxes(planId);

  const entry = {
    tenantId,
    clientName,
    clientPhone,
    clientEmail: clientEmail || null,
    planId:      plan.id,
    planName:    plan.name,
    priceHT:     plan.priceMonthly,
    priceTPS:    plan.taxes.tps,
    priceTVQ:    plan.taxes.tvq,
    priceTTC:    plan.taxes.total,
    stripeSubId: stripeSubId || null,
    notes:       notes || null,
  };

  if (DEMO_MODE || !pool) {
    bus.system(`[SUBS DEMO] Nouvel abonnement ${plan.name} pour ${clientName} — ${plan.priceLabel}`);
    return { ...entry, id: Math.floor(Math.random() * 10000), status: 'active', demo: true };
  }

  await initSubscriptionsTable();

  const r = await pool.query(`
    INSERT INTO subscriptions
      (tenant_id, client_name, client_phone, client_email, plan_id, plan_name,
       price_ht, price_tps, price_tvq, price_ttc, stripe_sub_id, notes)
    VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
    RETURNING *
  `, [
    tenantId, clientName, clientPhone, clientEmail,
    plan.id, plan.name,
    plan.priceMonthly, plan.taxes.tps, plan.taxes.tvq, plan.taxes.total,
    stripeSubId, notes,
  ]);

  bus.system(`[SUBS] Nouvel abonnement ${plan.name} pour ${clientName}`);
  return r.rows[0];
}

/**
 * Liste les abonnements actifs d'un tenant.
 */
async function getActiveSubscriptions(tenantId = 'kadio') {
  if (DEMO_MODE || !pool) {
    return { subscriptions: [], count: 0, demo: true };
  }
  const r = await pool.query(
    `SELECT * FROM subscriptions WHERE tenant_id=$1 AND status='active' ORDER BY started_at DESC`,
    [tenantId]
  );
  return { subscriptions: r.rows, count: r.rows.length };
}

/**
 * Annule un abonnement.
 */
async function cancelSubscription(subscriptionId, tenantId = 'kadio') {
  if (DEMO_MODE || !pool) {
    return { success: true, demo: true };
  }
  await pool.query(
    `UPDATE subscriptions SET status='cancelled', cancelled_at=NOW()
     WHERE id=$1 AND tenant_id=$2`,
    [subscriptionId, tenantId]
  );
  bus.system(`[SUBS] Abonnement #${subscriptionId} annulé`);
  return { success: true, subscriptionId, status: 'cancelled' };
}

/**
 * Statistiques abonnements pour le HUD.
 */
async function getSubscriptionStats(tenantId = 'kadio') {
  if (DEMO_MODE || !pool) {
    return {
      totalActive:  0,
      mrr_ht:       0,
      mrr_ttc:      0,
      byPlan:       {},
      demo:         true,
    };
  }
  const r = await pool.query(`
    SELECT
      COUNT(*)::int                                       AS total_active,
      SUM(price_ht)::numeric                             AS mrr_ht,
      SUM(price_ttc)::numeric                            AS mrr_ttc,
      json_object_agg(plan_id, cnt) AS by_plan
    FROM (
      SELECT plan_id, COUNT(*)::int AS cnt, SUM(price_ht) AS price_ht, SUM(price_ttc) AS price_ttc
      FROM subscriptions
      WHERE tenant_id=$1 AND status='active'
      GROUP BY plan_id
    ) sub
  `, [tenantId]);

  const row = r.rows[0] || {};
  return {
    totalActive: row.total_active || 0,
    mrr_ht:      parseFloat(row.mrr_ht  || 0).toFixed(2),
    mrr_ttc:     parseFloat(row.mrr_ttc || 0).toFixed(2),
    byPlan:      row.by_plan || {},
  };
}

module.exports = {
  PLANS,
  calculateTaxes,
  getAllPlansWithTaxes,
  getPlanWithTaxes,
  getAnnualCost,
  initSubscriptionsTable,
  createSubscription,
  getActiveSubscriptions,
  cancelSubscription,
  getSubscriptionStats,
};
