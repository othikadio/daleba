'use strict';
/**
 * Campaign Routes — DALEBA Metacortex Points 453-466
 * [457] /deploy — déploiement campagne Meta/Google
 * [466] /performance — ROAS + CTR
 * /stock/* — inventaire & déductions
 * /purchase-order/* — bons de commande & approbations
 */
const router    = require('express').Router();
const adsOrch   = require('../services/autonomous-ads-orchestrator');
const stock     = require('../services/dynamic-stock-tracker');
const velocity  = require('../services/stock-velocity-engine');
const purAgent  = require('../services/autonomous-purchase-agent');
const { CampaignAgent } = require('../agents/CampaignAgent');

function getPool(req) { return req.app?.locals?.pool || null; }
function getTenant(req) { return req.headers['x-tenant-id'] || req.query.tenantId || 'default'; }

// ── [453] POST /v1/campaigns — Créer une campagne ─────────────────────────
router.post('/', async (req, res) => {
  try {
    const pool = getPool(req); const T = getTenant(req);
    const { trigger, budget, platform } = req.body;
    const result = await adsOrch.buildCampaign(pool, T, { trigger, budget, platform });
    res.json({ ok: true, ...result });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── [457] POST /v1/campaigns/deploy — Déployer une campagne ───────────────
router.post('/deploy', async (req, res) => {
  try {
    const pool = getPool(req); const T = getTenant(req);
    const { campaignId, platform } = req.body;
    const result = await adsOrch.deployCampaign(pool, T, { campaignId, platform });
    res.json({ ok: true, ...result });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── [466] GET /v1/campaigns/performance — ROAS + CTR ──────────────────────
router.get('/performance', async (req, res) => {
  try {
    const pool = getPool(req); const T = getTenant(req);
    const result = await adsOrch.getCampaignPerformance(pool, T, { campaignId: req.query.campaignId });
    res.json({ ok: true, ...result });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── [455] GET /v1/campaigns/copies — Générer copies pub ───────────────────
router.get('/copies', async (req, res) => {
  try {
    const services = req.query.services ? req.query.services.split(',') : [];
    const result = await adsOrch.generateAdCopies(services, req.query.tone);
    res.json({ ok: true, ...result });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── [454] GET /v1/campaigns/audience — Lookalike Audience ─────────────────
router.get('/audience', async (req, res) => {
  try {
    const pool = getPool(req); const T = getTenant(req);
    const result = await adsOrch.buildLookalikeAudience(pool, T, { topN: parseInt(req.query.topN) || 5 });
    res.json({ ok: true, ...result });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── [452] GET /v1/campaigns/stock — État inventaire ───────────────────────
router.get('/stock', async (req, res) => {
  try {
    const pool = getPool(req); const T = getTenant(req);
    const result = await stock.getInventoryStatus(pool, T);
    res.json({ ok: true, ...result });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── [452] POST /v1/campaigns/stock/seed — Initialiser inventaire ──────────
router.post('/stock/seed', async (req, res) => {
  try {
    const pool = getPool(req); const T = getTenant(req);
    const result = await stock.seedDefaultInventory(pool, T, req.body.initialQty || 1000);
    res.json({ ok: true, ...result });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── [459] POST /v1/campaigns/stock/deduct — Déduire ingrédients ───────────
router.post('/stock/deduct', async (req, res) => {
  try {
    const pool = getPool(req); const T = getTenant(req);
    const { serviceType, quantity, txId } = req.body;
    const result = await stock.deductIngredients(pool, T, { serviceType, quantity, txId });
    res.json({ ok: true, ...result });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── [461] POST /v1/campaigns/stock/check-reorder — Flaguer REORDER_REQUIRED
router.post('/stock/check-reorder', async (req, res) => {
  try {
    const pool = getPool(req); const T = getTenant(req);
    const result = await velocity.checkAndFlagReorderRequired(pool, T);
    res.json({ ok: true, ...result });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── [462] POST /v1/campaigns/purchase-order — Générer bon de commande ─────
router.post('/purchase-order', async (req, res) => {
  try {
    const pool = getPool(req); const T = getTenant(req);
    const { productId, productName, qtyToOrder, unit } = req.body;
    const result = await purAgent.generatePurchaseOrder(pool, T, { productId, productName, qtyToOrder, unit });
    res.json({ ok: true, ...result });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── [465] GET /v1/campaigns/purchase-order/approve/:token — Approbation ───
router.get('/purchase-order/approve/:token', async (req, res) => {
  try {
    const pool = getPool(req); const T = getTenant(req);
    const result = await purAgent.approvePurchaseOrder(pool, T, { token: req.params.token, approvedBy: req.query.by || 'ulrich' });
    if (result.approved) {
      res.send(`<html><body style="font-family:sans-serif;text-align:center;padding:40px"><h2>✅ Bon de commande approuvé</h2><p>PO ${result.poId} — ${result.totalPrice}$ CAD</p></body></html>`);
    } else {
      res.status(404).send(`<html><body style="text-align:center;padding:40px"><h2>❌ Token invalide ou expiré</h2></body></html>`);
    }
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── [462] POST /v1/campaigns/purchase-order/trigger-reorder ───────────────
router.post('/purchase-order/trigger-reorder', async (req, res) => {
  try {
    const pool = getPool(req); const T = getTenant(req);
    const result = await purAgent.triggerReorder(pool, T, { productId: req.body.productId });
    res.json({ ok: true, ...result });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

module.exports = router;
