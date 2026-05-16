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

module.exports = router;
