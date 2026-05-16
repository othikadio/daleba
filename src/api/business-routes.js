/**
 * DALEBA — Routes Gestion des Entreprises (Multi-Tenant)
 * CRUD complet : créer, configurer, gérer toutes les entreprises
 * Réservé au super_admin (Ulrich) pour créer/gérer les tenants
 */

const express = require('express');
const router = express.Router();
const { pool } = require('../memory/db');
const { requireAuth, requireSuperAdmin, requireBusinessAdmin, ROLES, generateToken } = require('../middleware/auth');
const { logEntry, ENTRY_TYPES } = require('../services/journal');

// POST /api/businesses — Créer une nouvelle entreprise (super_admin)
router.post('/', requireAuth, requireSuperAdmin, async (req, res) => {
  const {
    name, slug, type, address, phone, email, website,
    timezone = 'America/Toronto', currency = 'CAD', settings = {}
  } = req.body;

  if (!name || !slug || !type) {
    return res.status(400).json({ error: 'name, slug et type requis' });
  }

  try {
    const result = await pool.query(`
      INSERT INTO businesses (name, slug, type, address, phone, email, website, timezone, currency, settings, created_at)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, NOW())
      RETURNING *
    `, [name, slug, type, address, phone, email, website, timezone, currency, JSON.stringify(settings)]);

    const business = result.rows[0];

    await logEntry(ENTRY_TYPES.ACHIEVED, `Nouvelle entreprise créée: ${name}`, '', { businessId: business.id, type });

    res.status(201).json({ success: true, business });
  } catch (err) {
    if (err.code === '23505') {
      return res.status(409).json({ error: `Le slug "${slug}" est déjà utilisé` });
    }
    res.status(500).json({ error: err.message });
  }
});

// GET /api/businesses — Liste toutes les entreprises (super_admin)
router.get('/', requireAuth, requireSuperAdmin, async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT 
        b.*,
        COUNT(DISTINCT u.id) as user_count,
        COUNT(DISTINCT a.id) as appointment_count
      FROM businesses b
      LEFT JOIN users u ON u.business_id = b.id
      LEFT JOIN appointments a ON a.business_id = b.id
      GROUP BY b.id
      ORDER BY b.created_at DESC
    `);
    res.json({ businesses: result.rows });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/businesses/dashboard — Dashboard global Ulrich (toutes les entreprises)
router.get('/dashboard', requireAuth, requireSuperAdmin, async (req, res) => {
  try {
    const today = new Date().toISOString().slice(0, 10);

    const [businesses, todayAppts, revenue] = await Promise.all([
      pool.query('SELECT id, name, slug, type, is_active FROM businesses ORDER BY name'),
      pool.query(`
        SELECT b.name as business_name, COUNT(a.id) as appointments
        FROM appointments a
        JOIN businesses b ON b.id = a.business_id
        WHERE DATE(a.start_time) = $1
        GROUP BY b.id, b.name
      `, [today]),
      pool.query(`
        SELECT b.name as business_name, COALESCE(SUM(p.amount), 0) as revenue
        FROM payments p
        JOIN businesses b ON b.id = p.business_id
        WHERE DATE(p.created_at) = $1
        GROUP BY b.id, b.name
      `, [today]),
    ]);

    res.json({
      totalBusinesses: businesses.rows.length,
      businesses: businesses.rows,
      today: {
        date: today,
        appointments: todayAppts.rows,
        revenue: revenue.rows,
      },
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/businesses/:id — Détails d'une entreprise
router.get('/:id', requireAuth, async (req, res) => {
  const { id } = req.params;

  // Un non-super_admin ne peut voir que son propre business
  if (req.user.role !== ROLES.SUPER_ADMIN && req.user.businessId !== parseInt(id)) {
    return res.status(403).json({ error: 'Accès refusé' });
  }

  try {
    const result = await pool.query('SELECT * FROM businesses WHERE id = $1', [id]);
    if (!result.rows.length) return res.status(404).json({ error: 'Entreprise introuvable' });
    res.json({ business: result.rows[0] });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// PATCH /api/businesses/:id — Modifier une entreprise
router.patch('/:id', requireAuth, requireBusinessAdmin, async (req, res) => {
  const { id } = req.params;

  if (req.user.role !== ROLES.SUPER_ADMIN && req.user.businessId !== parseInt(id)) {
    return res.status(403).json({ error: 'Accès refusé' });
  }

  const { name, address, phone, email, website, settings, is_active } = req.body;

  try {
    const result = await pool.query(`
      UPDATE businesses
      SET 
        name = COALESCE($1, name),
        address = COALESCE($2, address),
        phone = COALESCE($3, phone),
        email = COALESCE($4, email),
        website = COALESCE($5, website),
        settings = COALESCE($6::jsonb, settings),
        is_active = COALESCE($7, is_active),
        updated_at = NOW()
      WHERE id = $8
      RETURNING *
    `, [name, address, phone, email, website, settings ? JSON.stringify(settings) : null, is_active, id]);

    res.json({ success: true, business: result.rows[0] });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/businesses/:id/invite — Inviter un employé ou admin
router.post('/:id/invite', requireAuth, requireBusinessAdmin, async (req, res) => {
  const businessId = parseInt(req.params.id);
  const { email, name, role = ROLES.EMPLOYEE } = req.body;

  if (!email || !name) {
    return res.status(400).json({ error: 'email et name requis' });
  }

  // Génère un token d'invitation (valide 7 jours)
  const inviteToken = generateToken({
    type: 'invitation',
    email,
    name,
    role,
    businessId,
  }, '7d');

  // TODO: envoyer par email/SMS avec le lien d'activation
  const inviteUrl = `${process.env.APP_URL || 'https://daleba.app'}/join?token=${inviteToken}`;

  res.json({
    success: true,
    inviteUrl,
    message: `Invitation générée pour ${name} (${role}) — valide 7 jours`,
    token: inviteToken,
  });
});

module.exports = router;
