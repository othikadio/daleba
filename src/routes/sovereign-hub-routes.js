// src/routes/sovereign-hub-routes.js
// Routes API — Hub Souverain + Agent Autonome DALEBA v2.0
'use strict';

const express = require('express');
const router  = express.Router();
const multer  = require('multer');
const fleet   = require('../services/sovereign-fleet');
const agent   = require('../services/sovereign-agent');

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 20 * 1024 * 1024 } });

// ── STATUT DE LA FLOTTE ───────────────────────────────────────────────────────
router.get('/status', (req, res) => {
  res.json({
    ok: true,
    fleet:     fleet.getFleetStatus(),
    available: fleet.getAvailableModels(),
    timestamp: new Date().toISOString(),
  });
});

// ── CHAT STANDARD (multi-modèles) ─────────────────────────────────────────────
router.post('/chat', async (req, res) => {
  try {
    const { messages, forceModel, taskHint, systemPrompt, docContext } = req.body;
    if (!messages || !Array.isArray(messages) || messages.length === 0) {
      return res.status(400).json({ ok: false, error: 'messages array required' });
    }
    let enrichedMessages = [...messages];
    if (docContext && docContext.trim()) {
      const last = enrichedMessages[enrichedMessages.length - 1];
      if (last.role === 'user') {
        enrichedMessages[enrichedMessages.length - 1] = {
          ...last,
          content: `[DOCUMENT]\n${docContext.trim()}\n\n[INSTRUCTION]\n${last.content}`,
        };
      }
    }
    const result = await fleet.route(enrichedMessages, { forceModel, taskHint, systemPrompt });
    res.json({ ok: true, ...result });
  } catch (err) {
    console.error('[SovereignHub] chat error:', err.message);
    res.status(500).json({ ok: false, error: err.message });
  }
});

// ── UPLOAD DOCUMENT ───────────────────────────────────────────────────────────
router.post('/upload', upload.single('file'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ ok: false, error: 'Aucun fichier reçu' });
    const { originalname, mimetype, buffer } = req.file;
    let text = '';
    if (mimetype === 'application/pdf') {
      try { const pdfParse = require('pdf-parse'); const d = await pdfParse(buffer); text = d.text; }
      catch (e) { text = `[Erreur PDF: ${e.message}]`; }
    } else if (
      mimetype.startsWith('text/') || mimetype === 'application/json' ||
      originalname.match(/\.(js|ts|py|md|txt|csv|json|html|css|sql|sh|env|yaml|yml)$/i)
    ) {
      text = buffer.toString('utf-8');
    } else {
      text = `[Fichier binaire: ${originalname}]`;
    }
    if (text.length > 40000) text = text.slice(0, 40000) + '\n\n[... tronqué]';
    res.json({ ok: true, filename: originalname, chars: text.length, text });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

// ── DÉTECTION DE TÂCHE ────────────────────────────────────────────────────────
router.get('/detect', (req, res) => {
  const { q } = req.query;
  const task    = fleet.detectTask(q || '');
  const routing = fleet.ROUTING_MATRIX[task] || fleet.ROUTING_MATRIX.default;
  res.json({ task, routing, available: routing.filter(id => fleet.FLEET[id]?.available()) });
});

// ══════════════════════════════════════════════════════════════════════════════
// AGENT AUTONOME — Routes d'exécution A→Z
// ══════════════════════════════════════════════════════════════════════════════

// POST /api/sovereign/agent — Démarrer une tâche autonome
router.post('/agent', async (req, res) => {
  try {
    const { task } = req.body;
    if (!task || !task.trim()) {
      return res.status(400).json({ ok: false, error: 'task requis' });
    }
    const sessionId = agent.createSession(task.trim());
    agent.startAgent(sessionId);
    res.json({ ok: true, sessionId, message: 'Agent démarré — connecte-toi au stream SSE pour suivre la progression' });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

// GET /api/sovereign/agent/:id/stream — SSE temps réel
router.get('/agent/:id/stream', (req, res) => {
  const { id } = req.params;
  const emitter = agent.getEmitter(id);
  if (!emitter) return res.status(404).json({ ok: false, error: 'Session introuvable' });

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.flushHeaders();

  // Envoyer le statut initial
  const status = agent.getSessionStatus(id);
  res.write(`data: ${JSON.stringify({ type: 'init', data: status })}\n\n`);

  const onEvent = (event) => {
    res.write(`data: ${JSON.stringify(event)}\n\n`);
    if (event.type === 'complete' || event.type === 'error') {
      setTimeout(() => res.end(), 1000);
    }
  };

  emitter.on('event', onEvent);
  const ping = setInterval(() => res.write(': ping\n\n'), 25000);

  req.on('close', () => {
    clearInterval(ping);
    emitter.removeListener('event', onEvent);
  });
});

// GET /api/sovereign/agent/:id — Statut d'une session
router.get('/agent/:id', (req, res) => {
  const status = agent.getSessionStatus(req.params.id);
  if (!status) return res.status(404).json({ ok: false, error: 'Session introuvable' });
  res.json({ ok: true, ...status });
});

// POST /api/sovereign/agent/:id/answer — Répondre à une question de l'agent
router.post('/agent/:id/answer', (req, res) => {
  const { answer } = req.body;
  if (!answer) return res.status(400).json({ ok: false, error: 'answer requis' });
  const ok = agent.answerQuestion(req.params.id, answer);
  res.json({ ok, message: ok ? 'Réponse transmise à l\'agent' : 'Aucune question en attente' });
});

module.exports = router;
