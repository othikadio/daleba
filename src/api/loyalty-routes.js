'use strict';
/**
 * Loyalty Routes — DALEBA Metacortex Points 415-418
 */
const express   = require('express');
const router    = express.Router();
const { pool }  = require('../memory/db');
const { requireAuth } = require('../middleware/auth');
const bus       = require('../services/event-bus');

const pts      = require('../services/dynamic-points-engine');
const guard    = require('../services/google-review-guard');
const referral = require('../services/viral-referral-engine');

const ok  = (res, data, s=200)   => res.status(s).json({ success:true,  data,  ts: new Date().toISOString() });
const err = (res, msg, s=400)    => res.status(s).json({ success:false, error: msg });
const getTenant = (req)          => req.user?.tenantId || req.query.tenantId || 'kadio';

// ── [415] GET /loyalty/balance/:customerId ────────────────────────────────────
router.get('/balance/:customerId', requireAuth, async (req, res) => {
  try {
    const result = await pts.getBalance(pool, getTenant(req), req.params.customerId);
    ok(res, result);
  } catch(e) { err(res, e.message); }
});

// ── [408-409] POST /loyalty/award ─────────────────────────────────────────────
router.post('/award', requireAuth, async (req, res) => {
  try {
    const tenantId = getTenant(req);
    const result = await pts.awardPoints(pool, tenantId, req.body);
    ok(res, result);
  } catch(e) { err(res, e.message); }
});

// ── POST /loyalty/redeem ──────────────────────────────────────────────────────
router.post('/redeem', requireAuth, async (req, res) => {
  try {
    const tenantId = getTenant(req);
    const result = await pts.redeemPoints(pool, tenantId, req.body);
    ok(res, result);
  } catch(e) { err(res, e.message, 400); }
});

// ── [411] POST /loyalty/referral/code ─────────────────────────────────────────
router.post('/referral/code', requireAuth, async (req, res) => {
  try {
    const result = await referral.createReferralCode(pool, getTenant(req), req.body);
    ok(res, result, 201);
  } catch(e) { err(res, e.message); }
});

// ── [413] POST /loyalty/referral/apply ────────────────────────────────────────
router.post('/referral/apply', requireAuth, async (req, res) => {
  try {
    const result = await referral.validateAndApply(pool, getTenant(req), req.body);
    ok(res, result);
  } catch(e) { err(res, e.message); }
});

// ── [403] POST /loyalty/review/schedule ───────────────────────────────────────
router.post('/review/schedule', requireAuth, async (req, res) => {
  try {
    const result = await guard.scheduleReviewRequest(pool, getTenant(req), req.body);
    ok(res, result, 201);
  } catch(e) { err(res, e.message); }
});

// ── [404] GET /feedback/:token — Page notation 5 étoiles ────────────────────
router.get('/feedback/:token', async (req, res) => {
  try {
    const tenantId = req.query.tenantId || 'kadio';
    const r = await pool.query(
      `SELECT tr.*, ts.tenant_name FROM tenant_review_tokens tr
       LEFT JOIN tenant_settings ts ON ts.tenant_id = tr.tenant_id
       WHERE tr.token=$1`, [req.params.token]
    ).catch(() => ({ rows: [] }));
    const entry = r.rows[0];
    const tenantName = entry?.tenant_name || 'votre salon';
    await pool.query(`UPDATE tenant_review_tokens SET opened_at=COALESCE(opened_at,NOW()) WHERE token=$1`, [req.params.token]).catch(() => {});
    res.set('Content-Type', 'text/html');
    res.send(guard.buildFeedbackPage(req.params.token, tenantName));
  } catch(e) { res.status(500).send('Erreur'); }
});

// ── [405-407] POST /feedback/:token/rate ────────────────────────────────────
router.post('/feedback/:token/rate', async (req, res) => {
  try {
    const { rating, message } = req.body;
    if (!rating || rating < 1 || rating > 5) return err(res, 'rating 1-5 requis');
    // Trouve le tenant depuis le token
    const r = await pool.query(`SELECT tenant_id FROM tenant_review_tokens WHERE token=$1`, [req.params.token]).catch(() => ({ rows: [] }));
    const tenantId = r.rows[0]?.tenant_id || 'kadio';
    const result = await guard.processFeedback(pool, tenantId, { token: req.params.token, rating, message });
    ok(res, result);
  } catch(e) { err(res, e.message); }
});

// ── [418] GET /loyalty/admin/stats ────────────────────────────────────────────
router.get('/admin/stats', requireAuth, async (req, res) => {
  try {
    const tenantId = getTenant(req);
    const [cards, referrals, reviews, complaints] = await Promise.all([
      pool.query('SELECT COUNT(*) AS total, SUM(points_balance) AS total_pts FROM tenant_loyalty_cards WHERE tenant_id=$1', [tenantId]).catch(() => ({rows:[{total:0,total_pts:0}]})),
      pool.query("SELECT COUNT(*) AS total FROM tenant_referrals WHERE tenant_id=$1 AND status='converted'", [tenantId]).catch(() => ({rows:[{total:0}]})),
      pool.query("SELECT COUNT(*) AS total FROM tenant_review_tokens WHERE tenant_id=$1 AND status='redirected'", [tenantId]).catch(() => ({rows:[{total:0}]})),
      pool.query("SELECT COUNT(*) AS total FROM tenant_private_feedback WHERE tenant_id=$1 AND resolved=false", [tenantId]).catch(() => ({rows:[{total:0}]})),
    ]);
    const topReferrers = await referral.listTopReferrers(pool, tenantId, 5);
    ok(res, {
      loyaltyCards:    parseInt(cards.rows[0]?.total || 0),
      totalPoints:     parseInt(cards.rows[0]?.total_pts || 0),
      conversions:     parseInt(referrals.rows[0]?.total || 0),
      googleReviews:   parseInt(reviews.rows[0]?.total || 0),
      pendingComplaints: parseInt(complaints.rows[0]?.total || 0),
      topReferrers,
    });
  } catch(e) { err(res, e.message, 500); }
});

const { maskPhoneMiddleware } = require('../services/loyalty-phone-mask');
const transfer  = require('../services/loyalty-transfer');
const stampCard = require('../services/stamp-card-engine');
const velGuard  = require('../services/referral-velocity-guard');
const liabCache = require('../services/loyalty-liability-cache');

// [445] Masquage téléphone sur toutes les routes du module
router.use(maskPhoneMiddleware);

// [441] POST /loyalty/transfer
router.post('/transfer', requireAuth, async (req, res) => {
  try {
    const r = await transfer.transferPoints(pool, getTenant(req), { ...req.body, approvedBy: req.user?.id || 'manager' });
    ok(res, r);
  } catch(e) { err(res, e.message); }
});

// [444] POST /loyalty/stamp
router.post('/stamp', requireAuth, async (req, res) => {
  try {
    const r = await stampCard.addStamp(pool, getTenant(req), req.body);
    ok(res, r);
  } catch(e) { err(res, e.message); }
});

// [448] GET /loyalty/liability
router.get('/liability', requireAuth, async (req, res) => {
  try {
    const r = await liabCache.getLiabilityCached(pool, getTenant(req));
    ok(res, r);
  } catch(e) { err(res, e.message, 500); }
});

// [443] Alerte VIP dans processFeedback — intégrée via event-bus (listener dans auto-scheduler)
// [447] GET /loyalty/referral/velocity/:code
router.get('/referral/velocity/:code', requireAuth, async (req, res) => {
  try {
    const r = await velGuard.checkVelocity(pool, getTenant(req), req.params.code);
    ok(res, r);
  } catch(e) { err(res, e.message); }
});

// [442] GET /loyalty/reputation/chart — évolution note moyenne
router.get('/reputation/chart', requireAuth, async (req, res) => {
  try {
    const tenantId = getTenant(req);
    const r = await pool.query(`
      SELECT DATE_TRUNC('week', created_at) AS week,
             AVG(rating) AS avg_rating,
             COUNT(*) AS total,
             COUNT(CASE WHEN status='redirected' THEN 1 END) AS google_redirects,
             COUNT(CASE WHEN status='complaint' THEN 1 END) AS complaints
      FROM tenant_review_tokens
      WHERE tenant_id=$1 AND rating IS NOT NULL
      GROUP BY week ORDER BY week DESC LIMIT 12
    `, [tenantId]).catch(() => ({ rows: [] }));
    ok(res, { weeks: r.rows });
  } catch(e) { err(res, e.message, 500); }
});

module.exports = router;
