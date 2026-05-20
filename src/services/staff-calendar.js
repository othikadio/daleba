/**
 * DALEBA — Staff Calendar Service
 * Section 16 — Gestion calendrier et configuration du staff
 *
 * Table requise :
 *
 * CREATE TABLE IF NOT EXISTS daleba_staff_schedule (
 *   id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
 *   staff_id VARCHAR(50) NOT NULL,
 *   day_of_week INTEGER, -- 0=Dim, 1=Lun...6=Sam
 *   open_time VARCHAR(5), -- ex: '10:00'
 *   close_time VARCHAR(5), -- ex: '21:00'
 *   is_day_off BOOLEAN DEFAULT false,
 *   day_off_date DATE, -- pour congés ponctuels
 *   day_off_reason VARCHAR(100),
 *   created_at TIMESTAMP DEFAULT NOW()
 * );
 */

'use strict';

const { pool } = require('../memory/db');
const bus = require('./event-bus');

const LOG = '[STAFF-CALENDAR]';

// ─── STAFF LIST KADIO COIFFURE ────────────────────────────────────────────────

const STAFF_LIST = [
  { id: 'maya',   name: 'Maya',   color: '#b8965a', specialty: ['locks', 'tresses'] },
  { id: 'mariel', name: 'Mariel', color: '#7a9e72', specialty: ['tissage', 'perruques'] },
  { id: 'ulrich', name: 'Ulrich', color: '#c4622d', specialty: ['barbier', 'locs'] },
];

// ─── INIT TABLE ───────────────────────────────────────────────────────────────

async function ensureTable() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS daleba_staff_schedule (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      staff_id VARCHAR(50) NOT NULL,
      day_of_week INTEGER,
      open_time VARCHAR(5),
      close_time VARCHAR(5),
      is_day_off BOOLEAN DEFAULT false,
      day_off_date DATE,
      day_off_reason VARCHAR(100),
      created_at TIMESTAMP DEFAULT NOW()
    );
  `);
  console.log(`${LOG} Table daleba_staff_schedule vérifiée`);
}

// ─── HORAIRES ET CONGÉS ───────────────────────────────────────────────────────

/**
 * Récupère les rendez-vous Square pour un staff et une date
 * (fallback vers DB locale si Square non configuré)
 */
async function getStaffSchedule(staffId, date) {
  const staff = STAFF_LIST.find(s => s.id === staffId);
  if (!staff) throw new Error(`Staff "${staffId}" introuvable`);

  const dateObj = new Date(date);
  const dayOfWeek = dateObj.getDay(); // 0=Dim

  // Vérifier congé ponctuel
  const dayOffCheck = await pool.query(`
    SELECT * FROM daleba_staff_schedule
    WHERE staff_id = $1 AND is_day_off = true AND day_off_date = $2
  `, [staffId, date]);

  if (dayOffCheck.rows.length > 0) {
    return {
      staffId,
      staffName: staff.name,
      date,
      isDayOff: true,
      reason: dayOffCheck.rows[0].day_off_reason,
      slots: [],
      appointments: [],
    };
  }

  // Récupérer horaires du jour
  const hoursResult = await pool.query(`
    SELECT open_time, close_time FROM daleba_staff_schedule
    WHERE staff_id = $1 AND day_of_week = $2 AND is_day_off = false
    ORDER BY created_at DESC LIMIT 1
  `, [staffId, dayOfWeek]);

  const hours = hoursResult.rows[0] || { open_time: '10:00', close_time: '21:00' };

  // Générer créneaux de 30 min
  const slots = generateSlots(date, hours.open_time, hours.close_time);

  // Récupérer RDV depuis Square ou DB
  let appointments = [];
  try {
    const squareAppts = await getSquareAppointments(staffId, date);
    appointments = squareAppts;
  } catch (e) {
    console.warn(`${LOG} Square non disponible pour ${staffId}/${date}: ${e.message}`);
  }

  return {
    staffId,
    staffName: staff.name,
    color: staff.color,
    specialty: staff.specialty,
    date,
    dayOfWeek,
    openTime: hours.open_time,
    closeTime: hours.close_time,
    isDayOff: false,
    slots,
    appointments,
  };
}

/**
 * Génère des créneaux de 30 min entre open_time et close_time
 */
function generateSlots(date, openTime, closeTime) {
  const slots = [];
  const [openH, openM] = openTime.split(':').map(Number);
  const [closeH, closeM] = closeTime.split(':').map(Number);
  const start = openH * 60 + openM;
  const end = closeH * 60 + closeM;

  for (let t = start; t < end; t += 30) {
    const h = Math.floor(t / 60).toString().padStart(2, '0');
    const m = (t % 60).toString().padStart(2, '0');
    slots.push(`${h}:${m}`);
  }
  return slots;
}

/**
 * Récupère les RDV Square pour un staff et une date
 */
async function getSquareAppointments(staffId, date) {
  const SQUARE_TOKEN = process.env.SQUARE_ACCESS_TOKEN;
  if (!SQUARE_TOKEN) return [];

  const startAt = new Date(`${date}T00:00:00-05:00`).toISOString();
  const endAt   = new Date(`${date}T23:59:59-05:00`).toISOString();
  const locationId = process.env.SQUARE_LOCATION_ID || 'LTDE9RP9PSHX7';

  const resp = await fetch('https://connect.squareup.com/v2/bookings/search', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${SQUARE_TOKEN}`,
      'Content-Type': 'application/json',
      'Square-Version': '2024-02-22',
    },
    body: JSON.stringify({
      query: {
        filter: {
          location_id: locationId,
          start_at_range: { start_at: startAt, end_at: endAt },
          team_member_id_filter: { any: [staffId] },
        },
      },
    }),
  });

  if (!resp.ok) return [];
  const data = await resp.json();
  return (data.bookings || []).map(b => ({
    id: b.id,
    startAt: b.start_at,
    duration: b.appointment_segments?.[0]?.duration_minutes || 60,
    status: b.status,
    serviceName: b.appointment_segments?.[0]?.service_variation_id || 'Service',
    customerId: b.customer_id,
  }));
}

// ─── CONGÉS ───────────────────────────────────────────────────────────────────

/**
 * Marque un jour de congé pour un staff
 */
async function setStaffDayOff(staffId, date, reason = '') {
  await pool.query(`
    INSERT INTO daleba_staff_schedule (staff_id, is_day_off, day_off_date, day_off_reason)
    VALUES ($1, true, $2, $3)
  `, [staffId, date, reason]);

  console.log(`${LOG} Congé enregistré: ${staffId} le ${date} (${reason})`);
  bus.system(`${LOG} Congé: ${staffId} — ${date}`);
  return { success: true, staffId, date, reason };
}

// ─── HORAIRES HEBDOMADAIRES ───────────────────────────────────────────────────

/**
 * Configure les horaires d'un staff pour un jour de la semaine
 */
async function setStaffHours(staffId, dayOfWeek, openTime, closeTime) {
  // Upsert : supprimer l'ancien et insérer le nouveau
  await pool.query(`
    DELETE FROM daleba_staff_schedule
    WHERE staff_id = $1 AND day_of_week = $2 AND is_day_off = false
  `, [staffId, dayOfWeek]);

  await pool.query(`
    INSERT INTO daleba_staff_schedule (staff_id, day_of_week, open_time, close_time, is_day_off)
    VALUES ($1, $2, $3, $4, false)
  `, [staffId, dayOfWeek, openTime, closeTime]);

  const dayNames = ['Dim', 'Lun', 'Mar', 'Mer', 'Jeu', 'Ven', 'Sam'];
  console.log(`${LOG} Horaires: ${staffId} ${dayNames[dayOfWeek]} ${openTime}–${closeTime}`);
  bus.system(`${LOG} Horaires maj: ${staffId} — ${dayNames[dayOfWeek]}`);
  return { success: true, staffId, dayOfWeek, openTime, closeTime };
}

// ─── DÉPLACER UN RDV (SQUARE) ─────────────────────────────────────────────────

/**
 * Déplace un RDV vers un autre staff et/ou une autre date/heure via Square
 */
async function moveAppointment(appointmentId, newStaffId, newDatetime) {
  const SQUARE_TOKEN = process.env.SQUARE_ACCESS_TOKEN;
  if (!SQUARE_TOKEN) {
    console.log(`${LOG} [DEMO] Move: ${appointmentId} → ${newStaffId} at ${newDatetime}`);
    return { success: true, demo: true, appointmentId, newStaffId, newDatetime };
  }

  const resp = await fetch(`https://connect.squareup.com/v2/bookings/${appointmentId}`, {
    method: 'PUT',
    headers: {
      'Authorization': `Bearer ${SQUARE_TOKEN}`,
      'Content-Type': 'application/json',
      'Square-Version': '2024-02-22',
    },
    body: JSON.stringify({
      booking: {
        start_at: new Date(newDatetime).toISOString(),
        appointment_segments: [{ team_member_id: newStaffId }],
      },
    }),
  });

  if (!resp.ok) {
    const err = await resp.json();
    throw new Error(`Square move failed: ${JSON.stringify(err.errors)}`);
  }

  const data = await resp.json();
  console.log(`${LOG} RDV déplacé: ${appointmentId} → ${newStaffId} @ ${newDatetime}`);
  bus.system(`${LOG} RDV déplacé: ${appointmentId}`);
  return { success: true, booking: data.booking };
}

// ─── REDIMENSIONNER UN RDV (SQUARE) ──────────────────────────────────────────

/**
 * Modifie la durée d'un RDV
 */
async function resizeAppointment(appointmentId, newDurationMinutes) {
  const SQUARE_TOKEN = process.env.SQUARE_ACCESS_TOKEN;
  if (!SQUARE_TOKEN) {
    console.log(`${LOG} [DEMO] Resize: ${appointmentId} → ${newDurationMinutes}min`);
    return { success: true, demo: true, appointmentId, newDurationMinutes };
  }

  const resp = await fetch(`https://connect.squareup.com/v2/bookings/${appointmentId}`, {
    method: 'PUT',
    headers: {
      'Authorization': `Bearer ${SQUARE_TOKEN}`,
      'Content-Type': 'application/json',
      'Square-Version': '2024-02-22',
    },
    body: JSON.stringify({
      booking: {
        appointment_segments: [{ duration_minutes: newDurationMinutes }],
      },
    }),
  });

  if (!resp.ok) {
    const err = await resp.json();
    throw new Error(`Square resize failed: ${JSON.stringify(err.errors)}`);
  }

  const data = await resp.json();
  console.log(`${LOG} RDV redimensionné: ${appointmentId} → ${newDurationMinutes}min`);
  return { success: true, booking: data.booking };
}

// ─── VUE SEMAINE COMPLÈTE ─────────────────────────────────────────────────────

/**
 * Vue semaine pour tout le staff
 * @param {string} weekStart — YYYY-MM-DD (lundi)
 * @returns {{ [staffId]: appointments[] }}
 */
async function getWeekView(weekStart) {
  const result = {};
  const startDate = new Date(weekStart);

  const promises = STAFF_LIST.map(async (staff) => {
    const staffAppts = [];
    for (let i = 0; i < 7; i++) {
      const d = new Date(startDate);
      d.setDate(d.getDate() + i);
      const dateStr = d.toISOString().slice(0, 10);
      try {
        const schedule = await getStaffSchedule(staff.id, dateStr);
        staffAppts.push({ date: dateStr, ...schedule });
      } catch (e) {
        staffAppts.push({ date: dateStr, error: e.message });
      }
    }
    result[staff.id] = staffAppts;
  });

  await Promise.all(promises);
  return result;
}

// ─── LISTE STAFF AVEC HORAIRES ────────────────────────────────────────────────

async function getStaffList() {
  const staffWithHours = await Promise.all(STAFF_LIST.map(async (staff) => {
    const hoursResult = await pool.query(`
      SELECT day_of_week, open_time, close_time
      FROM daleba_staff_schedule
      WHERE staff_id = $1 AND is_day_off = false
      ORDER BY day_of_week ASC
    `, [staff.id]);

    return {
      ...staff,
      schedule: hoursResult.rows,
    };
  }));
  return staffWithHours;
}

module.exports = {
  STAFF_LIST,
  ensureTable,
  getStaffSchedule,
  setStaffDayOff,
  setStaffHours,
  moveAppointment,
  resizeAppointment,
  getWeekView,
  getStaffList,
};
