'use strict';
/**
 * Staff Notifier — DALEBA Metacortex Points 320-322-333
 * [320] SMS/WhatsApp à l'employé lors de changements de RDV
 * [321] Jamais divulguer coordonnées employés aux clients
 * [322] Anonymisation client: prénom + initiale nom uniquement
 * [333] Fallback mode local si Square API déconnectée
 */
const bus = require('./event-bus');

const TWILIO_SID   = process.env.TWILIO_ACCOUNT_SID;
const TWILIO_TOKEN = process.env.TWILIO_AUTH_TOKEN;
const TWILIO_FROM  = process.env.TWILIO_PHONE_NUMBER || '+13022328291';

// [337] Masquer les montants dans les logs
function _maskAmount(str) {
  return str.replace(/\d+\.?\d*\s*(CAD|$)/gi, '[MONTANT MASQUÉ]');
}

/**
 * [322] Anonymise le nom client pour les SMS employés
 * "Marie Tremblay" → "Marie T."
 */
function anonymizeClient(fullName = '') {
  const parts = fullName.trim().split(/\s+/);
  if (parts.length < 2) return parts[0] || 'Client';
  return `${parts[0]} ${parts[parts.length - 1][0]}.`;
}

/**
 * [320] Envoie une notification SMS à un employé
 * @param {object} params
 *   - staffPhone: numéro de l'employé (interne — [321] jamais partagé aux clients)
 *   - staffName:  prénom employé
 *   - eventType:  'NEW' | 'MODIFIED' | 'CANCELLED'
 *   - clientName: nom complet du client (sera anonymisé [322])
 *   - service:    nom du service
 *   - startAt:    Date/ISO string
 */
async function notifyStaff({ staffPhone, staffName, eventType, clientName, service, startAt }) {
  if (!staffPhone) {
    bus.system('[StaffNotifier] ⚠️ Pas de numéro employé — notification ignorée');
    return { sent: false, reason: 'no_phone' };
  }

  const anonClient  = anonymizeClient(clientName);
  const dt          = new Date(startAt);
  const formatted   = dt.toLocaleString('fr-CA', {
    weekday: 'long', day: 'numeric', month: 'long',
    hour: '2-digit', minute: '2-digit',
    timeZone: 'America/Toronto',
  });

  const templates = {
    NEW:       `${staffName}, un nouveau rendez-vous de ${service} a été planifié avec ${anonClient} le ${formatted}.`,
    MODIFIED:  `${staffName}, ton rendez-vous de ${service} avec ${anonClient} a été modifié. Nouvelle heure : ${formatted}.`,
    CANCELLED: `${staffName}, le rendez-vous de ${service} avec ${anonClient} prévu le ${formatted} a été annulé.`,
  };

  const message = templates[eventType] || templates.NEW;
  bus.system(`[StaffNotifier] → ${staffName}: ${eventType} | ${service} | ${anonClient}`);

  // [333] Fallback: si Twilio indisponible, log seulement
  try {
    const twilio = require('twilio');
    if (!TWILIO_SID || !TWILIO_TOKEN) throw new Error('Twilio non configuré');
    const client = twilio(TWILIO_SID, TWILIO_TOKEN);

    // WhatsApp priorité, SMS fallback
    let channel = 'sms';
    try {
      await client.messages.create({ from: `whatsapp:${TWILIO_FROM}`, to: `whatsapp:${staffPhone}`, body: message });
      channel = 'whatsapp';
    } catch {
      await client.messages.create({ from: TWILIO_FROM, to: staffPhone, body: message });
    }
    return { sent: true, channel, staffName, eventType };
  } catch (err) {
    // [333] Fallback local — log l'événement, ne bloque pas
    bus.system(`[StaffNotifier] FALLBACK LOCAL: ${message.slice(0, 100)}`);
    return { sent: false, fallback: true, localLog: message, error: err.message };
  }
}

/**
 * [320] Notifie tous les employés concernés par un changement de booking
 * Appelé depuis webhook Square ou booking-routes
 */
async function notifyBookingChange({ tenantId, pool, booking, eventType }) {
  if (!pool || !booking?.staff_square_id) return;
  try {
    const r = await pool.query(
      `SELECT name, phone FROM staff_profiles WHERE tenant_id=$1 AND square_id=$2`,
      [tenantId, booking.staff_square_id]
    );
    const staff = r.rows[0];
    if (!staff?.phone) return { sent: false, reason: 'no_staff_phone' };

    return notifyStaff({
      staffPhone:  staff.phone,
      staffName:   staff.name?.split(' ')[0] || staff.name,
      eventType,
      clientName:  booking.customer_name || 'Client',
      service:     booking.service_name  || 'Service',
      startAt:     booking.start_at,
    });
  } catch (err) {
    bus.system(`[StaffNotifier] Erreur: ${err.message}`);
    return { sent: false, error: err.message };
  }
}

module.exports = { notifyStaff, notifyBookingChange, anonymizeClient, _maskAmount };
