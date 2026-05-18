/**
 * video-studio.js — Studio Vidéo Botanique (V24)
 * Intégration Creatomate avec fallback démo HTML animée
 */

const { pool, DEMO_MODE } = require('../memory/db');
const bus = require('./event-bus');

const CREATOMATE_API_KEY = process.env.CREATOMATE_API_KEY;
const CREATOMATE_BASE = 'https://api.creatomate.com/v1';

// ─── CONTENUS BOTANIQUES ─────────────────────────────────────────────────────

const BOTANICAL_TIPS = [
  {
    title: "🌿 Le Secret des Plantes pour vos Cheveux",
    tip1: "L'huile de ricin fortifie les racines\net stimule la pousse naturelle ✨",
    tip2: "Le masque à l'avocat nourrit\nen profondeur les cheveux secs 🥑",
    cta: "Réservez votre soin botanique\nKadio Coiffure — Longueuil\n📞 (450) 000-0000",
  },
  {
    title: "🌺 Rituel Beauté Botanique",
    tip1: "Le beurre de karité scelle\nl'hydratation et protège 🧴",
    tip2: "L'aloe vera apaise le cuir chevelu\net réduit les démangeaisons 🌵",
    cta: "Prenez RDV en ligne !\nkadiocoiffure.com",
  },
];

// ─── TEMPLATE CREATOMATE ──────────────────────────────────────────────────────

function buildCreatomatePayload(tip) {
  return {
    source: {
      output_format: "mp4",
      duration: 30,
      width: 1080,
      height: 1920,
      elements: [
        {
          type: "video",
          track: 1,
          time: 0,
          duration: 30,
          source: "color",
          color: "#1a3a2a",
          fill_color: "#1a3a2a",
        },
        {
          type: "text",
          track: 2,
          time: 0,
          duration: 5,
          text: tip.title,
          font_family: "Playfair Display",
          font_size: 48,
          color: "#f0e6c8",
          x_alignment: "50%",
          y_alignment: "25%",
          animations: [{ time: "start", duration: 1, type: "fade" }],
        },
        {
          type: "text",
          track: 3,
          time: 1,
          duration: 8,
          text: tip.tip1,
          font_family: "Lato",
          font_size: 32,
          color: "#c8e6c9",
          x_alignment: "50%",
          y_alignment: "50%",
          animations: [{ time: "start", duration: 1, type: "slide", distance: "100%", direction: 270 }],
        },
        {
          type: "text",
          track: 4,
          time: 10,
          duration: 8,
          text: tip.tip2,
          font_family: "Lato",
          font_size: 32,
          color: "#c8e6c9",
          x_alignment: "50%",
          y_alignment: "50%",
          animations: [{ time: "start", duration: 1, type: "slide", distance: "100%", direction: 270 }],
        },
        {
          type: "text",
          track: 5,
          time: 20,
          duration: 8,
          text: tip.cta,
          font_family: "Playfair Display",
          font_size: 40,
          color: "#f0e6c8",
          x_alignment: "50%",
          y_alignment: "75%",
          animations: [{ time: "start", duration: 1, type: "fade" }],
        },
      ],
    },
    modifications: {
      title: tip.title,
      tip1: tip.tip1,
      tip2: tip.tip2,
      cta: tip.cta,
    },
  };
}

// ─── PREVIEW HTML ANIMÉE (mode démo) ─────────────────────────────────────────

function buildDemoPreviewHTML(tip, jobId) {
  return `<!DOCTYPE html>
<html lang="fr">
<head>
<meta charset="UTF-8">
<title>Preview Vidéo Botanique — ${tip.title}</title>
<style>
  @import url('https://fonts.googleapis.com/css2?family=Playfair+Display:wght@400;700&family=Lato:wght@300;400&display=swap');
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body { background: #0a0a0a; display: flex; justify-content: center; align-items: center; min-height: 100vh; font-family: Lato, sans-serif; }
  .phone { width: 360px; height: 640px; background: #1a3a2a; border-radius: 20px; overflow: hidden; position: relative; box-shadow: 0 0 60px #1a3a2a88; }
  .demo-badge { position: absolute; top: 12px; right: 12px; background: rgba(0,0,0,0.6); color: #f0e6c8; font-size: 10px; padding: 4px 8px; border-radius: 4px; letter-spacing: 2px; z-index: 10; }
  .scene { position: absolute; inset: 0; display: flex; flex-direction: column; justify-content: center; align-items: center; padding: 24px; text-align: center; opacity: 0; transition: opacity 0.8s; }
  .scene.active { opacity: 1; }
  .title-scene .main { font-family: 'Playfair Display', serif; font-size: 26px; color: #f0e6c8; line-height: 1.3; }
  .tip-scene .tip { font-family: Lato, sans-serif; font-size: 18px; color: #c8e6c9; line-height: 1.6; }
  .cta-scene .cta { font-family: 'Playfair Display', serif; font-size: 20px; color: #f0e6c8; line-height: 1.5; }
  .leaf { font-size: 48px; margin-bottom: 16px; animation: sway 2s ease-in-out infinite; }
  @keyframes sway { 0%,100% { transform: rotate(-5deg); } 50% { transform: rotate(5deg); } }
  .progress { position: absolute; bottom: 16px; left: 50%; transform: translateX(-50%); display: flex; gap: 6px; }
  .dot { width: 6px; height: 6px; border-radius: 50%; background: #f0e6c840; transition: background 0.3s; }
  .dot.active { background: #f0e6c8; }
  .job-id { position: absolute; bottom: 40px; left: 50%; transform: translateX(-50%); font-size: 9px; color: #f0e6c830; letter-spacing: 2px; }
</style>
</head>
<body>
<div class="phone">
  <div class="demo-badge">DÉMO</div>

  <div class="scene title-scene" id="s0">
    <div class="leaf">🌿</div>
    <div class="main">${tip.title}</div>
  </div>

  <div class="scene tip-scene" id="s1">
    <div class="tip">${tip.tip1.replace(/\n/g, '<br>')}</div>
  </div>

  <div class="scene tip-scene" id="s2">
    <div class="tip">${tip.tip2.replace(/\n/g, '<br>')}</div>
  </div>

  <div class="scene cta-scene" id="s3">
    <div class="leaf">🌺</div>
    <div class="cta">${tip.cta.replace(/\n/g, '<br>')}</div>
  </div>

  <div class="progress">
    <div class="dot active" id="d0"></div>
    <div class="dot" id="d1"></div>
    <div class="dot" id="d2"></div>
    <div class="dot" id="d3"></div>
  </div>
  <div class="job-id">JOB #${jobId}</div>
</div>
<script>
  let cur = 0;
  const scenes = [0,1,2,3];
  const timings = [3000, 3000, 3000, 4000];
  function show(i) {
    document.querySelectorAll('.scene').forEach((s,j) => s.classList.toggle('active', j===i));
    document.querySelectorAll('.dot').forEach((d,j) => d.classList.toggle('active', j===i));
  }
  show(0);
  function next() {
    cur = (cur + 1) % scenes.length;
    show(cur);
    setTimeout(next, timings[cur]);
  }
  setTimeout(next, timings[0]);
</script>
</body>
</html>`;
}

// ─── SAUVEGARDE EN DB ─────────────────────────────────────────────────────────

async function saveVideoToQueue({ businessId, tip, tipIndex, status, mediaUrl, creatomateJobId, previewHtml }) {
  if (DEMO_MODE) {
    // Mode sans DB — retourner un ID fictif
    return { id: `demo-${Date.now()}`, status, demo: true };
  }
  const result = await pool.query(
    `INSERT INTO daleba_content_queue
       (business_id, platform, content, media_url, topic, style, status, scheduled_at, created_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, NOW(), NOW())
     RETURNING *`,
    [
      businessId || 1,
      'video',
      tip.cta,
      mediaUrl || null,
      tip.title,
      `botanique-tip-${tipIndex}`,
      status,
    ]
  );
  const row = result.rows[0];

  // Stocker les métadonnées étendues dans une colonne JSON si possible (graceful ignore)
  if (creatomateJobId || previewHtml) {
    await pool.query(
      `UPDATE daleba_content_queue SET error = $1 WHERE id = $2`,
      [JSON.stringify({ creatomateJobId, hasPreview: !!previewHtml }), row.id]
    ).catch(() => {});
  }

  return row;
}

// ─── FONCTION PRINCIPALE ─────────────────────────────────────────────────────

async function generateBotanicalVideo(businessId = 1, options = {}) {
  const tipIndex = options.tipIndex !== undefined ? options.tipIndex % BOTANICAL_TIPS.length : 0;
  const tip = BOTANICAL_TIPS[tipIndex];

  bus.system(`[VIDEO] Génération botanique tip#${tipIndex} pour business #${businessId}`);

  // ── Mode Creatomate (clé API présente) ───────────────────────────────────
  if (CREATOMATE_API_KEY) {
    try {
      const payload = buildCreatomatePayload(tip);
      const response = await fetch(`${CREATOMATE_BASE}/renders`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${CREATOMATE_API_KEY}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(payload),
      });

      if (!response.ok) {
        const errText = await response.text();
        throw new Error(`Creatomate API ${response.status}: ${errText}`);
      }

      const renders = await response.json();
      const render = Array.isArray(renders) ? renders[0] : renders;
      const creatomateJobId = render.id;
      const mediaUrl = render.url || null;
      const status = render.status === 'succeeded' ? 'done' : 'rendering';

      const row = await saveVideoToQueue({
        businessId, tip, tipIndex,
        status,
        mediaUrl,
        creatomateJobId,
      });

      bus.system(`[VIDEO] Creatomate job ${creatomateJobId} lancé (status: ${status})`);

      return {
        mode: 'creatomate',
        jobId: row.id,
        creatomateJobId,
        status,
        videoUrl: mediaUrl,
        previewUrl: `/api/video/preview/${row.id}`,
        estimatedTime: 60,
        tip,
      };
    } catch (err) {
      bus.system(`[VIDEO] ⚠️ Creatomate error, fallback démo: ${err.message}`);
      // Fallback vers démo si erreur Creatomate
    }
  }

  // ── Mode Démo (sans clé ou après erreur Creatomate) ──────────────────────
  const previewHtml = buildDemoPreviewHTML(tip, 'DEMO');
  const mediaUrl = `/api/video/preview/`; // sera complété après insertion

  const row = await saveVideoToQueue({
    businessId, tip, tipIndex,
    status: 'demo',
    mediaUrl: null,
    previewHtml,
  });

  const jobId = row.id || `demo-${Date.now()}`;

  bus.system(`[VIDEO] 🎬 Preview démo générée — job #${jobId}`);

  return {
    mode: 'demo',
    jobId,
    status: 'demo',
    previewUrl: `/api/video/preview/${jobId}`,
    estimatedTime: 0,
    tip,
    preview_html: previewHtml,
  };
}

// ─── STATUT D'UN JOB ─────────────────────────────────────────────────────────

async function getVideoStatus(jobId) {
  if (DEMO_MODE || String(jobId).startsWith('demo-')) {
    return { jobId, status: 'demo', message: 'Preview HTML disponible' };
  }

  let row;
  try {
    const result = await pool.query(
      `SELECT * FROM daleba_content_queue WHERE id = $1 AND platform = 'video'`,
      [jobId]
    );
    row = result.rows[0];
  } catch (err) {
    return { jobId, status: 'error', error: err.message };
  }

  if (!row) return { jobId, status: 'not_found' };

  // Si rendering via Creatomate — vérifier le statut à distance
  let creatomateJobId = null;
  try {
    const meta = row.error ? JSON.parse(row.error) : {};
    creatomateJobId = meta.creatomateJobId;
  } catch (_) {}

  if (creatomateJobId && row.status === 'rendering' && CREATOMATE_API_KEY) {
    try {
      const resp = await fetch(`${CREATOMATE_BASE}/renders/${creatomateJobId}`, {
        headers: { 'Authorization': `Bearer ${CREATOMATE_API_KEY}` },
      });
      if (resp.ok) {
        const render = await resp.json();
        if (render.status === 'succeeded') {
          await pool.query(
            `UPDATE daleba_content_queue SET status = 'done', media_url = $1, published_at = NOW() WHERE id = $2`,
            [render.url, jobId]
          ).catch(() => {});
          return { jobId, status: 'done', videoUrl: render.url, thumbnailUrl: render.snapshot_url || null };
        } else if (render.status === 'failed') {
          await pool.query(`UPDATE daleba_content_queue SET status = 'error', error = $1 WHERE id = $2`,
            [render.error_message || 'Creatomate render failed', jobId]).catch(() => {});
          return { jobId, status: 'error', error: render.error_message };
        }
        return { jobId, status: 'rendering', progress: render.progress };
      }
    } catch (e) {
      // Ignore polling errors
    }
  }

  return {
    jobId: row.id,
    status: row.status,
    videoUrl: row.media_url || null,
    thumbnailUrl: null,
    topic: row.topic,
    createdAt: row.created_at,
  };
}

// ─── LISTE DES TIPS ──────────────────────────────────────────────────────────

function getBotanicalTips() {
  return BOTANICAL_TIPS;
}

// ─── EXPORTS ─────────────────────────────────────────────────────────────────

module.exports = { generateBotanicalVideo, getBotanicalTips, getVideoStatus };
