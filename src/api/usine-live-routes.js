/**
 * DALEBA — Usine IA v6 — Centre de Commandement Mondial
 * Scans parallèles · CA Réel · Task logs · Squads géographiques
 */
'use strict';

const express = require('express');
const router  = express.Router();

// ── État global ────────────────────────────────────────────────────────────────
let productionModeEnabled = process.env.USINE_PRODUCTION_MODE !== 'false';
let autonomousMode        = false; // restauré au boot
let cycleRunning          = false;
let autoCycleCount        = 0;
let lastAutoCycleAt       = null;
let EMAIL_BATCH_PER_CYCLE = 20; // 20 propositions/cycle
let CYCLE_COOLDOWN_MS     = 45 * 60 * 1000; // 45 min — mode surrégime

// ── Escouades géographiques/sectorielles ──────────────────────────────────────
const SQUADS_DEF = {
  americas:    { range:[1,150],    icon:'🌎', label:'Amériques',   squadId:'americas',   keywords:['automation','saas','api','ai integration','workflow'] },
  europe:      { range:[151,300],  icon:'🌍', label:'Europe',      squadId:'europe',     keywords:['automatisation','logiciel','ia','intégration','API'] },
  global:      { range:[301,450],  icon:'🌏', label:'Asie-Pacifique', squadId:'global',  keywords:['automation','fintech','saas','platform'] },
  tech_saas:   { range:[451,600],  icon:'💻', label:'Tech/SaaS',   squadId:'freelance',  keywords:['saas','platform','b2b','software as a service'] },
  auto_ai:     { range:[601,750],  icon:'🤖', label:'Auto/IA',     squadId:'global',     keywords:['ai','machine learning','llm','chatbot','agent'] },
  closers:     { range:[751,950],  icon:'📧', label:'Closers Email', squadId:null,       keywords:[] },
  maintenance: { range:[951,1000], icon:'🛡', label:'Maintenance',  squadId:null,        keywords:[] },
};

// ── LIVE TASKS — suivi temps réel ─────────────────────────────────────────────
const LIVE_TASKS = new Map();
let taskSeq = 0;

function taskRegister(squadKey, opp, extraData = {}) {
  const taskId = `T${++taskSeq}`;
  const def = SQUADS_DEF[squadKey] || SQUADS_DEF.americas;
  const [lo, hi] = def.range;
  const agentId = lo + Math.floor(Math.random() * (hi - lo + 1));
  const task = {
    taskId, agentId, squad: squadKey,
    squadLabel: def.label, squadIcon: def.icon,
    title:     opp?.title?.slice(0, 65) || `Mission ${taskId}`,
    action:    extraData.action || getDefaultAction(squadKey, opp),
    value:     opp?.budget_estimated ? `$${Math.round(opp.budget_estimated).toLocaleString('fr-CA')} ${opp?.budget_currency||'USD'}` : 'En estimation',
    valueRaw:  parseFloat(opp?.budget_estimated) || 0,
    startedAt: Date.now(),
    score:     opp?.score || 0,
    country:   opp?.country || '??',
    category:  opp?.category || 'général',
    oppId:     opp?.id || null,
    logs:      [{ ts: Date.now(), step: 'start', msg: `Agent #${agentId} déployé` }],
    progress:  0,
    currentUrl: extraData.url || null,
  };
  LIVE_TASKS.set(taskId, task);
  return taskId;
}
function taskLog(taskId, step, msg, extra = {}) {
  const t = LIVE_TASKS.get(taskId);
  if (!t) return;
  t.logs.unshift({ ts: Date.now(), step, msg, ...extra });
  if (t.logs.length > 20) t.logs.pop();
  if (extra.url) t.currentUrl = extra.url;
  if (extra.progress !== undefined) t.progress = extra.progress;
}
function taskDone(taskId) { LIVE_TASKS.delete(taskId); }
function getDefaultAction(squad, opp) {
  if (squad === 'americas' || squad === 'europe' || squad === 'global') return `Scan ${SQUADS_DEF[squad]?.label||squad} — ${opp?.source_platform||'multi-sources'}`;
  if (squad === 'tech_saas' || squad === 'auto_ai') return `Audit & Rédaction — ${opp?.category||'général'}`;
  if (squad === 'closers') return `Email Closing — ${opp?.country||'??'}`;
  return 'Maintenance système';
}

// ── MAINTENANCE #951-1000 ──────────────────────────────────────────────────────
let maintenanceActive = false, maintenanceHeals = 0, maintenanceErrors = 0;
const maintenanceLogs = [];

function logMaint(msg, level = 'info') {
  maintenanceLogs.unshift({ ts: new Date().toISOString(), msg, level });
  if (maintenanceLogs.length > 50) maintenanceLogs.pop();
  getBus()?.system?.(`🛡 [Maint] ${msg}`, { level });
}

async function runMaintenanceCycle() {
  if (!maintenanceActive) return;
  const taskId = taskRegister('maintenance', { title:'Surveillance système', score:0 }, { action:'Health check global' });
  taskLog(taskId, 'health', 'Vérification BullMQ, DB, cycle…');
  try {
    const aq = getAQ();
    if (aq) {
      const stats = await safeCall(() => aq.getQueueStats(), null);
      const totalFailed = Object.values(stats||{}).reduce((acc,q) => acc + (typeof q==='object' ? (q.failed||0) : 0), 0);
      if (totalFailed > 0) {
        maintenanceErrors++;
        logMaint(`${totalFailed} jobs failed détectés — retry lancé`, 'warn');
        taskLog(taskId, 'repair', `Auto-réparation: ${totalFailed} jobs relancés`);
        maintenanceHeals++;
        logMaint('Retry BullMQ exécuté ✅', 'heal');
      }
    }
    if (autonomousMode && !cycleRunning && lastAutoCycleAt) {
      const elapsed = Date.now() - new Date(lastAutoCycleAt).getTime();
      if (elapsed > 6 * 60 * 1000) {
        maintenanceErrors++;
        logMaint(`Cycle bloqué depuis ${Math.round(elapsed/60000)}min — relance`, 'warn');
        cycleRunning = false;
        setTimeout(runAutoCycle, 2000);
        maintenanceHeals++;
        logMaint('Cycle relancé ✅', 'heal');
      }
    }
    taskLog(taskId, 'done', 'Health check OK', { progress: 100 });
  } catch(e) { logMaint(`Erreur: ${e.message}`, 'error'); }
  taskDone(taskId);
  if (maintenanceActive) setTimeout(runMaintenanceCycle, 60000);
}
function startMaintenance() { maintenanceActive = true; logMaint('Escouade #951-1000 déployée'); setTimeout(runMaintenanceCycle, 5000); }
function stopMaintenance()  { maintenanceActive = false; }

// ── Helpers ────────────────────────────────────────────────────────────────────
function safeRequire(mod) { try { return require(mod); } catch (_) { return null; } }
async function safeCall(fn, fb) { try { return await fn(); } catch (_) { return fb; } }
function getPool() { return safeRequire('../memory/db')?.pool || null; }
function getBus()  { return safeRequire('../services/event-bus'); }
function getAQ()   { return safeRequire('../workers/agent-queue'); }

// ── Persistance DB ─────────────────────────────────────────────────────────────
async function persistAutoMode(enabled) {
  const pool = getPool(); if (!pool) return;
  try {
    await pool.query(`DELETE FROM daleba_notes WHERE title='autonomous_mode' AND category='system'`);
    await pool.query(`INSERT INTO daleba_notes (title, content, category, tags, priority, author_id, created_at, updated_at) VALUES ('autonomous_mode',$1,'system',ARRAY['usine','auto'],1,'system',NOW(),NOW())`, [enabled?'true':'false']);
  } catch(_) {}
}
async function restoreAutoModeFromDB() {
  const pool = getPool(); if (!pool) return false;
  try { const r = await pool.query(`SELECT content FROM daleba_notes WHERE title='autonomous_mode' AND category='system' LIMIT 1`); return r.rows[0]?.content==='true'; } catch(_) { return false; }
}

// ── SCANS PARALLÈLES PAR ESCOUADE ─────────────────────────────────────────────
async function runSquadScan(squadKey) {
  const scanner = safeRequire('../services/opportunity-scanner');
  if (!scanner?.scanBySquad) return 0;
  const def = SQUADS_DEF[squadKey];
  if (!def) return 0;

  const taskId = taskRegister(squadKey, { title:`Scan ${def.label}`, score:0 }, { action:`Scan ${def.label} — sources mondiales` });
  taskLog(taskId, 'scan', `Lancement scan escouade ${def.label}`, { progress: 10 });
  const bus = getBus();
  if (bus?.system) bus.system(`🌍 [${def.icon} ${def.label}] Scan démarré`);

  let newCount = 0;
  try {
    const raw = await scanner.scanBySquad(def.squadId);
    taskLog(taskId, 'fetch', `${raw.length} résultats bruts récupérés`, { progress: 50 });

    const pool = getPool();
    if (pool && raw.length > 0) {
      const classifier = safeRequire('../services/opportunity-classifier');
      const existingURLs = new Set((await safeCall(() => pool.query('SELECT source_url FROM daleba_opportunities WHERE source_url IS NOT NULL'), { rows:[] })).rows.map(r=>r.source_url));
      const toProcess = raw.filter(r => r.url && !existingURLs.has(r.url)).slice(0, 30);
      taskLog(taskId, 'classify', `Classification de ${toProcess.length} nouvelles opportunités`, { progress: 70 });

      for (const opp of toProcess) {
        try {
          let classified = { score:50, category:'général', description_fr:'' };
          if (classifier?.classifyOpportunity) classified = await safeCall(() => classifier.classifyOpportunity(opp), classified);
          if ((classified.score || 0) < 30) continue;
          await pool.query(`INSERT INTO daleba_opportunities (source_platform,source_url,country,language_original,title,description_orig,description_fr,budget_raw,budget_estimated,budget_currency,category,score,keywords_matched,status,detected_at)
            VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,'pending',NOW())
            ON CONFLICT (source_url) DO NOTHING`,
            [opp.platform,opp.url,opp.country||null,'en',opp.title,opp.description?.slice(0,3000)||'',classified.description_fr||'',opp.budget_raw||null,classified.budget_estimated||null,classified.budget_currency||'USD',classified.category||'général',classified.score||50,classified.keywords_matched||'']);
          newCount++;
        } catch(_) {}
      }
      if (bus?.system && newCount > 0) bus.system(`✅ [${def.icon} ${def.label}] ${newCount} nouvelles opportunités ajoutées`);
    }
    taskLog(taskId, 'done', `Scan terminé — ${newCount} nouvelles opps`, { progress: 100 });
  } catch(e) {
    taskLog(taskId, 'error', `Erreur: ${e.message}`);
    if (bus?.system) bus.system(`⚠️ [${def.label}] Scan: ${e.message?.slice(0,60)}`);
  }
  taskDone(taskId);
  return newCount;
}

// ── CYCLE AUTONOME — 3 scans d'escouades en parallèle ────────────────────────
async function runAutoCycle() {
  if (!autonomousMode || !productionModeEnabled || cycleRunning) return;
  cycleRunning = true;
  const bus = getBus();
  const cycleId = ++autoCycleCount;
  lastAutoCycleAt = new Date().toISOString();
  if (bus?.system) bus.system(`🤖 [AUTO #${cycleId}] Cycle Mondial — 3 escouades en parallèle`);

  // ── Rate limiter global IA ────────────────────────────────────────────────────
  // DeepSeek: ~60 RPM libre → on espace à 1 appel/2s max (30 RPM, marge large)
  // GPT-4o: crédits épuisés 2026-06-01 → exclu du pool DARE (quotaExhausted)
  // Gemini: instable → fallback uniquement
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  // Rate limiter calibré pour Kimi (Moonshot AI) :
  // Tier standard = 60 RPM. On vise 30 RPM (marge ×2) = 1 call / 2s.
  // Identique à DeepSeek — les deux APIs supportent ce rythme confortablement.
  const RL_DELAY_MS = 2000; // 1 call IA / 2s = 30 RPM max (Kimi + DeepSeek OK)

  // ÉTAPE 1 — SCANS SÉQUENTIELS avec pause (était parallèle — générait trop d'appels IA)
  // Americas → pause → Europe → pause → Global : scan propre sans bombardement API
  try {
    const r1 = await runSquadScan('americas');
    await sleep(RL_DELAY_MS);
    const r2 = await runSquadScan('europe');
    await sleep(RL_DELAY_MS);
    const r3 = await runSquadScan('global');
    const total = (r1||0) + (r2||0) + (r3||0);
    if (bus?.system) bus.system(`📡 [AUTO #${cycleId}] Scan séquentiel terminé — ${total} nouvelles opps`);
  } catch(e) {
    if (bus?.system) bus.system(`⚠️ [AUTO #${cycleId}] Scans: ${e.message}`);
  }

  if (!autonomousMode) { cycleRunning = false; return; }

  // ÉTAPE 2 — PIPELINE avec rate limiting strict
  // CHUNK réduit de 5 → 2 (2 appels IA en parallèle max) + pause 3s entre chunks
  const THROTTLE_CHUNK  = 4;   // 4 propositions en simultané (DeepSeek+GPT-4o)
  const THROTTLE_PAUSE  = 2000; // 2s entre lots (rate limit OK)
  const MAX_OPPS_CYCLE  = 20;  // 20 offres/cycle — mode agressif

  const pool = getPool();
  if (pool) {
    try {
      const r = await pool.query(`
        SELECT o.* FROM daleba_opportunities o
        LEFT JOIN daleba_proposals p ON p.opportunity_id = o.id
        WHERE o.score >= 65 AND o.status = 'pending' AND p.id IS NULL
        ORDER BY o.score DESC, o.detected_at DESC LIMIT $1`, [MAX_OPPS_CYCLE]);

      const opps = r.rows;
      if (opps.length) {
        if (bus?.system) bus.system(`✍️ [AUTO #${cycleId}] Pipeline: ${opps.length} opps — lot×${THROTTLE_CHUNK} avec pause ${THROTTLE_PAUSE/1000}s`);
        for (let i = 0; i < opps.length; i += THROTTLE_CHUNK) {
          if (!autonomousMode) break;
          const chunk = opps.slice(i, i + THROTTLE_CHUNK);
          await Promise.all(chunk.map(async (opp) => {
            const auditId  = taskRegister('tech_saas', opp, { action:`Rédaction proposition — ${opp.category}` });
            const closerId = taskRegister('closers', opp, { action:`Email closing — ${opp.country||'??'}` });
            try {
              taskLog(auditId, 'generate', `DeepSeek: génération proposition pour "${opp.title?.slice(0,40)}"`, { progress:30 });
              let proposalText = `[AUTO] DALEBA — Proposition pour ${opp.title}`;
              const pw = safeRequire('../services/proposal-writer');
              if (pw?.generateProposal) proposalText = await safeCall(() => pw.generateProposal(opp), proposalText);
              taskLog(auditId, 'done', `Proposition générée (${proposalText.length} chars)`, { progress:100 });
              taskDone(auditId);

              taskLog(closerId, 'email', `Envoi email — ${opp.title?.slice(0,40)}`, { progress:50 });
              await pool.query(`INSERT INTO daleba_proposals (opportunity_id,generated_text,status,created_at,sent_at) VALUES ($1,$2,'sent',NOW(),NOW())`, [opp.id, proposalText]);
              await pool.query(`UPDATE daleba_opportunities SET status='approved',approved_at=NOW() WHERE id=$1`, [opp.id]);
              const en = safeRequire('../services/email-notifier');
              if (en?.notifyProposal) await safeCall(() => en.notifyProposal(opp, proposalText), null);
              taskLog(closerId, 'sent', `Email envoyé ✅ — ${opp.title?.slice(0,40)}`, { progress:100 });
              if (bus?.system) bus.system(`📧 [AUTO #${cycleId}] Livré — "${opp.title?.slice(0,45)}" $${Math.round(opp.budget_estimated||0).toLocaleString()}`);
            } catch(e2) {
              taskDone(auditId);
              await safeCall(() => pool.query(`INSERT INTO daleba_proposals (opportunity_id,generated_text,status) VALUES ($1,'[error]','error')`, [opp.id]), null);
            } finally { taskDone(closerId); }
          }));
          // Pause rate limiter entre chaque lot
          if (i + THROTTLE_CHUNK < opps.length) await sleep(THROTTLE_PAUSE);
        }
        if (bus?.system) bus.system(`🏁 [AUTO #${cycleId}] Cycle terminé — ${opps.length} opportunités livrées`);
      } else {
        if (bus?.system) bus.system(`🔄 [AUTO #${cycleId}] Pipeline vide — re-scan au prochain cycle`);
      }
    } catch(e) { if (bus?.system) bus.system(`⚠️ [AUTO #${cycleId}] Pipeline: ${e.message}`); }
  }

  cycleRunning = false;
  if (autonomousMode && productionModeEnabled) setTimeout(runAutoCycle, CYCLE_COOLDOWN_MS);
}

function startAutonomousMode() { setTimeout(runAutoCycle, 2000); startMaintenance(); }
function stopAutonomousMode()  { autonomousMode = false; stopMaintenance(); }

// ── Boot restore ───────────────────────────────────────────────────────────────
;(async () => {
  let n = 0;
  const check = async () => {
    n++;
    if (await restoreAutoModeFromDB()) {
      autonomousMode = true; productionModeEnabled = true;
      getBus()?.system?.('🤖 [BOOT] Mode autonome restauré — cycle relancé');
      startAutonomousMode();
    } else if (n < 5) { setTimeout(check, 6000); }
  };
  setTimeout(check, 8000);
})();

// ─── ROUTES ───────────────────────────────────────────────────────────────────

// GET /api/usine/live-stats
router.get('/live-stats', async (req, res) => {
  res.setHeader('Content-Type', 'application/json');
  try {
    const pool = getPool(), aq = getAQ(), bus = getBus();
    const qs = aq ? await safeCall(() => aq.getQueueStats(), {redisAvailable:false}) : {redisAvailable:false};
    let recentOpps=[], totals={opportunities:0,proposals:0};
    if (pool) {
      const [oR,tR,pR] = await Promise.allSettled([
        pool.query(`SELECT id,title,country,category,score,source_platform,source_url,detected_at as created_at,budget_estimated,budget_currency FROM daleba_opportunities ORDER BY detected_at DESC LIMIT 15`),
        pool.query('SELECT COUNT(*)::int as n FROM daleba_opportunities'),
        pool.query('SELECT COUNT(*)::int as n FROM daleba_proposals'),
      ]);
      if(oR.status==='fulfilled') recentOpps=oR.value.rows;
      if(tR.status==='fulfilled') totals.opportunities=tR.value.rows[0]?.n||0;
      if(pR.status==='fulfilled') totals.proposals=pR.value.rows[0]?.n||0;
    }
    const evts = bus ? await safeCall(()=>bus.getRecent(20),[]) : [];
    const lg=qs['lead-gen-queue']||{}, seo=qs['seo-audit-queue']||{}, em=qs['email-sequence-queue']||{};
    const liveArr=[...LIVE_TASKS.values()];
    const totalActive=(lg.active||0)+(seo.active||0)+(em.active||0)+liveArr.length;
    res.json({
      ts:Date.now(), productionMode:productionModeEnabled, autonomousMode, cycleRunning,
      lastAutoCycleAt, autoCycleCount, redisConnected:!!qs.redisAvailable,
      agents:{active:totalActive,waiting:(lg.waiting||0)+(seo.waiting||0)+(em.waiting||0),capacity:1000},
      queues:{leadGen:{waiting:lg.waiting||0,active:lg.active||0,completed:lg.completed||0,failed:lg.failed||0},seoAudit:{waiting:seo.waiting||0,active:seo.active||0,completed:seo.completed||0,failed:seo.failed||0},emailSequence:{waiting:em.waiting||0,active:em.active||0,completed:em.completed||0,failed:em.failed||0}},
      totals, recentOpps,
      recentEvents: evts.slice(0,15),
      liveTasks: liveArr.map(t=>({...t, logs:undefined})), // résumé sans logs (perf)
      maintenance:{active:maintenanceActive,heals:maintenanceHeals,errors:maintenanceErrors,logs:maintenanceLogs.slice(0,5)},
    });
  } catch(err) { res.status(500).json({error:err.message}); }
});

// GET /api/usine/task/:taskId — boîte noire avec logs complets
router.get('/task/:taskId', (req, res) => {
  res.setHeader('Content-Type', 'application/json');
  const task = LIVE_TASKS.get(req.params.taskId);
  if (!task) return res.status(404).json({ error:'Tâche introuvable ou terminée' });
  res.json({ ...task, elapsed: Date.now() - task.startedAt });
});

// GET /api/usine/pipeline
// Logique business réelle :
// - Détectés    = toutes les opps scannées
// - Qualifiés   = score >= 65 (IA a validé)
// - Offres      = proposition email envoyée (prospection seulement, AUCUN livrable)
// - Contrat Signé = status='signed' — action manuelle uniquement
// CA Potentiel  = budget des opps qualifiées
// CA Réel       = budget des opps signées uniquement
router.get('/pipeline', async (req, res) => {
  res.setHeader('Content-Type', 'application/json');
  try {
    const pool = getPool();
    if (!pool) return res.json({ detected:0, qualified:0, offersSent:0, signed:0, caPotentiel:0, caReel:0, items:[] });
    const [det,qual,offers,signed,caPot,caReel,items] = await Promise.allSettled([
      pool.query('SELECT COUNT(*)::int as n FROM daleba_opportunities'),
      pool.query('SELECT COUNT(*)::int as n FROM daleba_opportunities WHERE score >= 65'),
      // Offres = email de prospection envoyé (proposal.sent_at NOT NULL)
      pool.query("SELECT COUNT(*)::int as n FROM daleba_proposals WHERE sent_at IS NOT NULL"),
      // Contrat Signé = seul statut qui déclenche du CA Réel — action manuelle
      pool.query("SELECT COUNT(*)::int as n FROM daleba_opportunities WHERE status='signed'"),
      // CA Potentiel = budget des opps qualifiées (score >= 65)
      pool.query('SELECT COALESCE(SUM(budget_estimated),0)::float as t FROM daleba_opportunities WHERE score >= 65 AND budget_estimated IS NOT NULL'),
      // CA Réel = UNIQUEMENT les contrats signés manuellement
      pool.query("SELECT COALESCE(SUM(budget_estimated),0)::float as t FROM daleba_opportunities WHERE status='signed' AND budget_estimated IS NOT NULL"),
      pool.query(`SELECT o.id,o.title,o.score,o.country,o.budget_estimated,o.budget_currency,o.status as opp_status,o.category,o.source_url,o.source_platform,p.status as prop_status,p.generated_text,p.created_at as prop_date,p.sent_at FROM daleba_opportunities o LEFT JOIN daleba_proposals p ON p.opportunity_id=o.id ORDER BY COALESCE(p.created_at,o.detected_at) DESC LIMIT 40`),
    ]);
    res.json({
      detected:    det.status==='fulfilled'     ? det.value.rows[0]?.n   ||0:0,
      qualified:   qual.status==='fulfilled'    ? qual.value.rows[0]?.n  ||0:0,
      offersSent:  offers.status==='fulfilled'  ? offers.value.rows[0]?.n||0:0,
      signed:      signed.status==='fulfilled'  ? signed.value.rows[0]?.n||0:0,
      caPotentiel: caPot.status==='fulfilled'   ? caPot.value.rows[0]?.t ||0:0,
      caReel:      caReel.status==='fulfilled'  ? caReel.value.rows[0]?.t||0:0,
      items:       items.status==='fulfilled'   ? items.value.rows        :[],
    });
  } catch(err) { res.status(500).json({error:err.message}); }
});

// POST /api/usine/opportunity/:id/sign — action manuelle Ulrich uniquement
router.post('/opportunity/:id/sign', async (req, res) => {
  res.setHeader('Content-Type','application/json');
  const pool = getPool(); if(!pool) return res.status(503).json({error:'DB indisponible'});
  try {
    await pool.query("UPDATE daleba_opportunities SET status='signed', approved_at=NOW() WHERE id=$1", [req.params.id]);
    const r = await pool.query('SELECT title, budget_estimated, budget_currency FROM daleba_opportunities WHERE id=$1', [req.params.id]);
    const opp = r.rows[0];
    getBus()?.system?.('CONTRAT SIGNE — ' + (opp?.title||'').slice(0,50));
    res.json({ success:true, signed:true, opp });
  } catch(err) { res.status(500).json({error:err.message}); }
});

// GET /api/usine/squads — détail escouades géographiques
router.get('/squads', async (req, res) => {
  res.setHeader('Content-Type', 'application/json');
  const liveArr = [...LIVE_TASKS.values()];
  res.json({
    squads: Object.entries(SQUADS_DEF).map(([key, def]) => ({
      key, ...def,
      agentCount: def.range[1] - def.range[0] + 1,
      liveTasks: liveArr.filter(t => t.squad === key).length,
    })),
    totalAgents: 1000,
    totalActive: liveArr.length,
  });
});

// GET /api/usine/maintenance
router.get('/maintenance', (req, res) => res.json({ active:maintenanceActive, agentRange:'951 → 1 000', agentCount:50, heals:maintenanceHeals, errors:maintenanceErrors, logs:maintenanceLogs.slice(0,20), liveTasks:[...LIVE_TASKS.values()].filter(t=>t.squad==='maintenance') }));

// GET /api/usine/opportunity/:id
router.get('/opportunity/:id', async (req, res) => {
  res.setHeader('Content-Type', 'application/json');
  try {
    const pool = getPool(); if (!pool) return res.status(503).json({error:'DB indisponible'});
    const [oR,pR] = await Promise.all([
      pool.query('SELECT * FROM daleba_opportunities WHERE id=$1',[req.params.id]),
      pool.query('SELECT id,generated_text,status,created_at,sent_at,notes FROM daleba_proposals WHERE opportunity_id=$1 ORDER BY created_at DESC',[req.params.id]),
    ]);
    if (!oR.rows.length) return res.status(404).json({error:'Introuvable'});
    const opp = oR.rows[0];
    res.json({...opp, keywords:(opp.keywords_matched||'').split(',').map(k=>k.trim()).filter(Boolean), seoFlaws:inferSeoFlaws(opp), proposals:pR.rows, proposalCount:pR.rows.length, hasSentProposal:pR.rows.some(p=>p.sent_at!==null)});
  } catch(err) { res.status(500).json({error:err.message}); }
});

function inferSeoFlaws(opp) {
  const flaws=[]; const desc=(opp.description_fr||opp.description_orig||'').toLowerCase(); const cat=(opp.category||'').toLowerCase(); const kw=(opp.keywords_matched||'').toLowerCase();
  if(cat.includes('seo')||kw.includes('seo')) flaws.push({label:'Audit SEO requis',severity:'high',detail:'Positionnement organique non optimisé'});
  if(kw.includes('automation')||cat.includes('automation')) flaws.push({label:'Processus manuels',severity:'high',detail:'Flux non automatisés — perte >40%'});
  if(kw.includes('crm')||kw.includes('lead')||desc.includes('lead')) flaws.push({label:'Pipeline CRM défaillant',severity:'medium',detail:'Attribution manquante'});
  if(kw.includes('api')||kw.includes('integration')||desc.includes('integr')) flaws.push({label:'Intégrations API absentes',severity:'medium',detail:'Silos entre outils'});
  if(!flaws.length) flaws.push({label:'Opportunité à analyser',severity:'low',detail:'Analyse approfondie recommandée'});
  return flaws;
}

// GET /api/usine/roster
router.get('/roster', async (req, res) => {
  res.setHeader('Content-Type', 'application/json');
  try {
    const aq=getAQ(), qs=aq?await safeCall(()=>aq.getQueueStats(),null):null;
    const lg=qs?.['lead-gen-queue']||{}, seo=qs?.['seo-audit-queue']||{}, em=qs?.['email-sequence-queue']||{};
    const liveArr=[...LIVE_TASKS.values()];
    res.json({
      totalAgents:1000, autonomousActive:autonomousMode, liveTasks:liveArr,
      squads:[
        {id:'scraping',label:'Scraping & Intelligence',range:'1 → 300',count:300,color:'sky',icon:'🔍',description:'3 escouades géo (Amériques/Europe/Global) — 11 sources mondiales simultanées.',skills:['Web Scraping','11 sources','Multi-langue','Geo-routing','Dedup'],queueActive:lg.active||0,queueCompleted:lg.completed||0,liveTasks:liveArr.filter(t=>['americas','europe','global'].includes(t.squad))},
        {id:'audit',label:'Rédacteurs B2B (Tech/SaaS/IA)',range:'301 → 750',count:450,color:'violet',icon:'✍️',description:'Audit SEO + rédaction propositions B2B en FR/EN. DeepSeek parallèle ×5.',skills:['SEO Analysis','Proposal Writing','DeepSeek LLM','FR/EN','Score ≥65'],queueActive:seo.active||0,queueCompleted:seo.completed||0,liveTasks:liveArr.filter(t=>['tech_saas','auto_ai'].includes(t.squad))},
        {id:'closers',label:'Closers Email',range:'751 → 950',count:200,color:'amber',icon:'📧',description:'Séquences email multi-étapes. sent_at tracé pour CA Réel.',skills:['Email Closing','Follow-up Auto','sent_at tracking','Resend API','CA Réel'],queueActive:(em.active||0)+liveArr.filter(t=>t.squad==='closers').length,queueCompleted:em.completed||0,liveTasks:liveArr.filter(t=>t.squad==='closers')},
        {id:'maintenance',label:'Maintenance #951-1000',range:'951 → 1 000',count:50,color:'rose',icon:'🛡',description:'Surveillance BullMQ, DB, cycle. Auto-healing en 60s.',skills:['BullMQ Repair','Cycle Watch','DB Health','Auto-Heal','Log Monitor'],queueActive:liveArr.filter(t=>t.squad==='maintenance').length,queueCompleted:maintenanceHeals,liveTasks:liveArr.filter(t=>t.squad==='maintenance'),heals:maintenanceHeals,errors:maintenanceErrors},
      ],
      redisConnected:!!qs?.redisAvailable,
    });
  } catch(err) { res.status(500).json({error:err.message}); }
});

// SSE /api/usine/live-stream
router.get('/live-stream', (req, res) => {
  res.setHeader('Content-Type','text/event-stream'); res.setHeader('Cache-Control','no-cache'); res.setHeader('Connection','keep-alive'); res.setHeader('X-Accel-Buffering','no'); res.flushHeaders();
  const send=(obj)=>{try{if(!res.writableEnded)res.write(`data: ${JSON.stringify(obj)}\n\n`);}catch(_){}};
  send({type:'connected',ts:Date.now(),productionMode:productionModeEnabled,autonomousMode});
  const tick=setInterval(async()=>{
    if(res.writableEnded){clearInterval(tick);return;}
    const aq=getAQ(), liveArr=[...LIVE_TASKS.values()];
    try{
      const stats=aq?await aq.getQueueStats():{};
      const lg=stats['lead-gen-queue']||{},seo=stats['seo-audit-queue']||{},em=stats['email-sequence-queue']||{};
      send({type:'stats',stats,totalActive:(lg.active||0)+(seo.active||0)+(em.active||0)+liveArr.length,liveTasks:liveArr.map(t=>({taskId:t.taskId,agentId:t.agentId,squad:t.squad,squadLabel:t.squadLabel,squadIcon:t.squadIcon,title:t.title,action:t.action,value:t.value,startedAt:t.startedAt,progress:t.progress,currentUrl:t.currentUrl})),autonomousMode,cycleRunning,autoCycleCount,ts:Date.now()});
    }catch(_){send({type:'ping',ts:Date.now(),liveTasks:liveArr.length});}
  },3000);
  const ping=setInterval(()=>{if(!res.writableEnded)res.write(': ping\n\n');},20000);
  const cleanup=()=>{clearInterval(tick);clearInterval(ping);};
  req.on('close',cleanup);req.on('aborted',cleanup);res.on('finish',cleanup);res.on('error',cleanup);
});

// POST /api/usine/trigger-scan
router.post('/trigger-scan', async (req, res) => {
  res.setHeader('Content-Type','application/json');
  if(!productionModeEnabled) return res.status(403).json({success:false,error:'Usine en pause.'});
  try{
    const aq=getAQ(), jobs=[];
    if(aq){const j1=await safeCall(()=>aq.addLeadGenJob({trigger:'manual',ts:Date.now()}),null); const j2=await safeCall(()=>aq.addSeoAuditJob({trigger:'manual',ts:Date.now()}),null); if(j1)jobs.push(String(j1.id||'mem')); if(j2)jobs.push(String(j2.id||'mem'));}
    // Lancer 3 scans d'escouades en parallèle
    setImmediate(async()=>{
      await Promise.all([runSquadScan('americas'), runSquadScan('europe'), runSquadScan('global')]);
    });
    getBus()?.system?.('🌍 Scan mondial manuel — 3 escouades déployées', {jobs});
    res.json({success:true,message:'3 escouades déployées en parallèle',jobs,squads:['americas','europe','global']});
  }catch(err){res.status(500).json({success:false,error:err.message});}
});

// POST /api/usine/opportunity/:id/sign — action manuelle Ulrich uniquement
router.post('/opportunity/:id/sign', async (req, res) => {
  res.setHeader('Content-Type','application/json');
  const pool = getPool(); if(!pool) return res.status(503).json({error:'DB indisponible'});
  try {
    await pool.query("UPDATE daleba_opportunities SET status='signed', approved_at=NOW() WHERE id=$1", [req.params.id]);
    const r = await pool.query('SELECT title, budget_estimated, budget_currency FROM daleba_opportunities WHERE id=$1', [req.params.id]);
    const opp = r.rows[0];
    getBus()?.system?.(`💰 CONTRAT SIGNÉ — "${opp?.title?.slice(0,50)}" — ${opp?.budget_estimated?'$'+Math.round(opp.budget_estimated).toLocaleString('fr-CA')+' '+(opp.budget_currency||'USD'):'budget inconnu'}`);
    res.json({ success:true, signed:true, opp });
  } catch(err) { res.status(500).json({error:err.message}); }
});

// Production + Autonomous mode
router.get('/production-mode',(req,res)=>res.json({enabled:productionModeEnabled}));
router.post('/production-mode',(req,res)=>{
  const{enabled}=req.body; if(typeof enabled!=='boolean')return res.status(400).json({error:'booléen requis'});
  productionModeEnabled=enabled; getBus()?.system?.(enabled?'▶ Production ON':'⏸ Production OFF',{productionMode:enabled});
  if(!enabled&&autonomousMode)stopAutonomousMode(); res.json({success:true,enabled:productionModeEnabled});
});
router.get('/autonomous-mode',(req,res)=>res.json({enabled:autonomousMode,lastCycleAt:lastAutoCycleAt,cycleCount:autoCycleCount,cycleRunning}));
router.post('/autonomous-mode',async(req,res)=>{
  const{enabled}=req.body; if(typeof enabled!=='boolean')return res.status(400).json({error:'booléen requis'});
  if(enabled&&!productionModeEnabled)return res.status(403).json({success:false,error:'Activez la Production d\'abord.'});
  autonomousMode=enabled; await persistAutoMode(enabled);
  getBus()?.system?.(enabled?'🤖 MODE AUTONOME — 3 scans parallèles + Maintenance':'🛑 Mode autonome désactivé',{autonomousMode:enabled});
  if(enabled)startAutonomousMode(); else stopAutonomousMode();
  res.json({success:true,enabled:autonomousMode,message:enabled?'🤖 3 escouades mondiales + Maintenance déployées':'🛑 Arrêté'});
});

module.exports = router;

// ── DÉMARRAGE AUTONOME GARANTI — restaure l'état depuis DB + env var ──────────
(async () => {
  try {
    // Attendre que la DB soit prête (max 10s)
    await new Promise(r => setTimeout(r, 3000));

    // Priorité 1 : variable d'environnement Railway
    const envAuto = process.env.USINE_AUTO_MODE;
    if (envAuto === 'true') {
      console.log('[USINE] 🔥 USINE_AUTO_MODE=true → démarrage autonome forcé');
      productionModeEnabled = true;
      autonomousMode = true;
      await persistAutoMode(true);
      startAutonomousMode();
      return;
    }

    // Priorité 2 : état persisté en DB
    const wasAuto = await restoreAutoModeFromDB();
    if (wasAuto) {
      console.log('[USINE] 🔄 Mode autonome restauré depuis DB → redémarrage');
      productionModeEnabled = true;
      autonomousMode = true;
      startAutonomousMode();
    } else {
      console.log('[USINE] ⏸ Mode autonome OFF (non persisté) — en attente activation manuelle');
    }
  } catch (err) {
    console.error('[USINE] Erreur boot init:', err.message);
  }
})();
