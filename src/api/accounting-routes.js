'use strict';
/**
 * DALEBA — Routes Comptabilité
 * GET  /api/accounting/report/:year/:month
 * GET  /api/accounting/commissions/:year/:month
 * POST /api/accounting/expense
 * GET  /api/accounting/taxes/:year/:month
 */

const express = require('express');
const router = express.Router();
const accounting = require('../services/accounting');

// GET /api/accounting/report/:year/:month
router.get('/report/:year/:month', async (req, res) => {
  try {
    const report = await accounting.getMonthlyReport(
      parseInt(req.params.year),
      parseInt(req.params.month)
    );
    res.json(report);
  } catch(err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/accounting/commissions/:year/:month
router.get('/commissions/:year/:month', async (req, res) => {
  try {
    const comms = await accounting.computeMonthlyCommissions(
      parseInt(req.params.year),
      parseInt(req.params.month)
    );
    res.json(comms);
  } catch(err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/accounting/expense
router.post('/expense', async (req, res) => {
  const { category, description, amount, expenseDate, isRecurring, recurringDay } = req.body;
  if (!category || !amount) return res.status(400).json({ error: 'category et amount requis' });
  try {
    const result = await accounting.recordExpense({ category, description, amount, expenseDate, isRecurring, recurringDay });
    res.json({ success: true, expense: result });
  } catch(err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/accounting/taxes/:year/:month  — récap TPS/TVQ à remettre
router.get('/taxes/:year/:month', async (req, res) => {
  try {
    const report = await accounting.getMonthlyReport(
      parseInt(req.params.year),
      parseInt(req.params.month)
    );
    res.json({
      period: report.period,
      revenueHT: report.revenue.ht,
      tpsAPercevoir: report.revenue.tps,
      tvqAPercevoir: report.revenue.tvq,
      totalTaxes: parseFloat((report.revenue.tps + report.revenue.tvq).toFixed(2)),
      totalTTC: report.revenue.ttc,
    });
  } catch(err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/accounting/calc — calcul rapide HT→TTC
router.get('/calc', (req, res) => {
  const ht = parseFloat(req.query.ht);
  if (isNaN(ht)) return res.status(400).json({ error: 'Paramètre ht requis' });
  res.json(accounting.calcTaxes(ht));
});

// GET /api/accounting/summary — résumé financier du mois en cours
router.get('/summary', async (req, res) => {
  try {
    const { tenantId = 'default' } = req.query;
    const now = new Date();
    const year = now.getFullYear();
    const month = now.getMonth() + 1;

    let summary = {
      tenantId,
      period: `${year}-${String(month).padStart(2, '0')}`,
      revenue: { gross: 0, net: 0, currency: 'CAD' },
      taxes: { tps: 0, tvq: 0, total: 0 },
      expenses: 0,
      profit: 0,
      status: 'operational'
    };

    try {
      const report = await accounting.getMonthlyReport(year, month);
      if (report) {
        summary.revenue.gross = report.revenue?.ttc || 0;
        summary.revenue.net   = report.revenue?.ht  || 0;
        summary.taxes.tps     = report.revenue?.tps || 0;
        summary.taxes.tvq     = report.revenue?.tvq || 0;
        summary.taxes.total   = parseFloat(((report.revenue?.tps || 0) + (report.revenue?.tvq || 0)).toFixed(2));
        const expAmt = typeof report.expenses === 'object' ? (report.expenses?.total || 0) : (report.expenses || 0);
        summary.expenses      = expAmt;
        summary.profit        = parseFloat(((report.revenue?.ht || 0) - expAmt).toFixed(2));
      }
    } catch (dbErr) {
      summary.dbStatus = 'unavailable';
    }

    res.json(summary);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/accounting — statut du module comptabilité
router.get('/', async (req, res) => {
  try {
    const now = new Date();
    res.json({
      status: 'operational',
      module: 'accounting',
      version: '1.0',
      currentPeriod: `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}`,
      endpoints: ['/summary', '/report/:year/:month', '/commissions/:year/:month', '/expense', '/taxes/:year/:month', '/calc']
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
