/**
 * DALEBA — Revenue Routes
 * GET /api/revenue/summary  → CA Square + compteurs opportunités/propositions
 */
'use strict';

const express = require('express');
const router  = express.Router();

let pool = null, DEMO_MODE = true;
try { const db = require('../memory/db'); pool = db.pool; DEMO_MODE = db.DEMO_MODE; } catch (e) {}

// Cache 5 min pour éviter de spammer Square
let cache = null;
let cacheTs = 0;
const CACHE_TTL = 5 * 60 * 1000;

router.get('/summary', async (req, res) => {
  try {
    const now = Date.now();
    if (cache && (now - cacheTs) < CACHE_TTL && !req.query.refresh) {
      return res.json({ ...cache, cached: true });
    }

    const { getRevenueSummary } = require('../services/revenue-tracker');

    // Requêtes en parallèle : Square + compteurs DB
    const [revenue, counts] = await Promise.allSettled([
      getRevenueSummary(),
      DEMO_MODE || !pool ? Promise.resolve(null) : pool.query(`
        SELECT
          (SELECT COUNT(*) FROM daleba_opportunities)                         AS opp_total,
          (SELECT COUNT(*) FROM daleba_opportunities WHERE status = 'pending') AS opp_pending,
          (SELECT COUNT(*) FROM daleba_opportunities WHERE status = 'approved') AS opp_approved,
          (SELECT COUNT(*) FROM daleba_proposals)                              AS prop_total,
          (SELECT COUNT(*) FROM daleba_proposals WHERE status = 'draft_pending_ulrich') AS prop_pending
      `),
    ]);

    const rev = revenue.status === 'fulfilled' ? revenue.value : {
      total: '0.00', currency: 'CAD', completed_count: 0, total_count: 0,
      error: revenue.reason?.message,
    };

    const row = counts.status === 'fulfilled' && counts.value?.rows?.[0]
      ? counts.value.rows[0]
      : {};

    const result = {
      revenue: {
        total:      rev.total,
        currency:   rev.currency,
        completed:  rev.completed_count,
        error:      rev.error || null,
      },
      opportunities: {
        total:    parseInt(row.opp_total    || 0),
        pending:  parseInt(row.opp_pending  || 0),
        approved: parseInt(row.opp_approved || 0),
      },
      proposals: {
        total:   parseInt(row.prop_total   || 0),
        pending: parseInt(row.prop_pending || 0),
      },
      fetched_at: new Date().toISOString(),
    };

    cache   = result;
    cacheTs = now;
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
