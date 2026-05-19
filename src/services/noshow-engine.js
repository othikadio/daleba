/**
 * No-Show Engine — DALEBA Metacortex Points 179-180
 *
 * [179] Taux annulation + no-show → Lost Opportunity Cost
 * [180] 2+ no-shows → dépôt garantie 50% obligatoire (Square customer profile)
 */

'use strict';

const bus = require('./event-bus');

// ─── CONSTANTES ───────────────────────────────────────────────────────────────

const NOSHOW_DEPOSIT_THRESHOLD = 2;   // [180] nombre de no-shows avant dépôt
const DEPOSIT_PERCENT          = 50;  // % du prix du service

// ─── ANALYSE NO-SHOWS SQUARE [179] ───────────────────────────────────────────

async function analyzeNoShows(tenantId = 'kadio', days = 30) {
  const square = (() => { try { return require('./square'); } catch { return null; } })();
  if (!square) return { error: 'Square non disponible' };

  const startAt = new Date(Date.now() - days * 86400000).toISOString();
  const endAt   = new Date().toISOString();

  // Récupérer les rendez-vous annulés / no-show depuis Square
  let appointments = [];
  try {
    const bookings = await square.listBookings({ startAt, endAt, limit: 200 }).catch(() => null);
    appointments = bookings?.bookings || [];
  } catch (e) {
    return { error: `Square listBookings: ${e.message}` };
  }

  const noShows     = appointments.filter(a => a.status === 'NO_SHOW');
  const cancelled   = appointments.filter(a => a.status === 'CANCELLED_BY_CUSTOMER');
  const total       = appointments.length;
  const completed   = appointments.filter(a => a.status === 'COMPLETED');

  // Taux
  const noShowRate   = total > 0 ? Math.round((noShows.length / total) * 10000) / 100 : 0;
  const cancelRate   = total > 0 ? Math.round((cancelled.length / total) * 10000) / 100 : 0;

  // [179] Lost Opportunity Cost — estimer depuis le panier moyen
  const maintenance = require('./maintenance');
  const pool = maintenance.getPool();
  let avgServicePrice = 0;
  if (pool) {
    const r = await pool.query(`
      SELECT AVG(amount_net) AS avg_net FROM tenant_ledgers
      WHERE tenant_id = $1 AND sale_type = 'service'
        AND timestamp_utc >= $2 AND refunded = FALSE
    `, [tenantId, startAt]).catch(() => ({ rows: [{}] }));
    avgServicePrice = parseFloat(r.rows[0]?.avg_net || 0);
  }

  const lostOpportunityCost = Math.round((noShows.length + cancelled.length * 0.3) * avgServicePrice * 100) / 100;

  // Grouper no-shows par client
  const noShowByCustomer = {};
  for (const appt of noShows) {
    const cid = appt.customer_id;
    if (!cid) continue;
    noShowByCustomer[cid] = (noShowByCustomer[cid] || 0) + 1;
  }

  // [180] Identifier clients > seuil
  const flaggedCustomers = Object.entries(noShowByCustomer)
    .filter(([, count]) => count >= NOSHOW_DEPOSIT_THRESHOLD)
    .map(([customerId, count]) => ({ customerId, noShowCount: count }));

  const result = {
    tenantId, period: { days, startAt, endAt },
    stats: {
      total, completed: completed.length, noShows: noShows.length,
      cancelled: cancelled.length, noShowRate, cancelRate,
    },
    lostOpportunityCost,
    avgServicePrice,
    flaggedCustomers,
    flaggedCount: flaggedCustomers.length,
  };

  if (flaggedCustomers.length > 0) {
    bus.system(`⚠️ No-shows: ${flaggedCustomers.length} client(s) avec ≥${NOSHOW_DEPOSIT_THRESHOLD} no-shows — Dépôt 50% à activer`);
    // Appliquer dépôt automatiquement [180]
    for (const { customerId } of flaggedCustomers) {
      await requireDepositForCustomer(customerId, avgServicePrice, tenantId).catch(() => {});
    }
  }

  return result;
}

// ─── [180] EXIGER DÉPÔT 50% ──────────────────────────────────────────────────

async function requireDepositForCustomer(customerId, avgPrice, tenantId = 'kadio') {
  const square = (() => { try { return require('./square'); } catch { return null; } })();
  if (!square) return { error: 'Square non disponible' };

  const depositAmount = Math.round(avgPrice * (DEPOSIT_PERCENT / 100) * 100) / 100;

  try {
    // Mettre à jour le profil client Square avec une note sur le dépôt requis
    // Square ne supporte pas nativement les dépôts obligatoires par client,
    // donc on passe par le champ `note` du profil
    await square.updateCustomer(customerId, {
      note: `⚠️ DÉPÔT OBLIGATOIRE: Ce client a accumulé plusieurs no-shows. Un dépôt de ${DEPOSIT_PERCENT}% (≈$${depositAmount}) est requis lors de la prochaine réservation. — DALEBA AUTO`,
      reference_id: `noshow_deposit_${tenantId}`,
    });

    // Enregistrer dans daleba_notes
    const maintenance = require('./maintenance');
    const pool = maintenance.getPool();
    if (pool) {
      await pool.query(`
        INSERT INTO daleba_notes (category, key, content, created_at)
        VALUES ('noshow_deposit', $1, $2, NOW())
        ON CONFLICT (category, key) DO UPDATE SET content = EXCLUDED.content, created_at = NOW()
      `, [
        `deposit_${customerId}`,
        JSON.stringify({ customerId, tenantId, depositAmount, depositPct: DEPOSIT_PERCENT, setAt: new Date().toISOString() }),
      ]).catch(() => {});
    }

    bus.system(`[NoShow] Dépôt ${DEPOSIT_PERCENT}% ($${depositAmount}) activé pour client ${customerId.slice(-6)}…`);
    return { success: true, customerId, depositAmount };

  } catch (e) {
    console.warn('[NoShow] updateCustomer:', e.message);
    return { error: e.message };
  }
}

// ─── EXPORTS ─────────────────────────────────────────────────────────────────

module.exports = {
  analyzeNoShows, requireDepositForCustomer,
  NOSHOW_DEPOSIT_THRESHOLD, DEPOSIT_PERCENT,
};
