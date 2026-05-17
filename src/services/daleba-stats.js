/**
 * DALEBA — Agrégateur de Stats (HUD Zenith)
 * Retourne un snapshot temps réel de l'activité du salon + système
 */

const { pool, DEMO_MODE } = require('../memory/db');

// Compteurs in-memory (incrémentés par les routes)
const counters = {
  smsSent: 0,
  whatsappSent: 0,
  chatRequests: 0,
  bookingsMade: 0,
  sessionsActive: new Set(),
};

function incrementSMS()     { counters.smsSent++; }
function incrementChat(sid) { counters.chatRequests++; if (sid) counters.sessionsActive.add(sid); }
function incrementBooking() { counters.bookingsMade++; }

/**
 * Snapshot complet pour le HUD Zenith
 * GET /api/stats
 */
async function getZenithStats() {
  const now = new Date();
  const todayStr = now.toISOString().slice(0, 10);

  const snapshot = {
    // Système
    status: 'online',
    version: 'STABLE',
    uptime: Math.floor(process.uptime()),
    timestamp: now.toISOString(),
    // Activité
    smsSent: counters.smsSent,
    chatRequests: counters.chatRequests,
    activeSessions: counters.sessionsActive.size,
    bookingsMade: counters.bookingsMade,
    // Salon (défauts démo)
    activeClients: 0,
    todayRdv: 0,
    nextSlot: null,
    weekRevenue: 0,
    // Finance placeholder
    portfolioValue: null,
    btcPrice: null,
  };

  if (DEMO_MODE) {
    // Démo: valeurs simulées réalistes
    const hour = now.getHours();
    snapshot.activeClients = hour >= 9 && hour <= 19 ? Math.floor(Math.random() * 4) + 1 : 0;
    snapshot.todayRdv = 3 + Math.floor(Math.random() * 5);
    snapshot.nextSlot = hour < 18 ? `${(hour + 1).toString().padStart(2,'0')}:30` : '09:00 demain';
    snapshot.weekRevenue = 1240 + Math.floor(Math.random() * 300);
    return snapshot;
  }

  try {
    // RDV aujourd'hui
    const apptRes = await pool.query(`
      SELECT COUNT(*) as total,
        MIN(start_time) FILTER (WHERE start_time > NOW()) as next_slot
      FROM appointments
      WHERE DATE(start_time) = $1
        AND status NOT IN ('cancelled', 'no_show')
    `, [todayStr]);

    snapshot.todayRdv = parseInt(apptRes.rows[0]?.total || 0);
    const nextSlotRaw = apptRes.rows[0]?.next_slot;
    if (nextSlotRaw) {
      snapshot.nextSlot = new Date(nextSlotRaw).toLocaleTimeString('fr-CA', {
        hour: '2-digit', minute: '2-digit', timeZone: 'America/Toronto'
      });
    }

    // Clients actifs (sessions créées dans les 30 dernières minutes)
    const sessRes = await pool.query(`
      SELECT COUNT(DISTINCT session_id) as active
      FROM daleba_memory
      WHERE created_at > NOW() - INTERVAL '30 minutes'
    `);
    snapshot.activeClients = parseInt(sessRes.rows[0]?.active || 0);

    // Revenus semaine
    try {
      const revRes = await pool.query(`
        SELECT COALESCE(SUM(amount), 0) as total
        FROM payments
        WHERE created_at > NOW() - INTERVAL '7 days'
          AND status = 'completed'
      `);
      snapshot.weekRevenue = parseFloat(revRes.rows[0]?.total || 0).toFixed(2);
    } catch (_) {}

  } catch (err) {
    console.error('[stats]', err.message);
  }

  return snapshot;
}

/**
 * Série temporelle pour les graphiques (24h)
 * Retourne des points (timestamp, value) pour chaque métrique
 */
async function getFinancialTimeSeries() {
  if (DEMO_MODE) {
    // Génère une série réaliste de 24 points (1 par heure)
    const points = [];
    const now = Date.now();
    for (let i = 23; i >= 0; i--) {
      const ts = new Date(now - i * 3600000).toISOString();
      const hour = new Date(ts).getHours();
      const isOpen = hour >= 9 && hour <= 19;
      points.push({
        ts,
        revenue: isOpen ? 80 + Math.random() * 120 : 0,
        bookings: isOpen ? Math.floor(Math.random() * 3) : 0,
        smsOut: Math.floor(Math.random() * 5),
      });
    }
    return { points, currency: 'CAD', period: '24h' };
  }

  try {
    const res = await pool.query(`
      SELECT
        date_trunc('hour', created_at) as hour,
        COALESCE(SUM(amount), 0) as revenue,
        COUNT(*) as bookings
      FROM payments
      WHERE created_at > NOW() - INTERVAL '24 hours'
        AND status = 'completed'
      GROUP BY hour
      ORDER BY hour ASC
    `);
    return {
      points: res.rows.map(r => ({
        ts: r.hour,
        revenue: parseFloat(r.revenue),
        bookings: parseInt(r.bookings),
      })),
      currency: 'CAD',
      period: '24h',
    };
  } catch (err) {
    return { points: [], error: err.message };
  }
}

/**
 * Projections mensuelles basées sur la semaine en cours
 */
async function getProjections() {
  if (DEMO_MODE) {
    const weekRev = 1240 + Math.floor(Math.random() * 300);
    return {
      weekRevenue: weekRev,
      monthProjection: +(weekRev * 4.33).toFixed(2),
      yearProjection: +(weekRev * 52).toFixed(2),
      currency: 'CAD',
      confidence: 'demo',
    };
  }

  try {
    const res = await pool.query(`
      SELECT COALESCE(SUM(amount), 0) as week_revenue
      FROM payments
      WHERE created_at > NOW() - INTERVAL '7 days'
        AND status = 'completed'
    `);
    const weekRev = parseFloat(res.rows[0]?.week_revenue || 0);
    return {
      weekRevenue: +weekRev.toFixed(2),
      monthProjection: +(weekRev * 4.33).toFixed(2),
      yearProjection: +(weekRev * 52).toFixed(2),
      currency: 'CAD',
      confidence: 'live',
    };
  } catch (err) {
    return { error: err.message };
  }
}

module.exports = {
  getZenithStats,
  getFinancialTimeSeries,
  getProjections,
  incrementSMS,
  incrementChat,
  incrementBooking,
  counters,
};
