/**
 * DALEBA V24 — Routes Studio Vidéo
 * POST /api/video/generate-botanical  → Génère vidéo botanique (Creatomate ou démo HTML)
 * GET  /api/video/preview/:jobId      → Preview HTML animée (mode démo)
 * GET  /api/video/status/:jobId       → Statut du rendu
 * GET  /api/video/list                → Liste des vidéos en queue
 */

const express = require('express');
const router  = express.Router();
const { generateBotanicalVideo, getVideoStatus, getBotanicalTips } = require('../services/video-studio');
const { pool, DEMO_MODE } = require('../memory/db');
const bus = require('../services/event-bus');

// POST /api/video/generate-botanical
router.post('/generate-botanical', async (req, res) => {
  try {
    const { businessId = 1, tipIndex } = req.body;

    // Calcul automatique du tip selon la semaine si non précisé
    const weekOfYear   = Math.floor((Date.now() / 604800000)) % getBotanicalTips().length;
    const resolvedTip  = tipIndex !== undefined ? parseInt(tipIndex, 10) : weekOfYear;

    const result = await generateBotanicalVideo(businessId, { tipIndex: resolvedTip });

    bus.system(`[VIDEO] Génération lancée — mode: ${result.mode} | job: ${result.jobId}`);

    res.json({
      success: true,
      jobId:         result.jobId,
      mode:          result.mode,
      status:        result.status,
      previewUrl:    result.previewUrl,
      videoUrl:      result.videoUrl || null,
      estimatedTime: result.estimatedTime,
      tip: {
        title: result.tip.title,
        index: resolvedTip,
      },
    });
  } catch (err) {
    bus.system(`[VIDEO] ❌ Erreur génération: ${err.message}`);
    res.status(500).json({ error: err.message });
  }
});

// GET /api/video/preview/:jobId → renvoie la preview HTML animée
router.get('/preview/:jobId', async (req, res) => {
  const { jobId } = req.params;
  const { tipIndex = 0 } = req.query;

  // Retrouver le bon tip selon le jobId (ou le tipIndex si mode démo)
  let tip;
  if (!DEMO_MODE && pool && !String(jobId).startsWith('demo-')) {
    try {
      const result = await pool.query(
        `SELECT style FROM daleba_content_queue WHERE id = $1 AND platform = 'video'`,
        [jobId]
      );
      if (result.rows[0]?.style) {
        const match = result.rows[0].style.match(/botanique-tip-(\d+)/);
        if (match) {
          const { generateBotanicalVideo: gen } = require('../services/video-studio');
          // On régénère la preview HTML sans sauvegarder en DB
          const tips = getBotanicalTips();
          const idx  = parseInt(match[1], 10) % tips.length;
          tip = tips[idx];
        }
      }
    } catch (_) {}
  }

  // Fallback: utiliser le tipIndex du query param
  if (!tip) {
    const tips = getBotanicalTips();
    tip = tips[parseInt(tipIndex, 10) % tips.length];
  }

  // Générer la preview HTML
  const html = buildPreviewHTML(tip, jobId);
  res.set('Content-Type', 'text/html; charset=utf-8');
  res.send(html);
});

// GET /api/video/status/:jobId
router.get('/status/:jobId', async (req, res) => {
  try {
    const status = await getVideoStatus(req.params.jobId);
    res.json(status);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/video/list?businessId=1&limit=10
router.get('/list', async (req, res) => {
  const { businessId = 1, limit = 10 } = req.query;

  if (DEMO_MODE || !pool) {
    return res.json({ videos: [], demo: true });
  }

  try {
    const result = await pool.query(
      `SELECT id, topic, style, status, media_url, created_at
       FROM daleba_content_queue
       WHERE platform = 'video' AND business_id = $1
       ORDER BY created_at DESC LIMIT $2`,
      [businessId, Math.min(parseInt(limit, 10), 50)]
    );
    res.json({ videos: result.rows });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── Helper: preview HTML inline ────────────────────────────────────────────

function buildPreviewHTML(tip, jobId) {
  return `<!DOCTYPE html>
<html lang="fr">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Preview — ${tip.title}</title>
<style>
  @import url('https://fonts.googleapis.com/css2?family=Playfair+Display:wght@400;700&family=Lato:wght@300;400&display=swap');
  *{margin:0;padding:0;box-sizing:border-box}
  body{background:#111;display:flex;flex-direction:column;justify-content:center;align-items:center;min-height:100vh;gap:16px;font-family:Lato,sans-serif}
  .label{color:#666;font-size:11px;letter-spacing:3px;text-transform:uppercase}
  .phone{width:320px;height:568px;background:linear-gradient(160deg,#1a3a2a,#0d2418);border-radius:32px;overflow:hidden;position:relative;box-shadow:0 0 80px #1a3a2a55,0 20px 60px #00000088}
  .badge{position:absolute;top:14px;right:14px;background:rgba(0,0,0,.5);color:#f0e6c8;font-size:9px;padding:3px 8px;border-radius:4px;letter-spacing:2px;backdrop-filter:blur(4px)}
  .scene{position:absolute;inset:0;display:flex;flex-direction:column;justify-content:center;align-items:center;padding:28px;text-align:center;opacity:0;transform:translateY(12px);transition:opacity .7s,transform .7s}
  .scene.active{opacity:1;transform:translateY(0)}
  .emoji{font-size:52px;margin-bottom:18px;display:block;animation:sway 3s ease-in-out infinite}
  @keyframes sway{0%,100%{transform:rotate(-4deg)}50%{transform:rotate(4deg)}}
  .title{font-family:'Playfair Display',serif;font-size:22px;color:#f0e6c8;line-height:1.35;font-weight:700}
  .tip{font-family:Lato,sans-serif;font-size:16px;color:#c8e6c9;line-height:1.65;font-weight:300}
  .cta{font-family:'Playfair Display',serif;font-size:18px;color:#f0e6c8;line-height:1.5}
  .dots{position:absolute;bottom:18px;left:50%;transform:translateX(-50%);display:flex;gap:7px}
  .dot{width:6px;height:6px;border-radius:50%;background:#f0e6c825;transition:background .4s,transform .4s}
  .dot.active{background:#f0e6c8;transform:scale(1.3)}
  .progress-bar{position:absolute;bottom:0;left:0;height:2px;background:linear-gradient(90deg,#4caf8088,#c8e6c9);transition:width linear}
  .actions{display:flex;gap:10px;margin-top:8px}
  .btn{padding:8px 20px;border:none;border-radius:8px;font-size:12px;cursor:pointer;font-family:Lato,sans-serif;letter-spacing:1px;text-transform:uppercase;font-weight:600}
  .btn-dl{background:#1a3a2a;color:#c8e6c9;border:1px solid #2d5a3d}
  .btn-regen{background:#2d5a3d;color:#f0e6c8}
  .btn:hover{opacity:.85}
</style>
</head>
<body>
<div class="label">Studio Vidéo · Aperçu Botanique</div>

<div class="phone">
  <div class="badge">DÉMO</div>

  <div class="scene active" id="s0">
    <span class="emoji">🌿</span>
    <div class="title">${tip.title}</div>
  </div>
  <div class="scene" id="s1">
    <div class="tip">${tip.tip1.replace(/\n/g, '<br>')}</div>
  </div>
  <div class="scene" id="s2">
    <div class="tip">${tip.tip2.replace(/\n/g, '<br>')}</div>
  </div>
  <div class="scene" id="s3">
    <span class="emoji">🌺</span>
    <div class="cta">${tip.cta.replace(/\n/g, '<br>')}</div>
  </div>

  <div class="dots">
    <div class="dot active" id="d0"></div>
    <div class="dot" id="d1"></div>
    <div class="dot" id="d2"></div>
    <div class="dot" id="d3"></div>
  </div>
  <div class="progress-bar" id="pbar" style="width:0%"></div>
</div>

<div class="actions">
  <button class="btn btn-dl" onclick="window.print()">📥 Sauvegarder</button>
  <button class="btn btn-regen" onclick="location.reload()">🔄 Rejouer</button>
</div>

<script>
const timings=[4000,4000,4000,5000];
let cur=0,start=Date.now(),total=timings.reduce((a,b)=>a+b,0);
function show(i){
  document.querySelectorAll('.scene').forEach((s,j)=>s.classList.toggle('active',j===i));
  document.querySelectorAll('.dot').forEach((d,j)=>d.classList.toggle('active',j===i));
}
function tick(){
  const el=Date.now()-start,pct=Math.min(100,el/total*100);
  document.getElementById('pbar').style.width=pct+'%';
  requestAnimationFrame(tick);
}
function next(){
  cur=(cur+1)%4;
  show(cur);
  setTimeout(next,timings[cur]);
}
setTimeout(next,timings[0]);
requestAnimationFrame(tick);
</script>
</body>
</html>`;
}

module.exports = router;
