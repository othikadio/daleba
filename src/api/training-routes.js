/**
 * DALEBA — Training Routes (V31)
 * Endpoints pour ingestion de conversations historiques + stats
 *
 * POST /api/training/upload/whatsapp    → upload .txt WhatsApp
 * POST /api/training/upload/messenger   → upload JSON Messenger
 * POST /api/training/upload/instagram   → upload JSON Instagram
 * POST /api/training/raw                → ingestion tableau brut JSON
 * GET  /api/training/stats              → statistiques base d'entraînement
 * GET  /api/training/style-dna          → Style DNA extrait
 * GET  /api/training/few-shot/:intent   → Few-shot examples pour un intent
 */

const express   = require('express');
const router    = express.Router();
const multer    = require('multer');
const path      = require('path');
const fs        = require('fs');
const ingester  = require('../services/conversation-ingester');
const extractor = require('../services/style-extractor');

// Multer — stockage temporaire uploads
const upload = multer({
  dest: '/tmp/daleba-training/',
  limits: { fileSize: 50 * 1024 * 1024 }, // 50 MB max
  fileFilter: (_req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    if (['.txt', '.json'].includes(ext)) return cb(null, true);
    cb(new Error('Format non supporté. Utilisez .txt (WhatsApp) ou .json (Meta)'));
  },
});

const SALON_NAMES = ['Kadio Coiffure', 'Ulrich', 'Kadio', 'Salon Kadio'];

// ─── UPLOAD WHATSAPP ──────────────────────────────────────────────────────────
router.post('/upload/whatsapp', upload.single('file'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'Aucun fichier reçu' });
  try {
    const result = await ingester.ingestWhatsApp(req.file.path, SALON_NAMES);
    fs.unlink(req.file.path, () => {}); // cleanup
    res.json({ ok: true, source: 'whatsapp', ...result });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── UPLOAD MESSENGER ────────────────────────────────────────────────────────
router.post('/upload/messenger', upload.single('file'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'Aucun fichier reçu' });
  try {
    const result = await ingester.ingestMetaJSON(req.file.path, SALON_NAMES, 'messenger');
    fs.unlink(req.file.path, () => {});
    res.json({ ok: true, source: 'messenger', ...result });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── UPLOAD INSTAGRAM ────────────────────────────────────────────────────────
router.post('/upload/instagram', upload.single('file'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'Aucun fichier reçu' });
  try {
    const result = await ingester.ingestMetaJSON(req.file.path, SALON_NAMES, 'instagram');
    fs.unlink(req.file.path, () => {});
    res.json({ ok: true, source: 'instagram', ...result });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── INGESTION TABLEAU BRUT ───────────────────────────────────────────────────
/**
 * Body : { pairs: [{client_msg, staff_reply, source?}], source: "whatsapp" }
 * Utile pour copier-coller des conversations manuellement
 */
router.post('/raw', async (req, res) => {
  const { pairs, source = 'manual' } = req.body;
  if (!Array.isArray(pairs) || !pairs.length) {
    return res.status(400).json({ error: 'pairs[] requis et non vide' });
  }
  const normalized = pairs.map(p => ({
    ...p,
    source: p.source || source,
    client_msg:  p.client_msg  || p.input   || p.question || '',
    staff_reply: p.staff_reply || p.output  || p.answer   || '',
  })).filter(p => p.client_msg && p.staff_reply);

  try {
    const result = await ingester.ingestRaw(normalized);
    res.json({ ok: true, source, ...result });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── STATISTIQUES ─────────────────────────────────────────────────────────────
router.get('/stats', async (_req, res) => {
  try {
    const stats = await ingester.getStats();
    res.json(stats);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── STYLE DNA ────────────────────────────────────────────────────────────────
router.get('/style-dna', async (_req, res) => {
  try {
    const dna = await extractor.extractStyleDNA();
    if (!dna) return res.json({ message: 'Pas encore de données. Uploadez vos conversations d\'abord.' });
    res.json(dna);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── FEW-SHOT PREVIEW ─────────────────────────────────────────────────────────
router.get('/few-shot/:intent?', async (req, res) => {
  try {
    const block = await extractor.buildFewShotBlock(req.params.intent || null, 5);
    res.json({ intent: req.params.intent || 'all', preview: block || '(aucune donnée qualifiée)' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
