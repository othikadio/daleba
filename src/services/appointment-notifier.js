/**
 * DALEBA — Notifications SMS Automatiques (RDV)
 * Chantier A — Confirmation + Rappels 24h/2h + Notification Coiffeur 1h
 *
 * Stratégie : polling Square toutes les 30-60 min + table anti-doublon
 * daleba_notifications_sent pour garantir qu'un SMS n'est envoyé qu'une seule fois.
 */

'use strict';

const twilio = require('twilio');
const { pool, DEMO_MODE } = require('../memory/db');
const bus = require('./event-bus');

const LOG = '[APPT-NOTIFIER]';

const TWILIO_SID   = process.env.TWILIO_ACCOUNT_SID;
const TWILIO_AUTH  = process.env.TWILIO_AUTH_TOKEN;
const TWILIO_FROM  = process.env.TWILIO_PHONE_NUMBER || '+13022328291';
const SQUARE_TOKEN = process.env.SQUARE_ACCESS_TOKEN;
const LOCATION_ID  = process.env.SQUARE_LOCATION_ID || 'LTDE9RP9PSHX7';
const SQUARE_BASE  = 'https://connect.squareup.com/v2';

// Numéros coiffeurs réels (source: USER.md / vérifiés 22 mai 2026)
// Priorité : daleba_staff DB > table statique ci-dessous
const STAFF_PHONES = {
  'TMQ9dzPRRMFbmlW9': '+15149539733', // Mariel Yonkeu (Barbier)
  'TMdS_nh6o1iy916q': '+15147553039', // Ange Zan
  'STAFF-AICHA':       '+14383504840', // Aïcha
  'TMbOuVGATiQQ_fKO': '',            // Othi (pas de numéro fourni)
  'STAFF-CHABRIOL':    '+16136840208', // Chabriol Wilfreed
  'TMoA3Pvr21QUskS1': '+14389299781', // Raquel Lafortune
  // Autres membres (non dans la liste Square active)
  'STAFF-MAYA':        '+15142074649', // Maya
  'STAFF-MARIANE':     '+14504059626', // Mariane Bérubé
  'STAFF-HERVIRA':     '+14384544414', // Hervira Brenda
};

// ID Square du barbier Mariel (pour exception confirmation SMS)
const BARBER_STAFF_ID = 'TMQ9dzPRRMFbmlW9';
// Alerte admin
const ADMIN_PHONE = '+15149845970'; // Ulrich

// ─── TWILIO CLIENT ────────────────────────────────────────────────────────────

let _twilioClient = null;
function getTwilio() {
  if (!_twilioClient && TWILIO_SID && TWILIO_AUTH) {
    _twilioClient = twilio(TWILIO_SID, TWILIO_AUTH);
  }
  return _twilioClient;
}

// ─── INIT TABLE ANTI-DOUBLON ──────────────────────────────────────────────────

async function initNotifTable() {
  if (DEMO_MODE || !pool) return;
  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS daleba_notifications_sent (
        id         SERIAL PRIMARY KEY,
        booking_id VARCHAR(100) NOT NULL,
        notif_type VARCHAR(30) NOT NULL,
        sent_at    TIMESTAMPTZ DEFAULT NOW(),
        UNIQUE(booking_id, notif_type)
      );
      CREATE INDEX IF NOT EXISTS idx_notif_booking ON daleba_notifications_sent(booking_id);
    `);
    console.log(`${LOG} Table daleba_notifications_sent OK`);
  } catch (e) {
    console.warn(`${LOG} Init table:`, e.message);
  }
}

// ─── HELPERS ─────────────────────────────────────────────────────────────────

function formatDateFR(isoStr) {
  const d = new Date(isoStr);
  const days   = ['dimanche','lundi','mardi','mercredi','jeudi','vendredi','samedi'];
  const months = ['janvier','février','mars','avril','mai','juin','juillet','août','septembre','octobre','novembre','décembre'];
  const h = String(d.getHours()).padStart(2,'0');
  const m = String(d.getMinutes()).padStart(2,'0');
  return `${days[d.getDay()]} ${d.getDate()} ${months[d.getMonth()]} à ${h}h${m}`;
}

function formatTimeFR(isoStr) {
  const d = new Date(isoStr);
  const h = String(d.getHours()).padStart(2,'0');
  const m = String(d.getMinutes()).padStart(2,'0');
  return `${h}h${m}`;
}

async function sendSMS(to, body) {
  if (!to || to.trim() === '') {
    console.log(`${LOG} Numéro vide — SMS ignoré`);
    return { success: false, reason: 'empty_phone' };
  }
  const client = getTwilio();
  if (!client) {
    console.warn(`${LOG} Twilio non configuré — SMS simulé vers ${to}`);
    return { success: true, demo: true };
  }
  try {
    const msg = await client.messages.create({ from: TWILIO_FROM, to, body });
    console.log(`${LOG} SMS envoyé → ${to} [${msg.sid}]`);
    return { success: true, sid: msg.sid };
  } catch (e) {
    console.error(`${LOG} SMS erreur vers ${to}:`, e.message);
    return { success: false, error: e.message };
  }
}

// ─── VÉRIFIER / MARQUER NOTIFICATION ─────────────────────────────────────────

async function alreadySent(bookingId, notifType) {
  if (DEMO_MODE || !pool) return false;
  const r = await pool.query(
    'SELECT 1 FROM daleba_notifications_sent WHERE booking_id=$1 AND notif_type=$2',
    [bookingId, notifType]
  );
  return r.rowCount > 0;
}

async function markSent(bookingId, notifType) {
  if (DEMO_MODE || !pool) return;
  try {
    await pool.query(
      'INSERT INTO daleba_notifications_sent(booking_id, notif_type) VALUES($1,$2) ON CONFLICT DO NOTHING',
      [bookingId, notifType]
    );
  } catch (e) {
    console.warn(`${LOG} markSent:`, e.message);
  }
}

// ─── LOOKUP NUMÉRO STAFF DEPUIS daleba_staff ────────────────────────────────

async function getStaffPhone(staffId) {
  // D'abord la table statique
  if (STAFF_PHONES[staffId]) return STAFF_PHONES[staffId];
  // Puis daleba_staff / staff_profiles
  if (!pool || DEMO_MODE) return '';
  try {
    const r = await pool.query(
      `SELECT phone FROM daleba_staff WHERE square_id=$1 LIMIT 1
       UNION
       SELECT phone FROM staff_profiles WHERE square_id=$1 LIMIT 1`,
      [staffId]
    );
    return r.rows[0]?.phone || '';
  } catch (_) {
    return '';
  }
}

// ─── FETCH SQUARE BOOKINGS ────────────────────────────────────────────────────

async function fetchSquareBookings(startAt, endAt) {
  if (!SQUARE_TOKEN) return [];
  try {
    const sqHeaders = {
      'Authorization':  `Bearer ${SQUARE_TOKEN}`,
      'Content-Type':   'application/json',
      'Square-Version': '2024-02-22',
    };
    const url = `${SQUARE_BASE}/bookings?location_id=${LOCATION_ID}&start_at_min=${encodeURIComponent(startAt)}&start_at_max=${encodeURIComponent(endAt)}&limit=100`;
    const res = await fetch(url, { headers: sqHeaders });
    if (!res.ok) {
      const err = await res.text();
      console.warn(`${LOG} Square bookings [${res.status}]:`, err.slice(0,80));
      return [];
    }
    const data = await res.json();
    return data.bookings || [];
  } catch (e) {
    console.warn(`${LOG} fetchSquareBookings:`, e.message);
    return [];
  }
}

// Fetch also from daleba_bookings (our own DB)
async function fetchDbBookings(startAt, endAt) {
  if (DEMO_MODE || !pool) return [];
  try {
    const r = await pool.query(
      `SELECT id::text AS id, client_name, client_phone, service_name, staff_name, staff_id, start_at, duration_min, status
       FROM daleba_bookings
       WHERE start_at BETWEEN $1 AND $2
         AND status != 'cancelled'`,
      [startAt, endAt]
    );
    return await Promise.all(r.rows.map(async b => {
      const staffPhone = await getStaffPhone(b.staff_id || '');
      return { ...b, _source: 'db', booking_id: `db_${b.id}`, staff_phone: staffPhone };
    }));
  } catch (e) {
    console.warn(`${LOG} fetchDbBookings:`, e.message);
    return [];
  }
}

// Normalize a Square booking into a common shape
async function normalizeSquareBooking(sq) {
  const seg    = sq.appointment_segments?.[0] || {};
  const bookId = sq.id;

  // Fetch customer info
  let clientName  = 'Client';
  let clientPhone = '';
  if (sq.customer_id && SQUARE_TOKEN) {
    try {
      const sqH = {
        'Authorization':  `Bearer ${SQUARE_TOKEN}`,
        'Square-Version': '2024-02-22',
      };
      const cr = await fetch(`${SQUARE_BASE}/customers/${sq.customer_id}`, { headers: sqH });
      if (cr.ok) {
        const cd = await cr.json();
        const c  = cd.customer || {};
        clientName  = [c.given_name, c.family_name].filter(Boolean).join(' ') || 'Client';
        clientPhone = c.phone_number || '';
      }
    } catch (_) {}
  }

  // Fetch service name
  let serviceName = seg.service_variation_id || 'Service';
  if (seg.service_variation_id && SQUARE_TOKEN) {
    try {
      const sqH = {
        'Authorization':  `Bearer ${SQUARE_TOKEN}`,
        'Square-Version': '2024-02-22',
      };
      const sr = await fetch(`${SQUARE_BASE}/catalog/object/${seg.service_variation_id}`, { headers: sqH });
      if (sr.ok) {
        const sd = await sr.json();
        serviceName = sd.object?.item_variation_data?.name || serviceName;
      }
    } catch (_) {}
  }

  // Fetch team member name
  let staffName = 'Coiffeur';
  let staffPhone = await getStaffPhone(seg.team_member_id || '');
  if (seg.team_member_id && SQUARE_TOKEN) {
    try {
      const sqH = {
        'Authorization':  `Bearer ${SQUARE_TOKEN}`,
        'Square-Version': '2024-02-22',
      };
      const tr = await fetch(`${SQUARE_BASE}/team-members/${seg.team_member_id}`, { headers: sqH });
      if (tr.ok) {
        const td = await tr.json();
        staffName = td.team_member?.display_name || staffName;
      }
    } catch (_) {}
  }

  return {
    booking_id: bookId,
    client_name: clientName,
    client_phone: clientPhone,
    service_name: serviceName,
    staff_name: staffName,
    staff_id: seg.team_member_id || '',
    staff_phone: staffPhone,
    start_at: sq.start_at,
    duration_min: seg.duration_minutes || 60,
    status: sq.status,
    _source: 'square',
  };
}

// ─── 4 TYPES DE SMS ───────────────────────────────────────────────────────────

/**
 * 1. Confirmation immédiate après booking
 * Exception barbier : "Aucun dépôt requis" vs "Dépôt de 20% requis"
 */
async function sendConfirmation(booking) {
  const { booking_id, client_name, client_phone, service_name, staff_name, start_at, staff_id } = booking;
  const firstName = client_name.split(' ')[0];
  const dateStr   = formatDateFR(start_at);
  const timeStr   = formatTimeFR(start_at);

  const body = `Bonjour ${firstName}, votre rendez-vous chez Kadio Coiffure est confirmé pour le ${dateStr} à ${timeStr}. Service: ${service_name}. Adresse: 615 Antoinette-Robidoux, local 100, Longueuil. Besoin de modifier? Appelez le (514) 919-5970.`;

  const result = await sendSMS(client_phone, body);
  if (result.success) await markSent(booking_id, 'confirm');
  return result;
}

/**
 * 2. Rappel 24h avant
 */
async function sendReminder24h(booking) {
  const { booking_id, client_name, client_phone, service_name, staff_name, start_at } = booking;
  const dateStr = formatDateFR(start_at);
  const timeStr = formatTimeFR(start_at);

  const body = `Rappel: votre rendez-vous chez Kadio Coiffure est demain ${dateStr} à ${timeStr}. Service: ${service_name}. Bonne journée!`;

  const result = await sendSMS(client_phone, body);
  if (result.success) await markSent(booking_id, 'remind_24h');
  return result;
}

/**
 * 3. Rappel 2h avant
 */
async function sendReminder2h(booking) {
  const { booking_id, client_name, client_phone, service_name, staff_name, start_at } = booking;
  const heureStr = formatTimeFR(start_at);

  const body = `Rappel: votre rendez-vous chez Kadio Coiffure est dans 2 heures, à ${heureStr}. On vous attend au 615 Antoinette-Robidoux, local 100, Longueuil.`;

  const result = await sendSMS(client_phone, body);
  if (result.success) await markSent(booking_id, 'remind_2h');
  return result;
}

/**
 * 4. Notification coiffeur 1h avant son RDV
 */
async function sendStaffReminder(booking) {
  const { booking_id, client_name, service_name, staff_phone, start_at } = booking;
  const heureStr = formatTimeFR(start_at);

  const body = `Rappel: RDV dans 1h. Client: ${client_name}. Service: ${service_name}. Heure: ${heureStr}.`;

  const result = await sendSMS(staff_phone, body);
  if (result.success) await markSent(booking_id, 'staff_1h');
  return result;
}

// ─── SCAN PRINCIPAL ───────────────────────────────────────────────────────────

async function scanAndNotify() {
  console.log(`${LOG} Scan à ${new Date().toISOString()}`);
  const now   = new Date();

  // Fenêtre : maintenant → +26h (pour couvrir 24h + marge)
  const windowEnd = new Date(now.getTime() + 26 * 3600 * 1000);

  // Récupérer bookings Square + DB
  const [squareRaw, dbBookings] = await Promise.all([
    fetchSquareBookings(now.toISOString(), windowEnd.toISOString()),
    fetchDbBookings(now.toISOString(), windowEnd.toISOString()),
  ]);

  // Normaliser Square (sans fetches customer/service pour éviter trop de requêtes)
  const squareBookings = await Promise.all(squareRaw.map(async sq => {
    const seg = sq.appointment_segments?.[0] || {};
    const staffPhone = await getStaffPhone(seg.team_member_id || '');
    return {
      booking_id:   sq.id,
      client_name:  sq.customer_note || 'Client',
      client_phone: '',   // numéro client non disponible sans lookup Square
      service_name: seg.service_variation_id || 'Service',
      staff_name:   seg.team_member_id || 'Coiffeur',
      staff_id:     seg.team_member_id || '',
      staff_phone:  staffPhone,
      start_at:     sq.start_at,
      duration_min: seg.duration_minutes || 60,
      status:       sq.status,
      _source:      'square',
    };
  }));
  const squareFiltered = squareBookings.filter(b => b.status === 'ACCEPTED' && b.client_phone);

  const allBookings = [...squareFiltered, ...dbBookings];
  let sent = 0;

  for (const booking of allBookings) {
    const startMs  = new Date(booking.start_at).getTime();
    const nowMs    = now.getTime();
    const diffMs   = startMs - nowMs;
    const diffMin  = diffMs / 60000;

    // Rappel 24h : entre 23h et 25h avant
    if (diffMin >= 23 * 60 && diffMin <= 25 * 60) {
      if (!(await alreadySent(booking.booking_id, 'remind_24h'))) {
        await sendReminder24h(booking);
        sent++;
      }
    }

    // Rappel 2h : entre 1h45 et 2h15 avant
    if (diffMin >= 105 && diffMin <= 135) {
      if (!(await alreadySent(booking.booking_id, 'remind_2h'))) {
        await sendReminder2h(booking);
        sent++;
      }
    }

    // Notif coiffeur 1h : DÉSACTIVÉE (Ulrich uniquement reçoit les confirmations — 29 mai 2026)
    // if (diffMin >= 45 && diffMin <= 75 && booking.staff_phone) {
    //   if (!(await alreadySent(booking.booking_id, 'staff_1h'))) {
    //     await sendStaffReminder(booking);
    //     sent++;
    //   }
    // }
  }

  if (sent > 0) {
    console.log(`${LOG} ${sent} SMS envoyés`);
    bus.system(`${LOG} ${sent} notifications SMS envoyées`);
  }
}

// ─── PENDING BOOKINGS (pour l'API) ────────────────────────────────────────────

async function getPendingNotifications() {
  if (DEMO_MODE || !pool) return [];
  try {
    const r = await pool.query(`
      SELECT b.*, 
        EXISTS(SELECT 1 FROM daleba_notifications_sent s WHERE s.booking_id=b.id::text AND s.notif_type='confirm')   AS confirm_sent,
        EXISTS(SELECT 1 FROM daleba_notifications_sent s WHERE s.booking_id=b.id::text AND s.notif_type='remind_24h') AS remind_24h_sent,
        EXISTS(SELECT 1 FROM daleba_notifications_sent s WHERE s.booking_id=b.id::text AND s.notif_type='remind_2h')  AS remind_2h_sent,
        EXISTS(SELECT 1 FROM daleba_notifications_sent s WHERE s.booking_id=b.id::text AND s.notif_type='staff_1h')   AS staff_1h_sent
      FROM daleba_bookings b
      WHERE b.start_at > NOW()
        AND b.status != 'cancelled'
      ORDER BY b.start_at ASC
      LIMIT 50
    `);
    return r.rows;
  } catch (e) {
    console.warn(`${LOG} getPending:`, e.message);
    return [];
  }
}

async function getNotificationLog(limit = 100) {
  if (DEMO_MODE || !pool) return [];
  try {
    const r = await pool.query(
      `SELECT ns.*, b.client_name, b.client_phone, b.service_name, b.start_at
       FROM daleba_notifications_sent ns
       LEFT JOIN daleba_bookings b ON b.id::text = ns.booking_id
       ORDER BY ns.sent_at DESC
       LIMIT $1`,
      [limit]
    );
    return r.rows;
  } catch (e) {
    // Table might not exist yet (square-only bookings), return empty
    return [];
  }
}

// ─── FORCER UN ENVOI MANUEL ───────────────────────────────────────────────────

async function forceNotification(bookingId, notifType) {
  if (DEMO_MODE || !pool) {
    return { success: false, error: 'Mode démo — pas de DB' };
  }
  try {
    const r = await pool.query(
      `SELECT * FROM daleba_bookings WHERE id=$1`,
      [bookingId]
    );
    if (!r.rows[0]) return { success: false, error: 'Booking introuvable' };
    const booking = { ...r.rows[0], booking_id: `db_${r.rows[0].id}` };

    // Remove existing sent flag to allow re-send
    await pool.query(
      'DELETE FROM daleba_notifications_sent WHERE booking_id=$1 AND notif_type=$2',
      [booking.booking_id, notifType]
    );

    let result;
    switch (notifType) {
      case 'confirm':    result = await sendConfirmation(booking); break;
      case 'remind_24h': result = await sendReminder24h(booking);  break;
      case 'remind_2h':  result = await sendReminder2h(booking);   break;
      case 'staff_1h':   result = await sendStaffReminder(booking); break;
      default: return { success: false, error: `Type inconnu: ${notifType}` };
    }
    return result;
  } catch (e) {
    return { success: false, error: e.message };
  }
}

// ─── DÉMARRER LES CRONS ───────────────────────────────────────────────────────

function scheduleReminders() {
  // Init table d'abord
  initNotifTable();

  // Scan toutes les 30 min pour rappels 2h et staff 1h
  setInterval(scanAndNotify, 30 * 60 * 1000);

  // Premier scan dans 10 secondes (pour ne pas bloquer le démarrage)
  setTimeout(scanAndNotify, 10 * 1000);

  console.log(`${LOG} Crons démarrés (30min scan)`);
}

module.exports = {
  scheduleReminders,
  sendConfirmation,
  sendReminder24h,
  sendReminder2h,
  sendStaffReminder,
  getPendingNotifications,
  getNotificationLog,
  forceNotification,
  initNotifTable,
};
