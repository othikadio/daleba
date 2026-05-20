/**
 * DALEBA — SMS Pipeline Automatique
 * Section 16 — Confirmation + Rappel + Avis + Note Interne
 *
 * Tables requises :
 *
 * CREATE TABLE IF NOT EXISTS daleba_sms_ratings (
 *   id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
 *   client_phone VARCHAR(20),
 *   booking_id VARCHAR(50),
 *   staff_id VARCHAR(50),
 *   staff_rating INTEGER CHECK (staff_rating BETWEEN 1 AND 5),
 *   salon_rating INTEGER CHECK (salon_rating BETWEEN 1 AND 5),
 *   raw_response VARCHAR(10),
 *   created_at TIMESTAMP DEFAULT NOW()
 * );
 *
 * CREATE TABLE IF NOT EXISTS daleba_reminders_queue (
 *   id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
 *   client_phone VARCHAR(20),
 *   client_name VARCHAR(100),
 *   service_name VARCHAR(100),
 *   staff_name VARCHAR(50),
 *   appointment_datetime TIMESTAMP,
 *   reminder_sent BOOLEAN DEFAULT false,
 *   confirmation_sent BOOLEAN DEFAULT false,
 *   review_sent BOOLEAN DEFAULT false,
 *   rating_sent BOOLEAN DEFAULT false,
 *   created_at TIMESTAMP DEFAULT NOW()
 * );
 */

'use strict';

const { sendSMS, alertUlrich } = require('./twilio');
const { pool } = require('../memory/db');
const bus = require('./event-bus');

const LOG = '[SMS-PIPELINE]';

// ─── INIT TABLES ──────────────────────────────────────────────────────────────

async function ensureTables() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS daleba_sms_ratings (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      client_phone VARCHAR(20),
      booking_id VARCHAR(50),
      staff_id VARCHAR(50),
      staff_rating INTEGER CHECK (staff_rating BETWEEN 1 AND 5),
      salon_rating INTEGER CHECK (salon_rating BETWEEN 1 AND 5),
      raw_response VARCHAR(10),
      created_at TIMESTAMP DEFAULT NOW()
    );
  `);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS daleba_reminders_queue (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      client_phone VARCHAR(20),
      client_name VARCHAR(100),
      service_name VARCHAR(100),
      staff_name VARCHAR(50),
      appointment_datetime TIMESTAMP,
      reminder_24h_sent BOOLEAN DEFAULT false,
      reminder_2h_sent BOOLEAN DEFAULT false,
      confirmation_sent BOOLEAN DEFAULT false,
      review_sent BOOLEAN DEFAULT false,
      rating_sent BOOLEAN DEFAULT false,
      created_at TIMESTAMP DEFAULT NOW()
    );
  `);
  console.log(`${LOG} Tables vérifiées`);
}

// ─── FORMATAGE DATE ────────────────────────────────────────────────────────────

function formatDatetime(datetime) {
  const d = new Date(datetime);
  return d.toLocaleString('fr-CA', {
    timeZone: 'America/Toronto',
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function formatTime(datetime) {
  const d = new Date(datetime);
  return d.toLocaleString('fr-CA', {
    timeZone: 'America/Toronto',
    hour: '2-digit',
    minute: '2-digit',
  });
}

// ─── MODULE 1 : CONFIRMATION IMMÉDIATE ────────────────────────────────────────

/**
 * SMS immédiat à la réservation
 */
async function sendBookingConfirmation(clientPhone, clientName, serviceName, datetime, staffName) {
  const dateStr = formatDatetime(datetime);
  const message =
    `Bonjour ${clientName}, votre RDV ${serviceName} avec ${staffName} est confirmé pour ` +
    `${dateStr} chez Kadio Coiffure. ` +
    `615 Antoinette Robidoux, local 100, Longueuil. ` +
    `Répondez ANNULER pour annuler.`;

  try {
    const result = await sendSMS(clientPhone, message);
    console.log(`${LOG} Confirmation envoyée à ${clientPhone} — SID: ${result.sid}`);
    bus.system(`${LOG} Confirmation RDV → ${clientName} (${clientPhone})`);

    // Enregistrer dans la file reminders
    await pool.query(`
      INSERT INTO daleba_reminders_queue
        (client_phone, client_name, service_name, staff_name, appointment_datetime, confirmation_sent)
      VALUES ($1, $2, $3, $4, $5, true)
      ON CONFLICT DO NOTHING
    `, [clientPhone, clientName, serviceName, staffName, new Date(datetime)]);

    return result;
  } catch (err) {
    console.error(`${LOG} Erreur confirmation: ${err.message}`);
    throw err;
  }
}

// ─── MODULE 2 : RAPPEL 24H AVANT ──────────────────────────────────────────────

/**
 * SMS rappel 24h avant le RDV
 */
async function sendReminderSMS(clientPhone, clientName, serviceName, datetime, staffName) {
  const timeStr = formatTime(datetime);
  const dateStr = formatDatetime(datetime);
  const message =
    `⏰ Rappel Kadio Coiffure : votre RDV ${serviceName} est demain ${timeStr} ` +
    `avec ${staffName}. On vous attend au 615 Antoinette-Robidoux, local 100, Longueuil. ` +
    `Info : 514-919-5970.`;

  try {
    const result = await sendSMS(clientPhone, message);
    console.log(`${LOG} Rappel 24h envoyé à ${clientPhone} — SID: ${result.sid}`);
    bus.system(`${LOG} Rappel 24h → ${clientName} (${clientPhone})`);
    return result;
  } catch (err) {
    console.error(`${LOG} Erreur rappel 24h: ${err.message}`);
    throw err;
  }
}

// ─── MODULE 2B : RAPPEL 2H AVANT ──────────────────────────────────────────────

/**
 * SMS rappel 2h avant le RDV (dernière minute)
 */
async function sendReminder2hSMS(clientPhone, clientName, serviceName, datetime, staffName) {
  const timeStr = formatTime(datetime);
  const message =
    `💇 Kadio Coiffure — Dans 2h ! Votre ${serviceName} à ${timeStr} avec ${staffName}. ` +
    `615 Antoinette-Robidoux, local 100, Longueuil. À tout à l'heure !`;

  try {
    const result = await sendSMS(clientPhone, message);
    console.log(`${LOG} Rappel 2h envoyé à ${clientPhone} — SID: ${result.sid}`);
    bus.system(`${LOG} Rappel 2h → ${clientName} (${clientPhone})`);
    return result;
  } catch (err) {
    console.error(`${LOG} Erreur rappel 2h: ${err.message}`);
    throw err;
  }
}

/**
 * Planifie les rappels 24h + 2h lors de la création d'un RDV
 */
async function scheduleReminders({ clientPhone, clientName, serviceName, datetime, staffName }) {
  if (DEMO_MODE || !pool) {
    console.log(`${LOG} DEMO — Rappels planifiés pour ${clientName} @ ${datetime}`);
    return;
  }
  const existing = await pool.query(
    'SELECT id FROM daleba_reminders_queue WHERE client_phone=$1 AND appointment_datetime=$2',
    [clientPhone, datetime]
  );
  if (!existing.rows[0]) {
    await pool.query(`
      INSERT INTO daleba_reminders_queue
        (client_phone, client_name, service_name, staff_name, appointment_datetime)
      VALUES ($1,$2,$3,$4,$5)
    `, [clientPhone, clientName, serviceName, staffName, datetime]);
  }
  console.log(`${LOG} Rappels 24h+2h planifiés pour ${clientName} @ ${datetime}`);
}

// ─── MODULE 3 : DEMANDE D'AVIS GOOGLE ────────────────────────────────────────

/**
 * SMS post-prestation — demande d'avis Google
 */
async function sendReviewRequestSMS(clientPhone, clientName, staffName) {
  const message =
    `Merci ${clientName} pour votre visite chez Kadio Coiffure ! ` +
    `Comment s'est passée votre expérience avec ${staffName} ? ` +
    `Laissez-nous un avis Google (30 sec) : https://g.page/r/CbT0iRpVkQ2REBM/review — ` +
    `Ça nous aide beaucoup ! 🙏`;

  try {
    const result = await sendSMS(clientPhone, message);
    console.log(`${LOG} Demande avis envoyée à ${clientPhone} — SID: ${result.sid}`);
    bus.system(`${LOG} Demande avis Google → ${clientName}`);
    return result;
  } catch (err) {
    console.error(`${LOG} Erreur demande avis: ${err.message}`);
    throw err;
  }
}

// ─── MODULE 4 : NOTE INTERNE 1-5 ─────────────────────────────────────────────

/**
 * SMS interne note 1-5 (coiffeur + salon)
 */
async function sendInternalRatingRequest(clientPhone, clientName, staffId, staffName, bookingId) {
  const message =
    `Évaluez votre visite Kadio Coiffure 👇\n` +
    `Coiffeur ${staffName} : répondez avec 2 chiffres (ex: 45 = coiffeur 4/5, salon 5/5)\n` +
    `Format : [note coiffeur 1-5][note salon 1-5]`;

  try {
    // Enregistrement en attente de réponse
    await pool.query(`
      UPDATE daleba_reminders_queue
      SET rating_sent = true
      WHERE client_phone = $1
        AND appointment_datetime = (
          SELECT appointment_datetime FROM daleba_reminders_queue
          WHERE client_phone = $1 ORDER BY created_at DESC LIMIT 1
        )
    `, [clientPhone]);

    const result = await sendSMS(clientPhone, message);
    console.log(`${LOG} Demande note interne → ${clientPhone} [booking: ${bookingId}]`);
    bus.system(`${LOG} Note interne → ${clientName} (staff: ${staffName})`);
    return result;
  } catch (err) {
    console.error(`${LOG} Erreur note interne: ${err.message}`);
    throw err;
  }
}

// ─── MODULE 5 : TRAITEMENT RÉPONSE NOTE ──────────────────────────────────────

/**
 * Parse la réponse SMS (ex: "45") et sauvegarde en DB
 * Alerte Ulrich si note < 3
 */
async function processInternalRating(inboundSMS, from) {
  const body = (inboundSMS || '').trim();

  // Validation format : 2 chiffres entre 1-5
  if (!/^[1-5][1-5]$/.test(body)) {
    console.log(`${LOG} Réponse note invalide de ${from}: "${body}"`);
    return { success: false, reason: 'format_invalide' };
  }

  const staffRating = parseInt(body[0]);
  const salonRating = parseInt(body[1]);

  // Trouver le dernier rating_sent pour ce numéro
  const pending = await pool.query(`
    SELECT * FROM daleba_reminders_queue
    WHERE client_phone = $1 AND rating_sent = true
    ORDER BY created_at DESC LIMIT 1
  `, [from]);

  const staffId = pending.rows[0]?.staff_id || null;
  const bookingId = null; // à lier si disponible

  await pool.query(`
    INSERT INTO daleba_sms_ratings
      (client_phone, booking_id, staff_id, staff_rating, salon_rating, raw_response)
    VALUES ($1, $2, $3, $4, $5, $6)
  `, [from, bookingId, staffId, staffRating, salonRating, body]);

  console.log(`${LOG} Note sauvegardée — ${from}: coiffeur ${staffRating}/5, salon ${salonRating}/5`);
  bus.system(`${LOG} Note reçue de ${from}: ${staffRating}/5 coiffeur, ${salonRating}/5 salon`);

  // Alerte si note basse (< 3)
  if (staffRating < 3 || salonRating < 3) {
    const alertMsg = `Note basse reçue ! Coiffeur: ${staffRating}/5, Salon: ${salonRating}/5 — de ${from}`;
    await alertUlrich(alertMsg).catch(e => console.warn(`${LOG} Alerte Ulrich échouée: ${e.message}`));
    bus.system(`${LOG} ⚠️ ALERTE NOTE BASSE — ${from}`);
  }

  return { success: true, staffRating, salonRating };
}

// ─── QUERIES ──────────────────────────────────────────────────────────────────

async function getRatings(staffId = null) {
  let query, params;
  if (staffId) {
    query = `SELECT * FROM daleba_sms_ratings WHERE staff_id = $1 ORDER BY created_at DESC`;
    params = [staffId];
  } else {
    query = `SELECT * FROM daleba_sms_ratings ORDER BY created_at DESC LIMIT 100`;
    params = [];
  }
  const { rows } = await pool.query(query, params);
  return rows;
}

async function getReminderQueue() {
  const { rows } = await pool.query(`
    SELECT * FROM daleba_reminders_queue ORDER BY appointment_datetime ASC LIMIT 200
  `);
  return rows;
}

module.exports = {
  ensureTables,
  sendBookingConfirmation,
  sendReminderSMS,
  sendReviewRequestSMS,
  sendInternalRatingRequest,
  processInternalRating,
  getRatings,
  getReminderQueue,
};
