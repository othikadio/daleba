/**
 * DALEBA — Routes Réservation (PUBLIQUES)
 * Pas d'auth requis — accessible par tous les clients en ligne
 * Supporte le mode démo (pas de PostgreSQL)
 */

const express = require('express');
const router = express.Router();
const { pool, DEMO_MODE } = require('../memory/db');
const { requireTenant } = require('../middleware/tenant');
const {
  DEMO_BUSINESS, DEMO_SERVICES, DEMO_STAFF,
  generateSlots, createDemoAppointment, demoAppointments,
} = require('../services/demo-data');

// En mode démo, on saute le middleware tenant
if (!DEMO_MODE) {
  router.use(requireTenant);
}

// GET /api/booking/info — Infos publiques de l'entreprise
router.get('/info', async (req, res) => {
  if (DEMO_MODE) {
    return res.json({ business: DEMO_BUSINESS });
  }
  try {
    const result = await pool.query(
      'SELECT name, address, phone, email, website, logo_url, settings FROM businesses WHERE id = $1 AND is_active = true',
      [req.businessId]
    );
    if (!result.rows.length) return res.status(404).json({ error: 'Entreprise introuvable' });
    res.json({ business: result.rows[0] });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/booking/services — Liste des services disponibles
router.get('/services', async (req, res) => {
  if (DEMO_MODE) {
    return res.json({ services: DEMO_SERVICES });
  }
  try {
    const result = await pool.query(
      'SELECT id, name, description, duration_min, price, category FROM services WHERE business_id = $1 AND is_active = true ORDER BY category, name',
      [req.businessId]
    );
    res.json({ services: result.rows });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/booking/staff — Liste des employés disponibles
router.get('/staff', async (req, res) => {
  if (DEMO_MODE) {
    const { serviceId } = req.query;
    let staff = DEMO_STAFF;
    if (serviceId) {
      staff = DEMO_STAFF.filter(s => s.services.includes(parseInt(serviceId)));
    }
    return res.json({ staff });
  }
  const { serviceId } = req.query;
  try {
    let query = `
      SELECT id, name, role_title, color, avatar_url
      FROM staff
      WHERE business_id = $1 AND is_active = true
    `;
    const params = [req.businessId];
    if (serviceId) {
      query += ` AND ($2 = ANY(services) OR services = '{}')`;
      params.push(parseInt(serviceId));
    }
    query += ' ORDER BY name';
    const result = await pool.query(query, params);
    res.json({ staff: result.rows });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/booking/slots — Créneaux disponibles
router.get('/slots', async (req, res) => {
  const { staffId, serviceId, date } = req.query;
  if (!staffId || !serviceId || !date) {
    return res.status(400).json({ error: 'staffId, serviceId et date requis' });
  }
  if (DEMO_MODE) {
    const slots = generateSlots(date, staffId);
    return res.json({ slots, date, staffId });
  }
  try {
    const appointments = require('../services/appointments');
    const slots = await appointments.getAvailableSlots({
      businessId: req.businessId,
      staffId: parseInt(staffId),
      serviceId: parseInt(serviceId),
      date,
    });
    res.json(slots);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/booking/book — Réserver un créneau
router.post('/book', async (req, res) => {
  const {
    staffId, serviceId, date, time,
    clientName, clientPhone, clientEmail, notes,
  } = req.body;

  if (!staffId || !serviceId || !date || !time || !clientName) {
    return res.status(400).json({ error: 'staffId, serviceId, date, time et clientName requis' });
  }
  if (!clientPhone && !clientEmail) {
    return res.status(400).json({ error: 'clientPhone ou clientEmail requis' });
  }

  if (DEMO_MODE) {
    const appointment = createDemoAppointment({
      businessId: 1, staffId, serviceId, clientName, clientPhone, clientEmail, date, time, notes,
    });
    return res.status(201).json({
      success: true,
      appointment: {
        id: appointment.id,
        clientName: appointment.client_name,
        service: appointment.service_name,
        startTime: appointment.start_time,
        endTime: appointment.end_time,
        status: appointment.status,
      },
      message: '✅ RDV confirmé ! (Mode démonstration)',
    });
  }

  try {
    const appointments = require('../services/appointments');
    const appointment = await appointments.createAppointment({
      businessId: req.businessId,
      staffId: parseInt(staffId),
      serviceId: parseInt(serviceId),
      clientName, clientPhone, clientEmail,
      date, time, notes,
    });
    res.status(201).json({
      success: true,
      appointment: {
        id: appointment.id,
        clientName: appointment.client_name,
        service: appointment.service_name,
        startTime: appointment.start_time,
        endTime: appointment.end_time,
        status: appointment.status,
      },
      message: clientPhone
        ? '✅ RDV confirmé ! Vous recevrez un SMS de confirmation.'
        : '✅ RDV confirmé !',
    });
  } catch (err) {
    if (err.message.includes('disponible')) {
      return res.status(409).json({ error: err.message });
    }
    res.status(500).json({ error: err.message });
  }
});

// GET /api/booking/appointment/:id — Détails d'un RDV
router.get('/appointment/:id', async (req, res) => {
  if (DEMO_MODE) {
    const appt = demoAppointments.find(a => a.id === parseInt(req.params.id));
    if (!appt) return res.status(404).json({ error: 'RDV introuvable' });
    return res.json({ appointment: appt });
  }
  try {
    const result = await pool.query(`
      SELECT a.id, a.client_name, a.service_name, a.start_time, a.end_time,
             a.status, a.price, st.name as staff_name, b.name as business_name,
             b.address as business_address, b.phone as business_phone
      FROM appointments a
      LEFT JOIN staff st ON st.id = a.staff_id
      JOIN businesses b ON b.id = a.business_id
      WHERE a.id = $1 AND a.business_id = $2
    `, [req.params.id, req.businessId]);
    if (!result.rows.length) return res.status(404).json({ error: 'RDV introuvable' });
    res.json({ appointment: result.rows[0] });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/booking/cancel/:id — Annuler un RDV
router.post('/cancel/:id', async (req, res) => {
  if (DEMO_MODE) {
    const appt = demoAppointments.find(a => a.id === parseInt(req.params.id));
    if (!appt) return res.status(404).json({ error: 'RDV introuvable' });
    appt.status = 'cancelled';
    return res.json({ success: true, message: 'RDV annulé', appointment: appt });
  }
  try {
    const appointments = require('../services/appointments');
    const appt = await appointments.updateStatus(parseInt(req.params.id), req.businessId, 'cancelled');
    res.json({ success: true, message: 'RDV annulé', appointment: appt });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
