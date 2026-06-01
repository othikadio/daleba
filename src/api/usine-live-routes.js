/**
 * DALEBA — Usine IA Live Routes v2
 * Endpoints :
 *   GET  /api/usine/live-stats      — snapshot complet
 *   GET  /api/usine/live-stream     — SSE temps réel
 *   POST /api/usine/trigger-scan    — scan international manuel
 *   GET  /api/usine/production-mode — état du switch ON/OFF
 *   POST /api/usine/production-mode — basculer ON/OFF
 */
'use strict';

const express = require('express');
const router  = express.Router();

// ── Switch ON/OFF (en mémoire + variable d'env optionnelle) ──────────────────
let productionModeEnabled = process.env.USINE_PRODUCTION_MODE !== 'false';

// ── Helpers robustes ─────────────────────────────────────────────────────────

function safeRequire(mod) {
  try { return require(mod); } catch (_) { return null; }
}

async function safeCall(fn, fallback) {
  try { return await fn(); } catch (_) { return fallback; }
}

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/usine/live-stats
// ─────────────────────────────────────────────────────────────────────────────

router.get('/live-stats', async (req, res) => {
  res.setHeader('Content-Type', 'application/json');
  try {
    const db  = safeRequire('../memory/db');
    const pool = db?.pool || null;

    // 1. Queue stats BullMQ
    let queueStats = {
      'lead-gen-queue':       { waiting: 0, active: 0, completed: 0, failed: 0 },
      'seo-audit-queue':      { waiting: 0, active: 0, completed: 0, failed: 0 },
      'email-sequence-queue': { waiting: 0, active: 0, completed: 0, failed: 0 },
      redisAvailable: false,
    };
    const aq = safeRequire('../workers/agent-queue');
    if (aq) {
      queueStats = await safeCall(() => aq.getQueueStats(), queueStats);
    }

    // 2. Agent manager
    let managerStats = { liveAgents: 0, totalSpawned: 0, totalCompleted: 0, totalFailed: 0 };
    let managerAgents = [];
    const mgr = safeRequire('../services/agent-manager');
    if (mgr) {
      const ms = await safeCall(() => mgr.getStatus(), null);
      if (ms) { managerStats = ms.stats || managerStats; managerAgents = ms.agents || []; }
    }

    // 3. Swarm
    let swarmStats  = { activeAgents: 0, totalCreated: 0, totalCompleted: 0 };
    let swarmAgents = [];
    const swarm = safeRequire('../services/swarm');
    if (swarm) {
      const ss = await safeCall(() => swarm.getSwarmStatus(), null);
      if (ss) { swarmStats = ss.stats || swarmStats; swarmAgents = ss.agents || []; }
    }

    // 4. Dernières opportunités DB
    let recentOpps = [];
    if (pool) {
      const r = await safeCall(() => pool.query(`
        SELECT id, title, country, category, score, source_platform,
               created_at, budget_estimated, budget_currency
        FROM daleba_opportunities
        ORDER BY created_at DESC LIMIT 15
      `), { rows: [] });
      recentOpps = r.rows || [];
    }

    // 5. Totaux DB
    let totals = { opportunities: 0, proposals: 0 };
    if (pool) {
      const [oR, pR] = await Promise.allSettled([
        pool.query('SELECT COUNT(*)::int as n FROM daleba_opportunities'),
        pool.query('SELECT COUNT(*)::int as n FROM daleba_proposals'),
      ]);
      totals.opportunities = oR.status === 'fulfilled' ? (oR.value.rows[0]?.n || 0) : 0;
      totals.proposals     = pR.status === 'fulfilled' ? (pR.value.rows[0]?.n || 0) : 0;
    }

    // 6. Événements récents event-bus
    let recentEvents = [];
    const bus = safeRequire('../services/event-bus');
    if (bus) {
      recentEvents = await safeCall(() => bus.getRecent(20), []);
    }

    // 7. Calcul charge globale
    const lg  = queueStats['lead-gen-queue'];
    const seo = queueStats['seo-audit-queue'];
    const em  = queueStats['email-sequence-queue'];

    const totalActive  = (lg.active||0) + (seo.active||0) + (em.active||0)
                       + (managerStats.liveAgents||0) + (swarmStats.activeAgents||0);
    const totalWaiting = (lg.waiting||0) + (seo.waiting||0) + (em.waiting||0);

    res.json({
      ts: Date.now(),
      productionMode: productionModeEnabled,
      redisConnected: !!queueStats.redisAvailable,
      agents: {
        active:      totalActive,
        waiting:     totalWaiting,
        capacity:    1000,
        liveManager: managerStats.liveAgents  || 0,
        swarmActive: swarmStats.activeAgents  || 0,
      },
      queues: {
        leadGen:       { waiting: lg.waiting||0,  active: lg.active||0,  completed: lg.completed||0,  failed: lg.failed||0  },
        seoAudit:      { waiting: seo.waiting||0, active: seo.active||0, completed: seo.completed||0, failed: seo.failed||0 },
        emailSequence: { waiting: em.waiting||0,  active: em.active||0,  completed: em.completed||0,  failed: em.failed||0  },
      },
      totals,
      recentOpps,
      recentEvents: recentEvents.slice(0, 15),
      swarmAgents:  swarmAgents.slice(0, 20),
      managerAgents: managerAgents.slice(0, 20),
    });

  } catch (err) {
    console.error('[usine-live] live-stats:', err.message);
    res.status(500).json({ error: 'Erreur interne', detail: err.message });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/usine/live-stream — SSE
// ─────────────────────────────────────────────────────────────────────────────

router.get('/live-stream', (req, res) => {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');
  res.flushHeaders();

  const send = (obj) => {
    if (!res.writableEnded) {
      try { res.write(`data: ${JSON.stringify(obj)}\n\n`); } catch (_) {}
    }
  };

  send({ type: 'connected', ts: Date.now(), productionMode: productionModeEnabled });

  // Écoute ipcBus agent-manager
  const ipcListeners = [];
  const mgr = safeRequire('../services/agent-manager');
  if (mgr?.ipcBus) {
    const onState = (d) => send({ type: 'agent_state', ...d });
    const onDone  = (d) => send({ type: 'agent_done',  ...d });
    mgr.ipcBus.on('agent:state', onState);
    mgr.ipcBus.on('agent:done',  onDone);
    ipcListeners.push(() => { mgr.ipcBus.off('agent:state', onState); mgr.ipcBus.off('agent:done', onDone); });
  }

  // Push stats toutes les 5s
  const statInterval = setInterval(async () => {
    if (res.writableEnded) { clearInterval(statInterval); return; }
    const aq = safeRequire('../workers/agent-queue');
    if (!aq) { send({ type: 'ping', ts: Date.now() }); return; }
    try {
      const stats = await aq.getQueueStats();
      const m = mgr ? await safeCall(() => mgr.getStatus(), null) : null;
      send({ type: 'stats', stats, liveAgents: m?.stats?.liveAgents || 0, ts: Date.now() });
    } catch (_) {
      send({ type: 'ping', ts: Date.now() });
    }
  }, 5000);

  // Keepalive toutes les 20s
  const pingInterval = setInterval(() => {
    if (!res.writableEnded) res.write(': ping\n\n');
  }, 20000);

  const cleanup = () => {
    clearInterval(statInterval);
    clearInterval(pingInterval);
    ipcListeners.forEach(fn => { try { fn(); } catch (_) {} });
  };
  req.on('close',   cleanup);
  req.on('aborted', cleanup);
  res.on('finish',  cleanup);
  res.on('error',   cleanup);
});

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/usine/trigger-scan
// ─────────────────────────────────────────────────────────────────────────────

router.post('/trigger-scan', async (req, res) => {
  res.setHeader('Content-Type', 'application/json');
  try {
    if (!productionModeEnabled) {
      return res.status(403).json({ success: false, error: "L'Usine est en mode PAUSE. Activez la production d'abord." });
    }

    const results = { jobs: [], scanStarted: false };

    // Ajouter jobs dans BullMQ si dispo
    const aq = safeRequire('../workers/agent-queue');
    if (aq) {
      const j1 = await safeCall(() => aq.addLeadGenJob({ trigger: 'manual', ts: Date.now() }), null);
      const j2 = await safeCall(() => aq.addSeoAuditJob({ trigger: 'manual', ts: Date.now() }), null);
      if (j1) results.jobs.push(String(j1.id || 'mem'));
      if (j2) results.jobs.push(String(j2.id || 'mem'));
    }

    // Lancer le worker opportunity en background (non-bloquant)
    setImmediate(async () => {
      try {
        const ow = safeRequire('../workers/opportunity-worker');
        if (ow?.runOpportunityWorker) {
          await ow.runOpportunityWorker();
        }
      } catch (e) {
        console.warn('[trigger-scan] opportunity-worker:', e.message);
      }
    });
    results.scanStarted = true;

    // Émettre sur l'event-bus
    const bus = safeRequire('../services/event-bus');
    if (bus?.system) bus.system('🌍 Scan international déclenché manuellement', { jobs: results.jobs });

    res.json({ success: true, message: 'Scan déclenché', ...results });

  } catch (err) {
    console.error('[trigger-scan]', err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// GET  /api/usine/production-mode
// POST /api/usine/production-mode  { enabled: true|false }
// ─────────────────────────────────────────────────────────────────────────────

router.get('/production-mode', (req, res) => {
  res.json({ enabled: productionModeEnabled, ts: Date.now() });
});

router.post('/production-mode', (req, res) => {
  res.setHeader('Content-Type', 'application/json');
  const { enabled } = req.body;
  if (typeof enabled !== 'boolean') {
    return res.status(400).json({ error: 'enabled doit être un booléen' });
  }
  productionModeEnabled = enabled;

  const bus = safeRequire('../services/event-bus');
  const label = enabled ? '▶ Usine IA activée — Production ON' : '⏸ Usine IA en pause — Production OFF';
  if (bus?.system) bus.system(label, { productionMode: enabled });

  console.log(`[USINE] Production mode: ${enabled ? 'ON' : 'OFF'}`);
  res.json({ success: true, enabled: productionModeEnabled, label });
});

module.exports = router;
