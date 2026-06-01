/**
 * DALEBA — Usine IA Live Routes
 * Flux de production en direct : stats queues, agents actifs, découvertes
 */
'use strict';

const express = require('express');
const router = express.Router();

// ── Helpers safe-require ──────────────────────────────────────────────────────

function safeGet(fn) {
  try { return fn(); } catch (_) { return null; }
}

// ── GET /api/usine/live-stats ─────────────────────────────────────────────────
// Snapshot complet: queues BullMQ + agents actifs + dernières opportunités DB

router.get('/live-stats', async (req, res) => {
  try {
    const { pool } = require('../memory/db');

    // 1. Queue stats BullMQ / fallback mémoire
    let queueStats = { 'lead-gen-queue': {}, 'seo-audit-queue': {}, 'email-sequence-queue': {}, redisAvailable: false };
    try {
      const aq = require('../workers/agent-queue');
      queueStats = await aq.getQueueStats();
    } catch (_) {}

    // 2. Agent Manager live agents
    let managerStatus = { stats: { liveAgents: 0, totalSpawned: 0, totalCompleted: 0, totalFailed: 0 }, agents: [] };
    try {
      const mgr = require('../services/agent-manager');
      managerStatus = mgr.getStatus();
    } catch (_) {}

    // 3. Swarm status
    let swarmStatus = { stats: { activeAgents: 0, totalCreated: 0, totalCompleted: 0 }, agents: [], queue: 0 };
    try {
      const swarm = require('../services/swarm');
      swarmStatus = swarm.getSwarmStatus();
    } catch (_) {}

    // 4. Dernières opportunités de la DB (vraies découvertes)
    let recentOpps = [];
    try {
      const r = await pool.query(`
        SELECT id, title, country, category, score, source_platform, created_at, budget_estimated, budget_currency
        FROM daleba_opportunities
        ORDER BY created_at DESC LIMIT 15
      `);
      recentOpps = r.rows;
    } catch (_) {}

    // 5. Totaux DB
    let totals = { opportunities: 0, proposals: 0 };
    try {
      const [oR, pR] = await Promise.all([
        pool.query('SELECT COUNT(*) FROM daleba_opportunities'),
        pool.query('SELECT COUNT(*) FROM daleba_proposals'),
      ]);
      totals.opportunities = parseInt(oR.rows[0].count) || 0;
      totals.proposals = parseInt(pR.rows[0].count) || 0;
    } catch (_) {}

    // 6. Recent event-bus events
    let recentEvents = [];
    try {
      const bus = require('../services/event-bus');
      recentEvents = bus.getRecent(20);
    } catch (_) {}

    // 7. Calcul charge globale
    const lgW = queueStats['lead-gen-queue']?.waiting || 0;
    const lgA = queueStats['lead-gen-queue']?.active || 0;
    const seoW = queueStats['seo-audit-queue']?.waiting || 0;
    const seoA = queueStats['seo-audit-queue']?.active || 0;
    const emW = queueStats['email-sequence-queue']?.waiting || 0;
    const emA = queueStats['email-sequence-queue']?.active || 0;

    const totalActive = lgA + seoA + emA + managerStatus.stats.liveAgents + swarmStatus.stats.activeAgents;
    const totalWaiting = lgW + seoW + emW + swarmStatus.queue;

    res.json({
      ts: Date.now(),
      redisConnected: queueStats.redisAvailable,
      agents: {
        active: totalActive,
        waiting: totalWaiting,
        capacity: 1000,
        liveManager: managerStatus.stats.liveAgents,
        swarmActive: swarmStatus.stats.activeAgents,
      },
      queues: {
        leadGen:       { waiting: lgW, active: lgA, completed: queueStats['lead-gen-queue']?.completed || 0, failed: queueStats['lead-gen-queue']?.failed || 0 },
        seoAudit:      { waiting: seoW, active: seoA, completed: queueStats['seo-audit-queue']?.completed || 0, failed: queueStats['seo-audit-queue']?.failed || 0 },
        emailSequence: { waiting: emW, active: emA, completed: queueStats['email-sequence-queue']?.completed || 0, failed: queueStats['email-sequence-queue']?.failed || 0 },
      },
      totals,
      recentOpps,
      recentEvents: recentEvents.slice(0, 15),
      swarmAgents: swarmStatus.agents.slice(0, 20),
      managerAgents: managerStatus.agents.slice(0, 20),
    });

  } catch (err) {
    console.error('[usine-live] live-stats error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ── GET /api/usine/live-stream ────────────────────────────────────────────────
// SSE dédié à l'Usine — push stats toutes les 3s + événements bus temps réel

router.get('/live-stream', (req, res) => {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');
  res.flushHeaders();

  // Ping initial
  res.write(`data: ${JSON.stringify({ type: 'connected', ts: Date.now() })}\n\n`);

  // Abonner aux événements du bus global
  let busListener = null;
  try {
    const bus = require('../services/event-bus');
    const { ipcBus } = require('../services/agent-manager');

    // Re-push chaque événement bus vers ce client SSE
    busListener = (entry) => {
      if (!res.writableEnded) {
        res.write(`data: ${JSON.stringify({ type: 'bus', ...entry })}\n\n`);
      }
    };
    // Écoute les événements bruts de l'event-bus via ipcBus
    ipcBus.on('agent:state', (d) => {
      if (!res.writableEnded) {
        res.write(`data: ${JSON.stringify({ type: 'agent_state', ...d })}\n\n`);
      }
    });
    ipcBus.on('agent:done', (d) => {
      if (!res.writableEnded) {
        res.write(`data: ${JSON.stringify({ type: 'agent_done', ...d })}\n\n`);
      }
    });
  } catch (_) {}

  // Push stats toutes les 4 secondes
  const statInterval = setInterval(async () => {
    if (res.writableEnded) { clearInterval(statInterval); return; }
    try {
      const aq = require('../workers/agent-queue');
      const stats = await aq.getQueueStats();
      const mgr = require('../services/agent-manager');
      const ms = mgr.getStatus();
      res.write(`data: ${JSON.stringify({ type: 'stats', stats, liveAgents: ms.stats.liveAgents, ts: Date.now() })}\n\n`);
    } catch (_) {
      res.write(`data: ${JSON.stringify({ type: 'ping', ts: Date.now() })}\n\n`);
    }
  }, 4000);

  // Keepalive
  const pingInterval = setInterval(() => {
    if (!res.writableEnded) res.write(': ping\n\n');
  }, 25000);

  const cleanup = () => {
    clearInterval(statInterval);
    clearInterval(pingInterval);
  };
  req.on('close', cleanup);
  req.on('aborted', cleanup);
  res.on('finish', cleanup);
  res.on('error', cleanup);
});

// ── POST /api/usine/trigger-scan ──────────────────────────────────────────────
// Force un cycle de scan immédiat (pour le bouton "Lancer un scan")

router.post('/trigger-scan', async (req, res) => {
  try {
    const aq = require('../workers/agent-queue');
    const job = await aq.addLeadGenJob({ trigger: 'manual', ts: Date.now(), source: 'admin-usine' });
    const job2 = await aq.addSeoAuditJob({ trigger: 'manual', ts: Date.now(), source: 'admin-usine' });
    // Tenter un scan opportunités en background
    setImmediate(async () => {
      try {
        const { runOpportunityWorker } = require('../workers/opportunity-worker');
        if (typeof runOpportunityWorker === 'function') await runOpportunityWorker();
      } catch (_) {}
    });
    res.json({ success: true, jobs: [job?.id, job2?.id], message: 'Scan déclenché' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
