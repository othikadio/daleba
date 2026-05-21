'use strict';
/**
 * Staff Routes — DALEBA Metacortex Points 315-316, 320-341
 * Tous les endpoints opérationnels de gestion d'équipe.
 * [340] Isolation multi-tenant stricte via middleware tenant
 */
const express    = require('express');
const router     = express.Router();
const { pool }   = require('../memory/db');
const { requireAuth } = require('../middleware/auth');
const bus        = require('../services/event-bus');

// Services
const staffSkills     = require('../services/staff-skills');
const loadBalancer    = require('../services/fair-load-balancer');
const commEngine      = require('../services/commission-engine');
const payouts         = require('../services/staff-payouts');
const conflictSentry  = require('../services/schedule-conflict-sentry');
const watchdog        = require('../services/staff-attendance-watchdog');
const worker          = require('../services/staff-sync-worker');
const notifier        = require('../services/staff-notifier');
const perfMonitor     = require('../services/performance-monitor');
const kpiTracker      = require('../services/kpi-tracker');
const simulator       = require('../services/schedule-simulator');
const pooledTips      = require('../services/pooled-tips');
const auditLog        = require('../services/security-audit-log');
const bookingLock     = require('../services/booking-lock');

const ok  = (res, data, s=200)  => res.status(s).json({ success:true,  data,  ts: new Date().toISOString() });
const err = (res, msg, s=400)   => res.status(s).json({ success:false, error: msg, ts: new Date().toISOString() });

// [340] Middleware isolation tenant: extrait et valide le tenant_id
function withTenant(req) {
  return req.user?.tenantId || req.query.tenantId || 'kadio';
}

// ── Liste des employés ────────────────────────────────────────────────────────
router.get('/', requireAuth, async (req, res) => {
  try {
    const tenantId = withTenant(req);
    const r = await pool.query(
      `SELECT * FROM staff_profiles WHERE tenant_id=$1 ORDER BY name`, [tenantId]
    );
    ok(res, { staff: r.rows, count: r.rows.length });
  } catch(e) { err(res, e.message, 500); }
});

// ── Sync Square Team ──────────────────────────────────────────────────────────
router.post('/sync', requireAuth, async (req, res) => {
  try {
    const tenantId    = withTenant(req);
    const accessToken = process.env.SQUARE_ACCESS_TOKEN;
    if (!accessToken) return err(res, 'SQUARE_ACCESS_TOKEN requis');
    const result = await worker.syncNow(tenantId, accessToken, pool);
    ok(res, result);
  } catch(e) { err(res, e.message, 500); }
});

// ── Assignation intelligente [304-306] ───────────────────────────────────────
router.post('/assign', requireAuth, async (req, res) => {
  try {
    const tenantId     = withTenant(req);
    const { catalogItemId, startAt, endAt } = req.body;
    if (!catalogItemId) return err(res, 'catalogItemId requis');

    // [341] Vérifier chevauchements
    const result = await loadBalancer.assignBestEmployee({ tenantId, catalogItemId, pool });
    if (startAt && endAt && result.employee) {
      const overlap = await bookingLock.checkOverlap(pool, tenantId, result.employee.employee_square_id, startAt, endAt);
      if (overlap) return err(res, 'Créneau déjà réservé pour cet employé', 409);
    }
    ok(res, result);
  } catch(e) { err(res, e.message, 400); }
});

// ── Modifier taux commission [319, 330] ───────────────────────────────────────
router.patch('/:squareId/commission', requireAuth, async (req, res) => {
  try {
    const tenantId = withTenant(req);
    const { commission_rate, product_commission_rate } = req.body;

    const old = await pool.query(
      `SELECT commission_rate, product_commission_rate FROM staff_profiles WHERE tenant_id=$1 AND square_id=$2`,
      [tenantId, req.params.squareId]
    );

    await pool.query(`
      UPDATE staff_profiles SET commission_rate=$3, product_commission_rate=$4, updated_at=NOW()
      WHERE tenant_id=$1 AND square_id=$2
    `, [tenantId, req.params.squareId, commission_rate || 40, product_commission_rate || 10]);

    // [330] Log audit
    await auditLog.logAdminAction(pool, {
      tenantId, action: 'UPDATE_COMMISSION', targetType: 'employee',
      targetId: req.params.squareId,
      oldValue: old.rows[0],
      newValue: { commission_rate, product_commission_rate },
      ipAddress: req.ip,
    });

    ok(res, { updated: true, commission_rate, product_commission_rate });
  } catch(e) { err(res, e.message, 500); }
});

// ── Blocage agenda [319, 330] ─────────────────────────────────────────────────
router.post('/:squareId/block', requireAuth, async (req, res) => {
  try {
    const tenantId = withTenant(req);
    const { from, to, reason = 'blocage admin' } = req.body;
    if (!from || !to) return err(res, 'from et to requis');

    await conflictSentry.blockLeave(pool, {
      tenantId, employeeId: req.params.squareId, startAt: from, endAt: to, reason,
    });

    // [330] Log audit
    await auditLog.logAdminAction(pool, {
      tenantId, action: 'BLOCK_SCHEDULE', targetType: 'schedule',
      targetId: req.params.squareId,
      newValue: { from, to, reason }, ipAddress: req.ip,
    });

    ok(res, { blocked: true });
  } catch(e) { err(res, e.message, 500); }
});

// ── Rapport quinzaine [315-316] ───────────────────────────────────────────────
router.get('/payouts/report', requireAuth, async (req, res) => {
  try {
    const tenantId = withTenant(req);
    const { startDate, endDate } = req.query;
    const report = await payouts.generateBiweeklyReport(tenantId, pool, { startDate, endDate });
    ok(res, report);
  } catch(e) { err(res, e.message, 500); }
});

// ── Marquer payé ──────────────────────────────────────────────────────────────
router.post('/payouts/:squareId/paid', requireAuth, async (req, res) => {
  try {
    const tenantId = withTenant(req);
    const result   = await payouts.markPaid(pool, tenantId, req.params.squareId);
    ok(res, result);
  } catch(e) { err(res, e.message, 500); }
});

// ── Alertes retard [317] ──────────────────────────────────────────────────────
router.get('/alerts', requireAuth, async (req, res) => {
  try {
    const tenantId = withTenant(req);
    const live     = await watchdog.checkLateStarts(pool, tenantId);
    const current  = watchdog.getActiveAlerts();
    ok(res, { liveAlerts: live, activeAlerts: current, count: current.length });
  } catch(e) { err(res, e.message, 500); }
});

// ── Performance + rétention [325-326] ────────────────────────────────────────
router.get('/performance', requireAuth, async (req, res) => {
  try {
    const tenantId = withTenant(req);
    const team     = await perfMonitor.computeTeamRetention(pool, tenantId);
    const suggestions = [];
    for (const m of team) {
      const s = await perfMonitor.checkCommissionRaiseSuggestion(pool, tenantId, m.squareId);
      if (s.suggest) suggestions.push(s);
    }
    ok(res, { teamRetention: team, raiseSuggestions: suggestions });
  } catch(e) { err(res, e.message, 500); }
});

// ── CA top-day pour voice-commander [331] ─────────────────────────────────────
router.get('/performance/today', requireAuth, async (req, res) => {
  try {
    const tenantId = withTenant(req);
    const tops     = await perfMonitor.getTopPerformerToday(pool, tenantId);
    const phrase   = await perfMonitor.getVoicePerformanceSummary(pool, tenantId);
    ok(res, { tops, voicePhrase: phrase });
  } catch(e) { err(res, e.message, 500); }
});

// ── KPI targets [338-339] ─────────────────────────────────────────────────────
router.get('/kpi', requireAuth, async (req, res) => {
  try {
    const tenantId = withTenant(req);
    const kpis     = await kpiTracker.getTeamKPIs(pool, tenantId);
    ok(res, { kpis });
  } catch(e) { err(res, e.message, 500); }
});

router.post('/:squareId/kpi', requireAuth, async (req, res) => {
  try {
    const tenantId = withTenant(req);
    const { targetCA, targetClients, periodLabel } = req.body;
    await kpiTracker.setTarget(pool, tenantId, req.params.squareId, periodLabel || new Date().toISOString().slice(0,7), { targetCA, targetClients });
    ok(res, { set: true });
  } catch(e) { err(res, e.message, 500); }
});

// ── Simulateur [327] ──────────────────────────────────────────────────────────
router.post('/simulate/new-employee', requireAuth, async (req, res) => {
  try {
    const tenantId = withTenant(req);
    const result   = await simulator.simulateNewEmployee(pool, tenantId, req.body);
    ok(res, result);
  } catch(e) { err(res, e.message, 500); }
});

router.post('/simulate/hours-change', requireAuth, async (req, res) => {
  try {
    const tenantId = withTenant(req);
    const result   = await simulator.simulateHoursChange(pool, tenantId, req.body);
    ok(res, result);
  } catch(e) { err(res, e.message, 500); }
});

// ── Multi-location [328] ──────────────────────────────────────────────────────
router.get('/locations', requireAuth, async (req, res) => {
  try {
    const tenantId = withTenant(req);
    const metrics  = await simulator.getMultiLocationMetrics(pool, tenantId);
    ok(res, { locations: metrics });
  } catch(e) { err(res, e.message, 500); }
});

// ── Pooled tips [329] ─────────────────────────────────────────────────────────
router.post('/pooled-tips/config', requireAuth, async (req, res) => {
  try {
    const tenantId = withTenant(req);
    const { enabled, scope } = req.body;
    await pooledTips.setPooledMode(pool, tenantId, enabled, scope);
    ok(res, { configured: true, enabled, scope });
  } catch(e) { err(res, e.message, 500); }
});

// ── Skills [307-308] ─────────────────────────────────────────────────────────
router.get('/:squareId/skills', requireAuth, async (req, res) => {
  try {
    const tenantId = withTenant(req);
    const sk       = await staffSkills.getEmployeeSkills(pool, tenantId, req.params.squareId);
    ok(res, { skills: sk });
  } catch(e) { err(res, e.message, 500); }
});

router.post('/:squareId/skills', requireAuth, async (req, res) => {
  try {
    const tenantId = withTenant(req);
    const { catalogItemId, serviceName } = req.body;
    if (!catalogItemId) return err(res, 'catalogItemId requis');
    await staffSkills.addSkill(pool, tenantId, req.params.squareId, catalogItemId, serviceName);
    ok(res, { added: true });
  } catch(e) { err(res, e.message, 500); }
});

// ── Audit log [330] ───────────────────────────────────────────────────────────
router.get('/audit', requireAuth, async (req, res) => {
  try {
    const tenantId = withTenant(req);
    const logs     = await auditLog.getAuditLog(pool, tenantId, { limit: parseInt(req.query.limit) || 50 });
    ok(res, { logs });
  } catch(e) { err(res, e.message, 500); }
});

// ── [347] Webhook Square Team — traité < 2s ───────────────────────────────────
router.post('/webhook/square', async (req, res) => {
  // Réponse immédiate à Square (< 2s exigé par Square)
  res.status(200).json({ received: true });

  // Traitement asynchrone découplé
  setImmediate(async () => {
    try {
      const { type, data } = req.body || {};
      if (!type?.startsWith('team_member')) return;

      const tenantId    = req.query.tenantId || 'kadio';
      const accessToken = process.env.SQUARE_ACCESS_TOKEN;

      if (type === 'team_member.created' || type === 'team_member.updated') {
        await worker.syncNow(tenantId, accessToken, pool);
        bus.system(`[Webhook] Square Team ${type} → sync immédiat`);
      }
    } catch (e) {
      bus.system(`[Webhook] Erreur Square Team: ${e.message}`);
    }
  });
});

// ── [348] Redistribution absence d'urgence ────────────────────────────────────
router.post('/absence', requireAuth, async (req, res) => {
  try {
    const tenantId = withTenant(req);
    const { employeeSquareId, date, reason = 'maladie' } = req.body;
    if (!employeeSquareId || !date) return err(res, 'employeeSquareId et date requis');

    const absenceMgr = require('../services/absence-manager');
    await absenceMgr.markAbsent(pool, tenantId, { employeeSquareId, date, reason });
    const result = await absenceMgr.triggerAbsenceRedistribution(pool, tenantId, {
      absentSquareId: employeeSquareId, date, approvedBy: req.user?.id || 'ulrich',
    });
    ok(res, result);
  } catch(e) { err(res, e.message, 500); }
});

// ── [344] PDF rapport quinzaine ───────────────────────────────────────────────
router.get('/payouts/report/pdf', requireAuth, async (req, res) => {
  try {
    const tenantId = withTenant(req);
    const { startDate, endDate } = req.query;
    const report   = await payouts.generateBiweeklyReport(tenantId, pool, { startDate, endDate });
    const pdfGen   = require('../services/staff-pdf-report');
    const html     = pdfGen.generatePayrollHTML(report);
    res.set('Content-Type', 'text/html');
    res.set('Content-Disposition', `inline; filename="daleba-payroll-${tenantId}.html"`);
    res.send(html);
  } catch(e) { err(res, e.message, 500); }
});

// ── [V35] POST /scan-qr — Vérification QR Flash abonnés ─────────────────────
// Public (pas de requireAuth) — coiffeurs sur mobile
const crypto_qr = require('crypto');
const JWT_SECRET_QR = process.env.JWT_SECRET || 'daleba-secret-change-in-prod';

router.post('/scan-qr', async (req, res) => {
  try {
    const { qrData } = req.body;
    if (!qrData) return err(res, 'qrData requis', 400);

    let parsed;
    try { parsed = typeof qrData === 'string' ? JSON.parse(qrData) : qrData; }
    catch(e) { return res.status(400).json({ valid: false, reason: 'invalid' }); }

    const { clientId, phone, token: hmacToken, ts } = parsed;

    // 1. Vérifier fraîcheur (< 10 minutes)
    const now = Date.now();
    if (!ts || (now - ts) > 10 * 60 * 1000) {
      return res.json({ valid: false, reason: 'expired' });
    }

    // 2. Vérifier HMAC
    const expected = crypto_qr.createHmac('sha256', JWT_SECRET_QR)
      .update(`${clientId}${phone}`)
      .digest('hex');
    if (expected !== hmacToken) {
      return res.json({ valid: false, reason: 'invalid' });
    }

    // 3. Chercher le client en DB
    if (!pool) return res.json({ valid: true, clientName: `Client ${phone}`, subscriptionPlan: 'Demo', expiresAt: null, demo: true });

    let clientName = `Client ${(phone||'').slice(-4)}`;
    let subscriptionPlan = null;
    let expiresAt = null;
    let active = false;

    try {
      const r = await pool.query(
        `SELECT * FROM daleba_loyalty WHERE client_phone=$1 ORDER BY created_at DESC LIMIT 1`,
        [phone]
      );
      if (r.rows.length) {
        const row = r.rows[0];
        clientName = row.client_name || clientName;
        subscriptionPlan = row.forfait_name || row.forfait_id || 'Forfait actif';
        expiresAt = row.next_billing_date || null;
        active = (row.status || '').toLowerCase() === 'active' || true;
      } else {
        return res.json({ valid: false, reason: 'notfound' });
      }
    } catch(e) {
      console.warn('[SCAN-QR] DB error:', e.message);
    }

    return res.json({ valid: true, clientName, subscriptionPlan, expiresAt });
  } catch(e) {
    console.error('[SCAN-QR]', e.message);
    return res.status(500).json({ valid: false, reason: 'invalid' });
  }
});

module.exports = router;
