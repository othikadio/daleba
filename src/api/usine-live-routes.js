/**
 * DALEBA — Usine IA Live Routes v3
 * GET  /api/usine/live-stats
 * GET  /api/usine/live-stream        — SSE
 * POST /api/usine/trigger-scan
 * GET  /api/usine/production-mode
 * POST /api/usine/production-mode
 * GET  /api/usine/autonomous-mode
 * POST /api/usine/autonomous-mode
 * GET  /api/usine/opportunity/:id    — fiche détail
 * GET  /api/usine/roster             — bottin agents
 */
'use strict';

const express = require('express');
const router  = express.Router();

// ── État global ───────────────────────────────────────────────────────────────
let productionModeEnabled = process.env.USINE_PRODUCTION_MODE !== 'false';
let autonomousMode = false;
let autonomousTimer = null;
let lastAutoCycleAt = null;
let autoCycleCount  = 0;

// ── Helpers ───────────────────────────────────────────────────────────────────
function safeRequire(mod) { try { return require(mod); } catch (_) { return null; } }
async function safeCall(fn, fb) { try { return await fn(); } catch (_) { return fb; } }

function getPool() { return safeRequire('../memory/db')?.pool || null; }
function getBus()  { return safeRequire('../services/event-bus'); }
function getAQ()   { return safeRequire('../workers/agent-queue'); }

// ── Cycle autonome ────────────────────────────────────────────────────────────
async function runAutoCycle() {
  if (!autonomousMode || !productionModeEnabled) return;
  const bus = getBus();
  const cycleId = ++autoCycleCount;
  lastAutoCycleAt = new Date().toISOString();

  if (bus?.system) bus.system(`🤖 [AUTO #${cycleId}] Cycle autonome démarré`, { cycleId });

  // Étape 1 — Scan
  try {
    const ow = safeRequire('../workers/opportunity-worker');
    if (ow?.runOpportunityWorker) {
      if (bus?.system) bus.system(`🌍 [AUTO #${cycleId}] Scan international en cours…`);
      await ow.runOpportunityWorker();
      if (bus?.system) bus.system(`✅ [AUTO #${cycleId}] Scan terminé`);
    }
  } catch (e) { if (bus?.system) bus.system(`⚠️ [AUTO #${cycleId}] Scan: ${e.message}`); }

  // Étape 2 — Générer propositions pour les nouvelles opps score ≥ 70
  try {
    const pool = getPool();
    if (pool) {
      const r = await pool.query(`
        SELECT o.id FROM daleba_opportunities o
        LEFT JOIN daleba_proposals p ON p.opportunity_id = o.id
        WHERE o.score >= 70 AND o.status = 'pending' AND p.id IS NULL
        ORDER BY o.score DESC LIMIT 5
      `);
      const ids = r.rows.map(x => x.id);
      if (ids.length > 0) {
        if (bus?.system) bus.system(`✍️ [AUTO #${cycleId}] Génération de ${ids.length} propositions…`);
        for (const oppId of ids) {
          await safeCall(async () => {
            await pool.query(
              `INSERT INTO daleba_proposals (opportunity_id, generated_text, status)
               VALUES ($1, $2, 'auto_generated')`,
              [oppId, `[Proposition AUTO #${cycleId} — opportunité #${oppId} — en attente de rédaction IA]`]
            );
          }, null);
        }
        if (bus?.system) bus.system(`✅ [AUTO #${cycleId}] ${ids.length} propositions créées`);
      }
    }
  } catch (e) { if (bus?.system) bus.system(`⚠️ [AUTO #${cycleId}] Propositions: ${e.message}`); }

  // Étape 3 — Ajouter jobs email
  const aq = getAQ();
  if (aq) {
    await safeCall(() => aq.addEmailSequenceJob({ trigger: 'auto', cycleId, delayDays: 0 }), null);
    if (bus?.system) bus.system(`📧 [AUTO #${cycleId}] Séquences email déclenchées`);
  }

  if (bus?.system) bus.system(`🏁 [AUTO #${cycleId}] Cycle terminé — rapport déposé`);
}

function startAutonomousMode() {
  if (autonomousTimer) clearInterval(autonomousTimer);
  // Cycle toutes les 4 heures
  autonomousTimer = setInterval(runAutoCycle, 4 * 60 * 60 * 1000);
  // Premier cycle dans 30s
  setTimeout(runAutoCycle, 30 * 1000);
}

function stopAutonomousMode() {
  if (autonomousTimer) { clearInterval(autonomousTimer); autonomousTimer = null; }
}

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/usine/live-stats
// ─────────────────────────────────────────────────────────────────────────────
router.get('/live-stats', async (req, res) => {
  res.setHeader('Content-Type', 'application/json');
  try {
    const pool = getPool();
    const aq   = getAQ();
    const mgr  = safeRequire('../services/agent-manager');
    const swarm= safeRequire('../services/swarm');
    const bus  = getBus();

    const queueStats = aq
      ? await safeCall(() => aq.getQueueStats(), { 'lead-gen-queue':{}, 'seo-audit-queue':{}, 'email-sequence-queue':{}, redisAvailable: false })
      : { 'lead-gen-queue':{}, 'seo-audit-queue':{}, 'email-sequence-queue':{}, redisAvailable: false };

    const ms = mgr ? await safeCall(() => mgr.getStatus(), null) : null;
    const ss = swarm ? await safeCall(() => swarm.getSwarmStatus(), null) : null;

    let recentOpps = [];
    let totals = { opportunities: 0, proposals: 0 };
    if (pool) {
      const [opR, totR, propR] = await Promise.allSettled([
        pool.query(`SELECT id, title, country, category, score, source_platform, source_url,
                    detected_at as created_at, budget_estimated, budget_currency
                    FROM daleba_opportunities ORDER BY detected_at DESC LIMIT 15`),
        pool.query('SELECT COUNT(*)::int as n FROM daleba_opportunities'),
        pool.query('SELECT COUNT(*)::int as n FROM daleba_proposals'),
      ]);
      if (opR.status === 'fulfilled')   recentOpps          = opR.value.rows;
      if (totR.status === 'fulfilled')  totals.opportunities = totR.value.rows[0]?.n || 0;
      if (propR.status === 'fulfilled') totals.proposals     = propR.value.rows[0]?.n || 0;
    }

    const recentEvents = bus ? await safeCall(() => bus.getRecent(20), []) : [];

    const lg  = queueStats['lead-gen-queue']       || {};
    const seo = queueStats['seo-audit-queue']      || {};
    const em  = queueStats['email-sequence-queue'] || {};
    const totalActive = (lg.active||0)+(seo.active||0)+(em.active||0)
                      + (ms?.stats?.liveAgents||0) + (ss?.stats?.activeAgents||0);

    res.json({
      ts: Date.now(),
      productionMode: productionModeEnabled,
      autonomousMode,
      lastAutoCycleAt,
      autoCycleCount,
      redisConnected: !!queueStats.redisAvailable,
      agents: { active: totalActive, waiting: (lg.waiting||0)+(seo.waiting||0)+(em.waiting||0), capacity: 1000,
                liveManager: ms?.stats?.liveAgents||0, swarmActive: ss?.stats?.activeAgents||0 },
      queues: {
        leadGen:       { waiting: lg.waiting||0,  active: lg.active||0,  completed: lg.completed||0,  failed: lg.failed||0  },
        seoAudit:      { waiting: seo.waiting||0, active: seo.active||0, completed: seo.completed||0, failed: seo.failed||0 },
        emailSequence: { waiting: em.waiting||0,  active: em.active||0,  completed: em.completed||0,  failed: em.failed||0  },
      },
      totals, recentOpps,
      recentEvents: recentEvents.slice(0, 15),
      swarmAgents:   (ss?.agents  || []).slice(0, 20),
      managerAgents: (ms?.agents  || []).slice(0, 20),
    });
  } catch (err) {
    res.status(500).json({ error: 'Erreur interne', detail: err.message });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/usine/opportunity/:id — fiche détail complète
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

    if (!oppR.rows.length) return res.status(404).json({ error: 'Opportunité introuvable' });

    const opp = oppR.rows[0];

    // Extraire les failles SEO / insights depuis les keywords et la description
    const keywords = (opp.keywords_matched || '').split(',').map(k => k.trim()).filter(Boolean);
    const seoFlaws = inferSeoFlaws(opp);

    res.json({
      ...opp,
      keywords,
      seoFlaws,
      proposals: propR.rows,
      proposalCount: propR.rows.length,
      hasSentProposal: propR.rows.some(p => p.sent_at !== null),
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

function inferSeoFlaws(opp) {
  const flaws = [];
  const desc = (opp.description_fr || opp.description_orig || '').toLowerCase();
  const cat  = (opp.category || '').toLowerCase();
  const kw   = (opp.keywords_matched || '').toLowerCase();

  if (cat.includes('seo') || kw.includes('seo'))
    flaws.push({ label: 'Audit SEO requis', severity: 'high', detail: 'Positionnement organique non optimisé détecté' });
  if (kw.includes('automation') || cat.includes('automation'))
    flaws.push({ label: 'Processus manuels', severity: 'high', detail: 'Flux de travail non automatisés — perte de productivité estimée > 40%' });
  if (kw.includes('crm') || kw.includes('lead') || desc.includes('lead'))
    flaws.push({ label: 'Pipeline CRM défaillant', severity: 'medium', detail: 'Leads non routés, attribution manquante, suivi irrégulier' });
  if (kw.includes('api') || kw.includes('integration') || desc.includes('integr'))
    flaws.push({ label: 'Intégrations API absentes', severity: 'medium', detail: 'Silos de données entre outils (CRM, paiement, marketing)' });
  if (desc.includes('manual') || desc.includes('manuel') || desc.includes('spreadsheet'))
    flaws.push({ label: 'Opérations manuelles', severity: 'high', detail: 'Traitement manuel détecté — candidat idéal pour l\'automatisation IA' });
  if (!flaws.length)
    flaws.push({ label: 'Opportunité à analyser', severity: 'low', detail: 'Analyse approfondie recommandée avant contact' });

  return flaws;
}

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/usine/roster — bottin des 1 000 agents
// ─────────────────────────────────────────────────────────────────────────────
router.get('/roster', async (req, res) => {
  res.setHeader('Content-Type', 'application/json');
  try {
    const aq = getAQ();
    const qs = aq ? await safeCall(() => aq.getQueueStats(), null) : null;

    const lg  = qs?.['lead-gen-queue']       || {};
    const seo = qs?.['seo-audit-queue']      || {};
    const em  = qs?.['email-sequence-queue'] || {};

    const squads = [
      {
        id: 'scraping', label: 'Scraping & Intelligence',
        range: '1 → 300', count: 300,
        color: 'sky', icon: '🔍',
        description: 'Agents spécialisés dans la collecte de données mondiales. Scannent HackerNews, Remotive, WeWorkRemotely et 40+ sources en temps réel.',
        skills: ['Web Scraping', 'Data Extraction', 'Source Classification', 'Deduplication', 'Multi-language'],
        queueActive: lg.active || 0, queueCompleted: lg.completed || 0,
      },
      {
        id: 'audit', label: 'Rédacteurs Audit SEO',
        range: '301 → 700', count: 400,
        color: 'violet', icon: '✍️',
        description: 'Agents rédigeurs d\'audits SEO et de propositions B2B personnalisées. Analyse des failles, génération de rapports et scoring de pertinence.',
        skills: ['SEO Analysis', 'Proposal Writing', 'Score Ranking', 'FR/EN bilingual', 'Budget Estimation'],
        queueActive: seo.active || 0, queueCompleted: seo.completed || 0,
      },
      {
        id: 'closers', label: 'Closers & Relances Email',
        range: '701 → 1 000', count: 300,
        color: 'amber', icon: '📧',
        description: 'Agents de séquences email multi-étapes. Gèrent les relances automatiques, suivis personnalisés et notifications Stripe sur conversions.',
        skills: ['Email Sequencing', 'Follow-up Automation', 'Stripe Monitoring', 'Reply Detection', 'A/B Testing'],
        queueActive: em.active || 0, queueCompleted: em.completed || 0,
      },
    ];

    res.json({ totalAgents: 1000, squads, redisConnected: !!qs?.redisAvailable });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
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
  send({ type: 'connected', ts: Date.now(), productionMode: productionModeEnabled, autonomousMode });

  const ipcCbs = [];
  const mgr = safeRequire('../services/agent-manager');
  if (mgr?.ipcBus) {
    const onState = d => send({ type: 'agent_state', ...d });
    const onDone  = d => send({ type: 'agent_done',  ...d });
    mgr.ipcBus.on('agent:state', onState);
    mgr.ipcBus.on('agent:done',  onDone);
    ipcCbs.push(() => { try { mgr.ipcBus.off('agent:state', onState); mgr.ipcBus.off('agent:done', onDone); } catch(_){} });
  }

  const statTick = setInterval(async () => {
    if (res.writableEnded) { clearInterval(statTick); return; }
    const aq = getAQ();
    if (!aq) { send({ type: 'ping', ts: Date.now() }); return; }
    try {
      const stats = await aq.getQueueStats();
      const ms = mgr ? await safeCall(() => mgr.getStatus(), null) : null;
      send({ type: 'stats', stats, liveAgents: ms?.stats?.liveAgents||0, autonomousMode, ts: Date.now() });
    } catch (_) { send({ type: 'ping', ts: Date.now() }); }
  }, 5000);

  const ping = setInterval(() => { if (!res.writableEnded) res.write(': ping\n\n'); }, 20000);

  const cleanup = () => { clearInterval(statTick); clearInterval(ping); ipcCbs.forEach(f => f()); };
  req.on('close', cleanup); req.on('aborted', cleanup); res.on('finish', cleanup); res.on('error', cleanup);
});

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/usine/trigger-scan
// ─────────────────────────────────────────────────────────────────────────────
router.post('/trigger-scan', async (req, res) => {
  res.setHeader('Content-Type', 'application/json');
  if (!productionModeEnabled)
    return res.status(403).json({ success: false, error: "L'Usine est en pause. Activez la production." });

  try {
    const aq = getAQ();
    const jobs = [];
    if (aq) {
      const j1 = await safeCall(() => aq.addLeadGenJob({ trigger: 'manual', ts: Date.now() }), null);
      const j2 = await safeCall(() => aq.addSeoAuditJob({ trigger: 'manual', ts: Date.now() }), null);
      if (j1) jobs.push(String(j1.id || 'mem'));
      if (j2) jobs.push(String(j2.id || 'mem'));
    }
    setImmediate(async () => {
      try { const ow = safeRequire('../workers/opportunity-worker'); if (ow?.runOpportunityWorker) await ow.runOpportunityWorker(); } catch(_) {}
    });
    const bus = getBus();
    if (bus?.system) bus.system('🌍 Scan international manuel déclenché', { jobs });
    res.json({ success: true, message: 'Scan déclenché', jobs, scanStarted: true });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// Production mode
// ─────────────────────────────────────────────────────────────────────────────
router.get('/production-mode', (req, res) => res.json({ enabled: productionModeEnabled, ts: Date.now() }));

router.post('/production-mode', (req, res) => {
  res.setHeader('Content-Type', 'application/json');
  const { enabled } = req.body;
  if (typeof enabled !== 'boolean') return res.status(400).json({ error: 'enabled doit être booléen' });
  productionModeEnabled = enabled;
  const bus = getBus();
  const label = enabled ? '▶ Usine activée — Production ON' : '⏸ Usine en pause — Production OFF';
  if (bus?.system) bus.system(label, { productionMode: enabled });
  if (!enabled && autonomousMode) { autonomousMode = false; stopAutonomousMode(); }
  res.json({ success: true, enabled: productionModeEnabled, label });
});

// ─────────────────────────────────────────────────────────────────────────────
// Autonomous mode
// ─────────────────────────────────────────────────────────────────────────────
router.get('/autonomous-mode', (req, res) => {
  res.json({ enabled: autonomousMode, lastCycleAt: lastAutoCycleAt, cycleCount: autoCycleCount, cycleIntervalHours: 4 });
});

router.post('/autonomous-mode', (req, res) => {
  res.setHeader('Content-Type', 'application/json');
  const { enabled } = req.body;
  if (typeof enabled !== 'boolean') return res.status(400).json({ error: 'enabled doit être booléen' });

  if (enabled && !productionModeEnabled)
    return res.status(403).json({ success: false, error: 'Activez d\'abord la Production avant le mode autonome.' });

  autonomousMode = enabled;
  const bus = getBus();
  if (enabled) {
    startAutonomousMode();
    if (bus?.system) bus.system('🤖 MODE 100% AUTONOME ACTIVÉ — L\'Usine gère tout le cycle sans intervention', { autonomousMode: true });
  } else {
    stopAutonomousMode();
    if (bus?.system) bus.system('🛑 Mode autonome désactivé — reprise en mode manuel', { autonomousMode: false });
  }
  res.json({ success: true, enabled: autonomousMode, message: enabled ? '🤖 Pilote automatique activé' : '🛑 Pilote automatique désactivé' });
});

module.exports = router;
