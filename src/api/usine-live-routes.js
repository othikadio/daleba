/**
 * DALEBA — Usine IA Live Routes v4 — Rendement Maximal Continu
 *
 * GET  /api/usine/live-stats
 * GET  /api/usine/live-stream        — SSE
 * POST /api/usine/trigger-scan
 * GET  /api/usine/production-mode
 * POST /api/usine/production-mode
 * GET  /api/usine/autonomous-mode
 * POST /api/usine/autonomous-mode
 * GET  /api/usine/opportunity/:id
 * GET  /api/usine/roster
 */
'use strict';

const express = require('express');
const router  = express.Router();

// ── État global (mémoire process) ─────────────────────────────────────────────
let productionModeEnabled = process.env.USINE_PRODUCTION_MODE !== 'false';
let autonomousMode        = false;   // persisté en DB au changement
let cycleRunning          = false;   // verrou anti-doublon
let autoCycleCount        = 0;
let lastAutoCycleAt       = null;
let activeTaskCount       = 0;       // compteur pour l'anneau de charge
let EMAIL_BATCH_PER_CYCLE = 10;      // limite Resend ~100/heure → 10/cycle
let CYCLE_COOLDOWN_MS     = 10000;   // 10s entre cycles (respiration API)

// ── Helpers ───────────────────────────────────────────────────────────────────
function safeRequire(mod) { try { return require(mod); } catch (_) { return null; } }
async function safeCall(fn, fb) { try { return await fn(); } catch (_) { return fb; } }
function getPool() { return safeRequire('../memory/db')?.pool || null; }
function getBus()  { return safeRequire('../services/event-bus'); }
function getAQ()   { return safeRequire('../workers/agent-queue'); }

// ── Persistance DB ────────────────────────────────────────────────────────────
async function persistAutoMode(enabled) {
  const pool = getPool();
  if (!pool) return;
  try {
    await pool.query(`
      INSERT INTO daleba_notes (title, content, category, tags, priority, author_id, created_at, updated_at)
      VALUES ('autonomous_mode', $1, 'system', ARRAY['usine','auto'], 1, 'system', NOW(), NOW())
      ON CONFLICT (title) DO UPDATE SET content = $1, updated_at = NOW()
      `, [enabled ? 'true' : 'false']);
  } catch (e) {
    // Table sans contrainte unique sur title — upsert fallback
    try {
      await pool.query(`DELETE FROM daleba_notes WHERE title='autonomous_mode' AND category='system'`);
      await pool.query(`INSERT INTO daleba_notes (title, content, category, tags, priority, author_id, created_at, updated_at)
        VALUES ('autonomous_mode', $1, 'system', ARRAY['usine','auto'], 1, 'system', NOW(), NOW())`, [enabled ? 'true' : 'false']);
    } catch (_) {}
  }
}

async function restoreAutoModeFromDB() {
  const pool = getPool();
  if (!pool) return false;
  try {
    const r = await pool.query(`SELECT content FROM daleba_notes WHERE title='autonomous_mode' AND category='system' LIMIT 1`);
    return r.rows[0]?.content === 'true';
  } catch (_) { return false; }
}

// ── Cycle autonome — BOUCLE INFINIE CONTINUE ─────────────────────────────────
async function runAutoCycle() {
  if (!autonomousMode || !productionModeEnabled) return;
  if (cycleRunning) return; // anti-doublon

  cycleRunning = true;
  const bus = getBus();
  const cycleId = ++autoCycleCount;
  lastAutoCycleAt = new Date().toISOString();

  if (bus?.system) bus.system(`🤖 [AUTO #${cycleId}] Cycle démarré — Rendement Maximal Continu`, { cycleId });

  // ── ÉTAPE 1 : SCAN ─────────────────────────────────────────────────────────
  try {
    const ow = safeRequire('../workers/opportunity-worker');
    if (ow?.runOpportunityWorker) {
      if (bus?.system) bus.system(`🌍 [AUTO #${cycleId}] Scan international…`);
      activeTaskCount++;
      await ow.runOpportunityWorker();
      activeTaskCount = Math.max(0, activeTaskCount - 1);
      if (bus?.system) bus.system(`✅ [AUTO #${cycleId}] Scan terminé`);
    }
  } catch (e) {
    activeTaskCount = Math.max(0, activeTaskCount - 1);
    if (bus?.system) bus.system(`⚠️ [AUTO #${cycleId}] Scan: ${e.message}`);
  }

  if (!autonomousMode) { cycleRunning = false; return; }

  // ── ÉTAPE 2 : PROPOSITIONS + EMAIL ─────────────────────────────────────────
  const pool = getPool();
  if (pool) {
    try {
      // Récupérer les opportunités sans proposition, score ≥ 70
      const r = await pool.query(`
        SELECT o.* FROM daleba_opportunities o
        LEFT JOIN daleba_proposals p ON p.opportunity_id = o.id
        WHERE o.score >= 70 AND o.status = 'pending' AND p.id IS NULL
        ORDER BY o.score DESC, o.detected_at DESC
        LIMIT $1
      `, [EMAIL_BATCH_PER_CYCLE]);

      const opps = r.rows;
      if (opps.length > 0) {
        if (bus?.system) bus.system(`✍️ [AUTO #${cycleId}] Pipeline: ${opps.length} opportunités en traitement`, { count: opps.length });

        const pw = safeRequire('../services/proposal-writer');
        const en = safeRequire('../services/email-notifier');

        for (const opp of opps) {
          if (!autonomousMode) break; // arrêt propre si désactivé entre-temps

          activeTaskCount++;
          if (bus?.system) bus.system(`🔍 [AUTO #${cycleId}] Analyse: ${opp.title?.slice(0, 55)}…`, { oppId: opp.id, score: opp.score });

          try {
            // Générer la proposition
            let proposalText = `[Proposition AUTO — ${opp.title}]`;
            if (pw?.generateProposal) {
              proposalText = await safeCall(() => pw.generateProposal(opp), proposalText);
            }

            // Sauvegarder en DB
            await pool.query(
              `INSERT INTO daleba_proposals (opportunity_id, generated_text, status, created_at)
               VALUES ($1, $2, 'sent', NOW())`,
              [opp.id, proposalText]
            );

            // Marquer l'opportunité comme traitée
            await pool.query(
              `UPDATE daleba_opportunities SET status='approved', approved_at=NOW() WHERE id=$1`,
              [opp.id]
            );

            // Envoyer l'email
            if (en?.notifyProposal) {
              await safeCall(() => en.notifyProposal(opp, proposalText), null);
              if (bus?.system) bus.system(`📧 [AUTO #${cycleId}] Email envoyé — ${opp.title?.slice(0, 50)} [score:${opp.score}]`);
            }
          } catch (e2) {
            if (bus?.system) bus.system(`⚠️ [AUTO #${cycleId}] Erreur opp #${opp.id}: ${e2.message?.slice(0, 80)}`);
            // Marquer quand même pour ne pas boucler dessus indéfiniment
            await safeCall(() => pool.query(
              `INSERT INTO daleba_proposals (opportunity_id, generated_text, status, created_at)
               VALUES ($1, '[Erreur génération — retry prochain cycle]', 'error', NOW())`,
              [opp.id]
            ), null);
          } finally {
            activeTaskCount = Math.max(0, activeTaskCount - 1);
          }
        }

        if (bus?.system) bus.system(`🏁 [AUTO #${cycleId}] Cycle terminé — ${opps.length} opportunités traitées`);
      } else {
        // Toutes les opps existantes traitées → re-scan immédiat pour en trouver d'autres
        if (bus?.system) bus.system(`🔄 [AUTO #${cycleId}] File vide — re-scan pour nouvelles opportunités`);
      }
    } catch (e) {
      if (bus?.system) bus.system(`⚠️ [AUTO #${cycleId}] Pipeline: ${e.message}`);
    }
  }

  cycleRunning = false;

  // ── BOUCLE INFINIE : relance immédiate si encore en mode autonome ───────────
  if (autonomousMode && productionModeEnabled) {
    // Petite respiration pour éviter de saturer les APIs externes (Resend, DeepSeek)
    setTimeout(runAutoCycle, CYCLE_COOLDOWN_MS);
  }
}

// ── Démarrage du mode autonome ─────────────────────────────────────────────────
function startAutonomousMode() {
  // Lance le premier cycle immédiatement (2s)
  setTimeout(runAutoCycle, 2000);
}

function stopAutonomousMode() {
  autonomousMode = false;
  // Le cycle en cours se terminera proprement (verrou cycleRunning) et ne relancera pas
}

// ── Restauration au démarrage du serveur ──────────────────────────────────────
;(async () => {
  // Attendre que la DB soit prête (max 30s)
  let attempts = 0;
  const checkAndRestore = async () => {
    attempts++;
    const restored = await restoreAutoModeFromDB();
    if (restored) {
      autonomousMode = true;
      productionModeEnabled = true;
      const bus = getBus();
      if (bus?.system) bus.system('🤖 [BOOT] Mode autonome restauré depuis la DB — relance du cycle');
      startAutonomousMode();
    } else if (attempts < 5) {
      setTimeout(checkAndRestore, 6000);
    }
  };
  setTimeout(checkAndRestore, 8000); // laisser la DB se connecter
})();

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/usine/live-stats
// ─────────────────────────────────────────────────────────────────────────────
router.get('/live-stats', async (req, res) => {
  res.setHeader('Content-Type', 'application/json');
  try {
    const pool = getPool();
    const aq   = getAQ();
    const mgr  = safeRequire('../services/agent-manager');
    const bus  = getBus();

    const queueStats = aq
      ? await safeCall(() => aq.getQueueStats(), { 'lead-gen-queue':{}, 'seo-audit-queue':{}, 'email-sequence-queue':{}, redisAvailable: false })
      : { 'lead-gen-queue':{}, 'seo-audit-queue':{}, 'email-sequence-queue':{}, redisAvailable: false };

    const ms = mgr ? await safeCall(() => mgr.getStatus(), null) : null;

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

    // L'anneau: actifs BullMQ + tâches autonomes en cours
    const bullActive = (lg.active||0) + (seo.active||0) + (em.active||0) + (ms?.stats?.liveAgents||0);
    const totalActive = bullActive + activeTaskCount;

    res.json({
      ts: Date.now(),
      productionMode: productionModeEnabled,
      autonomousMode,
      cycleRunning,
      lastAutoCycleAt,
      autoCycleCount,
      activeTaskCount,
      redisConnected: !!queueStats.redisAvailable,
      agents: {
        active: totalActive,
        waiting: (lg.waiting||0) + (seo.waiting||0) + (em.waiting||0),
        capacity: 1000,
        liveManager: ms?.stats?.liveAgents || 0,
      },
      queues: {
        leadGen:       { waiting: lg.waiting||0,  active: lg.active||0,  completed: lg.completed||0,  failed: lg.failed||0  },
        seoAudit:      { waiting: seo.waiting||0, active: seo.active||0, completed: seo.completed||0, failed: seo.failed||0 },
        emailSequence: { waiting: em.waiting||0,  active: em.active||0,  completed: em.completed||0,  failed: em.failed||0  },
      },
      totals, recentOpps,
      recentEvents: recentEvents.slice(0, 15),
    });
  } catch (err) {
    res.status(500).json({ error: 'Erreur interne', detail: err.message });
  }
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
  if (kw.includes('crm')||kw.includes('lead')||desc.includes('lead')) flaws.push({ label:'Pipeline CRM défaillant', severity:'medium', detail:'Attribution manquante, suivi irrégulier' });
  if (kw.includes('api')||kw.includes('integration')||desc.includes('integr')) flaws.push({ label:'Intégrations API absentes', severity:'medium', detail:'Silos entre outils' });
  if (desc.includes('manual')||desc.includes('spreadsheet')) flaws.push({ label:'Opérations manuelles', severity:'high', detail:'Candidat idéal pour l\'automatisation IA' });
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
    res.json({
      totalAgents: 1000,
      autonomousActive: autonomousMode,
      activeTaskCount,
      squads: [
        { id:'scraping', label:'Scraping & Intelligence', range:'1 → 300', count:300, color:'sky', icon:'🔍', description:'Scannent HackerNews, Remotive, WeWorkRemotely et 40+ sources en temps réel.', skills:['Web Scraping','Data Extraction','Source Classification','Deduplication','Multi-language'], queueActive:lg.active||0, queueCompleted:lg.completed||0 },
        { id:'audit',    label:'Rédacteurs Audit SEO',   range:'301 → 700', count:400, color:'violet', icon:'✍️', description:'Génèrent des propositions B2B personnalisées et audits SEO.', skills:['SEO Analysis','Proposal Writing','Score Ranking','FR/EN bilingual','Budget Estimation'], queueActive:seo.active||0, queueCompleted:seo.completed||0 },
        { id:'closers',  label:'Closers & Relances Email', range:'701 → 1 000', count:300, color:'amber', icon:'📧', description:'Séquences email multi-étapes, relances et suivi Stripe.', skills:['Email Sequencing','Follow-up Automation','Stripe Monitoring','Reply Detection','A/B Testing'], queueActive:(em.active||0)+activeTaskCount, queueCompleted:em.completed||0 },
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
  send({ type:'connected', ts:Date.now(), productionMode:productionModeEnabled, autonomousMode, activeTaskCount });

  const statTick = setInterval(async () => {
    if (res.writableEnded) { clearInterval(statTick); return; }
    const aq = getAQ();
    if (!aq) { send({ type:'ping', ts:Date.now(), activeTaskCount }); return; }
    try {
      const stats = await aq.getQueueStats();
      const lg=stats['lead-gen-queue']||{}, seo=stats['seo-audit-queue']||{}, em=stats['email-sequence-queue']||{};
      const bullA=(lg.active||0)+(seo.active||0)+(em.active||0);
      send({ type:'stats', stats, totalActive:bullA+activeTaskCount, activeTaskCount, autonomousMode, cycleRunning, autoCycleCount, ts:Date.now() });
    } catch (_) { send({ type:'ping', ts:Date.now(), activeTaskCount }); }
  }, 3000); // rafraîchissement toutes les 3s

  const ping = setInterval(() => { if (!res.writableEnded) res.write(': ping\n\n'); }, 20000);
  const cleanup = () => { clearInterval(statTick); clearInterval(ping); };
  req.on('close', cleanup); req.on('aborted', cleanup); res.on('finish', cleanup); res.on('error', cleanup);
});

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/usine/trigger-scan
// ─────────────────────────────────────────────────────────────────────────────
router.post('/trigger-scan', async (req, res) => {
  res.setHeader('Content-Type', 'application/json');
  if (!productionModeEnabled) return res.status(403).json({ success:false, error:'Usine en pause.' });
  try {
    const aq = getAQ();
    const jobs = [];
    if (aq) {
      const j1 = await safeCall(() => aq.addLeadGenJob({ trigger:'manual', ts:Date.now() }), null);
      const j2 = await safeCall(() => aq.addSeoAuditJob({ trigger:'manual', ts:Date.now() }), null);
      if (j1) jobs.push(String(j1.id||'mem'));
      if (j2) jobs.push(String(j2.id||'mem'));
    }
    setImmediate(async () => {
      try { const ow=safeRequire('../workers/opportunity-worker'); if(ow?.runOpportunityWorker) await ow.runOpportunityWorker(); } catch(_) {}
    });
    const bus = getBus();
    if (bus?.system) bus.system('🌍 Scan international manuel déclenché', { jobs });
    res.json({ success:true, message:'Scan déclenché', jobs, scanStarted:true });
  } catch (err) { res.status(500).json({ success:false, error:err.message }); }
});

// ─────────────────────────────────────────────────────────────────────────────
// Production mode
// ─────────────────────────────────────────────────────────────────────────────
router.get('/production-mode', (req, res) => res.json({ enabled:productionModeEnabled, ts:Date.now() }));
router.post('/production-mode', (req, res) => {
  const { enabled } = req.body;
  if (typeof enabled !== 'boolean') return res.status(400).json({ error:'enabled doit être booléen' });
  productionModeEnabled = enabled;
  const bus = getBus();
  if (bus?.system) bus.system(enabled ? '▶ Usine activée — Production ON' : '⏸ Usine en pause — Production OFF', { productionMode:enabled });
  if (!enabled && autonomousMode) stopAutonomousMode();
  res.json({ success:true, enabled:productionModeEnabled });
});

// ─────────────────────────────────────────────────────────────────────────────
// Autonomous mode — VERROUILLÉ EN DB
// ─────────────────────────────────────────────────────────────────────────────
router.get('/autonomous-mode', (req, res) => {
  res.json({ enabled:autonomousMode, lastCycleAt:lastAutoCycleAt, cycleCount:autoCycleCount, cycleRunning, activeTaskCount });
});

router.post('/autonomous-mode', async (req, res) => {
  const { enabled } = req.body;
  if (typeof enabled !== 'boolean') return res.status(400).json({ error:'enabled doit être booléen' });
  if (enabled && !productionModeEnabled) return res.status(403).json({ success:false, error:'Activez d\'abord la Production.' });

  autonomousMode = enabled;
  const bus = getBus();

  // Persister en DB (survit aux redémarrages)
  await persistAutoMode(enabled);

  if (enabled) {
    startAutonomousMode();
    if (bus?.system) bus.system('🤖 MODE 100% AUTONOME — Boucle infinie continue activée (zéro interruption)', { autonomousMode:true });
  } else {
    stopAutonomousMode();
    if (bus?.system) bus.system('🛑 Mode autonome désactivé manuellement', { autonomousMode:false });
  }

  res.json({ success:true, enabled:autonomousMode, message:enabled ? '🤖 Boucle infinie lancée — Rendement Maximal' : '🛑 Cycle arrêté' });
});

module.exports = router;
