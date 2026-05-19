/**
 * DALEBA — Routes Commandant (Points 065-070)
 * /api/commander/* — Dashboard Swarm, déploiement 1-clic, rollback global
 */

'use strict';

const express = require('express');
const router  = express.Router();
const swarm   = require('../services/swarm');
const dae     = require('../services/dae');
const shield  = require('../services/notification-shield');

// ─── SWARM DASHBOARD [065] ────────────────────────────────────────────────────

// GET /api/commander/swarm-status
router.get('/swarm-status', (req, res) => {
  res.json(swarm.getSwarmStatus());
});

// POST /api/commander/swarm/create — Crée un micro-agent
router.post('/swarm/create', async (req, res) => {
  const { type, task, payload, scope, timeout } = req.body;
  if (!task) return res.status(400).json({ error: 'task requis' });

  const agentId = swarm.createAgent({ type: type || 'GENERIC', task, payload, scope, timeout });
  res.json({ agentId, status: 'QUEUED' });
});

// POST /api/commander/swarm/kill/:agentId — Tue un agent [064]
router.post('/swarm/kill/:agentId', (req, res) => {
  const killed = swarm.killAgent(req.params.agentId, 'manual_kill');
  res.json({ killed, agentId: req.params.agentId });
});

// POST /api/commander/swarm/orchestrate — Lance une orchestration complexe [060]
router.post('/swarm/orchestrate', async (req, res) => {
  const { masterTask, subtasks } = req.body;
  if (!masterTask || !Array.isArray(subtasks) || subtasks.length === 0) {
    return res.status(400).json({ error: 'masterTask et subtasks[] requis' });
  }

  const masterAgentId = await swarm.orchestrate(masterTask, subtasks);
  res.json({ masterAgentId, subtasksCount: subtasks.length, status: 'RUNNING' });
});

// ─── DÉPLOIEMENT 1-CLIC [066, 067, 068] ──────────────────────────────────────

// POST /api/commander/deploy — Déploie un patch validé par le Commandant
router.post('/deploy', async (req, res) => {
  const { filePath, newContent, commitMessage, approvedBy } = req.body;

  if (!filePath || !newContent || !commitMessage) {
    return res.status(400).json({ error: 'filePath, newContent, commitMessage requis' });
  }

  try {
    const result = await dae.deployPatch(
      { filePath, newContent },
      commitMessage,
      { approvedBy }
    );
    res.json({ success: true, ...result });
  } catch (err) {
    res.status(500).json({ error: err.message, rollbackApplied: true });
  }
});

// ─── ROLLBACK [069] ──────────────────────────────────────────────────────────

// GET /api/commander/history — Historique des déploiements
router.get('/history', async (req, res) => {
  try {
    const history = await dae.getDeployHistory(req.query.n || 15);
    res.json({ history });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/commander/rollback — Rollback vers un commit précédent
router.post('/rollback', async (req, res) => {
  const { commitHash, confirm } = req.body;
  if (!commitHash) return res.status(400).json({ error: 'commitHash requis' });
  if (confirm !== true) return res.status(400).json({ error: 'confirm: true requis pour protection' });

  try {
    const result = await dae.rollbackToCommit(commitHash);
    res.json({ success: true, ...result });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── ARBORESCENCE [052] ──────────────────────────────────────────────────────

// GET /api/commander/tree — Scan de l'arborescence du projet
router.get('/tree', async (req, res) => {
  try {
    const tree = await dae.scanTree(req.query.dir || 'src', { maxDepth: req.query.depth || 3 });
    res.json({ root: req.query.dir || 'src', tree });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── NOTIFICATION SHIELD [071, 072] ──────────────────────────────────────────

// GET /api/commander/shield-status
router.get('/shield-status', (req, res) => {
  res.json(shield.getShieldStatus());
});

// POST /api/commander/shield-clear — Reset shield (admin)
router.post('/shield-clear', (req, res) => {
  shield.clearShield(req.body.type || null);
  res.json({ success: true, cleared: req.body.type || 'all' });
});

// ─── BACKUP [070] ────────────────────────────────────────────────────────────

// GET /api/commander/backups — Liste les backups disponibles
router.get('/backups', async (req, res) => {
  const { file } = req.query;
  if (!file) return res.status(400).json({ error: 'file requis (chemin relatif)' });

  const backups = await dae.listBackups(file);
  res.json({ file, backups: backups.map(b => ({ path: b, name: require('path').basename(b) })) });
});

// POST /api/commander/restore — Restaure un backup
router.post('/restore', async (req, res) => {
  const { backupPath, targetPath } = req.body;
  if (!backupPath || !targetPath) return res.status(400).json({ error: 'backupPath et targetPath requis' });

  try {
    await dae.restoreBackup(backupPath, targetPath);
    res.json({ success: true, restored: targetPath });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
