/**
 * DALEBA — Cron Rappels SMS
 * À exécuter chaque jour à 10h00 (America/Toronto)
 * Railway Cron : 0 14 * * *  (10h Toronto = 14h UTC)
 *
 * Usage : node scripts/reminder-cron.js
 */

require('dotenv').config();
const { sendReminders } = require('../src/services/appointments');

async function run() {
  console.log('⏰ DALEBA Reminder Cron — démarrage...');
  try {
    const result = await sendReminders();
    console.log(`✅ ${result.sent}/${result.total} rappels SMS envoyés`);
    process.exit(0);
  } catch (err) {
    console.error('❌ Erreur cron rappels:', err.message);
    process.exit(1);
  }
}

run();
