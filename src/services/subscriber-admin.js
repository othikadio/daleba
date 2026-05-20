/**
 * DALEBA — Service Admin Abonnés
 * Section 16 — Interface admin pour gestion des abonnés
 */

'use strict';

const { pool } = require('../memory/db');
const bus = require('./event-bus');

const LOG = '[SUBSCRIBER-ADMIN]';

// ─── LISTE ABONNÉS ────────────────────────────────────────────────────────────

/**
 * Liste tous les abonnés avec filtres optionnels
 * @param {object} filters — { status, forfait, search }
 */
async function listAllSubscribers(filters = {}) {
  const { status, forfait, search } = filters;

  let query = `
    SELECT
      s.id,
      s.client_phone,
      s.client_name,
      s.forfait_id,
      s.status,
      s.start_date,
      s.end_date,
      s.billing_cycle,
      s.price_paid,
      s.created_at,
      COUNT(DISTINCT u.id) AS usage_count,
      MAX(u.used_at) AS last_visit
    FROM subscriptions s
    LEFT JOIN subscription_usage u ON u.subscription_id = s.id
    WHERE 1=1
  `;
  const params = [];
  let idx = 1;

  if (status) {
    query += ` AND s.status = $${idx++}`;
    params.push(status);
  }
  if (forfait) {
    query += ` AND s.forfait_id = $${idx++}`;
    params.push(forfait);
  }
  if (search) {
    query += ` AND (s.client_name ILIKE $${idx} OR s.client_phone ILIKE $${idx})`;
    params.push(`%${search}%`);
    idx++;
  }

  query += ` GROUP BY s.id ORDER BY s.created_at DESC LIMIT 500`;

  try {
    const { rows } = await pool.query(query, params);

    // Grouper par statut
    const grouped = {
      active:    rows.filter(r => r.status === 'active'),
      blocked:   rows.filter(r => r.status === 'blocked'),
      paused:    rows.filter(r => r.status === 'paused'),
      cancelled: rows.filter(r => r.status === 'cancelled'),
      all:       rows,
    };

    return grouped;
  } catch (err) {
    console.error(`${LOG} listAllSubscribers: ${err.message}`);
    // Table inexistante → retourner structure vide
    return { active: [], blocked: [], paused: [], cancelled: [], all: [] };
  }
}

// ─── DÉTAIL ABONNÉ ────────────────────────────────────────────────────────────

/**
 * Historique complet d'un abonné : abonnement + prestations + notes + commissions
 */
async function getSubscriberDetails(phone) {
  try {
    // Abonnement
    const subResult = await pool.query(`
      SELECT * FROM subscriptions WHERE client_phone = $1 ORDER BY created_at DESC LIMIT 1
    `, [phone]);

    if (!subResult.rows.length) {
      return { found: false, phone };
    }

    const subscription = subResult.rows[0];

    // Usages / prestations
    const usageResult = await pool.query(`
      SELECT * FROM subscription_usage
      WHERE subscription_id = $1
      ORDER BY used_at DESC LIMIT 50
    `, [subscription.id]).catch(() => ({ rows: [] }));

    // Notes internes (ratings)
    const ratingsResult = await pool.query(`
      SELECT * FROM daleba_sms_ratings
      WHERE client_phone = $1
      ORDER BY created_at DESC LIMIT 20
    `, [phone]).catch(() => ({ rows: [] }));

    // Commissions liées
    const commissionResult = await pool.query(`
      SELECT * FROM staff_commissions
      WHERE client_phone = $1
      ORDER BY created_at DESC LIMIT 20
    `, [phone]).catch(() => ({ rows: [] }));

    return {
      found: true,
      subscription,
      usages: usageResult.rows,
      ratings: ratingsResult.rows,
      commissions: commissionResult.rows,
      summary: {
        totalVisits: usageResult.rows.length,
        avgStaffRating: ratingsResult.rows.length
          ? (ratingsResult.rows.reduce((a, r) => a + (r.staff_rating || 0), 0) / ratingsResult.rows.length).toFixed(1)
          : null,
        avgSalonRating: ratingsResult.rows.length
          ? (ratingsResult.rows.reduce((a, r) => a + (r.salon_rating || 0), 0) / ratingsResult.rows.length).toFixed(1)
          : null,
      },
    };
  } catch (err) {
    console.error(`${LOG} getSubscriberDetails: ${err.message}`);
    return { found: false, phone, error: err.message };
  }
}

// ─── MISE À JOUR STATUT ───────────────────────────────────────────────────────

/**
 * Met à jour le statut d'un abonné
 * @param {string} phone
 * @param {string} status — 'active' | 'blocked' | 'paused' | 'cancelled'
 * @param {string} reason
 */
async function updateSubscriberStatus(phone, status, reason = '') {
  const allowed = ['active', 'blocked', 'paused', 'cancelled'];
  if (!allowed.includes(status)) {
    throw new Error(`Statut invalide: ${status}. Valeurs: ${allowed.join(', ')}`);
  }

  try {
    const result = await pool.query(`
      UPDATE subscriptions
      SET status = $1, updated_at = NOW()
      WHERE client_phone = $2
      RETURNING id, client_name, client_phone, status
    `, [status, phone]);

    if (!result.rows.length) {
      return { success: false, reason: 'Abonné introuvable' };
    }

    console.log(`${LOG} Statut mis à jour: ${phone} → ${status} (${reason})`);
    bus.system(`${LOG} Abonné ${phone} → ${status}`);

    return { success: true, subscriber: result.rows[0], reason };
  } catch (err) {
    console.error(`${LOG} updateSubscriberStatus: ${err.message}`);
    throw err;
  }
}

// ─── STATISTIQUES ABONNEMENTS ─────────────────────────────────────────────────

/**
 * Stats globales des abonnements
 */
async function getSubscriptionStats() {
  try {
    const [totals, revenueRow, topForfait, newThisMonth] = await Promise.all([
      pool.query(`
        SELECT
          COUNT(*) AS total,
          COUNT(CASE WHEN status = 'active' THEN 1 END) AS active,
          COUNT(CASE WHEN status = 'blocked' THEN 1 END) AS blocked,
          COUNT(CASE WHEN status = 'paused' THEN 1 END) AS paused,
          COUNT(CASE WHEN status = 'cancelled' THEN 1 END) AS cancelled
        FROM subscriptions
      `).catch(() => ({ rows: [{ total: 0, active: 0, blocked: 0, paused: 0, cancelled: 0 }] })),

      pool.query(`
        SELECT COALESCE(SUM(price_paid), 0) AS monthly_revenue
        FROM subscriptions
        WHERE status = 'active' AND billing_cycle = 'monthly'
      `).catch(() => ({ rows: [{ monthly_revenue: 0 }] })),

      pool.query(`
        SELECT forfait_id, COUNT(*) AS cnt
        FROM subscriptions
        WHERE status = 'active'
        GROUP BY forfait_id
        ORDER BY cnt DESC LIMIT 1
      `).catch(() => ({ rows: [] })),

      pool.query(`
        SELECT COUNT(*) AS cnt
        FROM subscriptions
        WHERE created_at >= date_trunc('month', NOW())
      `).catch(() => ({ rows: [{ cnt: 0 }] })),
    ]);

    return {
      total: parseInt(totals.rows[0].total),
      active: parseInt(totals.rows[0].active),
      blocked: parseInt(totals.rows[0].blocked),
      paused: parseInt(totals.rows[0].paused),
      cancelled: parseInt(totals.rows[0].cancelled),
      revenue_monthly: parseFloat(revenueRow.rows[0].monthly_revenue),
      top_forfait: topForfait.rows[0]?.forfait_id || null,
      new_this_month: parseInt(newThisMonth.rows[0].cnt),
    };
  } catch (err) {
    console.error(`${LOG} getSubscriptionStats: ${err.message}`);
    return { total: 0, active: 0, revenue_monthly: 0, top_forfait: null, new_this_month: 0 };
  }
}

// ─── RECHERCHE ────────────────────────────────────────────────────────────────

/**
 * Recherche un abonné par nom ou téléphone
 */
async function searchSubscriber(query) {
  try {
    const { rows } = await pool.query(`
      SELECT id, client_phone, client_name, forfait_id, status, price_paid, created_at
      FROM subscriptions
      WHERE client_name ILIKE $1 OR client_phone ILIKE $1
      ORDER BY created_at DESC LIMIT 20
    `, [`%${query}%`]);
    return rows;
  } catch (err) {
    console.error(`${LOG} searchSubscriber: ${err.message}`);
    return [];
  }
}

module.exports = {
  listAllSubscribers,
  getSubscriberDetails,
  updateSubscriberStatus,
  getSubscriptionStats,
  searchSubscriber,
};
