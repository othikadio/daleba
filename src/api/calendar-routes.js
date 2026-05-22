/**
 * DALEBA — Routes Calendrier (PRIVÉ — employés + admin)
 * Vue agenda, gestion des RDV, horaires staff
 */

const express = require('express');
const router = express.Router();
const { pool } = require('../memory/db');
const appointments = require('../services/appointments');
const { requireAuth, requireEmployee, requireBusinessAdmin, ROLES } = require('../middleware/auth');
const { requireTenant } = require('../middleware/tenant');

router.use(requireAuth, requireTenant);

// GET /api/calendar — Calendrier (filtrable par staff, semaine)
// Query: ?staffId=1&start=2026-05-19&end=2026-05-25
router.get('/', requireEmployee, async (req, res) => {
  const { staffId, start, end } = req.query;

  // Un employé ne voit que son propre calendrier
  let resolvedStaffId = staffId ? parseInt(staffId) : null;
  if (req.user.role === ROLES.EMPLOYEE) {
    const staffResult = await pool.query(
      'SELECT id FROM staff WHERE user_id = $1 AND business_id = $2',
      [req.user.id, req.businessId]
    );
    if (staffResult.rows.length) resolvedStaffId = staffResult.rows[0].id;
  }

  const startDate = start || new Date().toISOString().slice(0, 10);
  const endDate = end || new Date(Date.now() + 7 * 86400000).toISOString().slice(0, 10);

  try {
    const appts = await appointments.getStaffCalendar({
      businessId: req.businessId,
      staffId: resolvedStaffId,
      startDate,
      endDate,
    });
    res.json({ appointments: appts, staffId: resolvedStaffId, startDate, endDate });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/calendar/today — RDV du jour
router.get('/today', requireEmployee, async (req, res) => {
  const today = new Date().toISOString().slice(0, 10);
  const tomorrow = new Date(Date.now() + 86400000).toISOString().slice(0, 10);

  let staffId = null;
  if (req.user.role === ROLES.EMPLOYEE) {
    const s = await pool.query(
      'SELECT id FROM staff WHERE user_id = $1 AND business_id = $2',
      [req.user.id, req.businessId]
    );
    if (s.rows.length) staffId = s.rows[0].id;
  }

  try {
    const appts = await appointments.getStaffCalendar({
      businessId: req.businessId,
      staffId,
      startDate: today,
      endDate: tomorrow,
    });

    res.json({
      date: today,
      total: appts.length,
      appointments: appts,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// PATCH /api/calendar/:id/status — Changer le statut d'un RDV
router.patch('/:id/status', requireEmployee, async (req, res) => {
  const { status } = req.body;
  try {
    const appt = await appointments.updateStatus(
      parseInt(req.params.id),
      req.businessId,
      status
    );
    res.json({ success: true, appointment: appt });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/calendar/reminder — Déclenche l'envoi des rappels SMS (cron ou manuel)
router.post('/reminder', requireBusinessAdmin, async (req, res) => {
  try {
    const result = await appointments.sendReminders();
    res.json({ success: true, ...result });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/calendar/staff — Liste du staff avec horaires
router.get('/staff', requireEmployee, async (req, res) => {
  try {
    const result = await pool.query(
      'SELECT id, name, role_title, schedule, color, is_active FROM staff WHERE business_id = $1 ORDER BY name',
      [req.businessId]
    );
    res.json({ staff: result.rows });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/calendar/staff — Ajouter un membre du staff
router.post('/staff', requireBusinessAdmin, async (req, res) => {
  const { name, roleTitle, services = [], schedule = {}, color } = req.body;
  if (!name) return res.status(400).json({ error: 'name requis' });

  try {
    const result = await pool.query(`
      INSERT INTO staff (business_id, name, role_title, services, schedule, color)
      VALUES ($1, $2, $3, $4, $5, $6)
      RETURNING *
    `, [req.businessId, name, roleTitle || 'Employé', services, JSON.stringify(schedule), color || '#6366f1']);
    res.status(201).json({ success: true, staff: result.rows[0] });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// PATCH /api/calendar/staff/:id/schedule — Modifier les horaires d'un staff
router.patch('/staff/:id/schedule', requireBusinessAdmin, async (req, res) => {
  const { schedule } = req.body;
  if (!schedule) return res.status(400).json({ error: 'schedule requis' });

  try {
    const result = await pool.query(`
      UPDATE staff SET schedule = $1 WHERE id = $2 AND business_id = $3 RETURNING *
    `, [JSON.stringify(schedule), req.params.id, req.businessId]);

    if (!result.rows.length) return res.status(404).json({ error: 'Staff introuvable' });
    res.json({ success: true, staff: result.rows[0] });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/calendar/stats — Stats rapides (admin)
router.get('/stats', requireBusinessAdmin, async (req, res) => {
  const today = new Date().toISOString().slice(0, 10);

  try {
    const [todayStats, weekStats, topStaff] = await Promise.all([
      pool.query(`
        SELECT 
          COUNT(*) as total,
          COUNT(CASE WHEN status = 'completed' THEN 1 END) as completed,
          COUNT(CASE WHEN status = 'cancelled' THEN 1 END) as cancelled,
          COUNT(CASE WHEN status = 'no_show' THEN 1 END) as no_shows,
          COALESCE(SUM(CASE WHEN status = 'completed' THEN price END), 0) as revenue
        FROM appointments
        WHERE business_id = $1 AND DATE(start_time AT TIME ZONE 'America/Toronto') = $2
      `, [req.businessId, today]),

      pool.query(`
        SELECT COUNT(*) as total,
          COALESCE(SUM(CASE WHEN status = 'completed' THEN price END), 0) as revenue
        FROM appointments
        WHERE business_id = $1
          AND start_time >= NOW() - INTERVAL '7 days'
      `, [req.businessId]),

      pool.query(`
        SELECT st.name, COUNT(a.id) as appointments
        FROM appointments a
        JOIN staff st ON st.id = a.staff_id
        WHERE a.business_id = $1
          AND a.start_time >= NOW() - INTERVAL '30 days'
          AND a.status = 'completed'
        GROUP BY st.id, st.name
        ORDER BY appointments DESC
        LIMIT 5
      `, [req.businessId]),
    ]);

    res.json({
      today: todayStats.rows[0],
      week: weekStats.rows[0],
      topStaff: topStaff.rows,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});


// GET /api/calendar/appointments?start=ISO&end=ISO — RDVs sur une période (Square + DB)
router.get('/appointments', requireEmployee, async (req, res) => {
  const { start, end } = req.query;
  if (!start || !end) return res.status(400).json({ error: 'start et end requis (ISO)' });

  const SQUARE_TOKEN = process.env.SQUARE_ACCESS_TOKEN;
  const LOCATION_ID  = process.env.SQUARE_LOCATION_ID || 'LTDE9RP9PSHX7';
  const results = [];

  // 1. Square bookings
  if (SQUARE_TOKEN) {
    try {
      const r = await fetch(
        `https://connect.squareup.com/v2/bookings?location_id=${LOCATION_ID}&start_at_min=${encodeURIComponent(start)}&start_at_max=${encodeURIComponent(end)}&limit=100`,
        { headers: { Authorization: `Bearer ${SQUARE_TOKEN}`, 'Square-Version': '2024-02-22' } }
      );
      if (r.ok) {
        const d = await r.json();
        for (const b of (d.bookings || [])) {
          const seg = b.appointment_segments?.[0] || {};
          results.push({
            id: b.id,
            start_at: b.start_at,
            duration_min: seg.duration_minutes || 60,
            staff_id: seg.team_member_id,
            service_id: seg.service_variation_id,
            status: b.status,
            source: 'square',
          });
        }
      }
    } catch (e) { console.warn('[calendar/appointments] Square:', e.message); }
  }

  // 2. DB bookings
  try {
    const r = await pool.query(
      `SELECT id, service_name, staff_id, staff_name, client_name, client_phone,
              start_at, duration_min, status
       FROM daleba_bookings
       WHERE start_at BETWEEN $1 AND $2 AND status != 'cancelled'
       ORDER BY start_at ASC`,
      [start, end]
    );
    for (const row of r.rows) {
      results.push({ ...row, source: 'db' });
    }
  } catch (e) { /* DB optionnelle */ }

  res.json({ appointments: results, count: results.length });
});

// PATCH /api/calendar/appointments/:id/reschedule — Reprogrammer un RDV
router.patch('/appointments/:id/reschedule', requireEmployee, async (req, res) => {
  const { newStartTime } = req.body;
  const apptId = req.params.id;
  if (!newStartTime) return res.status(400).json({ error: 'newStartTime requis (ISO)' });

  const SQUARE_TOKEN = process.env.SQUARE_ACCESS_TOKEN;
  let squareUpdated = false;

  // 1. Essai Square
  if (SQUARE_TOKEN && !apptId.startsWith('db_')) {
    try {
      const r = await fetch(`https://connect.squareup.com/v2/bookings/${apptId}`, {
        method: 'PUT',
        headers: {
          Authorization: `Bearer ${SQUARE_TOKEN}`,
          'Content-Type': 'application/json',
          'Square-Version': '2024-02-22',
        },
        body: JSON.stringify({
          idempotency_key: `reschedule-${apptId}-${Date.now()}`,
          booking: { start_at: new Date(newStartTime).toISOString() },
        }),
      });
      if (r.ok) squareUpdated = true;
    } catch (e) { console.warn('[calendar/reschedule] Square:', e.message); }
  }

  // 2. DB update
  let dbUpdated = false;
  try {
    const numId = parseInt(apptId.replace('db_', ''));
    if (!isNaN(numId)) {
      await pool.query(
        `UPDATE daleba_bookings SET start_at = $1 WHERE id = $2`,
        [new Date(newStartTime).toISOString(), numId]
      );
      dbUpdated = true;
    }
  } catch (e) { /* DB optionnelle */ }

  // 3. SMS au client
  try {
    const numId = parseInt(apptId.replace('db_', ''));
    if (!isNaN(numId)) {
      const r = await pool.query(
        `SELECT client_phone, client_name, service_name FROM daleba_bookings WHERE id = $1`,
        [numId]
      );
      if (r.rows.length && r.rows[0].client_phone) {
        const b = r.rows[0];
        const d = new Date(newStartTime);
        const dateStr = d.toLocaleDateString('fr-CA', { weekday:'long', year:'numeric', month:'long', day:'numeric', timeZone:'America/Toronto' });
        const timeStr = d.toLocaleTimeString('fr-CA', { hour:'2-digit', minute:'2-digit', timeZone:'America/Toronto' });
        const TWILIO_SID   = process.env.TWILIO_ACCOUNT_SID;
        const TWILIO_AUTH  = process.env.TWILIO_AUTH_TOKEN;
        const TWILIO_FROM  = process.env.TWILIO_PHONE_NUMBER || '+13022328291';
        if (TWILIO_SID && TWILIO_AUTH) {
          const params = new URLSearchParams({ From: TWILIO_FROM, To: b.client_phone, Body: `Votre RDV chez Kadio Coiffure a été déplacé au ${dateStr} à ${timeStr}. Service: ${b.service_name}. Questions: (514) 919-5970.` });
          await fetch(`https://api.twilio.com/2010-04-01/Accounts/${TWILIO_SID}/Messages.json`, {
            method: 'POST',
            headers: { Authorization: 'Basic ' + Buffer.from(`${TWILIO_SID}:${TWILIO_AUTH}`).toString('base64'), 'Content-Type': 'application/x-www-form-urlencoded' },
            body: params.toString(),
          }).catch(() => {});
        }
      }
    }
  } catch (_) {}

  if (squareUpdated || dbUpdated) {
    return res.json({ success: true, bookingId: apptId, newStartTime, squareUpdated, dbUpdated });
  }
  res.status(404).json({ error: 'RDV introuvable ou non modifiable' });
});

module.exports = router;
