/**
 * DALEBA — Service Twilio
 * SMS automatiques : confirmations RDV, rappels, notifications urgentes
 */

const twilio = require('twilio');

const client = twilio(
  process.env.TWILIO_ACCOUNT_SID,
  process.env.TWILIO_AUTH_TOKEN
);

const FROM_NUMBER = process.env.TWILIO_PHONE_NUMBER; // Numéro Twilio Kadio Coiffure

/**
 * Envoie un SMS simple
 * @param {string} to - Numéro destinataire (format E.164 ex: +15141234567)
 * @param {string} message - Contenu du SMS (max 160 chars recommandé)
 */
async function sendSMS(to, message) {
  const result = await client.messages.create({
    body: message,
    from: FROM_NUMBER,
    to,
  });

  return {
    sid: result.sid,
    status: result.status,
    to: result.to,
    sentAt: result.dateCreated,
  };
}

/**
 * SMS de confirmation de réservation (envoyé immédiatement après booking)
 * @param {Object} rdv
 * @param {string} rdv.clientPhone
 * @param {string} rdv.clientName
 * @param {string} rdv.date - ex: "lundi 20 mai à 14h00"
 * @param {string} rdv.service - ex: "Coupe + Barbe"
 * @param {string} rdv.coiffeur - ex: "Ulrich"
 */
async function sendConfirmation({ clientPhone, clientName, date, service, coiffeur }) {
  const message =
    `✅ Bonjour ${clientName}, votre RDV chez Kadio Coiffure est confirmé !\n` +
    `📅 ${date}\n` +
    `💈 ${service}${coiffeur ? ` avec ${coiffeur}` : ''}\n` +
    `📍 615 Antoinette Robidoux, Local 100, Longueuil\n` +
    `Pour annuler: répondez ANNULER`;

  return sendSMS(clientPhone, message);
}

/**
 * SMS de rappel (à envoyer 24h avant le RDV via cron/job)
 * @param {Object} rdv
 * @param {string} rdv.clientPhone
 * @param {string} rdv.clientName
 * @param {string} rdv.date
 * @param {string} rdv.service
 */
async function sendReminder({ clientPhone, clientName, date, service }) {
  const message =
    `⏰ Rappel Kadio Coiffure — ${clientName}\n` +
    `Votre RDV est demain : ${date}\n` +
    `💈 ${service}\n` +
    `📍 615 Antoinette Robidoux, Local 100, Longueuil\n` +
    `Besoin de reporter? Appelez-nous.`;

  return sendSMS(clientPhone, message);
}

/**
 * SMS d'annulation
 */
async function sendCancellation({ clientPhone, clientName, date }) {
  const message =
    `❌ Kadio Coiffure — Annulation\n` +
    `Bonjour ${clientName}, votre RDV du ${date} a été annulé.\n` +
    `Pour reprendre RDV: kadiocoiffure.com`;

  return sendSMS(clientPhone, message);
}

/**
 * SMS d'alerte interne (pour Ulrich — notifications urgentes)
 */
async function alertUlrich(message) {
  const ulrichPhone = process.env.ULRICH_PHONE_NUMBER;
  if (!ulrichPhone) throw new Error('ULRICH_PHONE_NUMBER non configuré');
  return sendSMS(ulrichPhone, `🚨 DALEBA — ${message}`);
}

module.exports = {
  sendSMS,
  sendConfirmation,
  sendReminder,
  sendCancellation,
  alertUlrich,
};
