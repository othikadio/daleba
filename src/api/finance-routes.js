/**
 * Finance Routes — DALEBA Metacortex Section 4
 *
 * [152] POST /api/v1/finances/ingest — Webhook universel Square + Stripe
 * + routes ledger, fiscal, cashflow, coûts infrastructure
 */

'use strict';

const router  = require('express').Router();
const ingester = require('../services/transaction-ingester');
const fiscal   = require('../services/fiscal-engine');
const cashflow = require('../services/cashflow-engine');
const tracker  = require('../services/infrastructure-cost-tracker');

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

module.exports = router;
