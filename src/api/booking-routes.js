/**
 * DALEBA — Routes Réservation (PUBLIQUES)
 * Pas d'auth requis — accessible par tous les clients en ligne
 * Ces routes sont le cœur du système de booking
 */

const express = require('express');
const router = express.Router();
const { pool } = require('../memory/db');
const appointments = require('../services/appointments');
const { requireTenant } = require('../middleware/tenant');

// Toutes les routes booking nécessitent un tenant résolu
router.use(requireTenant);

// GET /api/booking/info — Infos publiques de l'entreprise
router.get('/info', async (req, res) => {
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

// GET /api/booking/staff — Liste des employés disponibles (pour un service)
router.get('/staff', async (req, res) => {
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
// Query: ?staffId=1&serviceId=2&date=2026-05-20
router.get('/slots', async (req, res) => {
  const { staffId, serviceId, date } = req.query;

  if (!staffId || !serviceId || !date) {
    return res.status(400).json({ error: 'staffId, serviceId et date requis' });
  }

  try {
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
    return res.status(400).json({
      error: 'staffId, serviceId, date, time et clientName requis'
    });
  }

  if (!clientPhone && !clientEmail) {
    return res.status(400).json({ error: 'clientPhone ou clientEmail requis' });
  }

  try {
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

// GET /api/booking/appointment/:id — Détails d'un RDV (pour la page de confirmation)
router.get('/appointment/:id', async (req, res) => {
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

// POST /api/booking/cancel/:id — Annuler un RDV (par le client)
router.post('/cancel/:id', async (req, res) => {
  try {
    const appt = await appointments.updateStatus(
      parseInt(req.params.id),
      req.businessId,
      'cancelled'
    );
    res.json({ success: true, message: 'RDV annulé', appointment: appt });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
