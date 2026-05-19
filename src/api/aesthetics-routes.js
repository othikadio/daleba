'use strict';
/**
 * Aesthetics Routes — DALEBA Metacortex Points 352-363, 366
 * Tous les endpoints esthétique + widget + analyse cutanée.
 */
const express    = require('express');
const router     = express.Router();
const { pool }   = require('../memory/db');
const { requireAuth } = require('../middleware/auth');
const bus        = require('../services/event-bus');
const multer     = require('multer');

const records     = require('../services/aesthetic-records');
const skinAnalyzer= require('../services/skin-analyzer');
const sandbox     = require('../services/extension-sandbox');
const inventory   = require('../services/aesthetic-inventory');
const prescription= require('../services/botanical-prescription');
const widgetGen   = require('../services/widget-generator');

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } }); // 10MB max

const ok  = (res, data, s=200) => res.status(s).json({ success:true,  data,  ts: new Date().toISOString() });
const err = (res, msg, s=400)  => res.status(s).json({ success:false, error: msg, ts: new Date().toISOString() });

const getTenant = (req) => req.user?.tenantId || req.query.tenantId || 'kadio';

// ── [352] POST /extension/mount ──────────────────────────────────────────────
router.post('/extension/mount', requireAuth, async (req, res) => {
  try {
    const tenantId    = getTenant(req);
    const { extensionKey, config } = req.body;
    if (!extensionKey) return err(res, 'extensionKey requis');
    const result = await sandbox.mount(pool, tenantId, extensionKey, config || {});
    ok(res, result, 201);
  } catch(e) { err(res, e.message, 400); }
});

// ── [355-358] POST /analyze-skin ─────────────────────────────────────────────
router.post('/analyze-skin', requireAuth, upload.single('image'), async (req, res) => {
  try {
    const tenantId = getTenant(req);
    const { clientId } = req.body;

    // Accepte base64 direct ou upload fichier [356]
    let imageBase64;
    if (req.file) {
      imageBase64 = `data:${req.file.mimetype};base64,${req.file.buffer.toString('base64')}`;
    } else if (req.body.imageBase64) {
      imageBase64 = req.body.imageBase64;
    } else {
      return err(res, 'Image requise: champ "image" (multipart) ou "imageBase64" (base64)', 400);
    }

    const result = await skinAnalyzer.analyze({ tenantId, imageBase64, clientId, pool });
    ok(res, result);
  } catch(e) { err(res, e.message, 500); }
});

// ── [366] GET /prescriptions/:clientId ───────────────────────────────────────
router.get('/prescriptions/:clientId', requireAuth, async (req, res) => {
  try {
    const tenantId = getTenant(req);
    const { clientId } = req.params;
    const record = await records.getRecord(pool, tenantId, clientId);
    if (!record?.last_analysis) return err(res, 'Aucune analyse disponible pour ce client', 404);
    const rx = await prescription.generate(pool, tenantId, clientId, record.last_analysis);
    res.set('Content-Type', 'text/html');
    res.send(rx.html);
  } catch(e) { err(res, e.message, 500); }
});

// ── [354] GET /records/:clientId ─────────────────────────────────────────────
router.get('/records/:clientId', requireAuth, async (req, res) => {
  try {
    const tenantId = getTenant(req);
    const record   = await records.getRecord(pool, tenantId, req.params.clientId);
    if (!record) return err(res, 'Fiche non trouvée', 404);
    ok(res, record);
  } catch(e) { err(res, e.message, 500); }
});

router.post('/records', requireAuth, async (req, res) => {
  try {
    const tenantId = getTenant(req);
    const { clientId, ...data } = req.body;
    if (!clientId) return err(res, 'clientId requis');
    const record = await records.createRecord(pool, tenantId, clientId, data);
    ok(res, record, 201);
  } catch(e) { err(res, e.message, 500); }
});

// ── [367] POST /inventory/deduct ─────────────────────────────────────────────
router.post('/inventory/deduct', requireAuth, async (req, res) => {
  try {
    const tenantId = getTenant(req);
    const { formulationId, quantitiesUsed } = req.body;
    if (!quantitiesUsed?.length) return err(res, 'quantitiesUsed requis');
    const result = await inventory.deduct(pool, tenantId, formulationId, quantitiesUsed);
    ok(res, result);
  } catch(e) { err(res, e.message, 500); }
});

// ── [359-364] GET /widget/:tenantId ──────────────────────────────────────────
// Widget JS injectable — sans auth (public endpoint)
router.get('/widget/:tenantId', async (req, res) => {
  try {
    const { tenantId }  = req.params;
    const widgetKey     = req.headers['x-daleba-widget-key'];
    if (!widgetKey?.startsWith('tk_')) return res.status(401).send('// DALEBA: Clé widget invalide');

    // [362] CORS validation
    const origin = req.headers.origin || req.headers.referer;
    if (origin) {
      const validation = await widgetGen.validateOrigin(pool, tenantId, origin);
      if (!validation.valid) {
        res.set('Content-Type', 'text/javascript');
        return res.status(403).send(`// DALEBA Widget: Origine non autorisée (${origin})`);
      }
    }

    const r = await pool.query(`SELECT tenant_name, website_url, brand_config FROM tenant_settings WHERE tenant_id=$1`, [tenantId]).catch(() => ({rows:[]}));
    const tenant = r.rows[0];

    const { script, sizeKb } = widgetGen.generateWidgetScript(tenantId, widgetKey, {
      salonName: tenant?.tenant_name || tenantId,
      brand:     tenant?.brand_config || {},
    });

    res.set('Content-Type', 'application/javascript');
    res.set('Cache-Control', 'public, max-age=300'); // cache 5min
    res.set('X-Widget-Size', `${sizeKb}kb`);
    res.send(script);
  } catch(e) {
    res.status(500).send(`// DALEBA Widget Error: ${e.message}`);
  }
});

// ── [368] POST /aesthetics/reminders ─────────────────────────────────────────
router.post('/reminders', requireAuth, async (req, res) => {
  try {
    const tenantId = getTenant(req);
    const remindSvc = require('../services/aesthetic-reminder');
    const result    = await remindSvc.scheduleReminder(pool, { tenantId, ...req.body });
    ok(res, result, 201);
  } catch(e) { err(res, e.message); }
});

// ── [374] POST /aesthetics/check-allergens ────────────────────────────────────
router.post('/check-allergens', requireAuth, async (req, res) => {
  try {
    const { ingredients, clientAllergies } = req.body;
    const allergyTracker = require('../services/allergy-tracker');
    const result = allergyTracker.checkCrossAllergens(ingredients || [], clientAllergies || []);
    ok(res, result);
  } catch(e) { err(res, e.message); }
});

// ── [380] POST /aesthetics/progress/snapshot ─────────────────────────────────
router.post('/progress/snapshot', requireAuth, async (req, res) => {
  try {
    const tenantId = getTenant(req);
    const tracker  = require('../services/skin-progress-tracker');
    const result   = await tracker.saveSnapshot(pool, { tenantId, ...req.body });
    ok(res, result, 201);
  } catch(e) { err(res, e.message); }
});

router.get('/progress/:clientId', requireAuth, async (req, res) => {
  try {
    const tenantId = getTenant(req);
    const tracker  = require('../services/skin-progress-tracker');
    const result   = await tracker.compareProgress(pool, tenantId, req.params.clientId);
    ok(res, result);
  } catch(e) { err(res, e.message); }
});

// ── [375] POST /aesthetics/voice-command ─────────────────────────────────────
router.post('/voice-command', requireAuth, async (req, res) => {
  try {
    const tenantId = getTenant(req);
    const extractor = require('../services/voice-aesthetics-extractor');
    const result    = await extractor.handleVoiceAestheticCommand(pool, tenantId, req.body.utterance);
    if (!result) return err(res, 'Aucune commande esthétique détectée', 404);
    ok(res, result);
  } catch(e) { err(res, e.message); }
});

// ── [382] GET /aesthetics/questionnaire + POST /aesthetics/questionnaire ──────
router.get('/questionnaire', async (req, res) => {
  const q = require('../services/skin-fallback-questionnaire');
  ok(res, { questions: q.getQuestions() });
});

router.post('/questionnaire', async (req, res) => {
  try {
    const q      = require('../services/skin-fallback-questionnaire');
    const result = q.determineSkinType(req.body.answers || {});
    ok(res, result);
  } catch(e) { err(res, e.message); }
});

// ── [371] POST /aesthetics/sync-square ───────────────────────────────────────
router.post('/sync-square', requireAuth, async (req, res) => {
  try {
    const tenantId = getTenant(req);
    const squareSync = require('../services/aesthetic-square-sync');
    const result     = await squareSync.syncAestheticToSquare({ tenantId, ...req.body });
    ok(res, result, 201);
  } catch(e) { err(res, e.message, 503); }
});

// ── [384] POST /aesthetics/marketing/campaign ─────────────────────────────────
router.post('/marketing/campaign', requireAuth, async (req, res) => {
  try {
    const tenantId  = getTenant(req);
    const marketing = require('../services/aesthetic-marketing');
    const result    = await marketing.buildSkinTypeCampaign(pool, tenantId, req.body.skinType || 'sec');
    ok(res, result);
  } catch(e) { err(res, e.message); }
});

module.exports = router;
