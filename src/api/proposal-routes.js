/**
 * DALEBA — Proposal Routes (Agent Rédacteur)
 *
 * GET  /api/proposals                        → liste des propositions
 * GET  /api/proposals/opportunity/:oppId     → proposition d'une opportunité
 * GET  /api/proposals/:id                    → détail proposition
 * POST /api/proposals/generate/:oppId        → générer manuellement
 * PUT  /api/proposals/:id/status             → changer statut
 * DELETE /api/proposals/:id                  → supprimer
 */
'use strict';

const express = require('express');
const router  = express.Router();

let pool      = null;
let DEMO_MODE = true;
try {
  const db  = require('../memory/db');
  pool      = db.pool;
  DEMO_MODE = db.DEMO_MODE;
} catch (e) {}

// ── Auto-migration ────────────────────────────────────────────────────────────
async function initTable() {
  if (DEMO_MODE || !pool) return;
  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS daleba_proposals (
        id              SERIAL PRIMARY KEY,
        opportunity_id  INTEGER NOT NULL REFERENCES daleba_opportunities(id) ON DELETE CASCADE,
        generated_text  TEXT    NOT NULL,
        status          VARCHAR(30) DEFAULT 'draft_pending_ulrich',
        created_at      TIMESTAMPTZ DEFAULT NOW(),
        sent_at         TIMESTAMPTZ,
        notes           TEXT
      );
      CREATE INDEX IF NOT EXISTS idx_prop_opp    ON daleba_proposals(opportunity_id);
      CREATE INDEX IF NOT EXISTS idx_prop_status ON daleba_proposals(status);
    `);
    console.log('[proposals] Table daleba_proposals OK');
  } catch (e) {
    if (!e.message.includes('already exists')) console.error('[proposals] initTable:', e.message);
  }
}
initTable();

// ── GET /api/proposals ────────────────────────────────────────────────────────
router.get('/', async (req, res) => {
  try {
    const { status, limit = 50, offset = 0 } = req.query;
    let where = '';
    const params = [];
    if (status) { where = 'WHERE p.status = $1'; params.push(status); }
    const limitIdx  = params.length + 1;
    const offsetIdx = params.length + 2;

    const { rows } = await pool.query(`
      SELECT p.*, o.title AS opp_title, o.source_platform, o.category,
             o.score, o.country, o.budget_estimated, o.budget_currency
      FROM daleba_proposals p
      JOIN daleba_opportunities o ON o.id = p.opportunity_id
      ${where}
      ORDER BY p.created_at DESC
      LIMIT $${limitIdx} OFFSET $${offsetIdx}
    `, [...params, parseInt(limit), parseInt(offset)]);

    res.json({ proposals: rows, count: rows.length });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── GET /api/proposals/opportunity/:oppId ─────────────────────────────────────

// ── DELETE /api/proposals/reset — V42 Reset données de test ──────────────────
router.delete('/reset', async (req, res) => {
  try {
    const result = await pool.query('DELETE FROM daleba_proposals');
    res.json({ ok: true, deleted: result.rowCount, table: 'daleba_proposals' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/opportunity/:oppId', async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT p.*, o.title AS opp_title, o.source_platform, o.category,
              o.score, o.country, o.budget_estimated, o.budget_currency, o.language_original
       FROM daleba_proposals p
       JOIN daleba_opportunities o ON o.id = p.opportunity_id
       WHERE p.opportunity_id = $1
       ORDER BY p.created_at DESC LIMIT 1`,
      [req.params.oppId]
    );
    if (!rows.length) return res.status(404).json({ error: 'No proposal yet' });
    res.json(rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── GET /api/proposals/:id ────────────────────────────────────────────────────
router.get('/:id', async (req, res) => {
  try {
    const { rows } = await pool.query(
      'SELECT * FROM daleba_proposals WHERE id = $1', [req.params.id]
    );
    if (!rows.length) return res.status(404).json({ error: 'Not found' });
    res.json(rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── POST /api/proposals/generate/:oppId — génération manuelle ─────────────────
router.post('/generate/:oppId', async (req, res) => {
  // Répond immédiatement, génère en arrière-plan
  res.json({ message: 'Génération lancée', opportunity_id: req.params.oppId, started_at: new Date() });

  try {
    const oppResult = await pool.query(
      'SELECT * FROM daleba_opportunities WHERE id = $1', [req.params.oppId]
    );
    if (!oppResult.rows.length) return;

    const opp  = oppResult.rows[0];
    const { generateProposal } = require('../services/proposal-writer');
    const result = await generateProposal(opp, pool);
    const text = typeof result === 'string' ? result : result.text;
    const pricing = result.pricing || null;
    const paymentUrl = result.paymentUrl || null;

    await pool.query(`
      INSERT INTO daleba_proposals (opportunity_id, generated_text, status, notes)
      VALUES ($1, $2, 'draft_pending_ulrich', $3)
    `, [opp.id, text, pricing ? JSON.stringify({ finalPrice: pricing.finalPrice, marketRateUSD: pricing.marketRateUSD, strategy: pricing.strategy.label, paymentUrl }) : null]);

    console.log(`[proposals] Proposition enregistrée pour opp #${opp.id}`);
  } catch (err) {
    console.error('[proposals/generate] Erreur:', err.message);
  }
});

// ── PUT /api/proposals/:id/status ─────────────────────────────────────────────
router.put('/:id/status', async (req, res) => {
  try {
    const { status } = req.body;
    const allowed = ['draft_pending_ulrich', 'approved_to_send', 'sent', 'archived'];
    if (!allowed.includes(status)) {
      return res.status(400).json({ error: `Status invalide. Autorisés: ${allowed.join(', ')}` });
    }
    const extraFields = status === 'sent' ? ', sent_at = NOW()' : '';
    const { rows } = await pool.query(
      `UPDATE daleba_proposals SET status = $1${extraFields} WHERE id = $2 RETURNING *`,
      [status, req.params.id]
    );
    if (!rows.length) return res.status(404).json({ error: 'Not found' });
    res.json(rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── DELETE /api/proposals/:id ─────────────────────────────────────────────────
router.delete('/:id', async (req, res) => {
  try {
    const { rowCount } = await pool.query(
      'DELETE FROM daleba_proposals WHERE id = $1', [req.params.id]
    );
    if (!rowCount) return res.status(404).json({ error: 'Not found' });
    res.json({ deleted: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── POST /api/proposals/:id/send — Agent Envoyeur (déclenché par Ulrich) ──────
router.post('/:id/send', async (req, res) => {
  try {
    // 1. Charger la proposition + opportunité liée
    const { rows: propRows } = await pool.query(
      `SELECT p.*, o.title, o.source_platform, o.source_url, o.language_original,
              o.description_orig, o.description_fr, o.category, o.score,
              o.country, o.budget_estimated, o.budget_currency
       FROM daleba_proposals p
       JOIN daleba_opportunities o ON o.id = p.opportunity_id
       WHERE p.id = $1`,
      [req.params.id]
    );
    if (!propRows.length) return res.status(404).json({ error: 'Proposition introuvable' });

    const row = propRows[0];
    if (row.status === 'sent_to_client') {
      return res.status(409).json({ error: 'Déjà envoyée', sent_at: row.sent_at });
    }

    // ── Filtre de sécurité prix ─────────────────────────────────────────
    const { normalizeBudget } = require('../services/pricing-guard');
    const budgetCheck = normalizeBudget(row);
    if (budgetCheck.was_floored) {
      // Budget était 0 — on bloque l'envoi et on informe
      return res.status(422).json({
        error:       'PRICE_GUARD_BLOCKED',
        message:     `Budget à 0 détecté pour cette opportunité. Envoi bloqué — alerte maintenance levée.`,
        floor_applied: budgetCheck.budget_display,
        action_required: 'Mettez à jour le budget manuellement dans le dashboard avant de propulser.',
      });
    }

    const opportunity = {
      id:                 row.opportunity_id,
      title:              row.title,
      source_platform:    row.source_platform,
      source_url:         row.source_url,
      language_original:  row.language_original,
      description_orig:   row.description_orig,
      description_fr:     row.description_fr,
      category:           row.category,
      score:              row.score,
      country:            row.country,
      budget_estimated:   row.budget_estimated,
      budget_currency:    row.budget_currency,
    };

    const proposal = {
      id:             row.id,
      generated_text: row.generated_text,
    };

    // 2. Appeler l'Agent Envoyeur
    const { sendProposal } = require('../services/sender-agent');
    const result = await sendProposal(opportunity, proposal);

    // 3. Mettre à jour le statut en DB
    const newStatus = result.success ? 'sent_to_client' : 'manual_required';
    const { rows: updated } = await pool.query(
      `UPDATE daleba_proposals
       SET status = $1,
           sent_at = CASE WHEN $2 THEN NOW() ELSE sent_at END,
           notes = $3
       WHERE id = $4 RETURNING *`,
      [
        newStatus,
        result.success,
        result.success
          ? `Email direct → ${result.contactEmail} | Resend: ${result.resendId}`
          : `Manuel requis: ${result.reason}`,
        req.params.id,
      ]
    );

    res.json({
      proposal:  updated[0],
      send_result: result,
    });
  } catch (err) {
    console.error('[proposals/send] Erreur:', err.message);
    res.status(500).json({ error: err.message });
  }
});


module.exports = router;
