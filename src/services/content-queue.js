/**
 * Content Queue — DALEBA Metacortex Points 124-125
 *
 * Gestionnaire de file d'attente PostgreSQL daleba_content_queue.
 * Stocke les MP4 finaux prêts pour publication avec métadonnées SEO.
 */

'use strict';

const path = require('path');
const maintenance = require('./maintenance');

// ─── SCHÉMA TABLE [124-125] ───────────────────────────────────────────────────

const CREATE_QUEUE_SQL = `
CREATE TABLE IF NOT EXISTS daleba_content_queue (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  file_path       TEXT NOT NULL,
  secure_token    VARCHAR(64),
  format          VARCHAR(20) NOT NULL DEFAULT 'reels',
  platform        VARCHAR(20) NOT NULL DEFAULT 'instagram',
  status          VARCHAR(20) NOT NULL DEFAULT 'pending',
  -- [125] Métadonnées SEO
  seo_title       VARCHAR(300),
  description     TEXT,
  hashtags        TEXT[],
  targeting       JSONB DEFAULT '{}',
  -- Métriques
  scheduled_at    TIMESTAMPTZ,
  published_at    TIMESTAMPTZ,
  platform_post_id VARCHAR(200),
  publish_error   TEXT,
  retry_count     INTEGER DEFAULT 0,
  -- Analytics
  views           INTEGER DEFAULT 0,
  likes           INTEGER DEFAULT 0,
  comments        INTEGER DEFAULT 0,
  shares          INTEGER DEFAULT 0,
  watch_time_avg  DECIMAL(8,2),
  engagement_rate DECIMAL(5,2),
  analytics_at    TIMESTAMPTZ,
  -- Shadowban
  shadowbanned    BOOLEAN DEFAULT false,
  fingerprint_mod DECIMAL(4,3) DEFAULT 0,
  -- Source
  asset_id        UUID,
  source_script   JSONB,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_cq_status    ON daleba_content_queue(status);
CREATE INDEX IF NOT EXISTS idx_cq_scheduled ON daleba_content_queue(scheduled_at);
CREATE INDEX IF NOT EXISTS idx_cq_platform  ON daleba_content_queue(platform);
CREATE INDEX IF NOT EXISTS idx_cq_created   ON daleba_content_queue(created_at DESC);
`;

async function ensureQueueTable() {
  const pool = maintenance.getPool();
  if (!pool) return false;
  await pool.query(CREATE_QUEUE_SQL).catch(e => console.warn('[ContentQueue] Table:', e.message));
  return true;
}

// ─── CRUD [124-125] ──────────────────────────────────────────────────────────

/**
 * Ajoute un contenu à la file d'attente
 * @param {object} item — { filePath, format, platform, seoTitle, description, hashtags, targeting, scheduledAt, assetId, sourceScript }
 */
async function addToQueue(item) {
  const pool = maintenance.getPool();
  if (!pool) throw new Error('DB non disponible');

  const crypto = require('crypto');
  const secureToken = crypto.randomBytes(24).toString('hex');

  const r = await pool.query(`
    INSERT INTO daleba_content_queue
      (file_path, secure_token, format, platform, seo_title, description, hashtags,
       targeting, scheduled_at, asset_id, source_script)
    VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
    RETURNING id, status, created_at
  `, [
    item.filePath, secureToken,
    item.format   || 'reels',
    item.platform || 'instagram',
    item.seoTitle || item.title || '',
    item.description || '',
    item.hashtags || [],
    JSON.stringify(item.targeting || {}),
    item.scheduledAt || null,
    item.assetId || null,
    JSON.stringify(item.sourceScript || {}),
  ]);

  return { ...r.rows[0], secureToken };
}

/**
 * [125] Génère les métadonnées SEO via Claude pour un contenu
 */
async function generateSEOMetadata(filePath, sceneAnalysis = null, trends = null) {
  const claude = require('../agents/claude');

  const action   = sceneAnalysis?.overall?.primary_action || 'salon_service';
  const hashtags = trends?.trendingHashtags?.slice(0, 10).map(h => h.tag).join(' ') || '#naturalhair #salon';

  const prompt = `Tu génères les métadonnées SEO pour une publication Instagram/TikTok de Kadio Coiffure, salon premium à Longueuil QC.

Contenu vidéo analysé: ${action}
Tendances actuelles: ${hashtags}

Génère en JSON:
{
  "title": "string (max 100 chars, optimisé SEO, captivant)",
  "description": "string (150-220 chars, accroche + CTA + emojis naturels)",
  "hashtags": ["#tag1","#tag2",...] (exactement 15, mix fr/en, micro/macro niches),
  "targeting": {
    "interests": ["Natural hair","Beauty","Luxury","Hair salon"],
    "age_range": "18-45",
    "locations": ["Montreal","Longueuil","Quebec"],
    "languages": ["fr","en"]
  }
}

Règles: titres sans clickbait infantile, ton premium aspirationnel, CTA clair.`;

  const result = await claude.query(prompt,
    'Tu es un expert SEO et marketing pour salon premium. JSON uniquement.',
    []
  );

  try {
    const clean = result.content.replace(/```json\n?|\n?```/g, '').trim();
    return JSON.parse(clean);
  } catch {
    return {
      title: 'Kadio Coiffure — Transformation capillaire premium',
      description: 'Vivez l\'expérience Kadio Coiffure ✨ Experts en coiffure afro premium à Longueuil. Prenez rendez-vous aujourd\'hui.',
      hashtags: ['#naturalhair','#salondecoiffure','#coiffurequebec','#afropunk','#braids'],
      targeting: { interests: ['Hair'], age_range: '18-45', locations: ['Longueuil','Montreal'] },
    };
  }
}

/**
 * Récupère le prochain item à publier
 */
async function getNextPending(platform = null, scheduledBefore = new Date()) {
  const pool = maintenance.getPool();
  if (!pool) return null;

  const q = platform
    ? `SELECT * FROM daleba_content_queue WHERE status='pending' AND platform=$1 AND (scheduled_at IS NULL OR scheduled_at <= $2) ORDER BY scheduled_at ASC NULLS FIRST, created_at ASC LIMIT 1`
    : `SELECT * FROM daleba_content_queue WHERE status='pending' AND (scheduled_at IS NULL OR scheduled_at <= $1) ORDER BY scheduled_at ASC NULLS FIRST, created_at ASC LIMIT 1`;

  const params = platform ? [platform, scheduledBefore] : [scheduledBefore];
  const r = await pool.query(q, params);
  return r.rows[0] || null;
}

async function markPublished(id, platformPostId) {
  const pool = maintenance.getPool();
  if (!pool) return;
  await pool.query(
    `UPDATE daleba_content_queue SET status='published', published_at=NOW(), platform_post_id=$1, updated_at=NOW() WHERE id=$2`,
    [platformPostId, id]
  );
}

async function markFailed(id, error, retry = true) {
  const pool = maintenance.getPool();
  if (!pool) return;
  const newStatus = retry ? 'pending' : 'failed';
  await pool.query(
    `UPDATE daleba_content_queue SET status=$1, publish_error=$2, retry_count=retry_count+1, updated_at=NOW() WHERE id=$3`,
    [newStatus, error?.slice(0, 500), id]
  );
}

async function markScheduled(id, scheduledAt) {
  const pool = maintenance.getPool();
  if (!pool) return;
  await pool.query(
    `UPDATE daleba_content_queue SET scheduled_at=$1, updated_at=NOW() WHERE id=$2`,
    [scheduledAt, id]
  );
}

async function updateAnalytics(id, stats) {
  const pool = maintenance.getPool();
  if (!pool) return;
  await pool.query(`
    UPDATE daleba_content_queue SET
      views=$1, likes=$2, comments=$3, shares=$4,
      watch_time_avg=$5, engagement_rate=$6,
      analytics_at=NOW(), updated_at=NOW()
    WHERE id=$7
  `, [stats.views||0, stats.likes||0, stats.comments||0, stats.shares||0,
      stats.watchTimeAvg||0, stats.engagementRate||0, id]);
}

async function markShadowbanned(id, fingerprintMod = 0.001) {
  const pool = maintenance.getPool();
  if (!pool) return;
  await pool.query(
    `UPDATE daleba_content_queue SET shadowbanned=true, fingerprint_mod=$1, status='pending', updated_at=NOW() WHERE id=$2`,
    [fingerprintMod, id]
  );
}

async function getPublishedForAnalytics(hours = 25) {
  const pool = maintenance.getPool();
  if (!pool) return [];
  const r = await pool.query(`
    SELECT * FROM daleba_content_queue
    WHERE status='published'
    AND (analytics_at IS NULL OR analytics_at < NOW() - INTERVAL '${hours} hours')
    ORDER BY published_at DESC LIMIT 50
  `);
  return r.rows;
}

// ─── EXPORTS ─────────────────────────────────────────────────────────────────

module.exports = {
  ensureQueueTable, addToQueue, generateSEOMetadata,
  getNextPending, markPublished, markFailed, markScheduled,
  updateAnalytics, markShadowbanned, getPublishedForAnalytics,
  CREATE_QUEUE_SQL,
};
