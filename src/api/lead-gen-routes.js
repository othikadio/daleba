/**
 * KADIO OS — Axe 3: Routes Lead Generation
 * POST /api/usine/lead-gen/start
 * GET  /api/usine/lead-gen/stats
 * GET  /api/usine/leads
 * DELETE /api/usine/leads/:id
 */

const express = require('express');
const router = express.Router();
const { runLeadGenJob, DEFAULT_CITIES } = require('../workers/lead-gen-worker');
const { addLeadGenJob } = require('../workers/agent-queue');
const { pool } = require('../memory/db');

// ============= MIGRATIONS =============
async function ensureLeadsTables(pool) {
  if (!pool) return;
  await pool.query(`
    CREATE TABLE IF NOT EXISTS daleba_leads (
      id SERIAL PRIMARY KEY,
      company_name TEXT,
      email TEXT,
      website TEXT,
      phone TEXT,
      city TEXT,
      country TEXT DEFAULT 'CA',
      address TEXT,
      source TEXT DEFAULT 'nominatim',
      status TEXT DEFAULT 'new',
      audit_score INTEGER,
      revenue_generated DECIMAL DEFAULT 0,
      created_at TIMESTAMPTZ DEFAULT NOW()
    )
  `).catch(e => console.warn('[LeadGen] Migration leads:', e.message));
}

// ============= ÉTAT DU CYCLE =============
let currentCycle = null;
let cycleProgress = { running: false, started: null, cities: 0, citiesProcessed: 0, totalFound: 0, totalSaved: 0 };

// ============= ROUTES =============

// POST /api/usine/lead-gen/start — Lancer un cycle de scraping
router.post('/start', async (req, res) => {
  if (cycleProgress.running) {
    return res.json({ ok: false, message: 'Un cycle est déjà en cours', progress: cycleProgress });
  }

  
  await ensureLeadsTables(pool);

  const cities = req.body.cities || DEFAULT_CITIES;
  const query = req.body.query || 'salon coiffure';

  cycleProgress = {
    running: true, started: new Date(), cities: cities.length,
    citiesProcessed: 0, totalFound: 0, totalSaved: 0, query
  };

  // Lancer en arrière-plan
  setImmediate(async () => {
    try {
      const result = await runLeadGenJob({ cities, query }, pool);
      cycleProgress = { ...cycleProgress, ...result, running: false, finished: new Date() };
    } catch (e) {
      console.error('[LeadGen] Cycle error:', e.message);
      cycleProgress.running = false;
      cycleProgress.error = e.message;
    }
  });

  res.json({ ok: true, message: `Cycle démarré: ${cities.length} villes, query="${query}"`, progress: cycleProgress });
});

// GET /api/usine/lead-gen/stats
router.get('/stats', async (req, res) => {
  if (!pool) return res.json({ ok: true, stats: { total: 0, new: 0, qualified: 0, converted: 0, revenue_generated: 0, audited: 0, with_email: 0, with_website: 0 }, cycleProgress, mode: 'demo' });
  await ensureLeadsTables(pool);

  try {
    const stats = await pool.query(`
      SELECT
        COUNT(*) as total,
        COUNT(*) FILTER (WHERE status = 'new') as new,
        COUNT(*) FILTER (WHERE status = 'qualified') as qualified,
        COUNT(*) FILTER (WHERE status = 'converted') as converted,
        COALESCE(SUM(revenue_generated), 0) as revenue_generated,
        COUNT(*) FILTER (WHERE audit_score IS NOT NULL) as audited,
        COUNT(*) FILTER (WHERE email IS NOT NULL) as with_email,
        COUNT(*) FILTER (WHERE website IS NOT NULL) as with_website
      FROM daleba_leads
    `);
    res.json({ ok: true, stats: stats.rows[0], cycleProgress });
  } catch (e) {
    res.json({ ok: false, error: e.message, cycleProgress });
  }
});

// GET /api/usine/leads — Liste paginée
router.get('/', async (req, res) => {
  
  await ensureLeadsTables(pool);

  const page = parseInt(req.query.page) || 1;
  const limit = Math.min(parseInt(req.query.limit) || 50, 200);
  const offset = (page - 1) * limit;
  const status = req.query.status;
  const city = req.query.city;

  try {
    let where = '';
    const params = [];
    if (status) { params.push(status); where += ` WHERE status = $${params.length}`; }
    if (city) { params.push(`%${city}%`); where += (where ? ' AND' : ' WHERE') + ` city ILIKE $${params.length}`; }

    const total = await pool.query(`SELECT COUNT(*) FROM daleba_leads${where}`, params);
    params.push(limit, offset);
    const leads = await pool.query(
      `SELECT * FROM daleba_leads${where} ORDER BY created_at DESC LIMIT $${params.length - 1} OFFSET $${params.length}`,
      params
    );
    res.json({ ok: true, leads: leads.rows, total: parseInt(total.rows[0].count), page, limit });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

// DELETE /api/usine/leads/:id
router.delete('/:id', async (req, res) => {
  
  try {
    await pool.query('DELETE FROM daleba_leads WHERE id = $1', [req.params.id]);
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

// PUT /api/usine/leads/:id/status
router.put('/:id/status', async (req, res) => {
  
  const { status } = req.body;
  try {
    await pool.query('UPDATE daleba_leads SET status = $1 WHERE id = $2', [status, req.params.id]);
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

module.exports = router;
