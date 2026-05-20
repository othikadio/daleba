/**
 * DALEBA — Worker Rappels SMS
 * Section 17 — 3 SMS : confirmation (immédiat) + rappel 24h + rappel 2h
 *
 * Exécuter toutes les heures via setInterval dans index.js
 */

'use strict';

const { pool, DEMO_MODE } = require('../memory/db');
const { sendReminderSMS, sendReminder2hSMS, sendReviewRequestSMS, sendInternalRatingRequest } = require('../services/sms-pipeline');

const LOG = '[REMINDER-WORKER]';

async function runReminderWorker() {
  if (DEMO_MODE || !pool) {
    console.log(`${LOG} Mode démo — worker désactivé`);
    return;
  }

  console.log(`${LOG} Tick — vérification rappels à ${new Date().toISOString()}`);

  try {
    // ── RAPPEL 24H ────────────────────────────────────────────────────────────
    const due24h = await pool.query(`
      SELECT * FROM daleba_reminders_queue
      WHERE reminder_24h_sent = false
        AND appointment_datetime BETWEEN NOW() + INTERVAL '23 hours'
                                     AND NOW() + INTERVAL '25 hours'
    `);

    for (const row of due24h.rows) {
      try {
        await sendReminderSMS(
          row.client_phone, row.client_name,
          row.service_name, row.appointment_datetime, row.staff_name
        );
        await pool.query(
          'UPDATE daleba_reminders_queue SET reminder_24h_sent=true WHERE id=$1',
          [row.id]
        );
        console.log(`${LOG} Rappel 24h envoyé → ${row.client_name}`);
      } catch (e) {
        console.error(`${LOG} Erreur rappel 24h ${row.client_name}: ${e.message}`);
      }
    }

    // ── RAPPEL 2H ─────────────────────────────────────────────────────────────
    const due2h = await pool.query(`
      SELECT * FROM daleba_reminders_queue
      WHERE reminder_2h_sent = false
        AND appointment_datetime BETWEEN NOW() + INTERVAL '1 hour 45 minutes'
                                     AND NOW() + INTERVAL '2 hours 15 minutes'
    `);

    for (const row of due2h.rows) {
      try {
        await sendReminder2hSMS(
          row.client_phone, row.client_name,
          row.service_name, row.appointment_datetime, row.staff_name
        );
        await pool.query(
          'UPDATE daleba_reminders_queue SET reminder_2h_sent=true WHERE id=$1',
          [row.id]
        );
        console.log(`${LOG} Rappel 2h envoyé → ${row.client_name}`);
      } catch (e) {
        console.error(`${LOG} Erreur rappel 2h ${row.client_name}: ${e.message}`);
      }
    }

    // ── POST-PRESTATION : AVIS GOOGLE + NOTE INTERNE ─────────────────────────
    // 30 minutes après la fin estimée du RDV (durée par défaut = 60 min)
    const dueReview = await pool.query(`
      SELECT * FROM daleba_reminders_queue
      WHERE review_sent = false
        AND appointment_datetime < NOW() - INTERVAL '90 minutes'
        AND appointment_datetime > NOW() - INTERVAL '3 hours'
    `);

    for (const row of dueReview.rows) {
      try {
        await sendReviewRequestSMS(row.client_phone, row.client_name, row.staff_name);
        await pool.query(
          'UPDATE daleba_reminders_queue SET review_sent=true WHERE id=$1',
          [row.id]
        );
        console.log(`${LOG} Demande avis envoyée → ${row.client_name}`);
      } catch (e) {
        console.error(`${LOG} Erreur avis ${row.client_name}: ${e.message}`);
      }
    }

    // ── NOTE INTERNE ──────────────────────────────────────────────────────────
    // 2 heures après la prestation
    const dueRating = await pool.query(`
      SELECT * FROM daleba_reminders_queue
      WHERE rating_sent = false
        AND review_sent = true
        AND appointment_datetime < NOW() - INTERVAL '2 hours 30 minutes'
        AND appointment_datetime > NOW() - INTERVAL '5 hours'
    `);

    for (const row of dueRating.rows) {
      try {
        await sendInternalRatingRequest(
          row.client_phone, row.client_name,
          row.staff_name, row.staff_name, row.id
        );
        await pool.query(
          'UPDATE daleba_reminders_queue SET rating_sent=true WHERE id=$1',
          [row.id]
        );
        console.log(`${LOG} Note interne demandée → ${row.client_name}`);
      } catch (e) {
        console.error(`${LOG} Erreur note interne ${row.client_name}: ${e.message}`);
      }
    }

    const total = due24h.rows.length + due2h.rows.length + dueReview.rows.length + dueRating.rows.length;
    if (total > 0) console.log(`${LOG} Tick terminé — ${total} SMS envoyés`);

  } catch (e) {
    console.error(`${LOG} Erreur worker: ${e.message}`);
  }
}

module.exports = { runReminderWorker };
