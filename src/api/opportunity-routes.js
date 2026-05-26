/**
 * Opportunity Routes — Radar Planétaire
 * GET  /api/opportunities              → liste
 * GET  /api/opportunities/stats        → statistiques
 * GET  /api/opportunities/:id          → détail
 * POST /api/opportunities/scan         → déclenche scan manuel
 * PUT  /api/opportunities/:id/approve  → approuver
 * PUT  /api/opportunities/:id/reject   → rejeter
 * DELETE /api/opportunities/:id        → supprimer
 */
'use strict';

const express = require('express');
const router  = express.Router();

// ── DB avec graceful degradation ─────────────────────────────────────────────
let pool = null;
let DEMO_MODE = true;
try {
  const db = require('../memory/db');
  pool = db.pool;
  DEMO_MODE = db.DEMO_MODE;
} catch (e) {}

// ── Auto-migration au démarrage ──────────────────────────────────────────────
async function initTable() {
  if (DEMO_MODE || !pool) return;
  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS daleba_opportunities (
        id                 SERIAL PRIMARY KEY,
        source_platform    VARCHAR(100) NOT NULL,
        source_url         TEXT,
        country            VARCHAR(100),
        language_original  VARCHAR(10)  DEFAULT 'en',
        title              VARCHAR(600),
        description_orig   TEXT,
        description_fr     TEXT,
        budget_raw         VARCHAR(300),
        budget_estimated   DECIMAL(12,2),
        budget_currency    VARCHAR(10)  DEFAULT 'USD',
        category           VARCHAR(100),
        score              INTEGER      DEFAULT 0,
        keywords_matched   TEXT,
        status             VARCHAR(20)  DEFAULT 'pending',
        detected_at        TIMESTAMPTZ  DEFAULT NOW(),
        approved_at        TIMESTAMPTZ,
        rejected_at        TIMESTAMPTZ,
        notes              TEXT
      );
      CREATE INDEX IF NOT EXISTS idx_opp_status   ON daleba_opportunities(status);
      CREATE INDEX IF NOT EXISTS idx_opp_score    ON daleba_opportunities(score DESC);
      CREATE INDEX IF NOT EXISTS idx_opp_detected ON daleba_opportunities(detected_at DESC);
    `);
    await pool.query(`ALTER TABLE daleba_opportunities ADD COLUMN IF NOT EXISTS work_type VARCHAR(20) DEFAULT 'unknown'`);
    await pool.query(`ALTER TABLE daleba_opportunities ADD COLUMN IF NOT EXISTS is_remote BOOLEAN DEFAULT NULL`);
    console.log('[opportunities] Table daleba_opportunities OK (V43 — filtres remote/freelance)');
  } catch (e) {
    if (!e.message.includes('already exists')) console.error('[opportunities] initTable:', e.message);
  }
}
initTable();

// ── GET /api/opportunities — liste paginée ─────────────────────────────────
router.get('/', async (req, res) => {
  try {
    const { status = 'pending', category, limit = 50, offset = 0, min_score = 0 } = req.query;

    let where = ['score >= $1'];
    const params = [parseInt(min_score)];
    let idx = 2;

    if (status && status !== 'all') {
      where.push(`status = $${idx++}`);
      params.push(status);
    }
    if (category) {
      where.push(`category = $${idx++}`);
      params.push(category);
    }

    const whereSQL = where.length ? 'WHERE ' + where.join(' AND ') : '';
    const q = `
      SELECT * FROM daleba_opportunities
      ${whereSQL}
      ORDER BY score DESC, detected_at DESC
      LIMIT $${idx++} OFFSET $${idx++}
    `;
    params.push(parseInt(limit), parseInt(offset));

    const countQ = `SELECT COUNT(*) FROM daleba_opportunities ${whereSQL}`;
    const [rows, count] = await Promise.all([
      pool.query(q, params),
      pool.query(countQ, params.slice(0, idx - 3)),
    ]);

    res.json({
      total:  parseInt(count.rows[0].count),
      limit:  parseInt(limit),
      offset: parseInt(offset),
      items:  rows.rows,
    });
  } catch (err) {
    console.error('[opportunities] GET /:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ── GET /api/opportunities/stats ────────────────────────────────────────────
router.get('/stats', async (req, res) => {
  try {
    const [byStatus, byCategory, avgScore] = await Promise.all([
      pool.query(`SELECT status, COUNT(*) as count FROM daleba_opportunities GROUP BY status`),
      pool.query(`SELECT category, COUNT(*) as count FROM daleba_opportunities GROUP BY category ORDER BY count DESC`),
      pool.query(`SELECT ROUND(AVG(score)) as avg_score, COUNT(*) as total FROM daleba_opportunities`),
    ]);

    const statusMap = {};
    for (const r of byStatus.rows) statusMap[r.status] = parseInt(r.count);

    res.json({
      total:      parseInt(avgScore.rows[0]?.total || 0),
      avg_score:  parseInt(avgScore.rows[0]?.avg_score || 0),
      by_status:  statusMap,
      by_category: byCategory.rows.map(r => ({ category: r.category, count: parseInt(r.count) })),
      pending:    statusMap['pending']  || 0,
      approved:   statusMap['approved'] || 0,
      rejected:   statusMap['rejected'] || 0,
    });
  } catch (err) {
    console.error('[opportunities] GET /stats:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ── POST /api/opportunities/scan — scan manuel ──────────────────────────────
router.post('/scan', async (req, res) => {
  // Déclenche le worker en tâche de fond, répond immédiatement
  res.json({ message: 'Scan lancé en arrière-plan', started_at: new Date() });

  try {
    const { scanAll }          = require('../services/opportunity-scanner');
    const { classifyBatch }    = require('../services/opportunity-classifier');

    const raw        = await scanAll();
    // ── Pré-filtre dur V43 : éliminer CDI/présentiel avant d'appeler l'IA ──────
    const HARD_EXCLUDE = [
      // Types de contrats non voulus
      /\b(cdi|cdd|full.?time|temps.?plein|permanent.?position|staff.?position|employee|hire|embauche|recrutement|poste à pourvoir)\b/i,
      // Rôles non voulus
      /\b(directeur|director|VP|vice.?president|manager|chef.?d.?équipe|team.?lead|head.?of|responsable.?d.?équipe|people.?manager)\b/i,
      // Présentiel obligatoire
      /\b(on.?site.?required|présentiel.?obligatoire|in.?office|must.?be.?located|relocation.?required|sur.?place)\b/i,
      // Offres d'emploi classiques
      /\b(nous.?recrutons|nous.?recherchons.?un.?(collaborateur|salarié)|join.?our.?team.?as.?(a|an).+employee|w2.?only|w2.?position)\b/i,
    ];
    const REMOTE_REQUIRED = [
      /\b(remote|télétravail|à.?distance|distributed|anywhere|work.?from.?home|wfh|fully.?remote|100.?%.?remote|remote.?first|remote.?ok|remote.?friendly|freelance|contract|mission|forfait|short.?term|part.?time|contractuel)\b/i,
    ];

    const preFiltered = raw.filter(r => {
      if (!r.title || r.title.length < 5) return false;
      const fullText = (r.title + ' ' + (r.description || '')).slice(0, 2000);
      // Exclure si match exclusion dure
      if (HARD_EXCLUDE.some(re => re.test(fullText))) return false;
      // Exiger au moins 1 signal remote/freelance
      if (!REMOTE_REQUIRED.some(re => re.test(fullText))) return false;
      return true;
    });
    console.log("[scan] Pré-filtre: " + raw.length + " → " + preFiltered.length + " (éliminé " + (raw.length - preFiltered.length) + " non-remote/CDI)");
    // ────────────────────────────────────────────────────────────────────────────
    const classified = await classifyBatch(preFiltered);

    let inserted = 0;
    for (const opp of classified) {
      // Post-filtre : exclure full-time et présentiel confirmés
      if (!opp.relevant) continue;
      if (opp.work_type === 'full-time') continue;
      if (opp.is_remote === false) continue;  // présentiel confirmé par l'IA
      if (opp.score < 25) continue;
      try {
        await pool.query(`
          INSERT INTO daleba_opportunities
            (source_platform, source_url, country, language_original, title,
             description_orig, description_fr, budget_raw, budget_estimated,
             budget_currency, category, score, keywords_matched, status,
             work_type, is_remote)
          VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,'pending',$14,$15)
          ON CONFLICT DO NOTHING
        `, [
          opp.platform, opp.url, opp.country, opp.language_original,
          opp.title?.slice(0, 600),
          opp.description?.slice(0, 10000),
          opp.description_fr,
          opp.budget_raw,
          opp.budget_estimated,
          opp.budget_currency || 'USD',
          opp.category,
          opp.score,
          opp.keywords_matched,
          opp.work_type || 'unknown',
          opp.is_remote ?? null,
        ]);
        inserted++;
      } catch (e) {
        // Conflit d'URL dupliquée — ignorer
      }
    }
    console.log(`[opportunities/scan] Terminé : ${inserted} nouvelles opportunités insérées`);
  } catch (err) {
    console.error('[opportunities/scan] Erreur background:', err.message);
  }
});

// ── GET /api/opportunities/:id ──────────────────────────────────────────────

// ── DELETE /api/opportunities/reset — V42 Reset données de test ───────────────
router.delete('/reset', async (req, res) => {
  try {
    const result = await pool.query('DELETE FROM daleba_opportunities');
    res.json({ ok: true, deleted: result.rowCount, table: 'daleba_opportunities' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/:id', async (req, res) => {
  try {
    const { rows } = await pool.query(
      'SELECT * FROM daleba_opportunities WHERE id = $1', [req.params.id]
    );
    if (!rows.length) return res.status(404).json({ error: 'Not found' });
    res.json(rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── PUT /api/opportunities/:id/approve ─────────────────────────────────────
router.put('/:id/approve', async (req, res) => {
  try {
    const { rows } = await pool.query(
      `UPDATE daleba_opportunities
       SET status = 'approved', approved_at = NOW()
       WHERE id = $1 RETURNING *`,
      [req.params.id]
    );
    if (!rows.length) return res.status(404).json({ error: 'Not found' });
    const opp = rows[0];
    res.json(opp);

    // ── TRIGGER Agent Rédacteur (arrière-plan) ───────────────────────────────
    setImmediate(async () => {
      if (DEMO_MODE || !pool) return;
      try {
        const existing = await pool.query(
          'SELECT id FROM daleba_proposals WHERE opportunity_id = $1 LIMIT 1', [opp.id]
        );
        if (existing.rows.length > 0) return; // déjà générée
        const { generateProposal } = require('../services/proposal-writer');
        const text = await generateProposal(opp);
        await pool.query(
          `INSERT INTO daleba_proposals (opportunity_id, generated_text, status)
           VALUES ($1, $2, 'draft_pending_ulrich')`,
          [opp.id, text]
        );
        console.log(`[approve] Proposition générée pour opp #${opp.id}`);

        // ── ÉTAPE 3 : Notification email à Ulrich ────────────────────────────
        try {
          const { notifyProposal } = require('../services/email-notifier');
          const result = await notifyProposal(opp, text);
          console.log(`[approve] Email envoyé via ${result.provider}`, result.previewUrl || result.messageId || '');
        } catch (mailErr) {
          console.error(`[approve] Email notification échouée (non bloquant):`, mailErr.message);
        }
      } catch (err) {
        console.error(`[approve] Agent Rédacteur erreur opp #${opp.id}:`, err.message);
      }
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── PUT /api/opportunities/:id/reject ──────────────────────────────────────
router.put('/:id/reject', async (req, res) => {
  try {
    const { rows } = await pool.query(
      `UPDATE daleba_opportunities
       SET status = 'rejected', rejected_at = NOW()
       WHERE id = $1 RETURNING *`,
      [req.params.id]
    );
    if (!rows.length) return res.status(404).json({ error: 'Not found' });
    res.json(rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── DELETE /api/opportunities/:id ──────────────────────────────────────────
router.delete('/:id', async (req, res) => {
  try {
    const { rowCount } = await pool.query(
      'DELETE FROM daleba_opportunities WHERE id = $1', [req.params.id]
    );
    if (!rowCount) return res.status(404).json({ error: 'Not found' });
    res.json({ deleted: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;

// ── POST /api/opportunities/seed-test — inject fake opportunity for testing ──
router.post('/seed-test', async (req, res) => {
  if (DEMO_MODE || !pool) return res.json({ message: 'Demo mode', demo: true });
  try {
    const { rows } = await pool.query(`
      INSERT INTO daleba_opportunities
        (source_platform, source_url, country, language_original, title,
         description_orig, description_fr, budget_raw, budget_estimated,
         budget_currency, category, score, keywords_matched, status)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,'pending')
      RETURNING *
    `, [
      'Test', 'https://example.com/test-' + Date.now(),
      'Canada', 'en',
      'Automatisation CRM + WhatsApp Bot pour e-commerce (PME Montréal)',
      'Looking for a developer to automate our CRM (HubSpot) with WhatsApp notifications and order tracking. Budget $8000 CAD. Ongoing contract possible.',
      'Recherche développeur pour automatiser CRM HubSpot avec notifications WhatsApp et suivi de commandes. Budget 8 000$ CAD. Contrat récurrent possible.',
      '$8000 CAD',
      6000, 'USD',
      'chatbot-ia', 87,
      'automation, whatsapp, crm, integration, api',
    ]);
    res.json({ inserted: true, opportunity: rows[0] });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

