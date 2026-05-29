'use strict';
/**
 * Aesthetic Reminder — DALEBA Metacortex Point 368
 * Rappels automatiques SMS pour soins à cycle régulier.
 * Ex: micro-needling toutes les 4 semaines.
 */
const bus = require('./event-bus');

const CYCLE_DEFAULTS = {
  'micro-needling':    28,
  'soin-visage':       28,
  'botox-vegetale':    56,
  'peeling-botanique': 21,
  'masque-argile':     14,
  'soin-cuir-chevelu': 21,
};

async function initSchema(pool) {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS aesthetic_reminders (
      id              SERIAL PRIMARY KEY,
      tenant_id       TEXT NOT NULL,
      client_id       TEXT NOT NULL,
      client_phone    TEXT,
      client_name     TEXT,
      treatment_type  TEXT NOT NULL,
      cycle_days      INTEGER NOT NULL DEFAULT 28,
      last_treatment  TIMESTAMPTZ,
      next_reminder   TIMESTAMPTZ,
      status          TEXT DEFAULT 'scheduled',  -- scheduled | sent | cancelled
      message_template TEXT,
      created_at      TIMESTAMPTZ DEFAULT NOW(),
      UNIQUE(tenant_id, client_id, treatment_type)
    )
  `).catch(() => {});
  await pool.query('CREATE INDEX IF NOT EXISTS idx_reminders_due ON aesthetic_reminders(next_reminder, status)').catch(() => {});
}

/**
 * [368] Programme un rappel pour un soin cyclique
 */
async function scheduleReminder(pool, { tenantId, clientId, clientName, clientPhone, treatmentType, lastTreatmentDate, cycleDays }) {
  await initSchema(pool);
  const cycle    = cycleDays || CYCLE_DEFAULTS[treatmentType] || 28;
  const lastDate = lastTreatmentDate ? new Date(lastTreatmentDate) : new Date();
  const nextDate = new Date(lastDate.getTime() + cycle * 86400000);

  const msg = `Bonjour ${clientName || 'chère cliente'} 🌿 Votre soin ${treatmentType} a été effectué il y a ${cycle} jours. Il est temps de renouveler votre expérience bien-être chez nous ! Réservez sur kadiocoiffure.vercel.app/hub ou appelez le ${process.env.SALON_PHONE_NUMBER || 'le salon'}. À très bientôt 💜`;

  const r = await pool.query(`
    INSERT INTO aesthetic_reminders
      (tenant_id, client_id, client_name, client_phone, treatment_type, cycle_days, last_treatment, next_reminder, message_template)
    VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
    ON CONFLICT (tenant_id, client_id, treatment_type) DO UPDATE
      SET last_treatment=$7, next_reminder=$8, status='scheduled', message_template=$9
    RETURNING *
  `, [tenantId, clientId, clientName, clientPhone, treatmentType, cycle, lastDate.toISOString(), nextDate.toISOString(), msg]);

  bus.system(`[AestheticReminder] 📅 Rappel planifié: ${clientName} — ${treatmentType} dans ${cycle}j (${nextDate.toLocaleDateString('fr-CA')})`);
  return r.rows[0];
}

/**
 * [368] Envoie les rappels dus — appelé par cron
 */
async function processDueReminders(pool) {
  await initSchema(pool);
  const r = await pool.query(`
    SELECT * FROM aesthetic_reminders
    WHERE next_reminder <= NOW() + INTERVAL '2 hours' AND status='scheduled'
    ORDER BY next_reminder
    LIMIT 50
  `).catch(() => ({ rows: [] }));

  let sent = 0;
  for (const reminder of r.rows) {
    try {
      if (reminder.client_phone) {
        const twilio = require('./twilio-sender');
        await twilio.sendSMS({ to: reminder.client_phone, body: reminder.message_template });
      }
      await pool.query(
        `UPDATE aesthetic_reminders SET status='sent' WHERE id=$1`,
        [reminder.id]
      );
      bus.system(`[AestheticReminder] ✅ SMS envoyé: ${reminder.client_name} — ${reminder.treatment_type}`);
      sent++;
    } catch {}
  }
  return { processed: r.rows.length, sent };
}

module.exports = { scheduleReminder, processDueReminders, initSchema, CYCLE_DEFAULTS };
