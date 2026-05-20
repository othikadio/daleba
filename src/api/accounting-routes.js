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

module.exports = router;
