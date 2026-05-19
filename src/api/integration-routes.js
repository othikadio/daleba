/**
 * Integration Hub Routes — Points 082-088
 * /api/v1/integration/ext-app  — API universelle apps externes
 * /api/docs                    — Documentation auto-générée
 */

'use strict';

const express = require('express');
const router  = express.Router();
const hub     = require('../services/integration-hub');

// ─── MIDDLEWARE AUTH [082] ────────────────────────────────────────────────────

function requireExtApiKey(req, res, next) {
  const apiKey = req.headers['x-daleba-api-key'] || req.query.api_key;
  if (!apiKey) return res.status(401).json({ error: 'X-DALEBA-API-Key requis' });

  const validation = hub.validateApiKey(apiKey);
  if (!validation.valid) return res.status(403).json({ error: 'Clé API invalide ou app inactive' });

  req.extApp = validation;
  next();
}

// ─── ENDPOINTS APP EXTERNE [082, 083] ────────────────────────────────────────

// POST /api/v1/integration/ext-app/data — Injecter des données [083]
router.post('/data', requireExtApiKey, async (req, res) => {
  const { table, records, upsert = false } = req.body;
  if (!table || !Array.isArray(records)) {
    return res.status(400).json({ error: 'table et records[] requis' });
  }

  // [083] Isolation — vérifie qu'on ne touche pas aux tables coiffure
  try {
    hub.assertTenantIsolation(req.extApp.appId, table);
  } catch (err) {
    return res.status(403).json({ error: err.message });
  }

  // Insertion via pg-pool
  try {
    const maintenance = require('../services/maintenance');
    const results = [];

    for (const record of records.slice(0, 100)) { // Max 100 par batch
      const sql = upsert
        ? `INSERT INTO ${table} (data, external_ref, tenant_id) VALUES ($1, $2, $3) ON CONFLICT (external_ref) DO UPDATE SET data = $1, updated_at = NOW()`
        : `INSERT INTO ${table} (data, external_ref, tenant_id) VALUES ($1, $2, $3)`;
      await maintenance.query(sql, [
        JSON.stringify(record.data || record),
        record.id || record.external_ref || null,
        req.extApp.app.category,
      ]);
      results.push({ ok: true });
    }

    // [085] Déclencher webhooks sync si clients
    if (table.includes('client')) {
      await hub.fireWebhook('client.updated', { table, count: records.length, appId: req.extApp.appId });
    }

    res.json({ success: true, inserted: results.length, table });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/v1/integration/ext-app/clients — Lire fiches [083]
router.get('/clients', requireExtApiKey, async (req, res) => {
  const app = req.extApp.app;
  const clientTable = app.tables.find(t => t.includes('client')) || null;
  if (!clientTable) return res.status(404).json({ error: 'Aucune table clients pour cette app' });

  try {
    const maintenance = require('../services/maintenance');
    const limit = Math.min(parseInt(req.query.limit) || 50, 200);
    const offset = parseInt(req.query.offset) || 0;
    const result = await maintenance.query(
      `SELECT id, external_ref, data, created_at, updated_at FROM ${clientTable} ORDER BY created_at DESC LIMIT $1 OFFSET $2`,
      [limit, offset]
    );
    res.json({ records: result.rows, total: result.rowCount, table: clientTable });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/v1/integration/ext-app/webhook — Enregistrer webhook [085]
router.post('/webhook', requireExtApiKey, (req, res) => {
  const { event, url, secret } = req.body;
  if (!event || !url) return res.status(400).json({ error: 'event et url requis' });

  hub.registerWebhook(req.extApp.appId, event, url, secret);
  res.json({ success: true, event, url, availableEvents: hub.CLIENT_SYNC_EVENTS });
});

// GET /api/v1/integration/ext-app/schema — Schéma SQL [084]
router.get('/schema', requireExtApiKey, (req, res) => {
  const { category, entities } = req.query;
  if (!category || !entities) return res.status(400).json({ error: 'category et entities requis' });

  const entityList = entities.split(',').map(e => e.trim()).filter(Boolean);
  const sql = hub.generateTenantSchema(category, entityList);
  res.json({ category, entities: entityList, sql });
});

// POST /api/v1/integration/ext-app/register — Enregistrer nouvelle app
router.post('/register', (req, res) => {
  const { appId, name, category, tables, description } = req.body;
  if (!appId || !name) return res.status(400).json({ error: 'appId et name requis' });

  try {
    const result = hub.registerApp(appId, { name, category, tables, description });
    res.status(201).json(result);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// ─── DOCS AUTO-GÉNÉRÉES [088] ─────────────────────────────────────────────────

// GET /api/docs
router.get('/docs', (req, res) => {
  const docs = hub.generateAPIDocs();
  if (req.headers.accept?.includes('text/html')) {
    // Version HTML lisible
    res.send(`<!DOCTYPE html>
<html lang="fr">
<head><meta charset="UTF-8"><title>DALEBA API Docs</title>
<style>body{font-family:monospace;background:#0d1117;color:#e6edf3;padding:2rem}
h1{color:#58a6ff}h2{color:#79c0ff;border-bottom:1px solid #30363d;padding-bottom:.5rem}
pre{background:#161b22;padding:1rem;border-radius:6px;overflow-x:auto}
.badge{display:inline-block;padding:2px 8px;border-radius:4px;font-size:.8em;margin-right:.5rem}
.get{background:#238636}.post{background:#1f6feb}.del{background:#b91c1c}</style></head>
<body>
<h1>🤖 DALEBA API — Documentation</h1>
<p>Généré le ${docs._generated}</p>
<h2>Authentification</h2>
<pre>${JSON.stringify(docs.authentication, null, 2)}</pre>
<h2>Endpoints</h2>
${Object.entries(docs.endpoints).map(([path, info]) => {
  const method = path.split(' ')[0];
  return `<div><span class="badge ${method.toLowerCase()}">${method}</span><strong>${path.split(' ')[1]}</strong>
  <p>${info.description}</p></div>`;
}).join('')}
<h2>Applications enregistrées</h2>
<pre>${JSON.stringify(docs.registeredApps, null, 2)}</pre>
</body></html>`);
  } else {
    res.json(docs);
  }
});

module.exports = router;
