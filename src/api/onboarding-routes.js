/**
 * DALEBA — Routes Onboarding SaaS
 * Parcours d'inscription "Zéro Prise de Tête" pour nouveaux clients
 * 
 * Étapes:
 * 1. Créer le business (nom, type, adresse)
 * 2. Créer le compte admin
 * 3. Connecter Square (OAuth redirect ou token manuel)
 * 4. Connecter Twilio (auto-provision ou numéro existant)
 * 5. Choisir le plan
 */

const express = require('express');
const router = express.Router();
const bcrypt = require('bcryptjs');
const { pool, DEMO_MODE } = require('../memory/db');
const { generateToken, verifyToken } = require('../middleware/auth');
const { upsertIntegration } = require('../services/tenant-integrations');
const { provisionSubaccount } = require('../services/twilio-master');

// POST /api/onboarding/start — Étape 1: Créer business + admin
router.post('/start', async (req, res) => {
  const { businessName, businessType, address, phone, adminName, adminEmail, adminPassword } = req.body;

  if (!businessName || !adminEmail || !adminPassword) {
    return res.status(400).json({ error: 'businessName, adminEmail et adminPassword requis' });
  }

  const slug = businessName
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '')
    .slice(0, 50);

  try {
    // Créer le business
    const biz = await pool.query(`
      INSERT INTO businesses (name, slug, type, address, phone, timezone, currency)
      VALUES ($1, $2, $3, $4, $5, 'America/Toronto', 'CAD')
      RETURNING id, name, slug
    `, [businessName, slug + '_' + Date.now(), businessType || 'salon', address || '', phone || '']);

    const business = biz.rows[0];

    // Créer l'admin
    const hash = await bcrypt.hash(adminPassword, 12);
    const usr = await pool.query(`
      INSERT INTO users (name, email, password_hash, role, business_id)
      VALUES ($1, $2, $3, 'business_admin', $4)
      RETURNING id, name, email, role
    `, [adminName || adminEmail.split('@')[0], adminEmail, hash, business.id]);

    const user = usr.rows[0];

    // Trial 14 jours sur plan Starter
    await pool.query(`
      INSERT INTO business_subscriptions (business_id, plan_id, status, trial_ends_at)
      SELECT $1, id, 'trial', NOW() + INTERVAL '14 days'
      FROM subscription_plans WHERE name = 'Starter'
    `, [business.id]);

    const token = generateToken({
      id: user.id,
      email: user.email,
      role: user.role,
      businessId: business.id,
    });

    res.status(201).json({
      success: true,
      step: 'business_created',
      nextStep: 'connect_square',
      token,
      business,
      user,
    });
  } catch (err) {
    if (err.code === '23505') return res.status(409).json({ error: 'Email ou business déjà existant' });
    res.status(500).json({ error: err.message });
  }
});

// POST /api/onboarding/connect-square — Étape 2: Connecter Square (token manuel)
router.post('/connect-square', async (req, res) => {
  const authHeader = req.headers.authorization;
  if (!authHeader) return res.status(401).json({ error: 'Token JWT requis' });

  let decoded;
  try { decoded = verifyToken(authHeader.replace('Bearer ', '')); }
  catch { return res.status(401).json({ error: 'Token invalide' }); }

  const { accessToken, locationId } = req.body;
  if (!accessToken) return res.status(400).json({ error: 'accessToken Square requis' });

  // Vérifier le token Square
  try {
    const testRes = await fetch('https://connect.squareup.com/v2/locations', {
      headers: { 'Authorization': `Bearer ${accessToken}`, 'Square-Version': '2024-02-22' }
    });
    if (!testRes.ok) return res.status(400).json({ error: 'Token Square invalide ou expiré' });

    const { locations } = await testRes.json();
    const resolvedLocationId = locationId || locations?.[0]?.id;

    await upsertIntegration(decoded.businessId, 'square', {
      accessToken,
      extra: { location_id: resolvedLocationId, locations: locations?.map(l => ({ id: l.id, name: l.name })) }
    });

    res.json({
      success: true,
      step: 'square_connected',
      nextStep: 'setup_twilio',
      locationId: resolvedLocationId,
      locations: locations?.map(l => ({ id: l.id, name: l.name })),
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/onboarding/setup-twilio — Étape 3: Config Twilio
// Option A: token existant | Option B: auto-provision sous-compte
router.post('/setup-twilio', async (req, res) => {
  const authHeader = req.headers.authorization;
  if (!authHeader) return res.status(401).json({ error: 'Token JWT requis' });

  let decoded;
  try { decoded = verifyToken(authHeader.replace('Bearer ', '')); }
  catch { return res.status(401).json({ error: 'Token invalide' }); }

  const { mode, accountSid, authToken, phoneNumber } = req.body;
  // mode: 'existing' (apport son compte) | 'daleba' (on provision pour lui)

  if (mode === 'existing') {
    if (!accountSid || !authToken || !phoneNumber) {
      return res.status(400).json({ error: 'accountSid, authToken et phoneNumber requis' });
    }

    await pool.query(`
      INSERT INTO tenant_twilio (business_id, twilio_account_sid, twilio_auth_token, phone_number, status)
      VALUES ($1, $2, $3, $4, 'active')
      ON CONFLICT (business_id) DO UPDATE
        SET twilio_account_sid = EXCLUDED.twilio_account_sid,
            twilio_auth_token = EXCLUDED.twilio_auth_token,
            phone_number = EXCLUDED.phone_number,
            status = 'active',
            updated_at = NOW()
    `, [decoded.businessId, accountSid, authToken, phoneNumber]);

    return res.json({ success: true, step: 'twilio_connected', mode: 'existing', phoneNumber });
  }

  if (mode === 'daleba') {
    // Auto-provision: DALEBA gère le numéro (facturation supplémentaire)
    const biz = await pool.query('SELECT name FROM businesses WHERE id = $1', [decoded.businessId]);

    try {
      const sub = await provisionSubaccount(decoded.businessId, biz.rows[0]?.name || 'Business');
      res.json({ success: true, step: 'twilio_provisioning', mode: 'daleba', subaccountSid: sub.sid });
    } catch (err) {
      res.status(500).json({ error: `Provision Twilio impossible: ${err.message}` });
    }
    return;
  }

  res.status(400).json({ error: 'mode requis: existing | daleba' });
});

// GET /api/onboarding/status — État d'avancement de l'onboarding
router.get('/status', async (req, res) => {
  const authHeader = req.headers.authorization;
  if (!authHeader) return res.status(401).json({ error: 'Token JWT requis' });

  let decoded;
  try { decoded = verifyToken(authHeader.replace('Bearer ', '')); }
  catch { return res.status(401).json({ error: 'Token invalide' }); }

  const businessId = decoded.businessId;

  const [biz, integrations, twilio, sub] = await Promise.all([
    pool.query('SELECT * FROM businesses WHERE id = $1', [businessId]),
    pool.query('SELECT provider, is_active FROM tenant_integrations WHERE business_id = $1', [businessId]),
    pool.query('SELECT status, phone_number FROM tenant_twilio WHERE business_id = $1', [businessId]),
    pool.query('SELECT s.status, p.name as plan FROM business_subscriptions s JOIN subscription_plans p ON p.id = s.plan_id WHERE s.business_id = $1', [businessId]),
  ]);

  const providers = integrations.rows.reduce((acc, r) => {
    acc[r.provider] = r.is_active;
    return acc;
  }, {});

  const steps = {
    business_created: !!biz.rows[0],
    square_connected: !!providers.square,
    twilio_ready: twilio.rows[0]?.status === 'active',
    plan_active: ['active', 'trial'].includes(sub.rows[0]?.status),
  };

  const completedSteps = Object.values(steps).filter(Boolean).length;
  const totalSteps = Object.keys(steps).length;

  res.json({
    businessId,
    business: biz.rows[0],
    steps,
    progress: `${completedSteps}/${totalSteps}`,
    subscription: sub.rows[0],
    twilio: twilio.rows[0],
    ready: completedSteps === totalSteps,
  });
});

module.exports = router;
