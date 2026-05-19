'use strict';
/**
 * V1 Onboarding Routes — DALEBA Metacortex Points 254, 267, 269, 282, 284, 285, 287, 289
 */
const express     = require('express');
const router      = express.Router();
const bcrypt      = require('bcryptjs');
const { pool }    = require('../memory/db');

// Rate limiter custom [254] (sans dépendance externe)
const _rateMap = new Map();
function rateLimit(maxReqs, windowMs) {
  return (req, res, next) => {
    const ip  = req.ip || req.connection.remoteAddress || 'unknown';
    const now = Date.now();
    const key = `${ip}:${req.path}`;
    const entry = _rateMap.get(key) || { count: 0, resetAt: now + windowMs };
    if (now > entry.resetAt) { entry.count = 0; entry.resetAt = now + windowMs; }
    entry.count++;
    _rateMap.set(key, entry);
    if (entry.count > maxReqs) {
      return res.status(429).json({ error: 'Trop de requêtes. Réessayez dans quelques instants.', code: 'RATE_LIMITED' });
    }
    next();
  };
}

// Services
const OnboardingAgent = require('../agents/OnboardingAgent');
const squareOauth     = require('../services/square-oauth');
const tenantCreds     = require('../services/tenant-credentials');
const seedWorker      = require('../services/tenant-seed-worker');
const pingValidator   = require('../services/ping-validator');
const telephony       = require('../services/onboarding-telephony');
const journal         = require('../services/onboarding-journal');
const staffSync       = require('../services/staff-sync');
const cleanup         = require('../services/onboarding-cleanup');
const apiKeys         = require('../services/tenant-api-keys');

// [282] Réponse JSON standardisée
function ok(res, data, status = 200) {
  res.status(status).json({ success: true, data, ts: new Date().toISOString() });
}
function err(res, message, code = 'ERROR', status = 400) {
  res.status(status).json({ success: false, error: message, code, ts: new Date().toISOString() });
}

// [289] Validation téléphone basique (sans libphonenumber-js — optionnel)
function validatePhone(phone) {
  if (!phone) return true; // optionnel
  // E.164 ou format local
  return /^\+?[1-9]\d{6,14}$/.test(phone.replace(/[\s\-().]/g, ''));
}

// [254] POST /register — rate limit 5/IP/heure
router.post('/register', rateLimit(5, 3600000), async (req, res) => {
  try {
    const { businessName, country, timezone, currency, managerName, managerEmail, managerPhone, areaCode, password } = req.body;

    // Validation [282]
    if (!businessName || businessName.length < 3) return err(res, 'Nom entreprise requis (min 3 chars)', 'VALIDATION_ERROR');
    if (!managerEmail || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(managerEmail)) return err(res, 'Email invalide', 'VALIDATION_ERROR');
    if (!country || country.length !== 2) return err(res, 'Code pays ISO 2 requis', 'VALIDATION_ERROR');
    if (managerPhone && !validatePhone(managerPhone)) return err(res, 'Format téléphone invalide', 'VALIDATION_ERROR');

    // [287] Hash mot de passe si fourni
    let passwordHash = null;
    if (password) passwordHash = await bcrypt.hash(password, 12);

    // Exécuter l'agent d'onboarding [251]
    const result = await OnboardingAgent.execute({ businessName, country, timezone: timezone || 'America/Toronto', currency: currency || 'CAD', managerName, managerEmail, managerPhone, areaCode, passwordHash });

    // [279] Journal
    await journal.record(pool, { tenantId: result.tenantId, tenantName: businessName, country, status: 'SUCCESS', steps: result.steps }).catch(()=>{});

    ok(res, {
      tenantId:         result.tenantId,
      dalebaPhone:      result.dalebaPhone,
      squareAuthUrl:    result.squareAuthUrl,
      mmiInstructions:  result.mmiInstructions,
      tenantApiKey:     result.tenantApiKey,
      step:             'square_connect',
      message:          'Onboarding initié. Connectez Square pour continuer.',
    }, 201);
  } catch (e) {
    console.error('[v1/register]', e.message);
    err(res, 'Erreur interne onboarding', 'INTERNAL_ERROR', 500);
  }
});

// [257] GET /square/callback — OAuth2 Square
router.get('/square/callback', async (req, res) => {
  try {
    const { code, state } = req.query;
    if (!code || !state) return err(res, 'code et state requis', 'MISSING_PARAMS');

    const stateData = squareOauth.verifyState(state);
    const { tenantId } = stateData;

    const redirectUri = `${process.env.DALEBA_BASE_URL}/api/v1/onboarding/square/callback`;
    const tokens      = await squareOauth.exchangeCode(code, redirectUri);
    const locationId  = await squareOauth.getLocationId(tokens.accessToken);

    // [258] Stocker chiffré
    await tenantCreds.store(pool, tenantId, 'SQUARE_ACCESS_TOKEN', tokens.accessToken);
    await tenantCreds.store(pool, tenantId, 'SQUARE_LOCATION_ID', locationId);
    await pool.query(`UPDATE tenant_settings SET status='active', square_connected=true WHERE tenant_id=$1`, [tenantId]).catch(()=>{});

    // [259] Seed async (sans bloquer le redirect) + [284] rate-limit friendly
    setImmediate(() => {
      seedWorker.seedTenant({ tenantId, accessToken: tokens.accessToken, locationId, pool })
        .then(r => require('./event-bus') && require('../services/event-bus').system(`[Seed] ${tenantId}: ${JSON.stringify(r)}`))
        .catch(() => {});
      staffSync.syncFromSquare(tenantId, tokens.accessToken, pool).catch(() => {});
    });

    res.redirect(`/admin/onboarding?step=twilio&tenant=${tenantId}&square=ok`);
  } catch (e) {
    console.error('[v1/square/callback]', e.message);
    err(res, 'Erreur OAuth Square: ' + e.message, 'OAUTH_ERROR');
  }
});

// [267] POST /ping-validate
router.post('/ping-validate', rateLimit(10, 3600000), async (req, res) => {
  try {
    const { tenantId, tenantPhone } = req.body;
    if (!tenantId || !tenantPhone) return err(res, 'tenantId et tenantPhone requis', 'MISSING_PARAMS');

    const dalebaNumber = process.env.TWILIO_PHONE_NUMBER || '+13022328291';
    const result       = await pingValidator.validateForwarding({ tenantPhone, dalebaNumber, tenantId });

    ok(res, { ...result, message: result.validated ? '✅ Transfert actif et confirmé!' : '⚠️ Transfert non détecté.' });
  } catch (e) {
    err(res, e.message, 'PING_ERROR', 500);
  }
});

// [269] GET + POST /fixed-costs
router.get('/fixed-costs', rateLimit(30, 3600000), async (req, res) => {
  try {
    const { tenantId } = req.query;
    if (!tenantId) return err(res, 'tenantId requis', 'MISSING_PARAMS');
    const r = await pool.query(`SELECT * FROM tenant_fixed_costs WHERE tenant_id=$1 ORDER BY created_at DESC`, [tenantId]);
    ok(res, { costs: r.rows, tenantId });
  } catch (e) { err(res, e.message, 'DB_ERROR', 500); }
});

router.post('/fixed-costs', rateLimit(20, 3600000), async (req, res) => {
  try {
    const { tenantId, label, amount, currency = 'CAD', frequency = 'monthly', category = 'other' } = req.body;
    if (!tenantId || !label || !amount) return err(res, 'tenantId, label et amount requis', 'VALIDATION_ERROR');

    // Assurer que la table existe (utilise tenant-finances si dispo, sinon crée)
    await pool.query(`
      CREATE TABLE IF NOT EXISTS tenant_fixed_costs (
        id        SERIAL PRIMARY KEY,
        tenant_id TEXT NOT NULL,
        label     TEXT NOT NULL,
        amount    NUMERIC(12,2) NOT NULL,
        currency  TEXT DEFAULT 'CAD',
        frequency TEXT DEFAULT 'monthly',
        category  TEXT DEFAULT 'other',
        active    BOOL DEFAULT true,
        created_at TIMESTAMPTZ DEFAULT NOW()
      )
    `).catch(()=>{});

    const r = await pool.query(`
      INSERT INTO tenant_fixed_costs (tenant_id, label, amount, currency, frequency, category)
      VALUES ($1,$2,$3,$4,$5,$6) RETURNING *
    `, [tenantId, label, parseFloat(amount), currency, frequency, category]);
    ok(res, { cost: r.rows[0] }, 201);
  } catch (e) { err(res, e.message, 'DB_ERROR', 500); }
});

// GET /status/:tenantId
router.get('/status/:tenantId', async (req, res) => {
  try {
    const status = await OnboardingAgent.getOnboardingStatus(req.params.tenantId);
    if (!status) return err(res, 'Tenant non trouvé', 'NOT_FOUND', 404);
    ok(res, status);
  } catch (e) { err(res, e.message, 'DB_ERROR', 500); }
});

// GET /mmi-instructions
router.get('/mmi-instructions', async (req, res) => {
  try {
    const { tenantId, country = 'CA', tenantPhone = '' } = req.query;
    const dalebaNumber = process.env.TWILIO_PHONE_NUMBER || '+13022328291';
    const instructions = telephony.generateForwardingInstructions(tenantPhone, dalebaNumber, country);
    ok(res, instructions);
  } catch (e) { err(res, e.message, 'MMI_ERROR', 500); }
});

// GET /voice-summary — [286]
router.get('/voice-summary', async (req, res) => {
  try {
    const summary = await OnboardingAgent.getVoiceSummary();
    ok(res, { summary });
  } catch (e) { err(res, e.message, 'SUMMARY_ERROR', 500); }
});

// POST /cleanup — [283] purge onboardings abandonnés
router.post('/cleanup', async (req, res) => {
  try {
    const result = await cleanup.runCleanup(pool);
    ok(res, result);
  } catch (e) { err(res, e.message, 'CLEANUP_ERROR', 500); }
});

module.exports = router;
