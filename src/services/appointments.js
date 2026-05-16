/**
 * DALEBA — Service de Rendez-vous
 * Logique métier complète : créer, modifier, annuler, disponibilités
 */

const { pool } = require('../memory/db');
const twilio = require('./twilio');

/**
 * Récupère les créneaux disponibles pour un staff/service/date
 */
async function getAvailableSlots({ businessId, staffId, serviceId, date }) {
  // Récupère la durée du service
  const svcResult = await pool.query(
    'SELECT duration_min, name FROM services WHERE id = $1 AND business_id = $2',
    [serviceId, businessId]
  );
  if (!svcResult.rows.length) throw new Error('Service introuvable');
  const { duration_min, name: serviceName } = svcResult.rows[0];

  // Récupère les horaires du staff
  const staffResult = await pool.query(
    'SELECT schedule, name FROM staff WHERE id = $1 AND business_id = $2',
    [staffId, businessId]
  );
  if (!staffResult.rows.length) throw new Error('Employé introuvable');
  const { schedule, name: staffName } = staffResult.rows[0];

  // Jour de semaine (0=dim, 1=lun, ..., 6=sam)
  const dayOfWeek = new Date(date).getDay();
  const dayNames = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
  const daySchedule = schedule[dayNames[dayOfWeek]];

  if (!daySchedule || !daySchedule.isOpen) {
    return { date, staffId, staffName, serviceName, slots: [] };
  }

  const { start = '09:00', end = '18:00', breaks = [] } = daySchedule;

  // Récupère les RDV existants ce jour
  const existing = await pool.query(`
    SELECT start_time, end_time FROM appointments
    WHERE staff_id = $1
      AND DATE(start_time AT TIME ZONE 'America/Toronto') = $2
      AND status NOT IN ('cancelled')
  `, [staffId, date]);

  // Génère les créneaux de (duration_min) en (duration_min) entre start et end
  const slots = [];
  const [startH, startM] = start.split(':').map(Number);
  const [endH, endM] = end.split(':').map(Number);
  const startMinutes = startH * 60 + startM;
  const endMinutes = endH * 60 + endM;

  for (let t = startMinutes; t + duration_min <= endMinutes; t += duration_min) {
    const slotStart = `${String(Math.floor(t / 60)).padStart(2, '0')}:${String(t % 60).padStart(2, '0')}`;
    const slotEndMin = t + duration_min;
    const slotEnd = `${String(Math.floor(slotEndMin / 60)).padStart(2, '0')}:${String(slotEndMin % 60).padStart(2, '0')}`;

    const slotStartDt = new Date(`${date}T${slotStart}:00`);
    const slotEndDt = new Date(`${date}T${slotEnd}:00`);

    // Vérifie les pauses
    const inBreak = breaks.some(b => {
      const bStart = new Date(`${date}T${b.start}:00`);
      const bEnd = new Date(`${date}T${b.end}:00`);
      return slotStartDt < bEnd && slotEndDt > bStart;
    });

    // Vérifie les conflits avec RDV existants
    const hasConflict = existing.rows.some(appt => {
      return slotStartDt < new Date(appt.end_time) && slotEndDt > new Date(appt.start_time);
    });

    if (!inBreak && !hasConflict) {
      slots.push({ time: slotStart, endTime: slotEnd, available: true });
    }
  }

  return { date, staffId, staffName, serviceName, durationMin: duration_min, slots };
}

/**
 * Crée un rendez-vous
 */
async function createAppointment({
  businessId, staffId, serviceId,
  clientName, clientPhone, clientEmail,
  date, time, notes,
}) {
  // Récupère le service
  const svc = await pool.query(
    'SELECT * FROM services WHERE id = $1 AND business_id = $2 AND is_active = true',
    [serviceId, businessId]
  );
  if (!svc.rows.length) throw new Error('Service introuvable ou inactif');
  const service = svc.rows[0];

  const startTime = new Date(`${date}T${time}:00`);
  const endTime = new Date(startTime.getTime() + service.duration_min * 60000);

  // Vérifie qu'il n'y a pas de conflit
  const conflict = await pool.query(`
    SELECT id FROM appointments
    WHERE staff_id = $1
      AND status NOT IN ('cancelled')
      AND start_time < $2
      AND end_time > $3
  `, [staffId, endTime, startTime]);

  if (conflict.rows.length > 0) {
    throw new Error('Ce créneau n\'est plus disponible');
  }

  // Crée le RDV
  const result = await pool.query(`
    INSERT INTO appointments (
      business_id, staff_id, service_id,
      client_name, client_phone, client_email,
      service_name, start_time, end_time, duration_min,
      price, status, notes
    ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,'pending',$12)
    RETURNING *
  `, [
    businessId, staffId, serviceId,
    clientName, clientPhone, clientEmail,
    service.name, startTime, endTime, service.duration_min,
    service.price, notes,
  ]);

  const appointment = result.rows[0];

  // Met à jour les stats client
  if (clientPhone || clientEmail) {
    await pool.query(`
      INSERT INTO clients (business_id, name, email, phone, visit_count, last_visit)
      VALUES ($1, $2, $3, $4, 1, NOW())
      ON CONFLICT (business_id, email)
      DO UPDATE SET visit_count = clients.visit_count + 1, last_visit = NOW()
    `, [businessId, clientName, clientEmail || null, clientPhone || null]).catch(() => {});
  }

  // SMS de confirmation automatique
  if (clientPhone) {
    const dateStr = startTime.toLocaleDateString('fr-CA', {
      weekday: 'long', day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit',
      timeZone: 'America/Toronto',
    });
    await twilio.sendConfirmation({
      clientPhone,
      clientName,
      date: dateStr,
      service: service.name,
    }).catch(err => console.error('SMS confirmation error:', err.message));

    await pool.query('UPDATE appointments SET sms_sent = true WHERE id = $1', [appointment.id]);
  }

  return appointment;
}

/**
 * Récupère le calendrier d'un staff (semaine)
 */
async function getStaffCalendar({ businessId, staffId, startDate, endDate }) {
  const result = await pool.query(`
    SELECT 
      a.*,
      s.name as service_name_detail,
      st.name as staff_name
    FROM appointments a
    LEFT JOIN services s ON s.id = a.service_id
    LEFT JOIN staff st ON st.id = a.staff_id
    WHERE a.business_id = $1
      AND ($2::integer IS NULL OR a.staff_id = $2)
      AND a.start_time >= $3
      AND a.start_time <= $4
      AND a.status != 'cancelled'
    ORDER BY a.start_time ASC
  `, [businessId, staffId || null, startDate, endDate]);

  return result.rows;
}

/**
 * Met à jour le statut d'un RDV
 */
async function updateStatus(appointmentId, businessId, status) {
  const validStatuses = ['pending', 'confirmed', 'completed', 'cancelled', 'no_show'];
  if (!validStatuses.includes(status)) throw new Error('Statut invalide');

  const result = await pool.query(`
    UPDATE appointments
    SET status = $1, updated_at = NOW()
    WHERE id = $2 AND business_id = $3
    RETURNING *
  `, [status, appointmentId, businessId]);

  if (!result.rows.length) throw new Error('RDV introuvable');

  // SMS d'annulation
  const appt = result.rows[0];
  if (status === 'cancelled' && appt.client_phone) {
    const dateStr = new Date(appt.start_time).toLocaleDateString('fr-CA', {
      weekday: 'long', day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit',
      timeZone: 'America/Toronto',
    });
    await twilio.sendCancellation({
      clientPhone: appt.client_phone,
      clientName: appt.client_name,
      date: dateStr,
    }).catch(() => {});
  }

  return appt;
}

/**
 * Envoie les rappels SMS (à appeler via cron 24h avant)
 */
async function sendReminders() {
  const tomorrow = new Date();
  tomorrow.setDate(tomorrow.getDate() + 1);
  const tomorrowStart = new Date(tomorrow.setHours(0, 0, 0, 0));
  const tomorrowEnd = new Date(tomorrow.setHours(23, 59, 59, 999));

  const result = await pool.query(`
    SELECT a.*, b.name as business_name
    FROM appointments a
    JOIN businesses b ON b.id = a.business_id
    WHERE a.start_time BETWEEN $1 AND $2
      AND a.status IN ('pending', 'confirmed')
      AND a.reminder_sent = false
      AND a.client_phone IS NOT NULL
  `, [tomorrowStart, tomorrowEnd]);

  let sent = 0;
  for (const appt of result.rows) {
    const dateStr = new Date(appt.start_time).toLocaleDateString('fr-CA', {
      weekday: 'long', day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit',
      timeZone: 'America/Toronto',
    });
    try {
      await twilio.sendReminder({
        clientPhone: appt.client_phone,
        clientName: appt.client_name,
        date: dateStr,
        service: appt.service_name,
      });
      await pool.query('UPDATE appointments SET reminder_sent = true WHERE id = $1', [appt.id]);
      sent++;
    } catch (err) {
      console.error(`Reminder error for appt ${appt.id}:`, err.message);
    }
  }

  return { sent, total: result.rows.length };
}

module.exports = {
  getAvailableSlots,
  createAppointment,
  getStaffCalendar,
  updateStatus,
  sendReminders,
};
