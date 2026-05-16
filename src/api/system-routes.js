/**
 * DALEBA — Routes Système : Journal + Rollback
 */

const express = require('express');
const router = express.Router();
const journal = require('../services/journal');
const rollback = require('../services/rollback');

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

module.exports = router;
