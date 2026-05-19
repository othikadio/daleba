/**
 * Voice Booking Manager — DALEBA Metacortex Points 219-222
 *
 * [219] Persist booking Square → table tenant_appointments (CONFIRMED)
 * [220] SMS confirmation post-booking (date, heure, adresse, lien annulation)
 * [221] OTP pour MODIFICATION/CANCELLATION depuis numéro tiers — géré dans voice-otp.js
 * [222] CancelBooking Square + libération + mise à jour DB + SMS quittance
 *
 * [235] Fallback mécanique si DARE/API down
 */

'use strict';

const bus  = require('./event-bus');

const TWILIO_FROM   = process.env.TWILIO_PHONE_NUMBER || '+13022328291';
const SQUARE_BASE   = 'https://connect.squareup.com';
const SQUARE_TOKEN  = process.env.SQUARE_ACCESS_TOKEN;
const LOCATION_ID   = process.env.SQUARE_LOCATION_ID || 'LTDE9RP9PSHX7';
const DALEBA_URL    = process.env.DALEBA_BASE_URL || 'https://daleba-api-production.up.railway.app';

const SALON_ADDRESS = process.env.SALON_ADDRESS || '615 Antoinette-Robidoux, local 100, Longueuil, QC';

// ─── [219] PERSISTANCE DANS tenant_appointments ──────────────────────────────

/**
 * Schéma de la table (crée si absent)
 */
async function initAppointmentsTable() {
  try {
    const maintenance = require('./maintenance');
    const pool = maintenance.getPool();
    if (!pool) return;
    await pool.query(`
      CREATE TABLE IF NOT EXISTS tenant_appointments (
        id             SERIAL PRIMARY KEY,
        tenant_id      TEXT        NOT NULL DEFAULT 'kadio',
        square_id      TEXT        UNIQUE,
        customer_id    TEXT,
        customer_name  TEXT,
        customer_phone TEXT,
        service_id     TEXT,
        service_name   TEXT,
        start_at       TIMESTAMPTZ,
        end_at         TIMESTAMPTZ,
        duration_min   INTEGER     DEFAULT 60,
        status         TEXT        NOT NULL DEFAULT 'CONFIRMED',
        call_sid       TEXT,
        location_id    TEXT        DEFAULT '${LOCATION_ID}',
        created_at     TIMESTAMPTZ DEFAULT NOW(),
        updated_at     TIMESTAMPTZ DEFAULT NOW()
      );
      CREATE INDEX IF NOT EXISTS idx_ta_tenant   ON tenant_appointments(tenant_id);
      CREATE INDEX IF NOT EXISTS idx_ta_customer ON tenant_appointments(customer_id);
      CREATE INDEX IF NOT EXISTS idx_ta_status   ON tenant_appointments(status);
      CREATE INDEX IF NOT EXISTS idx_ta_start    ON tenant_appointments(start_at);
    `);
  } catch (e) {
    console.warn('[VoiceBooking] tenant_appointments init skipped:', e.message);
  }
}

initAppointmentsTable();

/**
 * Lie un booking Square à la table locale [219]
 * @param {object} booking — objet retourné par Square CreateBooking
 * @param {object} meta    — { tenantId, callSid, customerName, customerPhone, serviceName }
 */
async function persistBooking(booking, meta = {}) {
  const squareId    = booking?.id;
  const startAt     = booking?.start_at;
  const seg         = booking?.appointment_segments?.[0] || {};

  try {
    const maintenance = require('./maintenance');
    const pool = maintenance.getPool();
    if (!pool) return { persisted: false, demo: true };

    const result = await pool.query(`
      INSERT INTO tenant_appointments
        (tenant_id, square_id, customer_id, customer_name, customer_phone,
         service_id, service_name, start_at, duration_min, status, call_sid, location_id)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,'CONFIRMED',$10,$11)
      ON CONFLICT (square_id) DO UPDATE
        SET status = 'CONFIRMED', updated_at = NOW()
      RETURNING id
    `, [
      meta.tenantId     || 'kadio',
      squareId,
      booking.customer_id || meta.customerId || null,
      meta.customerName || null,
      meta.customerPhone || null,
      seg.service_variation_id || meta.serviceId || null,
      meta.serviceName  || null,
      startAt,
      seg.duration_minutes || 60,
      meta.callSid      || null,
      LOCATION_ID,
    ]);

    const localId = result.rows[0]?.id;
    bus.system(`[VoiceBooking] ✅ Persisté tenant_appointments id=${localId} | square=${squareId} | status=CONFIRMED`);
    return { persisted: true, localId, squareId };

  } catch (err) {
    bus.system(`[VoiceBooking] ⚠️ persist échoué: ${err.message}`);
    return { persisted: false, error: err.message };
  }
}

// ─── [220] SMS CONFIRMATION ───────────────────────────────────────────────────

/**
 * Envoie le SMS de confirmation post-booking [220]
 */
async function sendConfirmationSMS(opts = {}) {
  const {
    customerPhone, customerName, slotLabel,
    serviceName = 'votre service', squareBookingId = '',
  } = opts;

  if (!customerPhone) return { sent: false, reason: 'no phone' };

  const cancelUrl = `${DALEBA_URL}/api/salon/cancel?booking=${squareBookingId}`;

  const body = [
    `✅ Réservation confirmée — ${serviceName || 'votre service'}`,
    `📅 ${slotLabel}`,
    `📍 ${SALON_ADDRESS}`,
    ``,
    `Pour annuler: ${cancelUrl}`,
    ``,
    `Kadio Coiffure — 📞 (514) 919-5970`,
  ].join('\n');

  try {
    const twilio = require('twilio')(
      process.env.TWILIO_ACCOUNT_SID,
      process.env.TWILIO_AUTH_TOKEN
    );
    const msg = await twilio.messages.create({
      body: body.slice(0, 1600),
      from: TWILIO_FROM,
      to:   customerPhone,
    });
    bus.system(`[VoiceBooking] 📲 SMS confirmation → ${customerPhone} | ${msg.sid}`);
    return { sent: true, sid: msg.sid };
  } catch (err) {
    bus.system(`[VoiceBooking] ⚠️ SMS confirmation échoué: ${err.message}`);
    return { sent: false, error: err.message };
  }
}

// ─── [222] CANCEL BOOKING ─────────────────────────────────────────────────────

/**
 * Annule un rendez-vous Square + libère la plage + met à jour la DB [222]
 */
async function cancelBooking(squareBookingId, opts = {}) {
  const { customerPhone, customerName, slotLabel, tenantId = 'kadio' } = opts;

  // 1. Appel Square CancelBooking [222]
  let squareCancelled = false;
  if (SQUARE_TOKEN && squareBookingId) {
    try {
      const res = await fetch(`${SQUARE_BASE}/v2/bookings/${squareBookingId}/cancel`, {
        method:  'POST',
        headers: {
          'Authorization':  `Bearer ${SQUARE_TOKEN}`,
          'Content-Type':   'application/json',
          'Square-Version': '2024-02-22',
        },
        body: JSON.stringify({ idempotency_key: `cancel_${squareBookingId}_${Date.now()}` }),
      });
      squareCancelled = res.ok;
      if (!res.ok) {
        const err = await res.text();
        bus.system(`[VoiceBooking] Square cancel [${res.status}]: ${err.slice(0,80)}`);
      }
    } catch (err) {
      bus.system(`[VoiceBooking] Square cancel network error: ${err.message}`);
    }
  }

  // 2. Mise à jour DB locale [222] — statut CANCELLED
  let dbUpdated = false;
  try {
    const maintenance = require('./maintenance');
    const pool = maintenance.getPool();
    if (pool) {
      await pool.query(
        `UPDATE tenant_appointments SET status='CANCELLED', updated_at=NOW() WHERE square_id=$1 AND tenant_id=$2`,
        [squareBookingId, tenantId]
      );
      dbUpdated = true;
    }
  } catch (err) {
    bus.system(`[VoiceBooking] DB cancel update échoué: ${err.message}`);
  }

  bus.system(`[VoiceBooking] Annulation | square=${squareCancelled} | db=${dbUpdated} | ${squareBookingId}`);

  // 3. SMS quittance [222]
  let smsSent = false;
  if (customerPhone) {
    const body = [
      `❌ Annulation confirmée`,
      slotLabel ? `📅 Rendez-vous annulé: ${slotLabel}` : 'Votre rendez-vous a été annulé.',
      ``,
      `Merci de nous avoir contactés.`,
      `Pour reprendre un rendez-vous: ${DALEBA_URL}/api/salon`,
      ``,
      `Kadio Coiffure — 📞 (514) 919-5970`,
    ].join('\n');
    try {
      const twilio = require('twilio')(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN);
      await twilio.messages.create({ body, from: TWILIO_FROM, to: customerPhone });
      smsSent = true;
      bus.system(`[VoiceBooking] 📲 SMS quittance annulation → ${customerPhone}`);
    } catch {}
  }

  return { squareCancelled, dbUpdated, smsSent };
}

// ─── [235] FALLBACK MÉCANIQUE ─────────────────────────────────────────────────

/**
 * TwiML de secours rigide — DARE/Anthropic coupé [235]
 * Invite le client à laisser ses coordonnées par SMS
 */
function buildFallbackTwiML(opts = {}) {
  const { tenantName = 'Kadio Coiffure' } = opts;
  const twilio = require('twilio');
  const VR = twilio.twiml.VoiceResponse;
  const response = new VR();

  const say = response.say({ voice: 'Polly.Lea-Neural', language: 'fr-CA' });
  say.break({ time: '300ms' });
  say.addText(`Bonjour, ici ${tenantName}. Notre système intelligent est temporairement indisponible.`);
  say.break({ time: '400ms' });
  say.addText(`Veuillez nous envoyer un SMS au ${TWILIO_FROM} avec votre prénom, nom, et la date souhaitée.`);
  say.break({ time: '300ms' });
  say.addText('Nous vous rappellerons dans les plus brefs délais. Merci de votre compréhension.');
  say.break({ time: '200ms' });

  response.hangup();
  return response.toString();
}

// ─── [235] DÉTECTION PANNE DARE ──────────────────────────────────────────────

async function executeWithFallback(fn, fallbackTwiML) {
  try {
    const result = await Promise.race([
      fn(),
      new Promise((_, reject) => setTimeout(() => reject(new Error('DARE_TIMEOUT')), 3000)),
    ]);
    return { ok: true, result };
  } catch (err) {
    const isDareFault = err.message === 'DARE_TIMEOUT' ||
      /anthropic|openai|api.*down|ECONNREFUSED|timeout/i.test(err.message);
    if (isDareFault) {
      bus.system(`[VoiceBooking] 🚨 DARE offline — fallback mécanique activé`);
    }
    return { ok: false, twiml: fallbackTwiML || buildFallbackTwiML(), error: err.message };
  }
}

// ─── EXPORTS ─────────────────────────────────────────────────────────────────

module.exports = {
  persistBooking,
  sendConfirmationSMS,
  cancelBooking,
  buildFallbackTwiML,
  executeWithFallback,
};
