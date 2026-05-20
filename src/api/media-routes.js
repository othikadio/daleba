'use strict';
/**
 * DALEBA — Routes Pôle Média
 *
 * POST /api/media/upload          — soumettre une vidéo brute
 * POST /api/media/process         — analyser + planifier 3 plateformes
 * GET  /api/media/queue           — file de publication
 * POST /api/media/schedule        — planifier manuellement
 * GET  /api/media/platforms       — plateformes disponibles
 * POST /api/media/publish-now/:id — publier immédiatement
 */

const express = require('express');
const router  = express.Router();
const media   = require('../services/media-pipeline');

// GET /api/media/platforms
router.get('/platforms', (req, res) => {
  res.json({
    platforms: Object.entries(media.PLATFORM_FORMATS).map(([id, f]) => ({ id, ...f })),
    publishSlots: media.PUBLISH_SLOTS,
    autoPublish: !!process.env.META_ACCESS_TOKEN,
    note: !process.env.META_ACCESS_TOKEN
      ? 'META_ACCESS_TOKEN requis pour publication automatique — configurer dans Railway'
      : 'Publication automatique active',
  });
});

// POST /api/media/process — vidéo brute → 3 plateformes
router.post('/process', async (req, res) => {
  const { rawPath, videoUrl, context } = req.body;
  const source = rawPath || videoUrl;
  if (!source && !context) {
    return res.status(400).json({ error: 'rawPath/videoUrl ou context requis' });
  }
  try {
    const results = await media.processRawVideo({ rawPath: source, context: context||'Vidéo salon Kadio Coiffure' });
    res.json({
      success: true,
      scheduled: results.length,
      contents: results,
      message: `${results.length} contenus planifiés (Instagram Reel + TikTok + Facebook)`,
    });
  } catch(err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/media/schedule — planifier 1 contenu spécifique
router.post('/schedule', async (req, res) => {
  const { rawPath, platform, context, scheduledAt } = req.body;
  if (!platform) return res.status(400).json({ error: 'platform requis (instagram_reel|tiktok|facebook_reel|instagram_post)' });
  try {
    const result = await media.scheduleContent({ rawPath, platform, context, scheduledAt });
    res.json({ success: true, content: result });
  } catch(err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/media/queue
router.get('/queue', async (req, res) => {
  try {
    let pool = null;
    try { pool = require('../memory/db').pool; } catch(e) {}
    if (!pool) return res.json({ queue: [], demo: true, message: 'Mode démo — DB non connectée' });
    const r = await pool.query(
      'SELECT id,platform,caption,scheduled_at,status,published_at,platform_post_id FROM daleba_content_queue ORDER BY scheduled_at DESC LIMIT 50'
    );
    res.json({ queue: r.rows, total: r.rowCount });
  } catch(err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/media/caption — générer une caption seulement (sans planifier)
router.post('/caption', async (req, res) => {
  const { context, platform } = req.body;
  if (!context) return res.status(400).json({ error: 'context requis' });
  try {
    const result = await media.analyzeAndCaption({ platform: platform||'instagram_reel', context });
    res.json(result);
  } catch(err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
