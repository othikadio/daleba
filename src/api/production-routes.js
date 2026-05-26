/**
 * DALEBA — Production Routes (Usine de Production)
 *
 * POST /api/production/tasks           → créer + générer spec
 * GET  /api/production/tasks           → lister tâches
 * GET  /api/production/tasks/:id       → détail
 * POST /api/production/tasks/:id/regen → regénérer spec
 * PUT  /api/production/tasks/:id/status → changer statut
 * DELETE /api/production/tasks/:id     → supprimer
 */
'use strict';

const express = require('express');
const router  = express.Router();

let pool = null, DEMO_MODE = true;
try { const db = require('../memory/db'); pool = db.pool; DEMO_MODE = db.DEMO_MODE; } catch (e) {}

// ── Auto-migration ────────────────────────────────────────────────────────────
async function initTable() {
  if (DEMO_MODE || !pool) return;
  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS daleba_production_tasks (
        id                        SERIAL PRIMARY KEY,
        client_need_raw           TEXT    NOT NULL,
        context_additional        TEXT,
        specifications_functional TEXT,
        engine_used               VARCHAR(30),
        status                    VARCHAR(30) DEFAULT 'spec_pending_ulrich',
        technical_architecture_spec TEXT,
        arch_engine_used          VARCHAR(30),
        arch_status               VARCHAR(30) DEFAULT 'arch_pending',
        created_at                TIMESTAMPTZ DEFAULT NOW(),
        updated_at                TIMESTAMPTZ DEFAULT NOW(),
        notes                     TEXT
      );
      CREATE INDEX IF NOT EXISTS idx_prod_status ON daleba_production_tasks(status);
      CREATE INDEX IF NOT EXISTS idx_prod_created ON daleba_production_tasks(created_at DESC);
    `);
    // Migration douce : ajouter colonnes si la table existait déjà
    await pool.query(`ALTER TABLE daleba_production_tasks ADD COLUMN IF NOT EXISTS technical_architecture_spec TEXT;`);
    await pool.query(`ALTER TABLE daleba_production_tasks ADD COLUMN IF NOT EXISTS arch_engine_used VARCHAR(30);`);
    await pool.query(`ALTER TABLE daleba_production_tasks ADD COLUMN IF NOT EXISTS arch_status VARCHAR(30) DEFAULT 'arch_pending';`);
    // Étape 3 — Agent Dev
    await pool.query(`ALTER TABLE daleba_production_tasks ADD COLUMN IF NOT EXISTS generated_code_files JSONB;`);
    await pool.query(`ALTER TABLE daleba_production_tasks ADD COLUMN IF NOT EXISTS generated_code_raw TEXT;`);
    await pool.query(`ALTER TABLE daleba_production_tasks ADD COLUMN IF NOT EXISTS dev_engine_used VARCHAR(30);`);
    await pool.query(`ALTER TABLE daleba_production_tasks ADD COLUMN IF NOT EXISTS dev_status VARCHAR(30) DEFAULT 'code_pending';`);
    console.log('[production] Table daleba_production_tasks OK (Étape 1+2+3)');
  } catch (e) {
    if (!e.message.includes('already exists')) console.error('[production] initTable:', e.message);
  }
}
initTable();

// ── POST /api/production/tasks — créer + générer en arrière-plan ───────────────
router.post('/tasks', async (req, res) => {
  try {
    const { client_need_raw, context_additional = '' } = req.body;
    if (!client_need_raw?.trim()) {
      return res.status(400).json({ error: 'client_need_raw est requis' });
    }

    // Insérer d'abord avec status "generating"
    const { rows } = await pool.query(`
      INSERT INTO daleba_production_tasks
        (client_need_raw, context_additional, status)
      VALUES ($1, $2, 'generating')
      RETURNING *
    `, [client_need_raw.trim(), context_additional.trim()]);

    const task = rows[0];
    res.json({ task, message: 'Cahier des charges en cours de génération…' });

    // Générer la spec en arrière-plan
    setImmediate(async () => {
      try {
        const { generateSpec } = require('../services/product-owner-agent');
        const { spec, engine } = await generateSpec(client_need_raw, context_additional);

        await pool.query(`
          UPDATE daleba_production_tasks
          SET specifications_functional = $1,
              engine_used = $2,
              status = 'spec_pending_ulrich',
              updated_at = NOW()
          WHERE id = $3
        `, [spec, engine, task.id]);

        console.log(`[production] Spec générée — task #${task.id} (${engine})`);
      } catch (err) {
        await pool.query(
          `UPDATE daleba_production_tasks SET status = 'error', notes = $1, updated_at = NOW() WHERE id = $2`,
          [err.message, task.id]
        ).catch(() => {});
        console.error(`[production] Erreur génération task #${task.id}:`, err.message);
      }
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── GET /api/production/tasks ──────────────────────────────────────────────────
router.get('/tasks', async (req, res) => {
  try {
    const { status, limit = 50, offset = 0 } = req.query;
    const where  = status ? 'WHERE status = $1' : '';
    const params = status
      ? [status, parseInt(limit), parseInt(offset)]
      : [parseInt(limit), parseInt(offset)];
    const limitIdx = status ? 2 : 1;

    const { rows } = await pool.query(`
      SELECT id, client_need_raw, context_additional, engine_used,
             status, created_at, updated_at, notes,
             arch_status, arch_engine_used,
             dev_status, dev_engine_used,
             LEFT(specifications_functional, 300) AS spec_preview
      FROM daleba_production_tasks
      ${where}
      ORDER BY created_at DESC
      LIMIT $${limitIdx} OFFSET $${limitIdx + 1}
    `, params);

    const count = await pool.query(
      `SELECT COUNT(*) FROM daleba_production_tasks ${where}`,
      status ? [status] : []
    );

    res.json({ tasks: rows, total: parseInt(count.rows[0].count) });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── GET /api/production/tasks/:id ─────────────────────────────────────────────
router.get('/tasks/:id', async (req, res) => {
  try {
    const { rows } = await pool.query(
      'SELECT * FROM daleba_production_tasks WHERE id = $1', [req.params.id]
    );
    if (!rows.length) return res.status(404).json({ error: 'Not found' });
    res.json(rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── POST /api/production/tasks/:id/regen ──────────────────────────────────────
router.post('/tasks/:id/regen', async (req, res) => {
  try {
    const { rows } = await pool.query(
      'SELECT * FROM daleba_production_tasks WHERE id = $1', [req.params.id]
    );
    if (!rows.length) return res.status(404).json({ error: 'Not found' });
    const task = rows[0];

    await pool.query(
      `UPDATE daleba_production_tasks SET status = 'generating', updated_at = NOW() WHERE id = $1`,
      [task.id]
    );
    res.json({ message: 'Regénération lancée', task_id: task.id });

    setImmediate(async () => {
      try {
        const { generateSpec } = require('../services/product-owner-agent');
        const { spec, engine } = await generateSpec(task.client_need_raw, task.context_additional || '');
        await pool.query(`
          UPDATE daleba_production_tasks
          SET specifications_functional = $1, engine_used = $2,
              status = 'spec_pending_ulrich', updated_at = NOW()
          WHERE id = $3
        `, [spec, engine, task.id]);
      } catch (err) {
        await pool.query(
          `UPDATE daleba_production_tasks SET status = 'error', notes = $1, updated_at = NOW() WHERE id = $2`,
          [err.message, task.id]
        ).catch(() => {});
      }
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── PUT /api/production/tasks/:id/status ──────────────────────────────────────
router.put('/tasks/:id/status', async (req, res) => {
  try {
    const { status, notes } = req.body;
    const allowed = ['spec_pending_ulrich', 'spec_approved', 'in_development', 'delivered', 'archived'];
    if (!allowed.includes(status)) {
      return res.status(400).json({ error: `Statuts valides: ${allowed.join(', ')}` });
    }
    const { rows } = await pool.query(
      `UPDATE daleba_production_tasks
       SET status = $1, notes = COALESCE($2, notes), updated_at = NOW()
       WHERE id = $3 RETURNING *`,
      [status, notes || null, req.params.id]
    );
    if (!rows.length) return res.status(404).json({ error: 'Not found' });
    res.json(rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── POST /api/production/tasks/:id/architect — Étape 2 ──────────────────────
router.post('/tasks/:id/architect', async (req, res) => {
  try {
    const { rows } = await pool.query(
      'SELECT * FROM daleba_production_tasks WHERE id = $1', [req.params.id]
    );
    if (!rows.length) return res.status(404).json({ error: 'Not found' });
    const task = rows[0];

    if (!task.specifications_functional) {
      return res.status(400).json({ error: 'Le cahier des charges fonctionnel (Étape 1) doit être généré avant l\'architecture.' });
    }

    // Passer en mode generating
    await pool.query(
      `UPDATE daleba_production_tasks SET arch_status = 'arch_generating', updated_at = NOW() WHERE id = $1`,
      [task.id]
    );
    res.json({ message: 'Agent Architecte lancé — architecture en cours…', task_id: task.id });

    // Générer en arrière-plan
    setImmediate(async () => {
      try {
        const { generateArchitecture } = require('../services/architect-agent');
        const { arch, engine } = await generateArchitecture(
          task.specifications_functional,
          task.client_need_raw
        );

        await pool.query(`
          UPDATE daleba_production_tasks
          SET technical_architecture_spec = $1,
              arch_engine_used = $2,
              arch_status = 'arch_pending_ulrich',
              updated_at = NOW()
          WHERE id = $3
        `, [arch, engine, task.id]);

        console.log(`[production] Architecture générée — task #${task.id} (${engine})`);
      } catch (err) {
        await pool.query(
          `UPDATE daleba_production_tasks SET arch_status = 'arch_error', notes = $1, updated_at = NOW() WHERE id = $2`,
          [err.message, task.id]
        ).catch(() => {});
        console.error(`[production] Erreur architecture task #${task.id}:`, err.message);
      }
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});


// ── POST /api/production/tasks/:id/dev — Étape 3 ─────────────────────────────
router.post('/tasks/:id/dev', async (req, res) => {
  try {
    const { rows } = await pool.query(
      'SELECT * FROM daleba_production_tasks WHERE id = $1', [req.params.id]
    );
    if (!rows.length) return res.status(404).json({ error: 'Not found' });
    const task = rows[0];

    if (!task.technical_architecture_spec) {
      return res.status(400).json({ error: 'L\'architecture technique (Étape 2) doit être générée avant de coder.' });
    }

    await pool.query(
      `UPDATE daleba_production_tasks SET dev_status = 'code_generating', updated_at = NOW() WHERE id = $1`,
      [task.id]
    );
    res.json({ message: 'Agent Développeur lancé — code en production (60-120s)…', task_id: task.id });

    setImmediate(async () => {
      try {
        const { generateCode } = require('../services/dev-agent');
        const { files, rawOutput, engine, fileCount } = await generateCode(
          task.client_need_raw,
          task.specifications_functional || '',
          task.technical_architecture_spec
        );

        await pool.query(`
          UPDATE daleba_production_tasks
          SET generated_code_files = $1,
              generated_code_raw   = $2,
              dev_engine_used      = $3,
              dev_status           = 'code_pending_ulrich',
              updated_at           = NOW()
          WHERE id = $4
        `, [JSON.stringify(files), rawOutput, engine, task.id]);

        console.log(`[production] Code généré — task #${task.id} — ${fileCount} fichiers (${engine})`);
      } catch (err) {
        await pool.query(
          `UPDATE daleba_production_tasks SET dev_status = 'code_error', notes = $1, updated_at = NOW() WHERE id = $2`,
          [err.message, task.id]
        ).catch(() => {});
        console.error(`[production] Erreur dev task #${task.id}:`, err.message);
      }
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── PUT /api/production/tasks/:id/dev-approve ─────────────────────────────────
router.put('/tasks/:id/dev-approve', async (req, res) => {
  try {
    const { rows } = await pool.query(
      `UPDATE daleba_production_tasks
       SET dev_status = 'code_approved', updated_at = NOW()
       WHERE id = $1 RETURNING *`,
      [req.params.id]
    );
    if (!rows.length) return res.status(404).json({ error: 'Not found' });
    res.json(rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── GET /api/production/tasks/:id/code — télécharger les fichiers ─────────────
router.get('/tasks/:id/code', async (req, res) => {
  try {
    const { rows } = await pool.query(
      'SELECT id, generated_code_files, dev_status, dev_engine_used FROM daleba_production_tasks WHERE id = $1',
      [req.params.id]
    );
    if (!rows.length) return res.status(404).json({ error: 'Not found' });
    const t = rows[0];
    if (!t.generated_code_files) return res.status(404).json({ error: 'Code pas encore généré' });
    res.json({
      files: t.generated_code_files,
      engine: t.dev_engine_used,
      status: t.dev_status,
      fileCount: Object.keys(t.generated_code_files).length,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});


// ── PUT /api/production/tasks/:id/arch-approve ────────────────────────────────
router.put('/tasks/:id/arch-approve', async (req, res) => {
  try {
    const { rows } = await pool.query(
      `UPDATE daleba_production_tasks
       SET arch_status = 'arch_approved', updated_at = NOW()
       WHERE id = $1 RETURNING *`,
      [req.params.id]
    );
    if (!rows.length) return res.status(404).json({ error: 'Not found' });
    res.json(rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});


// ── POST /api/production/tasks/:id/inject-file — injecter un fichier dans le JSONB ──
router.post('/tasks/:id/inject-file', async (req, res) => {
  try {
    const { path, content } = req.body;
    if (!path || !content) return res.status(400).json({ error: 'path et content requis' });

    const { rows } = await pool.query(
      'SELECT generated_code_files FROM daleba_production_tasks WHERE id = $1', [req.params.id]
    );
    if (!rows.length) return res.status(404).json({ error: 'Not found' });

    const files = rows[0].generated_code_files || {};
    files[path] = content;

    await pool.query(
      `UPDATE daleba_production_tasks
       SET generated_code_files = $1, updated_at = NOW()
       WHERE id = $2`,
      [JSON.stringify(files), req.params.id]
    );

    res.json({ ok: true, path, totalFiles: Object.keys(files).length });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── DELETE /api/production/tasks/:id ──────────────────────────────────────────
router.delete('/tasks/:id', async (req, res) => {
  try {
    const { rowCount } = await pool.query(
      'DELETE FROM daleba_production_tasks WHERE id = $1', [req.params.id]
    );
    if (!rowCount) return res.status(404).json({ error: 'Not found' });
    res.json({ deleted: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
