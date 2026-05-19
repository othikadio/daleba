'use strict';
/**
 * Admin Tenants Routes — DALEBA Metacortex Points 273-274
 * Panneau pilotage Ulrich: suspendre, résilier, métriques temps réel.
 * Accès strictement réservé à Ulrich [293].
 */
const express  = require('express');
const router   = express.Router();
const { pool } = require('../memory/db');
const metrics  = require('../services/tenant-metrics');
const billing  = require('../services/saas-billing-tracker');
const bus      = require('../services/event-bus');

function ok(res, data)         { res.json({ success:true, data, ts:new Date().toISOString() }); }
function err(res, msg, s=500)  { res.status(s).json({ success:false, error:msg, ts:new Date().toISOString() }); }

// GET / — Liste tous les tenants + métriques consolidées [274]
router.get('/', async (req, res) => {
  try {
    const tenants  = await metrics.getAllTenantsMetrics(pool);
    const revenue  = await billing.getPlatformRevenue(pool).catch(()=>({ total:0 }));
    const active   = tenants.filter(t => t.status === 'active').length;
    const boarding = tenants.filter(t => t.status === 'onboarding').length;
    ok(res, { tenants, platformRevenue: revenue.total, totalActive: active, totalOnboarding: boarding, total: tenants.length });
  } catch(e) { err(res, e.message); }
});

// GET /platform/stats — Stats globales
router.get('/platform/stats', async (req, res) => {
  try {
    const r = await pool.query(`SELECT status, COUNT(*) as count FROM tenant_settings GROUP BY status`).catch(()=>({rows:[]}));
    const byStatus = {};
    for (const row of r.rows) byStatus[row.status] = parseInt(row.count);
    const revenue = await billing.getPlatformRevenue(pool).catch(()=>({ total:0, byPlan:{} }));
    ok(res, { byStatus, revenue, total: Object.values(byStatus).reduce((a,b)=>a+b, 0) });
  } catch(e) { err(res, e.message); }
});

// GET /:tenantId — Détails complets
router.get('/:tenantId', async (req, res) => {
  try {
    const { tenantId } = req.params;
    const r = await pool.query(`SELECT * FROM tenant_settings WHERE tenant_id=$1`, [tenantId]);
    if (!r.rows[0]) return err(res, 'Tenant non trouvé', 404);
    const m  = await metrics.getTenantMetrics(pool, tenantId);
    const b  = await billing.getTenantBilling(pool, tenantId).catch(()=>[]);
    const creds = await pool.query(`SELECT key_name FROM tenant_credentials WHERE tenant_id=$1`, [tenantId]).catch(()=>({rows:[]}));
    ok(res, { ...r.rows[0], metrics: m, billing: b, credentialKeys: creds.rows.map(c=>c.key_name) });
  } catch(e) { err(res, e.message); }
});

// POST /:tenantId/suspend [293] — NE modifie pas le compte Ulrich
router.post('/:tenantId/suspend', async (req, res) => {
  try {
    const { tenantId } = req.params;
    // [293] Protection absolue du compte Ulrich
    const t = await pool.query(`SELECT manager_email FROM tenant_settings WHERE tenant_id=$1`, [tenantId]).catch(()=>({rows:[]}));
    if (t.rows[0]?.manager_email === 'kadioothniel@yahoo.fr') return err(res, 'Impossible de suspendre le compte administrateur', 403);
    await pool.query(`UPDATE tenant_settings SET status='suspended', updated_at=NOW() WHERE tenant_id=$1`, [tenantId]);
    bus.system(`[AdminTenants] ⚠️ Tenant suspendu: ${tenantId}`);
    ok(res, { suspended: true, tenantId });
  } catch(e) { err(res, e.message); }
});

// POST /:tenantId/reactivate
router.post('/:tenantId/reactivate', async (req, res) => {
  try {
    await pool.query(`UPDATE tenant_settings SET status='active', updated_at=NOW() WHERE tenant_id=$1`, [req.params.tenantId]);
    ok(res, { reactivated: true });
  } catch(e) { err(res, e.message); }
});

// DELETE /:tenantId — Résiliation soft [293]
router.delete('/:tenantId', async (req, res) => {
  try {
    const { tenantId } = req.params;
    const confirmName  = req.headers['x-confirm-name'];
    const t = await pool.query(`SELECT tenant_name, manager_email FROM tenant_settings WHERE tenant_id=$1`, [tenantId]).catch(()=>({rows:[]}));
    if (!t.rows[0]) return err(res, 'Tenant non trouvé', 404);
    // [293] Jamais résilier le compte Ulrich
    if (t.rows[0]?.manager_email === 'kadioothniel@yahoo.fr') return err(res, 'Impossible de résilier le compte administrateur', 403);
    if (confirmName !== t.rows[0].tenant_name) return err(res, 'Confirmation incorrecte — tapez le nom exact du salon', 400);
    await pool.query(`UPDATE tenant_settings SET status='deleted', deleted_at=NOW() WHERE tenant_id=$1`, [tenantId]);
    bus.system(`[AdminTenants] 🔴 Résiliation: ${tenantId} | ${t.rows[0].tenant_name}`);
    ok(res, { deleted: true, tenantId, note: 'Soft delete — données conservées 30 jours.' });
  } catch(e) { err(res, e.message); }
});

module.exports = router;
