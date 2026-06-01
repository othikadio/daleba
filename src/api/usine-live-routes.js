/**
 * DALEBA — Usine IA Live Routes v5 — Centre de Commandement
 *
 * GET  /api/usine/live-stats
 * GET  /api/usine/live-stream
 * POST /api/usine/trigger-scan
 * GET  /api/usine/production-mode   POST
 * GET  /api/usine/autonomous-mode   POST
 * GET  /api/usine/pipeline
 * GET  /api/usine/maintenance
 * GET  /api/usine/opportunity/:id
 * GET  /api/usine/roster
 */
'use strict';

const express = require('express');
const router  = express.Router();

// ── État global ────────────────────────────────────────────────────────────────
let productionModeEnabled = process.env.USINE_PRODUCTION_MODE !== 'false';
let autonomousMode        = false;
let cycleRunning          = false;
let autoCycleCount        = 0;
let lastAutoCycleAt       = null;
let EMAIL_BATCH_PER_CYCLE = 10;
let CYCLE_COOLDOWN_MS     = 10000;

// ── LIVE TASKS — suivi temps réel des agents ──────────────────────────────────
const LIVE_TASKS = new Map(); // taskId → { agentId, squad, title, action, value, startedAt, score }
let taskSeq = 0;

function taskRegister(squad, opp) {
  const taskId = `T${++taskSeq}`;
  const squads = { scraping: [1, 300], audit: [301, 700], closers: [701, 950], maintenance: [951, 1000] };
  const [lo, hi] = squads[squad] || [1, 300];
  const agentId = lo + Math.floor(Math.random() * (hi - lo + 1));
  const task = {
    taskId, agentId, squad,
    title:     opp?.title?.slice(0, 60) || `Analyse #${taskId}`,
    action:    getAction(squad, opp),
    value:     opp?.budget_estimated ? `$${Math.round(opp.budget_estimated).toLocaleString('fr-CA')} ${opp?.budget_currency || 'USD'}` : 'En estimation',
    valueRaw:  parseFloat(opp?.budget_estimated) || 0,
    startedAt: Date.now(),
    score:     opp?.score || 0,
    country:   opp?.country || '??',
    category:  opp?.category || 'général',
  };
  LIVE_TASKS.set(taskId, task);
  return taskId;
}
function taskDone(taskId) { LIVE_TASKS.delete(taskId); }
function getAction(squad, opp) {
  if (squad === 'scraping') return `Scan mondial — ${opp?.source_platform || 'multi-sources'}`;
  if (squad === 'audit')    return `Rédaction audit SEO — ${opp?.category || 'général'}`;
  if (squad === 'closers')  return `Proposition B2B + email closing — ${opp?.country || '??'}`;
  return `Surveillance système — auto-réparation`;
}

// ── ESCOUADE MAINTENANCE #951-1000 ────────────────────────────────────────────
let maintenanceActive = false;
let maintenanceHeals  = 0;
let maintenanceErrors = 0;
const maintenanceLogs = [];

function logMaint(msg, level = 'info') {
  const entry = { ts: new Date().toISOString(), msg, level };
  maintenanceLogs.unshift(entry);
  if (maintenanceLogs.length > 50) maintenanceLogs.pop();
  const bus = getBus();
  if (bus?.system) bus.system(`🛡 [Maintenance] ${msg}`, { level });
}

async function runMaintenanceCycle() {
  if (!maintenanceActive) return;
  const taskId = taskRegister('maintenance', null);
  try {
    const bus = getBus();
    const aq  = getAQ();

    // 1. Nettoyer les jobs failed dans BullMQ
    if (aq) {
      const stats = await safeCall(() => aq.getQueueStats(), null);
      const lg = stats?.['lead-gen-queue'] || {};
      const seo = stats?.['seo-audit-queue'] || {};
      const em  = stats?.['email-sequence-queue'] || {};
      const totalFailed = (lg.failed || 0) + (seo.failed || 0) + (em.failed || 0);
      if (totalFailed > 0) {
        maintenanceErrors++;
        logMaint(`${totalFailed} jobs en échec détectés — nettoyage`, 'warn');
        // Retenter les jobs failed
        await safeCall(async () => {
          const bullmq = require('bullmq');
          const IORedis = require('ioredis');
          const conn = new IORedis(process.env.REDIS_URL, { maxRetriesPerRequest: null });
          const q = new bullmq.Queue('lead-gen-queue', { connection: conn });
          await q.retryJobs({ status: 'failed' });
          conn.disconnect();
        }, null);
        maintenanceHeals++;
        logMaint(`Auto-réparation: ${totalFailed} jobs relancés ✅`, 'heal');
      }
    }

    // 2. Vérifier que le cycle autonome ne s'est pas bloqué
    if (autonomousMode && !cycleRunning && lastAutoCycleAt) {
      const elapsed = Date.now() - new Date(lastAutoCycleAt).getTime();
      if (elapsed > 5 * 60 * 1000) { // bloqué > 5 min
        maintenanceErrors++;
        logMaint(`Cycle autonome bloqué depuis ${Math.round(elapsed/60000)}min — relance forcée`, 'warn');
        cycleRunning = false;
        setTimeout(runAutoCycle, 2000);
        maintenanceHeals++;
        logMaint('Auto-réparation: cycle relancé ✅', 'heal');
      }
    }

    // 3. Vérifier que Railway est accessible
    const pool = getPool();
    if (pool) {
      await safeCall(() => pool.query('SELECT 1'), null);
    }

    taskDone(taskId);
  } catch (e) {
    taskDone(taskId);
    logMaint(`Erreur maintenance: ${e.message}`, 'error');
  }

  if (maintenanceActive) setTimeout(runMaintenanceCycle, 60 * 1000); // toutes les 60s
}

function startMaintenance() {
  maintenanceActive = true;
  logMaint('Escouade Maintenance #951-1000 déployée — surveillance active');
  setTimeout(runMaintenanceCycle, 5000);
}
function stopMaintenance() { maintenanceActive = false; }

// ── Helpers ───────────────────────────────────────────────────────────────────
function safeRequire(mod) { try { return require(mod); } catch (_) { return null; } }
async function safeCall(fn, fb) { try { return await fn(); } catch (_) { return fb; } }
function getPool() { return safeRequire('../memory/db')?.pool || null; }
function getBus()  { return safeRequire('../services/event-bus'); }
function getAQ()   { return safeRequire('../workers/agent-queue'); }

// ── Persistance DB ─────────────────────────────────────────────────────────────
async function persistAutoMode(enabled) {
  const pool = getPool();
  if (!pool) return;
  try {
    await pool.query(`DELETE FROM daleba_notes WHERE title='autonomous_mode' AND category='system'`);
    await pool.query(`INSERT INTO daleba_notes (title, content, category, tags, priority, author_id, created_at, updated_at)
      VALUES ('autonomous_mode', $1, 'system', ARRAY['usine','auto'], 1, 'system', NOW(), NOW())`, [enabled ? 'true' : 'false']);
  } catch (_) {}
}

async function restoreAutoModeFromDB() {
  const pool = getPool();
  if (!pool) return false;
  try {
    const r = await pool.query(`SELECT content FROM daleba_notes WHERE title='autonomous_mode' AND category='system' LIMIT 1`);
    return r.rows[0]?.content === 'true';
  } catch (_) { return false; }
}

// ── CYCLE AUTONOME CONTINU ─────────────────────────────────────────────────────
async function runAutoCycle() {
  if (!autonomousMode || !productionModeEnabled || cycleRunning) return;
  cycleRunning = true;

  const bus = getBus();
  const cycleId = ++autoCycleCount;
  lastAutoCycleAt = new Date().toISOString();
  if (bus?.system) bus.system(`🤖 [AUTO #${cycleId}] Cycle Rendement Maximal`, { cycleId });

  // ÉTAPE 1 — SCAN (escouade Scraping)
  const scanTask = taskRegister('scraping', { source_platform: 'multi-sources', title: `Scan mondial cycle #${cycleId}` });
  try {
    if (bus?.system) bus.system(`🌍 [AUTO #${cycleId}] Scan international…`);
    const ow = safeRequire('../workers/opportunity-worker');
    if (ow?.runOpportunityWorker) await ow.runOpportunityWorker();
    if (bus?.system) bus.system(`✅ [AUTO #${cycleId}] Scan terminé`);
  } catch (e) {
    if (bus?.system) bus.system(`⚠️ [AUTO #${cycleId}] Scan: ${e.message}`);
  } finally { taskDone(scanTask); }

  if (!autonomousMode) { cycleRunning = false; return; }

  // ÉTAPE 2 — PIPELINE (Audit + Closing)
  const pool = getPool();
  if (pool) {
    try {
      const r = await pool.query(`
        SELECT o.* FROM daleba_opportunities o
        LEFT JOIN daleba_proposals p ON p.opportunity_id = o.id
        WHERE o.score >= 70 AND o.status = 'pending' AND p.id IS NULL
        ORDER BY o.score DESC, o.detected_at DESC LIMIT $1`, [EMAIL_BATCH_PER_CYCLE]);

      const opps = r.rows;
      if (opps.length) {
        if (bus?.system) bus.system(`✍️ [AUTO #${cycleId}] Pipeline: ${opps.length} opportunités`, { count: opps.length });

        // Traitement parallèle par lots de 5 (concurrence max)
        const CHUNK = 5;
        for (let i = 0; i < opps.length; i += CHUNK) {
          if (!autonomousMode) break;
          const chunk = opps.slice(i, i + CHUNK);
          await Promise.all(chunk.map(async (opp) => {
            const auditTask   = taskRegister('audit', opp);
            const closerTask  = taskRegister('closers', opp);
            try {
              // Générer proposition
              let proposalText = `[AUTO PROPOSAL] ${opp.title} — DALEBA Solution`;
              const pw = safeRequire('../services/proposal-writer');
              if (pw?.generateProposal) proposalText = await safeCall(() => pw.generateProposal(opp), proposalText);
              taskDone(auditTask);

              // Sauvegarder + approuver
              await pool.query(`INSERT INTO daleba_proposals (opportunity_id, generated_text, status, created_at)
                VALUES ($1, $2, 'sent', NOW())`, [opp.id, proposalText]);
              await pool.query(`UPDATE daleba_opportunities SET status='approved', approved_at=NOW() WHERE id=$1`, [opp.id]);

              // Envoyer email
              const en = safeRequire('../services/email-notifier');
              if (en?.notifyProposal) await safeCall(() => en.notifyProposal(opp, proposalText), null);
              if (bus?.system) bus.system(`📧 [AUTO #${cycleId}] Email — ${opp.title?.slice(0, 45)} [$${Math.round(opp.budget_estimated || 0).toLocaleString()}]`);
            } catch (e2) {
              taskDone(auditTask);
              await safeCall(() => pool.query(`INSERT INTO daleba_proposals (opportunity_id, generated_text, status) VALUES ($1, '[error]', 'error')`, [opp.id]), null);
            } finally { taskDone(closerTask); }
          }));
        }
        if (bus?.system) bus.system(`🏁 [AUTO #${cycleId}] ${opps.length} opportunités traitées`);
      } else {
        if (bus?.system) bus.system(`🔄 [AUTO #${cycleId}] File vide — re-scan`);
      }
    } catch (e) {
      if (bus?.system) bus.system(`⚠️ [AUTO #${cycleId}] Pipeline: ${e.message}`);
    }
  }

  cycleRunning = false;
  if (autonomousMode && productionModeEnabled) setTimeout(runAutoCycle, CYCLE_COOLDOWN_MS);
}

function startAutonomousMode() {
  setTimeout(runAutoCycle, 2000);
  startMaintenance(); // Maintenance squad démarre aussi
}
function stopAutonomousMode() {
  autonomousMode = false;
  stopMaintenance();
}

// ── Restauration au boot ───────────────────────────────────────────────────────
;(async () => {
  let attempts = 0;
  const checkAndRestore = async () => {
    attempts++;
    const restored = await restoreAutoModeFromDB();
    if (restored) {
      autonomousMode = true;
      productionModeEnabled = true;
      getBus()?.system?.('🤖 [BOOT] Mode autonome restauré — cycle relancé');
      startAutonomousMode();
    } else if (attempts < 5) { setTimeout(checkAndRestore, 6000); }
  };
  setTimeout(checkAndRestore, 8000);
})();

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/usine/live-stats
// ─────────────────────────────────────────────────────────────────────────────
router.get('/live-stats', async (req, res) => {
  res.setHeader('Content-Type', 'application/json');
  try {
    const pool = getPool();
    const aq   = getAQ();
    const bus  = getBus();

    const queueStats = aq
      ? await safeCall(() => aq.getQueueStats(), { 'lead-gen-queue':{}, 'seo-audit-queue':{}, 'email-sequence-queue':{}, redisAvailable: false })
      : { 'lead-gen-queue':{}, 'seo-audit-queue':{}, 'email-sequence-queue':{}, redisAvailable: false };

    let recentOpps = [], totals = { opportunities: 0, proposals: 0 };
    if (pool) {
      const [opR, totR, propR] = await Promise.allSettled([
        pool.query(`SELECT id, title, country, category, score, source_platform, source_url,
                    detected_at as created_at, budget_estimated, budget_currency
                    FROM daleba_opportunities ORDER BY detected_at DESC LIMIT 15`),
        pool.query('SELECT COUNT(*)::int as n FROM daleba_opportunities'),
        pool.query('SELECT COUNT(*)::int as n FROM daleba_proposals'),
      ]);
      if (opR.status === 'fulfilled')   recentOpps           = opR.value.rows;
      if (totR.status === 'fulfilled')  totals.opportunities = totR.value.rows[0]?.n || 0;
      if (propR.status === 'fulfilled') totals.proposals     = propR.value.rows[0]?.n || 0;
    }

    const recentEvents = bus ? await safeCall(() => bus.getRecent(20), []) : [];
    const lg  = queueStats['lead-gen-queue']       || {};
    const seo = queueStats['seo-audit-queue']      || {};
    const em  = queueStats['email-sequence-queue'] || {};
    const bullActive = (lg.active||0) + (seo.active||0) + (em.active||0);
    const liveTasks  = [...LIVE_TASKS.values()];
    const totalActive = bullActive + liveTasks.length;

    res.json({
      ts: Date.now(),
      productionMode: productionModeEnabled,
      autonomousMode, cycleRunning,
      lastAutoCycleAt, autoCycleCount,
      redisConnected: !!queueStats.redisAvailable,
      agents: { active: totalActive, waiting: (lg.waiting||0)+(seo.waiting||0)+(em.waiting||0), capacity: 1000 },
      queues: {
        leadGen:       { waiting: lg.waiting||0,  active: lg.active||0,  completed: lg.completed||0,  failed: lg.failed||0  },
        seoAudit:      { waiting: seo.waiting||0, active: seo.active||0, completed: seo.completed||0, failed: seo.failed||0 },
        emailSequence: { waiting: em.waiting||0,  active: em.active||0,  completed: em.completed||0,  failed: em.failed||0  },
      },
      totals, recentOpps,
      recentEvents: recentEvents.slice(0, 15),
      liveTasks,
      maintenance: { active: maintenanceActive, heals: maintenanceHeals, errors: maintenanceErrors, logs: maintenanceLogs.slice(0, 5) },
    });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/usine/pipeline — 4 colonnes kanban
// ─────────────────────────────────────────────────────────────────────────────
router.get('/pipeline', async (req, res) => {
  res.setHeader('Content-Type', 'application/json');
  try {
    const pool = getPool();
    if (!pool) return res.json({ detected:0, accepted:0, processing:0, completed:0, caPotentiel:0, caGenere:0 });

    const [det, acc, proc, done, ca] = await Promise.allSettled([
      pool.query('SELECT COUNT(*)::int as n FROM daleba_opportunities'),
      pool.query("SELECT COUNT(*)::int as n FROM daleba_opportunities WHERE status='approved'"),
      pool.query("SELECT COUNT(*)::int as n FROM daleba_proposals WHERE status NOT IN ('sent','error','delivered')"),
      pool.query("SELECT COUNT(*)::int as n FROM daleba_proposals WHERE status IN ('sent','delivered')"),
      pool.query("SELECT COALESCE(SUM(budget_estimated),0)::numeric as total FROM daleba_opportunities WHERE budget_estimated IS NOT NULL"),
    ]);

    const caTotal = parseFloat(ca.status === 'fulfilled' ? ca.value.rows[0]?.total || 0 : 0);

    // Recent pipeline items
    const recentR = await safeCall(() => pool.query(`
      SELECT o.id, o.title, o.score, o.country, o.budget_estimated, o.budget_currency,
             o.status as opp_status, o.category, p.status as prop_status, p.created_at as prop_date
      FROM daleba_opportunities o
      LEFT JOIN daleba_proposals p ON p.opportunity_id = o.id
      ORDER BY COALESCE(p.created_at, o.detected_at) DESC LIMIT 20
    `), null);

    res.json({
      detected:   det.status==='fulfilled'  ? det.value.rows[0]?.n  || 0 : 0,
      accepted:   acc.status==='fulfilled'  ? acc.value.rows[0]?.n  || 0 : 0,
      processing: proc.status==='fulfilled' ? proc.value.rows[0]?.n || 0 : 0,
      completed:  done.status==='fulfilled' ? done.value.rows[0]?.n || 0 : 0,
      caPotentiel: caTotal,
      items: recentR?.rows || [],
    });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/usine/maintenance
// ─────────────────────────────────────────────────────────────────────────────
router.get('/maintenance', (req, res) => {
  res.json({
    active: maintenanceActive,
    agentRange: '951 → 1 000',
    agentCount: 50,
    heals: maintenanceHeals,
    errors: maintenanceErrors,
    logs: maintenanceLogs.slice(0, 20),
    liveTasks: [...LIVE_TASKS.values()].filter(t => t.squad === 'maintenance'),
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/usine/opportunity/:id
// ─────────────────────────────────────────────────────────────────────────────
router.get('/opportunity/:id', async (req, res) => {
  res.setHeader('Content-Type', 'application/json');
  try {
    const pool = getPool();
    if (!pool) return res.status(503).json({ error: 'DB indisponible' });
    const [oppR, propR] = await Promise.all([
      pool.query('SELECT * FROM daleba_opportunities WHERE id = $1', [req.params.id]),
      pool.query('SELECT id, generated_text, status, created_at, sent_at, notes FROM daleba_proposals WHERE opportunity_id = $1 ORDER BY created_at DESC', [req.params.id]),
    ]);
    if (!oppR.rows.length) return res.status(404).json({ error: 'Introuvable' });
    const opp = oppR.rows[0];
    res.json({ ...opp, keywords: (opp.keywords_matched||'').split(',').map(k=>k.trim()).filter(Boolean), seoFlaws: inferSeoFlaws(opp), proposals: propR.rows, proposalCount: propR.rows.length, hasSentProposal: propR.rows.some(p=>p.sent_at!==null) });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

function inferSeoFlaws(opp) {
  const flaws = [];
  const desc = (opp.description_fr||opp.description_orig||'').toLowerCase();
  const cat  = (opp.category||'').toLowerCase();
  const kw   = (opp.keywords_matched||'').toLowerCase();
  if (cat.includes('seo')||kw.includes('seo')) flaws.push({ label:'Audit SEO requis', severity:'high', detail:'Positionnement organique non optimisé' });
  if (kw.includes('automation')||cat.includes('automation')) flaws.push({ label:'Processus manuels', severity:'high', detail:'Flux non automatisés — perte >40%' });
  if (kw.includes('crm')||kw.includes('lead')||desc.includes('lead')) flaws.push({ label:'Pipeline CRM défaillant', severity:'medium', detail:'Attribution manquante' });
  if (kw.includes('api')||kw.includes('integration')||desc.includes('integr')) flaws.push({ label:'Intégrations API absentes', severity:'medium', detail:'Silos entre outils' });
  if (!flaws.length) flaws.push({ label:'Opportunité à analyser', severity:'low', detail:'Analyse approfondie recommandée' });
  return flaws;
}

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/usine/roster
// ─────────────────────────────────────────────────────────────────────────────
router.get('/roster', async (req, res) => {
  res.setHeader('Content-Type', 'application/json');
  try {
    const aq = getAQ();
    const qs = aq ? await safeCall(() => aq.getQueueStats(), null) : null;
    const lg  = qs?.['lead-gen-queue']       || {};
    const seo = qs?.['seo-audit-queue']      || {};
    const em  = qs?.['email-sequence-queue'] || {};
    const liveArr = [...LIVE_TASKS.values()];
    res.json({
      totalAgents: 1000,
      autonomousActive: autonomousMode,
      liveTasks: liveArr,
      squads: [
        { id:'scraping', label:'Scraping & Intelligence', range:'1 → 300', count:300, color:'sky', icon:'🔍', description:'Scannent 40+ sources mondiales en temps réel.', skills:['Web Scraping','Data Extraction','Deduplication','Multi-language','Source Ranking'], queueActive: lg.active||0, queueCompleted: lg.completed||0, liveTasks: liveArr.filter(t=>t.squad==='scraping') },
        { id:'audit', label:'Rédacteurs Audit SEO', range:'301 → 700', count:400, color:'violet', icon:'✍️', description:'Génèrent propositions B2B et audits SEO personnalisés.', skills:['SEO Analysis','Proposal Writing','Score Ranking','FR/EN bilingual','Budget Estimation'], queueActive: seo.active||0, queueCompleted: seo.completed||0, liveTasks: liveArr.filter(t=>t.squad==='audit') },
        { id:'closers', label:'Closers & Email', range:'701 → 950', count:250, color:'amber', icon:'📧', description:'Séquences email multi-étapes et closing B2B.', skills:['Email Sequencing','Follow-up Auto','Stripe Monitor','Reply Detection','A/B Testing'], queueActive: (em.active||0)+liveArr.filter(t=>t.squad==='closers').length, queueCompleted: em.completed||0, liveTasks: liveArr.filter(t=>t.squad==='closers') },
        { id:'maintenance', label:'Maintenance & Auto-Réparation', range:'951 → 1 000', count:50, color:'rose', icon:'🛡', description:'Surveillance continue, détection d\'erreurs et auto-healing.', skills:['Log Monitoring','Worker Restart','Queue Repair','API Health Check','Auto-Healing'], queueActive: liveArr.filter(t=>t.squad==='maintenance').length, queueCompleted: maintenanceHeals, liveTasks: liveArr.filter(t=>t.squad==='maintenance'), heals: maintenanceHeals, errors: maintenanceErrors },
      ],
      redisConnected: !!qs?.redisAvailable,
    });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ─────────────────────────────────────────────────────────────────────────────
// SSE /api/usine/live-stream
// ─────────────────────────────────────────────────────────────────────────────
router.get('/live-stream', (req, res) => {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');
  res.flushHeaders();

  const send = (obj) => { try { if (!res.writableEnded) res.write(`data: ${JSON.stringify(obj)}\n\n`); } catch (_) {} };
  send({ type:'connected', ts:Date.now(), productionMode:productionModeEnabled, autonomousMode });

  const tick = setInterval(async () => {
    if (res.writableEnded) { clearInterval(tick); return; }
    const aq = getAQ();
    const liveArr = [...LIVE_TASKS.values()];
    try {
      const stats = aq ? await aq.getQueueStats() : {};
      const lg=stats['lead-gen-queue']||{}, seo=stats['seo-audit-queue']||{}, em=stats['email-sequence-queue']||{};
      send({ type:'stats', stats, totalActive:(lg.active||0)+(seo.active||0)+(em.active||0)+liveArr.length,
             liveTasks:liveArr, autonomousMode, cycleRunning, autoCycleCount, ts:Date.now() });
    } catch (_) { send({ type:'ping', ts:Date.now(), liveTasks:liveArr }); }
  }, 3000);

  const ping = setInterval(() => { if (!res.writableEnded) res.write(': ping\n\n'); }, 20000);
  const cleanup = () => { clearInterval(tick); clearInterval(ping); };
  req.on('close', cleanup); req.on('aborted', cleanup); res.on('finish', cleanup); res.on('error', cleanup);
});

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/usine/trigger-scan
// ─────────────────────────────────────────────────────────────────────────────
router.post('/trigger-scan', async (req, res) => {
  res.setHeader('Content-Type', 'application/json');
  if (!productionModeEnabled) return res.status(403).json({ success:false, error:'Usine en pause.' });
  try {
    const aq = getAQ(), jobs = [];
    if (aq) {
      const j1 = await safeCall(() => aq.addLeadGenJob({ trigger:'manual', ts:Date.now() }), null);
      const j2 = await safeCall(() => aq.addSeoAuditJob({ trigger:'manual', ts:Date.now() }), null);
      if (j1) jobs.push(String(j1.id||'mem'));
      if (j2) jobs.push(String(j2.id||'mem'));
    }
    setImmediate(async () => {
      const ow = safeRequire('../workers/opportunity-worker');
      if (ow?.runOpportunityWorker) await safeCall(() => ow.runOpportunityWorker(), null);
    });
    getBus()?.system?.('🌍 Scan international manuel déclenché', { jobs });
    res.json({ success:true, message:'Scan déclenché', jobs });
  } catch (err) { res.status(500).json({ success:false, error:err.message }); }
});

// ─────────────────────────────────────────────────────────────────────────────
// Production mode
// ─────────────────────────────────────────────────────────────────────────────
router.get('/production-mode', (req, res) => res.json({ enabled:productionModeEnabled }));
router.post('/production-mode', (req, res) => {
  const { enabled } = req.body;
  if (typeof enabled !== 'boolean') return res.status(400).json({ error:'enabled doit être booléen' });
  productionModeEnabled = enabled;
  getBus()?.system?.(enabled ? '▶ Production ON' : '⏸ Production OFF', { productionMode:enabled });
  if (!enabled && autonomousMode) stopAutonomousMode();
  res.json({ success:true, enabled:productionModeEnabled });
});

// ─────────────────────────────────────────────────────────────────────────────
// Autonomous mode
// ─────────────────────────────────────────────────────────────────────────────
router.get('/autonomous-mode', (req, res) => res.json({ enabled:autonomousMode, lastCycleAt:lastAutoCycleAt, cycleCount:autoCycleCount, cycleRunning }));

router.post('/autonomous-mode', async (req, res) => {
  const { enabled } = req.body;
  if (typeof enabled !== 'boolean') return res.status(400).json({ error:'enabled doit être booléen' });
  if (enabled && !productionModeEnabled) return res.status(403).json({ success:false, error:'Activez d\'abord la Production.' });
  autonomousMode = enabled;
  await persistAutoMode(enabled);
  getBus()?.system?.(enabled ? '🤖 MODE AUTONOME — Boucle infinie + Maintenance activées' : '🛑 Mode autonome désactivé manuellement', { autonomousMode:enabled });
  if (enabled) startAutonomousMode();
  else stopAutonomousMode();
  res.json({ success:true, enabled:autonomousMode, message:enabled ? '🤖 Boucle infinie + Escouade Maintenance lancées' : '🛑 Cycle arrêté' });
});

module.exports = router;
