/**
 * DALEBA — Commander Alerts (Alertes Prioritaires pour Ulrich)
 * Détecte événements critiques Square → WhatsApp/SMS Ulrich
 * Seuils: annulation last-minute, gros paiement, baisse CA hebdo
 */

const bus = require('./event-bus');

// Numéro WhatsApp personnel d'Ulrich (variable Railway)
// Ex: ULRICH_WHATSAPP=+15141234567
const ULRICH_PHONE = process.env.ULRICH_PHONE_NUMBER || process.env.ULRICH_WHATSAPP;

// Seuils d'alerte
const THRESHOLDS = {
  BIG_PAYMENT_CAD:      150,   // Paiement > 150$ → alerte
  REVENUE_DROP_PCT:      25,   // Baisse CA hebdo > 25% → alerte
  CANCELLATION_HOURS:     2,   // Annulation < 2h avant → alerte
  INACTIVITY_ALERT_DAYS: 45,   // Aucun paiement depuis 45j → alerte
};

// Anti-spam: cooldown persistant en base PostgreSQL (Railway /tmp est éphémère — ne jamais utiliser)
// FIX CRITIQUE [2026-05-19]: /tmp est purgé à chaque restart Railway → spam garanti si fichier
// Solution: table daleba_alert_cooldowns en PostgreSQL (seul stockage persistant sur Railway)
const COOLDOWN_MS_BY_TYPE = {
  BAISSE_CA:             24 * 60 * 60 * 1000, // 24h — comparaison hebdo
  GROS_PAIEMENT:          1 * 60 * 60 * 1000, // 1h
  ANNULATION_DERNIERE_MINUTE: 30 * 60 * 1000, // 30min
  DEFAULT:                1 * 60 * 60 * 1000, // 1h
};

// ─── COOLDOWNS DB-PERSISTANTS (PostgreSQL — survit aux restarts Railway) ────────
// In-memory fallback si la DB n'est pas encore disponible au boot
const _memCooldowns = {};

async function _initCooldownTable(pool) {
  if (!pool?.query) return;
  await pool.query(`
    CREATE TABLE IF NOT EXISTS daleba_alert_cooldowns (
      alert_type TEXT PRIMARY KEY,
      last_sent  BIGINT NOT NULL DEFAULT 0
    )
  `).catch(() => {});
}

async function canAlertDB(type, pool) {
  const windowMs = COOLDOWN_MS_BY_TYPE[type] || COOLDOWN_MS_BY_TYPE.DEFAULT;
  const now = Date.now();
  try {
    if (pool?.query) {
      await _initCooldownTable(pool);
      const r = await pool.query(
        `SELECT last_sent FROM daleba_alert_cooldowns WHERE alert_type=$1`,
        [type]
      );
      const last = r.rows[0] ? parseInt(r.rows[0].last_sent) : 0;
      if (now - last < windowMs) return false;
      await pool.query(
        `INSERT INTO daleba_alert_cooldowns (alert_type, last_sent) VALUES ($1,$2)
         ON CONFLICT (alert_type) DO UPDATE SET last_sent=$2`,
        [type, now]
      );
      return true;
    }
  } catch (e) {
    bus.system(`[ALERT] DB cooldown indisponible, fallback mémoire: ${e.message}`);
  }
  // Fallback mémoire si DB down
  const last = _memCooldowns[type] || 0;
  if (now - last < windowMs) return false;
  _memCooldowns[type] = now;
  return true;
}

// Compatibilité sync pour appels sans pool (legacy) — utilise fallback mémoire
function canAlert(type) {
  const windowMs = COOLDOWN_MS_BY_TYPE[type] || COOLDOWN_MS_BY_TYPE.DEFAULT;
  const now = Date.now();
  const last = _memCooldowns[type] || 0;
  if (now - last < windowMs) return false;
  _memCooldowns[type] = now;
  return true;
}

// ─── ENVOI D'ALERTE ───────────────────────────────────────────────────────────

/**
 * Envoie une alerte WhatsApp/SMS à Ulrich
 * @param {string} type    — identifiant du type d'alerte
 * @param {string} emoji   — émoji d'urgence
 * @param {string} message — corps du message
 */
async function sendCommanderAlert(type, emoji, message) {
  if (!ULRICH_PHONE) {
    bus.system(`[ALERT] ${emoji} ${type}: ${message.slice(0, 80)} (ULRICH_PHONE_NUMBER non configuré)`);
    return { sent: false, reason: 'ULRICH_PHONE_NUMBER manquant' };
  }

  if (!canAlert(type)) {
    return { sent: false, reason: 'cooldown' };
  }

  const fullMsg = `${emoji} *DALEBA ALERT — ${type}*\n\n${message}\n\n_${new Date().toLocaleString('fr-CA', { timeZone: 'America/Toronto' })}_`;

  bus.emit('system', `[ALERT→Ulrich] ${emoji} ${type}: ${message.slice(0, 60)}`);

  try {
    const twilio = require('./twilio');
    // WhatsApp en priorité
    const waPhone = `whatsapp:${ULRICH_PHONE}`;
    try {
      await twilio.sendSMS(waPhone, fullMsg);
      return { sent: true, channel: 'whatsapp' };
    } catch (_) {
      // Fallback SMS
      await twilio.sendSMS(ULRICH_PHONE, fullMsg);
      return { sent: true, channel: 'sms' };
    }
  } catch (err) {
    bus.emit('error', `[ALERT] Envoi échoué: ${err.message}`);
    return { sent: false, error: err.message };
  }
}

// ─── DÉTECTEURS D'ÉVÉNEMENTS CRITIQUES ───────────────────────────────────────

/**
 * Vérifie les paiements Square de la dernière heure pour gros montants
 */
async function checkBigPayments() {
  try {
    const square = require('./square');
    const since = new Date(Date.now() - 60 * 60 * 1000).toISOString();
    const { payments = [] } = await square.getPayments(since, new Date().toISOString());

    for (const p of payments) {
      if (p.status !== 'COMPLETED') continue;
      const amountCAD = (p.amount_money?.amount || 0) / 100;
      if (amountCAD >= THRESHOLDS.BIG_PAYMENT_CAD) {
        await sendCommanderAlert(
          'GROS_PAIEMENT',
          '💰',
          `Paiement exceptionnel reçu: *${amountCAD.toFixed(2)} CAD*\nClient: ${p.buyer_email_address || 'N/A'}\nNote: ${p.note || 'Sans note'}`
        );
      }
    }
  } catch (_) {}
}

/**
 * Vérifie les bookings Square pour annulations de dernière minute
 */
async function checkLastMinuteCancellations() {
  try {
    const square = require('./square');
    const since = new Date(Date.now() - 30 * 60 * 1000).toISOString(); // dernières 30 min
    const { bookings = [] } = await square.getBookings(since, new Date().toISOString());

    for (const b of bookings) {
      if (b.status !== 'CANCELLED_BY_CUSTOMER' && b.status !== 'CANCELLED_BY_SELLER') continue;

      const startAt = b.start_at ? new Date(b.start_at) : null;
      if (!startAt) continue;

      const hoursUntilAppt = (startAt - Date.now()) / (1000 * 60 * 60);
      if (hoursUntilAppt > 0 && hoursUntilAppt <= THRESHOLDS.CANCELLATION_HOURS) {
        const service = b.appointment_segments?.[0]?.service_variation_id || 'Service';
        await sendCommanderAlert(
          'ANNULATION_DERNIERE_MINUTE',
          '🚨',
          `Annulation < ${THRESHOLDS.CANCELLATION_HOURS}h!\nRDV prévu: ${startAt.toLocaleString('fr-CA', { timeZone: 'America/Toronto' })}\nService: ${service}\nAction: créneau libre à remplir rapidement.`
        );
      }
    }
  } catch (_) {}
}

/**
 * Compare le CA hebdo actuel vs semaine précédente (alerte si baisse > seuil)
 */
async function checkWeeklyRevenueAlert() {
  try {
    const square = require('./square');
    const now = new Date();

    // Semaine actuelle
    const weekStart = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
    const { payments: currentPayments = [] } = await square.getPayments(weekStart.toISOString(), now.toISOString());
    const currentCA = currentPayments
      .filter(p => p.status === 'COMPLETED')
      .reduce((s, p) => s + (p.amount_money?.amount || 0), 0) / 100;

    // Semaine précédente
    const prevEnd = weekStart;
    const prevStart = new Date(prevEnd.getTime() - 7 * 24 * 60 * 60 * 1000);
    const { payments: prevPayments = [] } = await square.getPayments(prevStart.toISOString(), prevEnd.toISOString());
    const prevCA = prevPayments
      .filter(p => p.status === 'COMPLETED')
      .reduce((s, p) => s + (p.amount_money?.amount || 0), 0) / 100;

    if (prevCA > 0) {
      const dropPct = ((prevCA - currentCA) / prevCA) * 100;
      if (dropPct >= THRESHOLDS.REVENUE_DROP_PCT) {
        // ⛔ BAISSE_CA SMS DÉSACTIVÉ [FIX 2026-05-19] — spam boucle Railway
        // La métrique est loguée dans le bus et visible dans le HUD uniquement.
        // Réactiver après revue de code avec Ulrich.
        bus.system(`[ALERT-HUD-ONLY] 📉 BAISSE_CA ${dropPct.toFixed(1)}% — SMS neutralisé (visible HUD)`);
        // await sendCommanderAlert('BAISSE_CA', '📉', `...`); // NEUTRALISÉ
      }
    }
  } catch (_) {}
}

// ─── SCAN COMPLET (appelé périodiquement) ─────────────────────────────────────

/**
 * Lance tous les checks — appelé depuis auto-scheduler toutes les heures
 */
async function runAllAlertChecks() {
  await Promise.allSettled([
    checkBigPayments(),
    checkLastMinuteCancellations(),
    checkWeeklyRevenueAlert(),
  ]);
}

/**
 * Test manuel: envoie une alerte de test à Ulrich
 */
async function sendTestAlert() {
  return sendCommanderAlert(
    'TEST',
    '🧪',
    `DALEBA Commander Alerts opérationnel ✅\nSeuils actifs:\n• Gros paiement: > ${THRESHOLDS.BIG_PAYMENT_CAD} CAD\n• Annulation last-minute: < ${THRESHOLDS.CANCELLATION_HOURS}h\n• Baisse CA: > ${THRESHOLDS.REVENUE_DROP_PCT}%\nNuméro configuré: ${ULRICH_PHONE || 'NON CONFIGURÉ'}`
  );
}

module.exports = {
  sendCommanderAlert,
  runAllAlertChecks,
  sendTestAlert,
  checkBigPayments,
  checkLastMinuteCancellations,
  checkWeeklyRevenueAlert,
  THRESHOLDS,
};
