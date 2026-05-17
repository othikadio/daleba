/**
 * DALEBA — Routes Système : Journal + Rollback + Deploy + Auto-Apply
 */

const express = require('express');
const router = express.Router();
const journal = require('../services/journal');
const rollback = require('../services/rollback');
const { triggerDeploy, getDeployStatus } = require('../services/cicd');
const { logError } = require('../services/error-monitor');
const fs = require('fs');
const path = require('path');

const DALEBA_MASTER_KEY = process.env.DALEBA_MASTER_KEY;

function requireMasterKey(req, res, next) {
  const key = req.headers['x-master-key'] || req.body?.masterKey;
  if (!DALEBA_MASTER_KEY || key !== DALEBA_MASTER_KEY) {
    return res.status(403).json({ error: 'Clé maître invalide' });
  }
  next();
}

// ─── JOURNAL DE BORD ────────────────────────────────────────────────

// GET /api/system/journal — Journal du jour (ou d'une date)
router.get('/journal', async (req, res) => {
  const { date } = req.query;
  try {
    const entries = await journal.getDailyJournal(date);
    res.json({ date: date || new Date().toISOString().slice(0, 10), entries });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/system/journal/report — Rapport markdown du jour
router.get('/journal/report', async (req, res) => {
  const { date } = req.query;
  try {
    const report = await journal.generateDailyReport(date);
    res.type('text/plain').send(report);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/system/journal/curve — Courbe d'apprentissage (30 derniers jours)
router.get('/journal/curve', async (req, res) => {
  const days = parseInt(req.query.days) || 30;
  try {
    const curve = await journal.getLearningCurve(days);
    res.json({ days, curve });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/system/journal — Ajouter une entrée manuellement
router.post('/journal', async (req, res) => {
  const { type, summary, detail, metadata } = req.body;
  if (!type || !summary) {
    return res.status(400).json({ error: 'type et summary requis' });
  }
  try {
    await journal.logEntry(type, summary, detail, metadata);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── ROLLBACK VOCAL ─────────────────────────────────────────────────

// GET /api/system/commits — Voir les derniers commits
router.get('/commits', async (req, res) => {
  try {
    const commits = await rollback.getRecentCommits(10);
    res.json({ commits });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/system/rollback — Rollback du dernier commit (vocal ou manuel)
router.post('/rollback', async (req, res) => {
  const { masterKey, reason, targetHash } = req.body;

  if (!masterKey) {
    return res.status(400).json({ error: 'masterKey requis' });
  }

  try {
    let result;
    if (targetHash) {
      result = await rollback.rollbackToCommit(targetHash, masterKey);
    } else {
      result = await rollback.rollbackLast(masterKey, reason || 'Rollback demandé via API');
    }
    res.json(result);
  } catch (err) {
    res.status(403).json({ error: err.message });
  }
});

// POST /api/system/vocal-command — Interprète une commande vocale DALEBA
// Point d'entrée pour les commandes comme "DALEBA, annule ça"
router.post('/vocal-command', async (req, res) => {
  const { message, masterKey } = req.body;

  if (!message) {
    return res.status(400).json({ error: 'message requis' });
  }

  // Détection rollback
  if (rollback.detectRollbackIntent(message)) {
    if (!masterKey) {
      return res.status(400).json({
        intent: 'rollback',
        error: 'masterKey requis pour confirmer le rollback',
      });
    }
    try {
      const result = await rollback.rollbackLast(masterKey, `Commande vocale: "${message}"`);
      return res.json({ intent: 'rollback', ...result });
    } catch (err) {
      return res.status(403).json({ intent: 'rollback', error: err.message });
    }
  }

  res.json({ intent: 'unknown', message: 'Commande non reconnue' });
});

// ─── DEPLOY (Point 15) ──────────────────────────────────────────────────

// POST /api/system/deploy — Déclenche un redeploy Vercel
router.post('/deploy', requireMasterKey, async (req, res) => {
  const { reason } = req.body;
  try {
    const result = await triggerDeploy(reason || 'Manual deploy via API');
    res.json(result);
  } catch (err) {
    logError(err, 'DEPLOY_TRIGGER');
    res.status(500).json({ error: err.message });
  }
});

// GET /api/system/deploy/status — Statut du dernier déploiement
router.get('/deploy/status', async (req, res) => {
  try {
    const status = await getDeployStatus();
    res.json(status);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── AUTO-APPLY (Point 16) ────────────────────────────────────────────────

// POST /api/system/auto-apply — Applique du CSS/JS/config en live
router.post('/auto-apply', requireMasterKey, async (req, res) => {
  const { type, target, content } = req.body;

  if (!type || !target || !content) {
    return res.status(400).json({ error: 'type, target et content requis' });
  }

  const allowedTypes = ['css', 'js', 'config'];
  if (!allowedTypes.includes(type)) {
    return res.status(400).json({ error: `type doit être: ${allowedTypes.join('|')}` });
  }

  try {
    // Déterminer le dossier cible
    const baseDir = type === 'config'
      ? path.join(__dirname, '../../src')
      : path.join(__dirname, '../../public', type === 'css' ? 'css' : 'js');

    const filePath = path.join(baseDir, target);

    // Sécurité : rester dans le dossier autorisé
    if (!filePath.startsWith(path.join(__dirname, '../..')) ) {
      return res.status(403).json({ error: 'Chemin non autorisé' });
    }

    // Créer les dossiers parents si nécessaire
    const dir = path.dirname(filePath);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

    // Écrire le fichier
    fs.writeFileSync(filePath, content, 'utf8');

    // Log dans les annales
    const logEntry = {
      timestamp: new Date().toISOString(),
      type,
      target,
      appliedBy: 'auto',
      contentLength: content.length,
    };

    const annalesDir = path.join(__dirname, '../../logs');
    if (!fs.existsSync(annalesDir)) fs.mkdirSync(annalesDir, { recursive: true });
    const annalesFile = path.join(annalesDir, `annales-${new Date().toISOString().slice(0, 10)}.json`);
    let annales = [];
    if (fs.existsSync(annalesFile)) {
      try { annales = JSON.parse(fs.readFileSync(annalesFile, 'utf8')); } catch { annales = []; }
    }
    annales.push(logEntry);
    fs.writeFileSync(annalesFile, JSON.stringify(annales, null, 2));

    console.log(`📝 Auto-apply: ${type}/${target} (${content.length} chars)`);

    // Déclencher un deploy si ce n'est pas du CSS pur
    let deployResult = null;
    if (type !== 'css') {
      deployResult = await triggerDeploy(`Auto-apply: ${type}/${target}`).catch(() => null);
    }

    res.json({
      success: true,
      applied: logEntry,
      deploy: deployResult,
    });

  } catch (err) {
    logError(err, 'AUTO_APPLY');
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
