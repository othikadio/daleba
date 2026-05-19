/**
 * Trend Scraper Agent — DALEBA Metacortex Points 108-110
 *
 * Interroge TikTok Research API + YouTube Trends toutes les 6h.
 * Extrait vitesse des hashtags · structures de montage virales · hooks.
 * Fallback Claude si APIs indisponibles.
 */

'use strict';

const axios = require('axios');

// ─── CATÉGORIES SUIVIES [109] ─────────────────────────────────────────────────

const TRACKED_CATEGORIES = ['coiffure', 'beauté', 'luxe', 'botanique', 'afro hair', 'natural hair',
  'haircut', 'braids', 'salon', 'beauty', 'luxury', 'phytothérapie'];

const HASHTAGS_FR  = ['#coiffureafro', '#tressesafricaines', '#salondecoiffure', '#naturalhair',
  '#braids', '#locks', '#twist', '#weave', '#coiffurequebec', '#soinscapillaires', '#botanique'];

const HASHTAGS_EN  = ['#hairtransformation', '#hairsalon', '#naturalhaircommunity', '#protectivestyles',
  '#luxuryhair', '#salon', '#haircare', '#hairgoals', '#afropunk'];

// Cache en mémoire (rafraîchi toutes les 6h)
let _trendsCache = null;
let _lastFetch   = 0;
const CACHE_TTL  = 6 * 3600 * 1000;

// ─── YOUTUBE TRENDS [108] ────────────────────────────────────────────────────

async function fetchYouTubeTrends(categories = ['beauty']) {
  const apiKey = process.env.YOUTUBE_API_KEY;
  if (!apiKey) return { source: 'youtube', available: false, data: [] };

  try {
    const res = await axios.get('https://www.googleapis.com/youtube/v3/videos', {
      params: {
        part: 'snippet,statistics,contentDetails',
        chart: 'mostPopular',
        regionCode: 'CA',
        videoCategoryId: '26', // Howto & Style
        maxResults: 20,
        key: apiKey,
      },
      timeout: 8000,
    });

    const items = res.data.items || [];
    return {
      source: 'youtube',
      available: true,
      videos: items.map(v => ({
        title:       v.snippet.title,
        views:       parseInt(v.statistics.viewCount || 0),
        likes:       parseInt(v.statistics.likeCount || 0),
        duration:    v.contentDetails.duration,
        publishedAt: v.snippet.publishedAt,
        tags:        v.snippet.tags || [],
        engagement:  _calcEngagement(v.statistics),
      })),
      fetchedAt: new Date().toISOString(),
    };
  } catch (err) {
    return { source: 'youtube', available: false, error: err.message, data: [] };
  }
}

function _calcEngagement(stats) {
  const views = parseInt(stats.viewCount || 1);
  const likes = parseInt(stats.likeCount || 0);
  const comments = parseInt(stats.commentCount || 0);
  return Math.round(((likes + comments * 2) / views) * 10000) / 100; // en %
}

// ─── TIKTOK TRENDS [108-109] ─────────────────────────────────────────────────

async function fetchTikTokTrends() {
  const token = process.env.TIKTOK_RESEARCH_API_TOKEN;

  // TikTok Research API (requiert approbation account)
  if (token) {
    try {
      const res = await axios.post(
        'https://open.tiktokapis.com/v2/research/video/query/',
        {
          query: {
            or: HASHTAGS_EN.slice(0, 5).map(h => ({ operation: 'IN', field_name: 'hashtag_name', field_values: [h.replace('#', '')] })),
          },
          start_date: _daysAgo(3),
          end_date: _today(),
          max_count: 20,
          fields: ['id', 'video_description', 'create_time', 'region_code', 'share_count', 'view_count', 'like_count', 'comment_count', 'music_id', 'hashtag_names', 'duration'],
        },
        {
          headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
          timeout: 10000,
        }
      );

      const videos = res.data?.data?.videos || [];
      return {
        source: 'tiktok_research_api',
        available: true,
        videos: videos.map(v => ({
          description: v.video_description,
          views:        v.view_count,
          likes:        v.like_count,
          shares:       v.share_count,
          duration:     v.duration,
          hashtags:     v.hashtag_names,
          engagement:   _calcTikTokEngagement(v),
        })),
        fetchedAt: new Date().toISOString(),
      };
    } catch (err) {
      console.warn('[TrendScraper] TikTok Research API:', err.message);
    }
  }

  // Fallback : analyse des patterns via Claude si API indisponible
  return _tiktokFallbackAnalysis();
}

async function _tiktokFallbackAnalysis() {
  const claude = require('../agents/claude');

  const prompt = `Tu es un expert en marketing vidéo viral. Analyse les tendances actuelles (mai 2026) sur TikTok pour ces niches: coiffure afro, salon de beauté premium, phytothérapie capillaire, luxury hair.

Donne-moi:
1. Les 5 structures de montage les plus virales (durée des plans, types de transitions)
2. Les hooks textuels les plus engageants (premières 2-3 secondes)
3. Les hashtags à vitesse croissante actuellement
4. Le style musical/sonore dominant
5. La durée optimale par format (Reels, TikTok, YouTube Shorts)

Retourne un JSON structuré selon ce schéma:
{
  "montage_structures": [{"name": str, "avg_clip_duration_s": num, "transition_style": str, "retention_hook": str}],
  "text_hooks": [{"text": str, "type": str, "engagement_score": num}],
  "trending_hashtags": [{"tag": str, "velocity": str, "niche": str}],
  "audio_trends": [str],
  "optimal_durations": {"reels": num, "tiktok": num, "shorts": num}
}`;

  try {
    const result = await claude.query(prompt, 'Tu es un expert marketing vidéo. Réponds uniquement en JSON valide.', []);
    const clean = result.content.replace(/```json\n?|\n?```/g, '').trim();
    return { source: 'claude_analysis', available: true, ...JSON.parse(clean), fetchedAt: new Date().toISOString() };
  } catch {
    return _hardcodedTrends();
  }
}

function _hardcodedTrends() {
  return {
    source: 'hardcoded_baseline',
    available: true,
    montage_structures: [
      { name: 'Before/After', avg_clip_duration_s: 3, transition_style: 'jump_cut', retention_hook: 'transformation reveal' },
      { name: 'Process POV', avg_clip_duration_s: 2, transition_style: 'smooth_cut', retention_hook: 'close-up detail' },
      { name: 'Time Lapse Service', avg_clip_duration_s: 1.5, transition_style: 'zoom_in', retention_hook: 'speed effect' },
      { name: 'Client Reaction', avg_clip_duration_s: 4, transition_style: 'fade', retention_hook: 'emotion reveal' },
    ],
    text_hooks: [
      { text: 'POV: Finally the hair of your dreams ✨', type: 'aspirational', engagement_score: 92 },
      { text: 'WAIT FOR IT 😱', type: 'suspense', engagement_score: 95 },
      { text: 'This transformation 🤯', type: 'shock', engagement_score: 88 },
      { text: 'Kadio Coiffure — Longueuil 💜', type: 'brand', engagement_score: 75 },
    ],
    trending_hashtags: [
      { tag: '#naturalhair', velocity: 'high', niche: 'coiffure' },
      { tag: '#braids2026', velocity: 'rising', niche: 'coiffure' },
      { tag: '#hairsalon', velocity: 'stable', niche: 'beauté' },
      { tag: '#luxuryhair', velocity: 'rising', niche: 'luxe' },
      { tag: '#phytotherapy', velocity: 'emerging', niche: 'botanique' },
    ],
    audio_trends: ['afrobeats_trending', 'ambient_lo-fi', 'reggaeton_slowed'],
    optimal_durations: { reels: 30, tiktok: 45, shorts: 60 },
    fetchedAt: new Date().toISOString(),
  };
}

// ─── ANALYSE STRUCTURES VIRALES [110] ────────────────────────────────────────

function analyzeViralStructures(videos) {
  if (!videos || videos.length === 0) return null;

  const durations = videos.map(v => v.duration).filter(Boolean).sort((a, b) => a - b);
  const avgDuration = durations.length ? Math.round(durations.reduce((a, b) => a + b, 0) / durations.length) : 30;

  const topVideos = [...videos].sort((a, b) => (b.engagement || 0) - (a.engagement || 0)).slice(0, 5);

  return {
    avgDuration,
    medianDuration: durations[Math.floor(durations.length / 2)] || 30,
    topEngagement:  topVideos.slice(0, 3).map(v => ({ views: v.views, engagement: v.engagement })),
    recommendedDuration: avgDuration <= 30 ? 30 : avgDuration <= 60 ? 60 : 90,
  };
}

// ─── FETCH CONSOLIDÉ [108] ───────────────────────────────────────────────────

async function fetchTrends(categories = TRACKED_CATEGORIES) {
  const now = Date.now();
  if (_trendsCache && now - _lastFetch < CACHE_TTL) return _trendsCache;

  const [youtube, tiktok] = await Promise.allSettled([
    fetchYouTubeTrends(categories),
    fetchTikTokTrends(),
  ]);

  const yt  = youtube.status === 'fulfilled' ? youtube.value : null;
  const tt  = tiktok.status  === 'fulfilled' ? tiktok.value  : null;

  const viralStructures = tt?.montage_structures || analyzeViralStructures(yt?.videos);

  _trendsCache = {
    youtube:          yt,
    tiktok:           tt,
    viralStructures,
    trendingHashtags: tt?.trending_hashtags || HASHTAGS_FR.slice(0, 5).map(h => ({ tag: h, velocity: 'stable' })),
    textHooks:        tt?.text_hooks || [],
    optimalDurations: tt?.optimal_durations || { reels: 30, tiktok: 45, shorts: 60 },
    categories,
    fetchedAt:        new Date().toISOString(),
  };

  _lastFetch = now;
  return _trendsCache;
}

function getLatestTrends() {
  return _trendsCache || fetchTrends();
}

// ─── UTILITAIRES ─────────────────────────────────────────────────────────────

function _today() { return new Date().toISOString().slice(0, 10).replace(/-/g, ''); }
function _daysAgo(n) {
  const d = new Date(); d.setDate(d.getDate() - n);
  return d.toISOString().slice(0, 10).replace(/-/g, '');
}
function _calcTikTokEngagement(v) {
  const views = v.view_count || 1;
  return Math.round(((v.like_count + v.comment_count * 2 + v.share_count * 3) / views) * 10000) / 100;
}

// ─── SCHEDULER [108] — toutes les 6h ─────────────────────────────────────────

function startTrendScheduler() {
  setInterval(() => {
    fetchTrends().catch(e => console.warn('[TrendScraper] Refresh failed:', e.message));
  }, CACHE_TTL);
  console.log('[TrendScraper] Scheduler démarré (refresh toutes les 6h)');
}

// ─── EXPORTS ─────────────────────────────────────────────────────────────────

module.exports = {
  fetchTrends, getLatestTrends, fetchYouTubeTrends, fetchTikTokTrends,
  analyzeViralStructures, startTrendScheduler,
  TRACKED_CATEGORIES, HASHTAGS_FR, HASHTAGS_EN,
};
