'use strict';
/**
 * Aesthetic Satisfaction — DALEBA Metacortex Point 398
 * Notation satisfaction client par SMS 24h après le soin esthétique.
 */
const bus = require('./event-bus');

async function initSchema(pool) {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS aesthetic_ratings (
      id              SERIAL PRIMARY KEY,
      tenant_id       TEXT NOT NULL,
      client_id       TEXT,
      client_phone    TEXT,
      appointment_id  TEXT,
      treatment_type  TEXT,
      rating          INTEGER CHECK(rating BETWEEN 1 AND 5),
      comment         TEXT,
      sent_at         TIMESTAMPTZ,
      responded_at    TIMESTAMPTZ,
      status          TEXT DEFAULT 'pending',
      created_at      TIMESTAMPTZ DEFAULT NOW()
    )
  `).catch(() => {});
}

/**
 * [398] Programme l'envoi d'un SMS de satisfaction 24h après le soin
 */
async function scheduleSatisfactionSMS(pool, { tenantId, clientId, clientPhone, clientName, appointmentId, treatmentType, appointmentEndAt }) {
  await initSchema(pool);
  const sendAt = new Date((appointmentEndAt ? new Date(appointmentEndAt).getTime() : Date.now()) + 24 * 3600000);

  await pool.query(`
    INSERT INTO aesthetic_ratings (tenant_id, client_id, client_phone, appointment_id, treatment_type, sent_at)
    VALUES ($1,$2,$3,$4,$5,$6)
    ON CONFLICT DO NOTHING
  `, [tenantId, clientId, clientPhone, appointmentId, treatmentType, sendAt.toISOString()]).catch(() => {});

  bus.system(`[AestheticSatisfaction] 📅 SMS satisfaction planifié: ${clientName||clientId} — ${sendAt.toLocaleDateString('fr-CA')}`);
  return { scheduled: true, sendAt: sendAt.toISOString() };
}

/**
 * [398] Envoie les SMS de satisfaction dus
 */
async function processDueSatisfactionSMS(pool) {
  await initSchema(pool);
  const r = await pool.query(`
    SELECT * FROM aesthetic_ratings
    WHERE sent_at <= NOW() AND status='pending' AND client_phone IS NOT NULL
    LIMIT 20
  `).catch(() => ({ rows: [] }));

  let sent = 0;
  for (const row of r.rows) {
    try {
      const twilio = require('./twilio-sender');
      const msg = `Bonjour ! Comment s'est passé votre soin ${row.treatment_type||'esthétique'} ? Répondez avec un chiffre de 1 à 5 (5 = Excellent). Votre avis compte beaucoup 🌿`;
      await twilio.sendSMS({ to: row.client_phone, body: msg });
      await pool.query(`UPDATE aesthetic_ratings SET status='sent' WHERE id=$1`, [row.id]);
      sent++;
    } catch {}
  }
  return { processed: r.rows.length, sent };
}

/**
 * [398] Enregistre la réponse SMS du client (webhook Twilio)
 */
async function recordRatingResponse(pool, { from, body }) {
  const rating = parseInt((body||'').trim());
  if (isNaN(rating) || rating < 1 || rating > 5) return { recorded: false };

  const r = await pool.query(`
    UPDATE aesthetic_ratings SET rating=$1, responded_at=NOW(), status='completed'
    WHERE client_phone=$2 AND status='sent'
    RETURNING *
  `, [rating, from]).catch(() => ({ rows: [] }));

  if (r.rows[0]) bus.system(`[AestheticSatisfaction] ⭐ Note reçue: ${rating}/5 de ${from}`);
  return { recorded: r.rows.length > 0, rating };
}

module.exports = { scheduleSatisfactionSMS, processDueSatisfactionSMS, recordRatingResponse, initSchema };
