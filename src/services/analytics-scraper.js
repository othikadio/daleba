/**
 * Analytics Scraper — DALEBA Metacortex Points 132-134
 *
 * [132] Collecte stats vidéos publiées toutes les 24h
 * [133] Algorithme d'apprentissage contenu (engagement +30% → update prompt)
 * [134] Détection shadowban <50 vues/4h → archive + republication fingerprint altéré
 */

'use strict';

const axios = require('axios');
const maintenance = require('./maintenance');

// ─── COLLECTE STATS META [132] ────────────────────────────────────────────────

async function fetchInstagramStats(postId) {
  const token = process.env.META_ACCESS_TOKEN;
  if (!token) return null;

  try {
    const r = await axios.get(
      `https://graph.facebook.com/v19.0/${postId}`,
      {
        params: {
          fields: 'like_count,comments_count,shares_count,plays,reach,impressions,saved',
          access_token: token,
        },
        timeout: 8000,
      }
    );
    const d = r.data;
    const views = d.plays || d.impressions || d.reach || 0;
    const likes = d.like_count || 0;
    const comments = d.comments_count || 0;
    const shares = d.shares_count || 0;

    return {
      platform: 'instagram', postId,
      views, likes, comments, shares,
      engagementRate: views > 0 ? Math.round(((likes + comments + shares) / views) * 10000) / 100 : 0,
    };
  } catch (err) {
    console.warn(`[Analytics] Instagram stats ${postId}: ${err.message}`);
    return null;
  }
}

async function fetchTikTokStats(postId) {
  const token = process.env.TIKTOK_BUSINESS_TOKEN;
  if (!token) return null;

  try {
    const r = await axios.get(
      'https://open.tiktokapis.com/v2/video/query/',
      {
        params: { fields: 'id,stats' },
        headers: { Authorization: `Bearer ${token}` },
        data: { filters: { video_ids: [postId] } },
        timeout: 8000,
      }
    );
    const video = r.data?.data?.videos?.[0];
    if (!video) return null;

    const s = video.stats || {};
    const views = s.play_count || 0;
    return {
      platform: 'tiktok', postId,
      views,
      likes:         s.like_count || 0,
      comments:      s.comment_count || 0,
      shares:        s.share_count || 0,
      watchTimeAvg:  s.average_time_watched || 0,
      engagementRate: views > 0
        ? Math.round(((s.like_count + s.comment_count + s.share_count) / views) * 10000) / 100
        : 0,
    };
  } catch (err) {
    console.warn(`[Analytics] TikTok stats ${postId}: ${err.message}`);
    return null;
  }
}

// ─── RUN ANALYTICS 24H [132] ─────────────────────────────────────────────────

async function runDailyAnalytics() {
  const queue = require('./content-queue');
  const published = await queue.getPublishedForAnalytics(24);

  if (published.length === 0) return { updated: 0 };

  let updated = 0;
  for (const item of published) {
    if (!item.platform_post_id) continue;

    let stats = null;
    if (item.platform === 'instagram') stats = await fetchInstagramStats(item.platform_post_id);
    if (item.platform === 'tiktok')    stats = await fetchTikTokStats(item.platform_post_id);

    if (!stats) continue;

    await queue.updateAnalytics(item.id, stats);
    updated++;

    // [134] Vérification shadowban (si récent < 4h et < 50 vues)
    const ageHours = (Date.now() - new Date(item.published_at).getTime()) / 3600000;
    if (ageHours < 4 && stats.views < 50) {
      console.warn(`[Analytics] ⚠️ Shadowban potentiel: ${item.id} — ${stats.views} vues en ${ageHours.toFixed(1)}h`);
      await _handleShadowban(item, stats);
    }
  }

  // [133] Algorithme apprentissage
  await _runLearningAlgorithm();

  return { updated, total: published.length };
}

// ─── DÉTECTION SHADOWBAN [134] ────────────────────────────────────────────────

async function _handleShadowban(item, stats) {
  const queue = require('./content-queue');
  const bus   = (() => { try { return require('./event-bus'); } catch { return null; } })();
  const shield = require('./notification-shield');

  // 1. Archiver
  await queue.markShadowbanned(item.id, 0.001);

  // 2. Alerte silencieuse HUD uniquement [134]
  bus?.emit('studio:shadowban', {
    itemId: item.id, postId: item.platform_post_id,
    platform: item.platform, views: stats.views,
    message: `Shadowban détecté: ${stats.views} vues en <4h (${item.platform})`,
  });

  // HUD-only, pas de SMS (shield)
  await shield.reportMetricChange(`shadowban_${item.platform}`, stats.views,
    { hudOnly: true }).catch(() => {});

  // 3. Re-queue avec fingerprint altéré dans 1h [134]
  const reEncPath = await require('./social-publisher').reEncodeForFallback(
    item.file_path,
    { shadowban: true, fpsDelta: 0.001, targetBitrate: '2200k', currentFps: 30 }
  ).catch(() => null);

  if (reEncPath) {
    const nextSlot = new Date(Date.now() + 60 * 60 * 1000); // 1h plus tard
    await queue.addToQueue({
      filePath:    reEncPath,
      format:      item.format,
      platform:    item.platform,
      seoTitle:    item.seo_title,
      description: item.description,
      hashtags:    item.hashtags,
      targeting:   item.targeting,
      scheduledAt: nextSlot,
      assetId:     item.asset_id,
    });
    console.log(`[Analytics] 🔄 Republication fingerprint altéré schedulée dans 1h`);
  }
}

// ─── ALGORITHME D'APPRENTISSAGE [133] ────────────────────────────────────────

async function _runLearningAlgorithm() {
  const pool = maintenance.getPool();
  if (!pool) return;

  try {
    // Calcul de la moyenne d'engagement mensuelle
    const avgResult = await pool.query(`
      SELECT AVG(engagement_rate) as avg_engagement
      FROM daleba_content_queue
      WHERE status='published'
      AND published_at >= NOW() - INTERVAL '30 days'
      AND engagement_rate > 0
    `);

    const avgEngagement = parseFloat(avgResult.rows[0]?.avg_engagement || 0);
    if (avgEngagement === 0) return;

    const threshold = avgEngagement * 1.30; // +30% [133]

    // Contenus surperformants
    const topPerformers = await pool.query(`
      SELECT id, source_script, engagement_rate, views, format, platform
      FROM daleba_content_queue
      WHERE status='published'
      AND engagement_rate >= $1
      AND published_at >= NOW() - INTERVAL '30 days'
      ORDER BY engagement_rate DESC LIMIT 5
    `, [threshold]);

    if (topPerformers.rows.length === 0) return;

    // [133] Claude met à jour le modèle de prompt interne
    await _updatePromptModel(topPerformers.rows, avgEngagement);

  } catch (err) {
    console.warn('[Analytics] Learning algorithm:', err.message);
  }
}

// Clé DB pour le modèle de prompt appris
const LEARNED_PROMPT_KEY = 'media_learned_prompt_v1';

async function _updatePromptModel(topPerformers, avgEngagement) {
  const claude = require('../agents/claude');
  const pool   = maintenance.getPool();

  const perfData = topPerformers.map(p => ({
    engagement: p.engagement_rate,
    views:      p.views,
    script:     p.source_script?.formats?.reels?.clips?.length || 0,
    hook:       p.source_script?.hook || '',
    format:     p.format,
    platform:   p.platform,
  }));

  const prompt = `Tu analyses les vidéos surperformantes (+30% engagement) de Kadio Coiffure pour optimiser les prochaines créations.

Données des tops performers:
${JSON.stringify(perfData, null, 2)}

Moyenne d'engagement actuelle: ${avgEngagement.toFixed(2)}%

Génère des directives de prompt optimisées pour MediaAgent en JSON:
{
  "preferred_hooks": ["string"],
  "optimal_clip_duration_s": number,
  "best_structures": ["string"],
  "niche_priorities": ["string"],
  "avoid": ["string"],
  "color_grade_preference": { "saturation": number, "contrast": number },
  "caption_style": "string",
  "last_updated": "ISO-date"
}`;

  try {
    const result = await claude.query(prompt, 'Expert en optimisation contenu vidéo. JSON uniquement.', []);
    const clean  = result.content.replace(/```json\n?|\n?```/g, '').trim();
    const model  = JSON.parse(clean);
    model.last_updated = new Date().toISOString();

    // Persistance dans daleba_notes [107]
    if (pool) {
      await pool.query(`
        INSERT INTO daleba_notes (category, key, content, created_at)
        VALUES ('media_ai_learning', $1, $2, NOW())
        ON CONFLICT (key) DO UPDATE SET content=$2, updated_at=NOW()
      `, [LEARNED_PROMPT_KEY, JSON.stringify(model)]).catch(() => {});
    }

    console.log(`[Analytics] 🧠 Modèle de prompt mis à jour (avg: ${avgEngagement.toFixed(2)}% → seuil: ${(avgEngagement*1.3).toFixed(2)}%)`);
    return model;
  } catch (err) {
    console.warn('[Analytics] Prompt model update:', err.message);
  }
}

/**
 * Récupère le modèle de prompt appris pour enrichir les prochains scripts
 */
async function getLearnedPromptModel() {
  const pool = maintenance.getPool();
  if (!pool) return null;
  try {
    const r = await pool.query(
      `SELECT content FROM daleba_notes WHERE key=$1 LIMIT 1`,
      [LEARNED_PROMPT_KEY]
    );
    return r.rows[0] ? JSON.parse(r.rows[0].content) : null;
  } catch { return null; }
}

// ─── SCHEDULER 24H [132] ─────────────────────────────────────────────────────

function startAnalyticsScheduler() {
  setInterval(() => {
    runDailyAnalytics().catch(e => console.warn('[Analytics] Scheduler error:', e.message));
  }, 24 * 3600 * 1000);
  console.log('[Analytics] Scheduler démarré (toutes les 24h)');
}

// ─── EXPORTS ─────────────────────────────────────────────────────────────────

module.exports = {
  runDailyAnalytics, fetchInstagramStats, fetchTikTokStats,
  getLearnedPromptModel, startAnalyticsScheduler,
};
