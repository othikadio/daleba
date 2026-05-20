/**
 * DALEBA — Routes Calendrier Staff Section 16
 * Drag & Drop, vue semaine, congés, horaires
 */

'use strict';

const express = require('express');
const router = express.Router();
const staffCalendar = require('../services/staff-calendar');

// GET /api/calendar/week?start=YYYY-MM-DD — vue semaine tout le staff
router.get('/week', async (req, res) => {
  const { start } = req.query;
  if (!start) return res.status(400).json({ error: 'Paramètre requis: start (YYYY-MM-DD)' });
  try {
    const weekView = await staffCalendar.getWeekView(start);
    res.json({ success: true, weekStart: start, data: weekView });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/calendar/staff/:staffId?date=YYYY-MM-DD — vue jour d'un coiffeur
router.get('/staff/:staffId', async (req, res) => {
  const { date } = req.query;
  const dateStr = date || new Date().toISOString().slice(0, 10);
  try {
    const schedule = await staffCalendar.getStaffSchedule(req.params.staffId, dateStr);
    res.json({ success: true, ...schedule });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/calendar/move — déplacer un RDV
router.post('/move', async (req, res) => {
  const { appointmentId, newStaffId, newDatetime } = req.body;
  if (!appointmentId || !newStaffId || !newDatetime) {
    return res.status(400).json({ error: 'Requis: appointmentId, newStaffId, newDatetime' });
  }
  try {
    const result = await staffCalendar.moveAppointment(appointmentId, newStaffId, newDatetime);
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/calendar/resize — modifier durée d'un RDV
router.post('/resize', async (req, res) => {
  const { appointmentId, durationMinutes } = req.body;
  if (!appointmentId || !durationMinutes) {
    return res.status(400).json({ error: 'Requis: appointmentId, durationMinutes' });
  }
  try {
    const result = await staffCalendar.resizeAppointment(appointmentId, parseInt(durationMinutes));
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/calendar/staff/dayoff — marquer congé
router.post('/staff/dayoff', async (req, res) => {
  const { staffId, date, reason } = req.body;
  if (!staffId || !date) {
    return res.status(400).json({ error: 'Requis: staffId, date (YYYY-MM-DD)' });
  }
  try {
    const result = await staffCalendar.setStaffDayOff(staffId, date, reason || '');
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/calendar/staff/hours — configurer horaires
router.post('/staff/hours', async (req, res) => {
  const { staffId, dayOfWeek, openTime, closeTime } = req.body;
  if (staffId === undefined || dayOfWeek === undefined || !openTime || !closeTime) {
    return res.status(400).json({ error: 'Requis: staffId, dayOfWeek (0-6), openTime, closeTime' });
  }
  try {
    const result = await staffCalendar.setStaffHours(staffId, parseInt(dayOfWeek), openTime, closeTime);
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/calendar/staff/list — liste du staff avec horaires
router.get('/staff/list', async (req, res) => {
  try {
    const staff = await staffCalendar.getStaffList();
    res.json({ success: true, staff });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
