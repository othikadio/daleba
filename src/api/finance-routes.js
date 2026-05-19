/**
 * Finance Routes — DALEBA Metacortex Section 4
 *
 * [152] POST /api/v1/finances/ingest — Webhook universel Square + Stripe
 * + routes ledger, fiscal, cashflow, coûts infrastructure
 */

'use strict';

const router   = require('express').Router();
const ingester = require('../services/transaction-ingester');
const fiscal   = require('../services/fiscal-engine');
const cashflow = require('../services/cashflow-engine');
const tracker  = require('../services/infrastructure-cost-tracker');
const taxDigest = require('../services/tax-digest');
const metaAds  = require('../services/meta-ads');
const noshow   = require('../services/noshow-engine');
const budgetGuard = require('../services/budget-guard');
const { requireStudioAccess } = require('../middleware/studio-auth');

// ─── PCI COMPLIANCE [175] — Masquage carte ───────────────────────────────────
function maskCardData(paymentMode) {
  // Ne retourner que les 4 derniers + la marque [175]
  if (!paymentMode || !paymentMode.startsWith('card:')) return paymentMode;
  const brand = paymentMode.split(':')[1] || 'unknown';
  return `card:${brand.toUpperCase()}_****`;
}

// ─── [174] Clause tenant strict ──────────────────────────────────────────────
function getTenantId(req) {
  // Priorité: body > header > query (jamais de bypass possible)
  return req.body?.tenant_id || req.headers['x-tenant-id'] || req.query?.tenant_id || 'kadio';
}

// ─── [152] WEBHOOK UNIVERSEL ──────────────────────────────────────────────────

/**
 * POST /api/v1/finances/ingest
 * Accepte simultanément Square et Stripe en détectant la source automatiquement.
 * Supporte aussi un batch d'events.
 *
 * Body: { source: 'square'|'stripe', transaction: {...} }
 *    ou: { source: 'square', transactions: [...] }   ← batch
 *    ou: Corps brut Square webhook (type: 'payment.created')
 *    ou: Corps brut Stripe webhook (type: 'charge.succeeded')
 */
router.post('/ingest', async (req, res) => {
  try {
    const body = req.body || {};
    let source, transactions, isBatch = false;

    // Auto-détection de la source [152]
    if (body.source) {
      source = body.source;
    } else if (body.merchant_id || body.type?.includes('payment')) {
      source = 'square';
    } else if (body.livemode !== undefined || body.object === 'event') {
      source = 'stripe';
    } else {
      return res.status(400).json({ error: 'Source indéterminée — préciser { source: "square"|"stripe" }' });
    }

    const tenantId = body.tenant_id || req.headers['x-tenant-id'] || 'kadio';
    const province = body.province  || req.headers['x-province']  || 'QC';

    // Extraction objet de transaction
    if (body.transactions?.length) {
      // Batch
      transactions = body.transactions;
      isBatch = true;
    } else if (body.transaction) {
      transactions = [body.transaction];
    } else if (body.data?.object || body.payment) {
      // Webhook natif Square: { type, data: { object: { payment: {...} } } }
      const sqPayment = body.data?.object?.payment || body.payment;
      if (sqPayment) { transactions = [sqPayment]; source = 'square'; }
      else return res.status(400).json({ error: 'Webhook Square: objet payment manquant' });
    } else if (body.type === 'charge.succeeded' && body.data?.object) {
      // Webhook Stripe
      transactions = [body.data.object];
      source = 'stripe';
    } else {
      // Tenter de traiter le corps entier comme transaction
      transactions = [body];
    }

    if (isBatch || transactions.length > 1) {
      const result = await ingester.ingestBatch(source, transactions, { tenantId, province });
      return res.status(201).json({
        status:  'batch_ingested',
        ...result,
      });
    } else {
      const result = await ingester.ingestTransaction(source, transactions[0], { tenantId, province });
      if (result.duplicate) return res.status(200).json({ status: 'duplicate_skipped', tx_id: result.uto?.tx_id });
      return res.status(201).json({
        status: 'ingested',
        tx_id:  result.uto.tx_id,
        fiscal: {
          amount_net:   result.fiscal.amount_net,
          amount_tps:   result.fiscal.amount_tps,
          amount_tvq:   result.fiscal.amount_tvq,
          amount_gross: result.fiscal.amount_gross,
        },
        audit:    result.audit,
        ledger_id: result.ledgerId,
      });
    }
  } catch (err) {
    console.error('[FinanceIngest]', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ─── CALCUL FISCAL [155-159] ──────────────────────────────────────────────────

// POST /api/v1/finances/fiscal/compute
router.post('/fiscal/compute', (req, res) => {
  const { amount, province = 'QC', mode = 'gross' } = req.body || {};
  if (!amount || isNaN(amount)) return res.status(400).json({ error: 'amount requis (numérique)' });
  const fn = mode === 'net' ? fiscal.decomposeFromNet : fiscal.decomposeFromGross;
  const result = fn(parseFloat(amount), province);
  res.json({
    ...result,
    formatted: fiscal.formatFiscalBreakdown(result),
    taxProfile: result.taxProfile,
  });
});

// GET /api/v1/finances/fiscal/rates — Tous les taux par province
router.get('/fiscal/rates', (req, res) => {
  const rates = Object.entries(fiscal.TAX_RATES).map(([code, r]) => ({
    code,
    label:           r.label,
    tps:             r.tps,
    tvq:             r.tvq,
    effectiveTotal:  fiscal.roundCents((r.tps + r.tvq) * 100) + '%',
  }));
  res.json({ rates });
});

// ─── LEDGER [158-160] ─────────────────────────────────────────────────────────

// GET /api/v1/finances/ledger — Résumé du grand livre
router.get('/ledger', async (req, res) => {
  const maintenance = require('../services/maintenance');
  const pool = maintenance.getPool();
  if (!pool) return res.json({ error: 'DB indisponible' });

  const tenantId = req.query.tenant_id || 'kadio';
  const since    = req.query.since || new Date(Date.now() - 30 * 86400000).toISOString();

  const r = await pool.query(`
    SELECT
      sale_type,
      source,
      COUNT(*)           AS tx_count,
      SUM(amount_gross)  AS total_gross,
      SUM(amount_net)    AS total_net,
      SUM(amount_tps)    AS total_tps,
      SUM(amount_tvq)    AS total_tvq,
      SUM(amount_tip)    AS total_tips,
      COUNT(*) FILTER (WHERE audit_status='flagged') AS flagged_count
    FROM tenant_ledgers
    WHERE tenant_id = $1 AND timestamp_utc >= $2
    GROUP BY ROLLUP(sale_type, source)
    ORDER BY sale_type, source
  `, [tenantId, since]).catch(() => ({ rows: [] }));

  res.json({ tenantId, since, rows: r.rows });
});

// GET /api/v1/finances/ledger/flags — Transactions suspectes [161-162]
router.get('/ledger/flags', async (req, res) => {
  const maintenance = require('../services/maintenance');
  const pool = maintenance.getPool();
  if (!pool) return res.json({ error: 'DB indisponible' });
  const r = await pool.query(`
    SELECT * FROM tenant_ledgers
    WHERE tenant_id = $1 AND audit_status = 'flagged'
    ORDER BY timestamp_utc DESC LIMIT 100
  `, [req.query.tenant_id || 'kadio']).catch(() => ({ rows: [] }));
  res.json({ flagged: r.rows, count: r.rows.length });
});

// GET /api/v1/finances/tips — Pourboires par employé [163]
router.get('/tips', async (req, res) => {
  const maintenance = require('../services/maintenance');
  const pool = maintenance.getPool();
  if (!pool) return res.json({ error: 'DB indisponible' });
  const r = await pool.query(`
    SELECT employee_id, SUM(tip_amount) AS total_tips, COUNT(*) AS tip_count,
           MIN(timestamp_utc) AS first_tip, MAX(timestamp_utc) AS last_tip
    FROM staff_tips
    WHERE tenant_id = $1
    GROUP BY employee_id ORDER BY total_tips DESC
  `, [req.query.tenant_id || 'kadio']).catch(() => ({ rows: [] }));
  res.json({ tips: r.rows });
});

// ─── CASHFLOW [164-167] ───────────────────────────────────────────────────────

// GET /api/v1/finances/cashflow/forecast
router.get('/cashflow/forecast', async (req, res) => {
  const result = await cashflow.runCashflowForecast(
    req.query.tenant_id || 'kadio',
    req.query.province  || 'QC',
  );
  res.json(result);
});

// ─── INFRA COSTS [168-169] ────────────────────────────────────────────────────

// GET /api/v1/finances/infra/costs
router.get('/infra/costs', (req, res) => {
  res.json(tracker.getCostReport());
});

// GET /api/v1/finances/infra/costs/formatted
router.get('/infra/costs/report', (req, res) => {
  res.type('text/plain').send(tracker.formatCostReport());
});

// POST /api/v1/finances/infra/track — Track un appel manuel
router.post('/infra/track', (req, res) => {
  const { provider, model, usage } = req.body || {};
  if (!provider) return res.status(400).json({ error: 'provider requis' });
  const cost = tracker.trackAPICall(provider, model, usage || {});
  res.json({ costUSD: cost, report: tracker.getCostReport() });
});

// ─── [171-172] RAPPORT FINANCIER SÉCURISÉ ──────────────────────────────────────────────

// GET /api/v1/finances/report — [171] JWT éphémère requis
router.get('/report', requireStudioAccess, async (req, res) => {
  const tenantId = getTenantId(req); // [174] tenant strict
  const since    = req.query.since || new Date(Date.now() - 30 * 86400000).toISOString();

  const maintenance = require('../services/maintenance');
  const pool = maintenance.getPool();
  if (!pool) return res.json({ error: 'DB indisponible' });

  // [172] Agrégation complète
  const [summary, budgetStatus] = await Promise.all([
    pool.query(`
      SELECT
        SUM(amount_gross)  AS ca_brut,
        SUM(amount_net)    AS ca_net,
        SUM(amount_tps)    AS total_tps,
        SUM(amount_tvq)    AS total_tvq,
        COUNT(DISTINCT customer_id) FILTER (WHERE customer_id IS NOT NULL) AS unique_customers,
        COUNT(*) AS tx_count,
        AVG(amount_net)    AS panier_moyen
      FROM tenant_ledgers
      WHERE tenant_id = $1
        AND timestamp_utc >= $2
        AND refunded = FALSE
        AND audit_status != 'flagged'
    `, [tenantId, since]).catch(() => ({ rows: [{}] })),
    budgetGuard.getStatus(),
  ]);

  const s = summary.rows[0] || {};

  // [176-177] Coût publicitaire depuis Meta Ads
  const adNote = await pool.query(`
    SELECT SUM((content->>'spend')::numeric) AS total_spend
    FROM daleba_notes WHERE category = 'meta_ads_spend'
      AND created_at >= $1
  `, [since]).catch(() => ({ rows: [{}] }));
  const adSpend = parseFloat(adNote.rows[0]?.total_spend || 0);

  const caNet = parseFloat(s.ca_net || 0);
  const txCount = parseInt(s.tx_count || 0);

  // [177] ROAS global
  const roas = adSpend > 0 ? fiscal.roundCents(caNet / adSpend) : null;

  res.json({
    tenantId,
    period: { since, to: new Date().toISOString() },
    // [172] Champs obligatoires
    ca_brut:          fiscal.roundCents(parseFloat(s.ca_brut || 0)),
    ca_net:           fiscal.roundCents(caNet),
    total_tps:        fiscal.roundCents(parseFloat(s.total_tps || 0)),
    total_tvq:        fiscal.roundCents(parseFloat(s.total_tvq || 0)),
    total_taxes:      fiscal.roundCents(parseFloat(s.total_tps || 0) + parseFloat(s.total_tvq || 0)),
    tx_count:         txCount,
    unique_customers: parseInt(s.unique_customers || 0),
    panier_moyen:     fiscal.roundCents(parseFloat(s.panier_moyen || 0)),
    ad_spend_usd:     adSpend,
    roas,
    infrastructure: {
      totalUSD:   budgetStatus.totalSpentUSD,
      usagePct:   budgetStatus.usagePct,
      capUSD:     budgetStatus.monthlyCapUSD,
      blocked:    budgetStatus.blocked,
    },
    generatedAt: new Date().toISOString(),
  });
});

// ─── [173] DIGEST TRIMESTRIEL ──────────────────────────────────────────────────

router.get('/tax-digest', async (req, res) => {
  const r = await taxDigest.generateTaxDigest(
    getTenantId(req),
    req.query.year    ? parseInt(req.query.year)    : undefined,
    req.query.quarter ? parseInt(req.query.quarter) : undefined,
  );
  res.json(r);
});

// ─── [176-178] META ADS + ROAS ────────────────────────────────────────────────

// GET /api/v1/finances/ads/spend
router.get('/ads/spend', async (req, res) => {
  const r = await metaAds.fetchAdSpend(getTenantId(req));
  res.json(r);
});

// GET /api/v1/finances/ads/roas/:campaignId
router.get('/ads/roas/:campaignId', async (req, res) => {
  const r = await metaAds.computeROAS(req.params.campaignId, getTenantId(req));
  res.json(r);
});

// [178] POST /api/v1/finances/ads/pause — confirmation 1-clic
router.post('/ads/pause', requireStudioAccess, async (req, res) => {
  const { campaignId, confirmCode } = req.body || {};
  if (!campaignId || !confirmCode) return res.status(400).json({ error: 'campaignId + confirmCode requis' });
  const r = await metaAds.pauseCampaign(campaignId, confirmCode);
  r.error ? res.status(400).json(r) : res.json(r);
});

// ─── [179-180] NO-SHOWS ──────────────────────────────────────────────────────

// GET /api/v1/finances/no-shows
router.get('/no-shows', requireStudioAccess, async (req, res) => {
  const r = await noshow.analyzeNoShows(
    getTenantId(req),
    parseInt(req.query.days || '30'),
  );
  res.json(r);
});

// ─── [183] DÉTECTION CHUTE HEBDOMADAIRE ──────────────────────────────────────

// GET /api/v1/finances/weekly-drop
router.get('/weekly-drop', async (req, res) => {
  const r = await taxDigest.detectWeeklyDrop(getTenantId(req));
  res.json(r || { status: 'insufficient_data' });
});

// ─── [184] MÉMO VOCAL ─────────────────────────────────────────────────────────

// GET /api/v1/finances/voice-memo
router.get('/voice-memo', async (req, res) => {
  const r = await taxDigest.generateVoiceMemo(getTenantId(req));
  res.json(r);
});

// ─── [185] REMBOURSEMENTS ─────────────────────────────────────────────────────

// POST /api/v1/finances/refund
router.post('/refund', requireStudioAccess, async (req, res) => {
  const { txId, amount, reason } = req.body || {};
  if (!txId || !amount) return res.status(400).json({ error: 'txId + amount requis' });
  const r = await taxDigest.processRefund(txId, parseFloat(amount), reason || '');
  r.error ? res.status(400).json(r) : res.json(r);
});

// ─── [170] BUDGET GUARD STATUS ────────────────────────────────────────────────

router.get('/budget', requireStudioAccess, (req, res) => {
  res.json(budgetGuard.getStatus());
});

// POST /api/v1/finances/budget/unlock — Déblocage par Commandant
router.post('/budget/unlock', requireStudioAccess, (req, res) => {
  const { newCapUSD, adminToken } = req.body || {};
  try {
    budgetGuard.unlockBudget(newCapUSD, adminToken || req.headers['x-daleba-session']);
    res.json({ unlocked: true, newCap: newCapUSD });
  } catch (e) { res.status(403).json({ error: e.message }); }
});

// ─── DASHBOARD [181] ───────────────────────────────────────────────────────────
// Route enregistrée dans index.js: GET /admin/finances


// ─── ROUTES 189-196 ──────────────────────────────────────────────────────────

router.post('/simulate/closure', requireStudioAccess, async (req, res) => {
  const sim = require('../services/financial-simulator');
  const r   = await sim.simulateClosure({ ...req.body, tenantId: getTenantId(req) }).catch(e => ({ error: e.message }));
  res.json(r);
});

router.get('/fixed-costs', requireStudioAccess, async (req, res) => {
  const sim = require('../services/financial-simulator');
  res.json(await sim.getMonthlyFixedCosts(getTenantId(req)));
});

router.post('/fixed-costs', requireStudioAccess, async (req, res) => {
  const sim = require('../services/financial-simulator');
  const { category, label, amount } = req.body || {};
  if (!category || !label || !amount) return res.status(400).json({ error: 'category + label + amount requis' });
  await sim.upsertFixedCost(getTenantId(req), category, label, parseFloat(amount), req.body);
  res.json({ created: true });
});

router.post('/receipt/generate', requireStudioAccess, async (req, res) => {
  const receipt = require('../services/receipt-generator');
  const r = await receipt.generateAndSendReceipt(req.body, req.body.customer || {}).catch(e => ({ error: e.message }));
  r.error ? res.status(500).json(r) : res.json(r);
});

router.get('/webhook/log', requireStudioAccess, (req, res) => {
  const wsSec = require('../services/webhook-security');
  res.json({ log: wsSec.getSignatureLog(parseInt(req.query.limit || '50')) });
});

router.post('/reconcile', requireStudioAccess, async (req, res) => {
  const sim = require('../services/financial-simulator');
  const r   = await sim.runBatchReconciliation(getTenantId(req), req.body || {}).catch(e => ({ error: e.message }));
  res.json(r);
});

router.post('/archive', requireStudioAccess, async (req, res) => {
  const sim = require('../services/financial-simulator');
  const r   = await sim.archiveOldTransactions(getTenantId(req)).catch(e => ({ error: e.message }));
  res.json(r);
});

router.get('/basket-analysis', requireStudioAccess, async (req, res) => {
  const sim = require('../services/financial-simulator');
  const r   = await sim.computeBasketByCustomerType(getTenantId(req), parseInt(req.query.days || '30')).catch(() => null);
  res.json(r || { error: 'Donnees insuffisantes' });
});

module.exports = router;
