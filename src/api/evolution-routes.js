'use strict';
/**
 * Evolution Routes — DALEBA [601-614]
 */
const express  = require('express');
const router   = express.Router();
const { pool } = require('../memory/db');
const { requireAuth } = require('../middleware/auth');
const crawler = require('../services/github-skill-crawler-worker');
const sandbox = require('../services/evolution-sandbox');
const poison  = require('../services/code-poison-detector');
const guard   = require('../services/sovereign-upgrade-guard');
const bus     = require('../services/event-bus');

const ok  = (res, d, s = 200) => res.status(s).json({ success: true, data: d, ts: new Date().toISOString() });
const err = (res, m, s = 400) => res.status(s).json({ success: false, error: m });

// [602] Scan
router.post('/scan',      requireAuth, async (req, res) => { try { ok(res, await crawler.scanGitHubSkills(pool, req.body)); } catch(e) { err(res, e.message); } });
router.post('/crawl-ai',  requireAuth, async (req, res) => { try { ok(res, await crawler.crawlAIReleases(pool)); } catch(e) { err(res, e.message); } });

// [604,605] Sandbox
router.post('/sandbox/analyze', requireAuth, async (req, res) => { try { ok(res, await sandbox.runInSandbox(req.body.code, req.body.options)); } catch(e) { err(res, e.message); } });

// [606,607] Poison
router.post('/poison/detect', requireAuth, async (req, res) => { try { ok(res, await poison.detectPoison(req.body.code, req.body.source)); } catch(e) { err(res, e.message); } });
router.post('/poison/ban',    requireAuth, async (req, res) => { try { ok(res, await poison.banSource(pool, req.body)); } catch(e) { err(res, e.message); } });
router.get('/banned',         requireAuth, async (req, res) => { try { ok(res, await guard.getBannedSources(pool)); } catch(e) { err(res, e.message, 500); } });

// [603] Pool
router.get('/pool',   requireAuth, async (req, res) => { try { ok(res, await guard.getEvolutionPool(pool, req.query)); } catch(e) { err(res, e.message, 500); } });
router.get('/staged', requireAuth, async (req, res) => { try { ok(res, await guard.getStagedSkills(pool)); } catch(e) { err(res, e.message, 500); } });
router.get('/stats',  requireAuth, async (req, res) => { try { ok(res, await guard.getEvolutionStats(pool)); } catch(e) { err(res, e.message, 500); } });

// [614] Audit logs
router.get('/security-logs', requireAuth, async (req, res) => { try { ok(res, await guard.getSecurityLogs(pool, req.query)); } catch(e) { err(res, e.message, 500); } });

// [609-612] Approbation
router.post('/request-approval', requireAuth, async (req, res) => { try { ok(res, await guard.requestUpgradeApproval(pool, req.body)); } catch(e) { err(res, e.message); } });
router.post('/approve',          requireAuth, async (req, res) => { try { ok(res, await guard.processApproval(pool, req.body)); } catch(e) { err(res, e.message); } });

// [610] Webhook SMS réponse OUI/NON Ulrich
router.post('/webhook/sms-response', async (req, res) => {
  try {
    const body      = (req.body?.Body || '').toUpperCase().trim();
    const match     = body.match(/\b(OUI|NON)\b/);
    const tokenMatch= body.match(/[A-F0-9]{24}/);
    if (match && tokenMatch) {
      const result = await guard.processApproval(pool, { smsToken: tokenMatch[0], response: match[1] });
      bus.system(`[EvolutionWebhook] 📱 "${match[1]}" → skill: ${result.skillId} → ${result.status}`);
    }
    res.status(200).send('<Response></Response>');
  } catch(e) { res.status(200).send('<Response></Response>'); }
});

module.exports = router;
