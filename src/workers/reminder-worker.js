/**
 * DALEBA — Reminder Worker
 * Section 16 — Worker de rappels SMS automatiques (toutes les heures)
 *
 * Vérifie la file daleba_reminders_queue pour les RDV dans les 24h
 * et envoie les SMS de rappel si pas encore envoyés.
 */

'use strict';

const { pool } = require('../memory/db');
const { sendReminderSMS } = require('../services/sms-pipeline');
const bus = require('../services/event-bus');

const LOG = '[REMINDER-WORKER]';

/**
 * Exécute le worker de rappels SMS
 * - Cherche les RDV dans les 24-26h qui n'ont pas encore reçu de rappel
 * - Envoie le SMS et marque reminder_sent = true
 */
async function runReminderWorker() {
  console.log(`${LOG} Démarrage scan rappels SMS...`);
  let sent = 0;
  let errors = 0;

  try {
    // Récupérer les RDV dans les 24 prochaines heures (fenêtre 26h pour sécurité)
    const { rows } = await pool.query(`
      SELECT *
      FROM daleba_reminders_queue
      WHERE reminder_sent = false
        AND appointment_datetime BETWEEN NOW() AND NOW() + INTERVAL '26 hours'
      ORDER BY appointment_datetime ASC
    `);

    if (rows.length === 0) {
      console.log(`${LOG} Aucun rappel à envoyer.`);
      return { sent: 0, errors: 0 };
    }

    console.log(`${LOG} ${rows.length} rappels à envoyer`);

    for (const reminder of rows) {
      try {
        await sendReminderSMS(
          reminder.client_phone,
          reminder.client_name,
          reminder.service_name,
          reminder.appointment_datetime,
          reminder.staff_name,
        );

        // Marquer comme envoyé
        await pool.query(`
          UPDATE daleba_reminders_queue
          SET reminder_sent = true
          WHERE id = $1
        `, [reminder.id]);

        sent++;
        bus.system(`${LOG} Rappel envoyé → ${reminder.client_name} (${reminder.client_phone})`);
      } catch (err) {
        errors++;
        console.error(`${LOG} Erreur rappel ${reminder.id}: ${err.message}`);
      }
    }

    console.log(`${LOG} Terminé — ${sent} envoyés, ${errors} erreurs`);
    return { sent, errors };
  } catch (err) {
    console.error(`${LOG} Erreur critique: ${err.message}`);
    return { sent, errors: errors + 1, criticalError: err.message };
  }
}

module.exports = { runReminderWorker };
