/**
 * KADIO OS — Axe 3: Routes SEO Audit + Séquences Email
 * POST /api/usine/seo/audit/:leadId
 * GET  /api/usine/seo/report/:leadId
 * GET  /api/usine/seo/stats
 * POST /api/usine/sequences/start
 * GET  /api/usine/stats (KPIs globaux)
 */

const express = require('express');
const router = express.Router();
const fs = require('fs');
const path = require('path');
const { runSeoAuditJob, analyzeSEO } = require('../workers/seo-audit-worker');
const { startEmailSequence, processEmailSequences } = require('../workers/email-sequence-worker');
const { getQueueStats, addSeoAuditJob } = require('../workers/agent-queue');
const { pool } = require('../memory/db');

async function ensureAuditTables(pool) {
  if (!pool) return;
  await pool.query(`
    CREATE TABLE IF NOT EXISTS daleba_seo_audits (
      id SERIAL PRIMARY KEY,
      lead_id INTEGER,
      score INTEGER,
      issues JSONB,
      report_path TEXT,
      created_at TIMESTAMPTZ DEFAULT NOW()
    )
  `).catch(() => {});

  await pool.query(`
    CREATE TABLE IF NOT EXISTS daleba_email_sequences (
      id SERIAL PRIMARY KEY,
      lead_id INTEGER,
      step INTEGER DEFAULT 0,
      last_sent TIMESTAMPTZ,
      next_send TIMESTAMPTZ,
      status TEXT DEFAULT 'active',
      created_at TIMESTAMPTZ DEFAULT NOW()
    )
  `).catch(() => {});
}

// POST /api/usine/seo/audit/:leadId
router.post('/seo/audit/:leadId', async (req, res) => {
  const { leadId } = req.params;

  try {
    const leadRow = await pool.query('SELECT * FROM daleba_leads WHERE id = $1', [leadId]);
    if (!leadRow.rows[0]) return res.status(404).json({ ok: false, error: 'Lead introuvable' });

    const lead = leadRow.rows[0];
    if (!lead.website) return res.status(400).json({ ok: false, error: 'Ce lead n\'a pas de site web' });

    // Lancer en arrière-plan
    setImmediate(async () => {
      try {
        await runSeoAuditJob({ leadId: lead.id, website: lead.website, leadName: lead.company_name }, pool);
      } catch (e) {
        console.error('[SEO Route] Audit error:', e.message);
      }
    });

    res.json({ ok: true, message: `Audit lancé pour ${lead.company_name} (${lead.website})`, leadId });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

// POST /api/usine/seo/audit-url — Audit direct par URL (sans lead)
router.post('/seo/audit-url', async (req, res) => {
  const { url } = req.body;
  if (!url) return res.status(400).json({ ok: false, error: 'URL requise' });

  try {
    const result = await analyzeSEO(url);
    res.json({ ok: true, url, ...result });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

// GET /api/usine/seo/report/:leadId — Télécharger le PDF
router.get('/seo/report/:leadId', async (req, res) => {
  try {
    const audit = await pool.query(
      'SELECT * FROM daleba_seo_audits WHERE lead_id = $1 ORDER BY created_at DESC LIMIT 1',
      [req.params.leadId]
    );

    if (!audit.rows[0] || !audit.rows[0].report_path) {
      return res.status(404).json({ ok: false, error: 'Rapport non disponible' });
    }

    const pdfPath = audit.rows[0].report_path;
    if (!fs.existsSync(pdfPath)) {
      return res.status(404).json({ ok: false, error: 'Fichier PDF introuvable' });
    }

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename=audit-seo-${req.params.leadId}.pdf`);
    fs.createReadStream(pdfPath).pipe(res);
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

// GET /api/usine/seo/stats
router.get('/seo/stats', async (req, res) => {
  if (!pool) return res.json({ ok: true, audits: { total_audits: 0, avg_score: null, critical: 0, warning: 0, good: 0, today: 0 }, sequences: { total: 0, active: 0, completed: 0, emails_sent: 0 }, mode: 'demo' });
  await ensureAuditTables(pool);

  try {
    const stats = await pool.query(`
      SELECT
        COUNT(*) as total_audits,
        ROUND(AVG(score)) as avg_score,
        COUNT(*) FILTER (WHERE score < 40) as critical,
        COUNT(*) FILTER (WHERE score BETWEEN 40 AND 69) as warning,
        COUNT(*) FILTER (WHERE score >= 70) as good,
        COUNT(*) FILTER (WHERE DATE(created_at) = CURRENT_DATE) as today
      FROM daleba_seo_audits
    `).catch(() => ({ rows: [{}] }));

    const seqStats = await pool.query(`
      SELECT
        COUNT(*) as total,
        COUNT(*) FILTER (WHERE status = 'active') as active,
        COUNT(*) FILTER (WHERE status = 'completed') as completed,
        COUNT(*) FILTER (WHERE step >= 1) as emails_sent
      FROM daleba_email_sequences
    `).catch(() => ({ rows: [{}] }));

    res.json({ ok: true, audits: stats.rows[0], sequences: seqStats.rows[0] });
  } catch (e) {
    res.json({ ok: false, error: e.message });
  }
});

// POST /api/usine/sequences/start — Lancer les séquences email pour tous les leads avec audit
router.post('/sequences/start', async (req, res) => {
  await ensureAuditTables(pool);

  try {
    // Leads avec audit + email mais sans séquence active
    const leads = await pool.query(`
      SELECT l.*, a.score, a.report_path, a.issues
      FROM daleba_leads l
      JOIN daleba_seo_audits a ON a.lead_id = l.id
      WHERE l.email IS NOT NULL
      AND NOT EXISTS (
        SELECT 1 FROM daleba_email_sequences es WHERE es.lead_id = l.id AND es.status = 'active'
      )
      ORDER BY a.created_at DESC
      LIMIT 50
    `);

    let started = 0;
    for (const lead of leads.rows) {
      const auditResult = {
        score: lead.score,
        issues: lead.issues || [],
        details: {}
      };
      const seq = await startEmailSequence(lead, auditResult, lead.report_path, null, pool);
      if (seq) started++;
      await new Promise(r => setTimeout(r, 200)); // Throttle Resend
    }

    res.json({ ok: true, started, total: leads.rows.length });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

// POST /api/usine/sequences/process — Avancer les séquences en attente (cron/manuel)
router.post('/sequences/process', async (req, res) => {
  try {
    const result = await processEmailSequences(pool);
    res.json({ ok: true, ...result });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

// GET /api/usine/stats — KPIs globaux de l'Usine
router.get('/stats', async (req, res) => {
  if (!pool) return res.json({ ok: true, queues: {}, leads: { total: 0 }, audits: { total: 0 }, emails: { sent: 0 }, revenue: { total: 0 }, mode: 'demo' });
  await ensureAuditTables(pool);

  try {
    const [queueStats, leadStats, auditStats, emailStats] = await Promise.all([
      getQueueStats(),
      pool.query(`
        SELECT COUNT(*) as total, COUNT(*) FILTER (WHERE status='new') as new_leads,
               COUNT(*) FILTER (WHERE email IS NOT NULL) as with_email,
               COUNT(*) FILTER (WHERE audit_score IS NOT NULL) as audited
        FROM daleba_leads
      `).catch(() => ({ rows: [{}] })),
      pool.query(`
        SELECT COUNT(*) as total, ROUND(AVG(score)) as avg_score,
               COUNT(*) FILTER (WHERE DATE(created_at) = CURRENT_DATE) as today
        FROM daleba_seo_audits
      `).catch(() => ({ rows: [{}] })),
      pool.query(`
        SELECT COUNT(*) FILTER (WHERE step >= 1) as sent,
               COUNT(*) FILTER (WHERE status='completed') as completed
        FROM daleba_email_sequences
      `).catch(() => ({ rows: [{}] }))
    ]);

    const revenueData = { total: 0 };
    try {
      const { getUsineRevenue } = require('../services/stripe-usine');
      revenueData.total = await getUsineRevenue();
    } catch {}

    res.json({
      ok: true,
      queues: queueStats,
      leads: leadStats.rows[0],
      audits: auditStats.rows[0],
      emails: emailStats.rows[0],
      revenue: revenueData
    });
  } catch (e) {
    res.json({ ok: false, error: e.message });
  }
});

module.exports = router;
