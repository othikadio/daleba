/**
 * DALEBA — Portail Staff Routes
 * Dashboard, agenda, clients, notes
 */

const express = require('express');
const router  = express.Router();
const { pool } = require('../memory/db');
const { requireAuth, requireAdmin } = require('./auth-staff-routes');

// Protéger toutes les routes /api/staff-portal/*
router.use(requireAuth);

// Square API helper
async function squareGet(path) {
  const token = process.env.SQUARE_ACCESS_TOKEN;
  if (!token) throw new Error('SQUARE_ACCESS_TOKEN manquant');
  const res = await fetch(`https://connect.squareup.com/v2${path}`, {
    headers: { Authorization: `Bearer ${token}`, 'Square-Version': '2024-01-18', 'Content-Type': 'application/json' }
  });
  if (!res.ok) throw new Error(`Square ${res.status}: ${await res.text()}`);
  return res.json();
}

function todayRange() {
  const now = new Date();
  const start = new Date(now); start.setHours(0,0,0,0);
  const end   = new Date(now); end.setHours(23,59,59,999);
  return { start: start.toISOString(), end: end.toISOString() };
}

/* ── GET /dashboard ── */
router.get('/dashboard', requireAuth, async (req, res) => {
  try {
    const { start, end } = todayRange();
    const locationId = process.env.SQUARE_LOCATION_ID || 'LTDE9RP9PSHX7';
    let bookings = [];
    try {
      const data = await squareGet(`/bookings?location_id=${locationId}&start_at_min=${start}&start_at_max=${end}&limit=50`);
      bookings = (data.bookings || []).filter(b => {
        const appt = b.appointment_segments?.[0];
        return appt?.team_member_id === req.staff.squareId;
      });
    } catch (e) {
      console.warn('[StaffPortal] Square bookings:', e.message);
    }

    // Stats semaine
    const now = new Date();
    const weekStart = new Date(now); weekStart.setDate(now.getDate() - now.getDay());
    weekStart.setHours(0,0,0,0);
    let weekBookings = [];
    try {
      const data = await squareGet(`/bookings?location_id=${locationId}&start_at_min=${weekStart.toISOString()}&start_at_max=${end}&limit=100`);
      weekBookings = (data.bookings || []).filter(b => b.appointment_segments?.[0]?.team_member_id === req.staff.squareId);
    } catch {}

    res.json({
      today: bookings.map(b => ({
        id: b.id,
        startAt: b.start_at,
        duration: b.appointment_segments?.[0]?.duration_minutes,
        service: b.appointment_segments?.[0]?.service_variation_id,
        status: b.status,
        customerId: b.customer_id,
      })),
      stats: {
        todayCount: bookings.length,
        weekCount: weekBookings.length,
      }
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/* ── GET /schedule ── */
router.get('/schedule', requireAuth, async (req, res) => {
  try {
    const date = req.query.date || new Date().toISOString().split('T')[0];
    const start = new Date(date + 'T00:00:00Z').toISOString();
    const end   = new Date(date + 'T23:59:59Z').toISOString();
    const locationId = process.env.SQUARE_LOCATION_ID || 'LTDE9RP9PSHX7';

    let bookings = [];
    try {
      const data = await squareGet(`/bookings?location_id=${locationId}&start_at_min=${start}&start_at_max=${end}&limit=50`);
      bookings = (data.bookings || []).filter(b => b.appointment_segments?.[0]?.team_member_id === req.staff.squareId);
    } catch (e) {
      console.warn('[StaffPortal] schedule Square:', e.message);
    }

    res.json({ date, bookings });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/* ── GET /clients ── */
router.get('/clients', requireAuth, async (req, res) => {
  try {
    const locationId = process.env.SQUARE_LOCATION_ID || 'LTDE9RP9PSHX7';
    let customers = [];
    try {
      const data = await squareGet('/customers?limit=50&sort_field=CREATED_AT&sort_order=DESC');
      customers = (data.customers || []).map(c => ({
        id: c.id,
        name: `${c.given_name || ''} ${c.family_name || ''}`.trim(),
        phone: c.phone_number,
        email: c.email_address,
      }));
    } catch (e) {
      console.warn('[StaffPortal] clients Square:', e.message);
    }
    res.json({ customers });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/* ── GET /clients/:id/notes ── */
router.get('/clients/:id/notes', requireAuth, async (req, res) => {
  if (!pool) return res.json({ notes: [] });
  try {
    const q = await pool.query(
      `SELECT n.*, s.name as staff_name FROM daleba_client_notes n
       LEFT JOIN daleba_staff s ON s.id=n.staff_id
       WHERE n.square_customer_id=$1 ORDER BY n.created_at DESC`,
      [req.params.id]
    );
    res.json({ notes: q.rows });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/* ── POST /clients/:id/notes ── */
router.post('/clients/:id/notes', requireAuth, async (req, res) => {
  const { note, category, clientName, clientPhone } = req.body;
  if (!note) return res.status(400).json({ error: 'note requis' });
  if (!pool) return res.json({ ok: true, id: 1 });
  try {
    const q = await pool.query(
      `INSERT INTO daleba_client_notes (square_customer_id, client_name, client_phone, note, category, staff_id)
       VALUES ($1,$2,$3,$4,$5,$6) RETURNING *`,
      [req.params.id, clientName || null, clientPhone || null, note, category || 'general', req.staff.id]
    );
    res.json({ ok: true, note: q.rows[0] });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/* ── PUT /clients/:id/notes/:noteId ── */
router.put('/clients/:id/notes/:noteId', requireAuth, async (req, res) => {
  const { note, category } = req.body;
  if (!pool) return res.json({ ok: true });
  try {
    await pool.query(
      `UPDATE daleba_client_notes SET note=$1, category=$2, updated_at=NOW()
       WHERE id=$3 AND staff_id=$4`,
      [note, category || 'general', req.params.noteId, req.staff.id]
    );
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/* ── GET /team-notes (admin) ── */
router.get('/team-notes', requireAdmin, async (req, res) => {
  if (!pool) return res.json({ notes: [] });
  try {
    const q = await pool.query(
      `SELECT n.*, a.name as author_name, t.name as target_name
       FROM daleba_staff_notes n
       JOIN daleba_staff a ON a.id=n.author_id
       JOIN daleba_staff t ON t.id=n.target_id
       ORDER BY n.created_at DESC LIMIT 100`
    );
    res.json({ notes: q.rows });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/* ── POST /team-notes (admin) ── */
router.post('/team-notes', requireAdmin, async (req, res) => {
  const { targetId, note, isPrivate } = req.body;
  if (!targetId || !note) return res.status(400).json({ error: 'targetId et note requis' });
  if (!pool) return res.json({ ok: true, id: 1 });
  try {
    const q = await pool.query(
      `INSERT INTO daleba_staff_notes (author_id, target_id, note, is_private)
       VALUES ($1,$2,$3,$4) RETURNING id`,
      [req.staff.id, targetId, note, isPrivate !== false]
    );
    res.json({ ok: true, id: q.rows[0].id });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/* ── GET /team (admin) ── */
router.get('/team', requireAdmin, async (req, res) => {
  if (!pool) return res.json({ staff: [] });
  try {
    const q = await pool.query(
      'SELECT id,name,email,phone,role,square_id,speciality,bio,is_active,created_at FROM daleba_staff ORDER BY id'
    );
    res.json({ staff: q.rows });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/* ── PUT /team/:id (admin) ── */
router.put('/team/:id', requireAdmin, async (req, res) => {
  const { name, email, phone, role, speciality, bio, isActive } = req.body;
  if (!pool) return res.json({ ok: true });
  try {
    await pool.query(
      `UPDATE daleba_staff SET name=COALESCE($1,name), email=COALESCE($2,email),
       phone=COALESCE($3,phone), role=COALESCE($4,role), speciality=COALESCE($5,speciality),
       bio=COALESCE($6,bio), is_active=COALESCE($7,is_active) WHERE id=$8`,
      [name, email, phone, role, speciality, bio, isActive, req.params.id]
    );
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
