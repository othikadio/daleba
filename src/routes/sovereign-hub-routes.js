// src/routes/sovereign-hub-routes.js
// Routes API — Hub Souverain Multi-Agents DALEBA v2
'use strict';

const express = require('express');
const router  = express.Router();
const multer  = require('multer');
const fleet   = require('../services/sovereign-fleet');

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 20 * 1024 * 1024 } });

// GET /api/sovereign/status
router.get('/status', (req, res) => {
  res.json({
    ok: true,
    fleet: fleet.getFleetStatus(),
    available: fleet.getAvailableModels(),
    timestamp: new Date().toISOString(),
  });
});

// POST /api/sovereign/chat
router.post('/chat', async (req, res) => {
  try {
    const { messages, forceModel, taskHint, systemPrompt, docContext } = req.body;
    if (!messages || !Array.isArray(messages) || messages.length === 0) {
      return res.status(400).json({ ok: false, error: 'messages array required' });
    }

    // Injecter le contexte documentaire dans le dernier message utilisateur
    let enrichedMessages = [...messages];
    if (docContext && docContext.trim()) {
      const last = enrichedMessages[enrichedMessages.length - 1];
      if (last.role === 'user') {
        enrichedMessages[enrichedMessages.length - 1] = {
          ...last,
          content: `[DOCUMENT PARTAGÉ]\n${docContext.trim()}\n\n[INSTRUCTION]\n${last.content}`,
        };
      }
    }

    const result = await fleet.route(enrichedMessages, { forceModel, taskHint, systemPrompt });
    res.json({ ok: true, ...result });
  } catch (err) {
    console.error('[SovereignHub] chat error:', err);
    res.status(500).json({ ok: false, error: err.message });
  }
});

// POST /api/sovereign/upload — extraction texte depuis fichier (PDF, TXT, code)
router.post('/upload', upload.single('file'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ ok: false, error: 'Aucun fichier reçu' });

    const { originalname, mimetype, buffer } = req.file;
    let text = '';

    if (mimetype === 'application/pdf') {
      try {
        const pdfParse = require('pdf-parse');
        const data = await pdfParse(buffer);
        text = data.text;
      } catch (e) {
        text = `[Erreur lecture PDF: ${e.message}]`;
      }
    } else if (
      mimetype.startsWith('text/') ||
      mimetype === 'application/json' ||
      mimetype === 'application/javascript' ||
      originalname.match(/\.(js|ts|py|md|txt|csv|json|html|css|sql|sh|env|yaml|yml)$/i)
    ) {
      text = buffer.toString('utf-8');
    } else {
      text = `[Fichier binaire: ${originalname} — contenu non extractible automatiquement]`;
    }

    // Limiter à 40 000 chars pour éviter de saturer le contexte
    if (text.length > 40000) {
      text = text.slice(0, 40000) + '\n\n[... contenu tronqué à 40 000 caractères]';
    }

    res.json({ ok: true, filename: originalname, chars: text.length, text });
  } catch (err) {
    console.error('[SovereignHub] upload error:', err);
    res.status(500).json({ ok: false, error: err.message });
  }
});

// GET /api/sovereign/detect
router.get('/detect', (req, res) => {
  const { q } = req.query;
  const task    = fleet.detectTask(q || '');
  const routing = fleet.ROUTING_MATRIX[task] || fleet.ROUTING_MATRIX.default;
  res.json({ task, routing, available: routing.filter(id => fleet.FLEET[id]?.available()) });
});

module.exports = router;
