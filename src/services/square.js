/**
 * DALEBA — Square Integration (Appointments, Catalog, Customers)
 * Variables requises: SQUARE_ACCESS_TOKEN, SQUARE_LOCATION_ID
 * Docs: https://developer.squareup.com/docs
 */

const bus = require('./event-bus');

// const SQUARE_BASE = 'https://connect.squareupstaging.com'; // sandbox
const SQUARE_BASE = 'https://connect.squareup.com'; // production ✅

const SQUARE_TOKEN = process.env.SQUARE_ACCESS_TOKEN;
const LOCATION_ID  = process.env.SQUARE_LOCATION_ID;

function squareHeaders() {
  if (!SQUARE_TOKEN) throw new Error('SQUARE_ACCESS_TOKEN manquant dans .env');
  return {
    'Authorization': `Bearer ${SQUARE_TOKEN}`,
    'Content-Type': 'application/json',
    'Square-Version': '2024-02-22',
  };
}

// ─── APPOINTMENTS ──────────────────────────────────────────────────────────

/**
 * Récupère les rendez-vous Square sur une plage de dates
 * @param {string} startAt  ISO-8601 (ex: "2024-05-01T00:00:00Z")
 * @param {string} endAt    ISO-8601
 */
async function getBookings(startAt, endAt) {
  if (!SQUARE_TOKEN) return { bookings: [], demo: true };
  const params = new URLSearchParams();
  if (LOCATION_ID) params.set('location_id', LOCATION_ID);
  if (startAt)     params.set('start_at_min', startAt);
  if (endAt)       params.set('start_at_max', endAt);
  params.set('limit', '200');

  const res = await fetch(`${SQUARE_BASE}/v2/bookings?${params}`, { headers: squareHeaders() });
  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Square Bookings [${res.status}]: ${err.slice(0, 120)}`);
  }
  const data = await res.json();
  return data;
}

/**
 * Calcule les stats de no-show à partir des bookings
 */
function computeBookingStats(bookings = []) {
  const total     = bookings.length;
  const completed = bookings.filter(b => b.status === 'COMPLETED').length;
  const cancelled = bookings.filter(b => b.status === 'CANCELLED_BY_CUSTOMER' || b.status === 'CANCELLED_BY_SELLER').length;
  const noShow    = bookings.filter(b => b.status === 'NO_SHOW').length;
  return {
    total,
    completed,
    cancelled,
    noShow,
    noShowRate: total > 0 ? +((noShow / total) * 100).toFixed(1) : 0,
    completionRate: total > 0 ? +((completed / total) * 100).toFixed(1) : 0,
  };
}

// ─── CATALOG ────────────────────────────────────────────────────────────────

/**
 * Récupère tous les services/produits du catalogue Square
 */
async function getCatalogItems(types = 'ITEM,ITEM_VARIATION') {
  if (!SQUARE_TOKEN) return { objects: [], demo: true };
  const params = new URLSearchParams({ types });

  const res = await fetch(`${SQUARE_BASE}/v2/catalog/list?${params}`, { headers: squareHeaders() });
  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Square Catalog [${res.status}]: ${err.slice(0, 120)}`);
  }
  return res.json();
}

/**
 * Récupère les abonnements actifs depuis le catalogue Square
 */
async function getSubscriptionPlans() {
  if (!SQUARE_TOKEN) return { objects: [], demo: true };
  const params = new URLSearchParams({ types: 'SUBSCRIPTION_PLAN,SUBSCRIPTION_PLAN_VARIATION' });

  const res = await fetch(`${SQUARE_BASE}/v2/catalog/list?${params}`, { headers: squareHeaders() });
  if (!res.ok) return { objects: [] };
  return res.json();
}

// ─── CUSTOMERS ──────────────────────────────────────────────────────────────

/**
 * Récupère les clients Square (pagination automatique jusqu'à limit)
 */
async function getCustomers(limit = 100) {
  if (!SQUARE_TOKEN) return { customers: [], demo: true };
  const params = new URLSearchParams({ limit: Math.min(limit, 200) });

  const res = await fetch(`${SQUARE_BASE}/v2/customers?${params}`, { headers: squareHeaders() });
  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Square Customers [${res.status}]: ${err.slice(0, 120)}`);
  }
  return res.json();
}

// ─── PAYMENTS / REVENUE ─────────────────────────────────────────────────────

/**
 * Récupère les paiements Square sur une plage de dates
 * @param {string} beginTime  ISO-8601
 * @param {string} endTime    ISO-8601
 */
async function getPayments(beginTime, endTime) {
  if (!SQUARE_TOKEN) return { payments: [], demo: true };
  const params = new URLSearchParams({ sort_order: 'DESC', limit: '200' });
  if (LOCATION_ID) params.set('location_id', LOCATION_ID);
  if (beginTime)   params.set('begin_time', beginTime);
  if (endTime)     params.set('end_time', endTime);

  const res = await fetch(`${SQUARE_BASE}/v2/payments?${params}`, { headers: squareHeaders() });
  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Square Payments [${res.status}]: ${err.slice(0, 120)}`);
  }
  return res.json();
}

/**
 * Agrège le CA par service/note à partir des paiements
 * Les paiements Square retournent `note` (nom du service dans les intégrations booking)
 */
function aggregateRevenue(payments = []) {
  let totalCents = 0;
  const byService = {};

  for (const p of payments) {
    if (p.status !== 'COMPLETED') continue;
    const amount = p.amount_money?.amount || 0;
    totalCents += amount;

    const service = p.note || p.order_id || 'Service';
    byService[service] = (byService[service] || 0) + amount;
  }

  // Convertit les cents en dollars CAD
  const toCAD = c => +(c / 100).toFixed(2);
  const byServiceCAD = {};
  for (const [k, v] of Object.entries(byService)) byServiceCAD[k] = toCAD(v);

  return {
    totalCAD: toCAD(totalCents),
    byService: byServiceCAD,
    topServices: Object.entries(byServiceCAD)
      .sort(([, a], [, b]) => b - a)
      .slice(0, 5)
      .map(([service, revenue]) => ({ service, revenue })),
  };
}

// ─── TEAM / STAFF ───────────────────────────────────────────────────────────

/**
 * Récupère les membres de l'équipe
 */
async function getTeamMembers() {
  if (!SQUARE_TOKEN) return { team_members: [], demo: true };
  const body = JSON.stringify({ query: { filter: { location_ids: LOCATION_ID ? [LOCATION_ID] : [] } } });

  const res = await fetch(`${SQUARE_BASE}/v2/team-members/search`, {
    method: 'POST',
    headers: squareHeaders(),
    body,
  });
  if (!res.ok) return { team_members: [] };
  return res.json();
}

// ─── RAPPORT AUDIT COMPLET ──────────────────────────────────────────────────

/**
 * Rapport financier hebdomadaire complet depuis Square
 * Utilisé par /api/finance/audit
 */
async function getSquareWeeklyAudit() {
  const now = new Date();
  const weekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
  const startAt = weekAgo.toISOString();
  const endAt   = now.toISOString();

  const errors = [];

  // ── Bookings ──
  let bookingStats = { total: 0, completed: 0, cancelled: 0, noShow: 0, noShowRate: 0, completionRate: 0 };
  try {
    const { bookings = [] } = await getBookings(startAt, endAt);
    bookingStats = computeBookingStats(bookings);
    bus.finance(`Square: ${bookings.length} RDV cette semaine (no-show ${bookingStats.noShowRate}%)`);
  } catch (err) {
    errors.push(`bookings: ${err.message}`);
  }

  // ── Paiements ──
  let revenueData = { totalCAD: 0, byService: {}, topServices: [] };
  try {
    const { payments = [] } = await getPayments(startAt, endAt);
    revenueData = aggregateRevenue(payments);
    bus.finance(`Square: CA semaine = ${revenueData.totalCAD} CAD`);
  } catch (err) {
    errors.push(`payments: ${err.message}`);
  }

  // ── Abonnements actifs ──
  let subscriptionCount = 0;
  try {
    const { objects = [] } = await getSubscriptionPlans();
    subscriptionCount = objects.length;
  } catch (err) {
    errors.push(`subscriptions: ${err.message}`);
  }

  return {
    source: 'square',
    period: { from: startAt.slice(0, 10), to: endAt.slice(0, 10) },
    revenue: {
      total: revenueData.totalCAD,
      byService: revenueData.byService,
      currency: 'CAD',
    },
    appointments: bookingStats,
    topServices: revenueData.topServices,
    activeSubscriptions: subscriptionCount,
    projection: {
      month: +(revenueData.totalCAD * 4).toFixed(2),
      method: 'weekly_average_x4',
    },
    generatedAt: now.toISOString(),
    errors: errors.length > 0 ? errors : undefined,
  };
}

module.exports = {
  getBookings,
  getPayments,
  getCatalogItems,
  getSubscriptionPlans,
  getCustomers,
  getTeamMembers,
  computeBookingStats,
  aggregateRevenue,
  getSquareWeeklyAudit,
};
