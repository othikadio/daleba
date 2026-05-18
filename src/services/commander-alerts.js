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

// Anti-spam: une alerte par type par heure max
const alertCooldown = new Map();
const COOLDOWN_MS = 60 * 60 * 1000; // 1 heure

function canAlert(type) {
  const last = alertCooldown.get(type) || 0;
  if (Date.now() - last < COOLDOWN_MS) return false;
  alertCooldown.set(type, Date.now());
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
        await sendCommanderAlert(
          'BAISSE_CA',
          '📉',
          `Baisse de CA détectée cette semaine!\nSemaine actuelle: *${currentCA.toFixed(2)} CAD*\nSemaine précédente: *${prevCA.toFixed(2)} CAD*\nBaisse: *${dropPct.toFixed(1)}%*\nAction recommandée: activer campagne réengagement.`
        );
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
