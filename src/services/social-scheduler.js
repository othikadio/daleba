/**
 * DALEBA — Social Scheduler (TikTok / Instagram / Facebook)
 * Génère scripts vidéo, planifie publications, poste via Meta Graph API
 * Table PostgreSQL: daleba_content_queue
 */

const { pool, DEMO_MODE } = require('../memory/db');
const bus = require('./event-bus');

const PLATFORMS = ['instagram', 'facebook', 'tiktok'];

const CONTENT_STYLES = {
  tiktok_script: 'Script TikTok viral (hook 3s, narration rapide, CTA)',
  reels_caption: 'Caption Instagram Reels (émojis, hashtags, CTA)',
  fb_post:       'Publication Facebook (ton communautaire, informatif)',
  story:         'Story Instagram (court, dynamique, CTA swipe-up)',
};

// ─── GÉNÉRATION DE CONTENU LLM ────────────────────────────────────────────────

/**
 * Génère un script/contenu pour les réseaux sociaux via LLM
 * Pioche dans la mémoire stratégique pour le contexte
 */
async function generateContent({ topic, style = 'reels_caption', platform = 'instagram', language = 'fr' }) {
  const claude = require('../agents/claude');

  // Récupérer le contexte stratégique pertinent
  let stratContext = '';
  try {
    const mem = require('./strategic-memory');
    const notes = await mem.getNotes({ limit: 5 });
    if (notes.length > 0) {
      stratContext = `\nContexte stratégique du salon:\n${notes.map(n => `- ${n.title}: ${n.content.slice(0, 100)}`).join('\n')}`;
    }
  } catch (_) {}

  const styleDesc = CONTENT_STYLES[style] || style;
  const systemPrompt = `Tu es le responsable marketing de Kadio Coiffure et Esthétique, un salon premium à Longueuil, QC.
Tu crées du contenu authentique et engageant pour attirer des clients afro-caribéens et québécois.
Services clés: Tresses, Dreadlocks, Tissages, Extensions, Bar à Plantes (soins botaniques naturels).
Ton: chaleureux, moderne, culturellement ancré. Langue: ${language}.
${stratContext}`;

  const prompt = `Génère un ${styleDesc} pour ${platform} sur le thème: "${topic}".
Format de réponse:
- Titre/Hook: (accroche principale)
- Contenu: (corps du message)
- Hashtags: (si applicable)
- CTA: (appel à l'action)`;

  const result = await claude.query(prompt, systemPrompt, []);
  return {
    platform,
    style,
    topic,
    content: result.content,
    generatedAt: new Date().toISOString(),
  };
}

// ─── FILE D'ATTENTE DE PUBLICATIONS ──────────────────────────────────────────

/**
 * Ajoute une publication à la file d'attente
 */
async function schedulePost({ platform, content, caption, mediaUrl, scheduledAt, topic, style }) {
  const entry = {
    platform,
    content: content || caption,
    media_url: mediaUrl,
    scheduled_at: scheduledAt || new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
    topic,
    style,
    status: 'pending',
    created_at: new Date().toISOString(),
  };

  if (DEMO_MODE) {
    bus.system(`[SOCIAL] Post planifié (démo): [${platform}] "${(content || '').slice(0, 50)}..."`);
    return { ...entry, id: Date.now(), demo: true };
  }

  try {
    const res = await pool.query(`
      INSERT INTO daleba_content_queue (platform, content, media_url, scheduled_at, topic, style, status)
      VALUES ($1, $2, $3, $4, $5, $6, 'pending')
      RETURNING *
    `, [platform, entry.content, mediaUrl, entry.scheduled_at, topic, style]);
    bus.system(`[SOCIAL] Post planifié: [${platform}] pour ${entry.scheduled_at.slice(0, 10)}`);
    return res.rows[0];
  } catch (err) {
    bus.emit('error', `Schedule post failed: ${err.message}`);
    return entry;
  }
}

/**
 * Récupère les posts en attente de publication
 */
async function getPendingPosts(platform) {
  if (DEMO_MODE) return [];
  try {
    let q = `SELECT * FROM daleba_content_queue WHERE status = 'pending' AND scheduled_at <= NOW()`;
    const params = [];
    if (platform) { params.push(platform); q += ` AND platform = $${params.length}`; }
    q += ' ORDER BY scheduled_at ASC LIMIT 10';
    const res = await pool.query(q, params);
    return res.rows;
  } catch { return []; }
}

/**
 * Publie les posts planifiés (à appeler via cron ou manuellement)
 */
async function publishPendingPosts() {
  const posts = await getPendingPosts();
  if (posts.length === 0) return { published: 0 };

  const meta = require('./meta-social');
  let published = 0;

  for (const post of posts) {
    try {
      if (post.platform === 'facebook' || post.platform === 'instagram') {
        await meta.postToFacebook(post.content, post.media_url);
      }
      await pool.query(
        `UPDATE daleba_content_queue SET status = 'published', published_at = NOW() WHERE id = $1`,
        [post.id]
      );
      bus.system(`[SOCIAL] Publié: [${post.platform}] ${post.content.slice(0, 50)}...`);
      published++;
    } catch (err) {
      await pool.query(
        `UPDATE daleba_content_queue SET status = 'failed', error = $1 WHERE id = $2`,
        [err.message, post.id]
      ).catch(() => {});
      bus.emit('error', `Publish failed [${post.platform}]: ${err.message}`);
    }
  }

  return { published, total: posts.length };
}

/**
 * Génère et planifie automatiquement du contenu depuis la mémoire stratégique
 * (pipeline hebdomadaire complet)
 */
async function autoGenerateWeeklyContent() {
  const mem = require('./strategic-memory');
  const notes = await mem.getNotes({ limit: 10 });

  const topics = notes.length > 0
    ? notes.slice(0, 3).map(n => n.title)
    : [
        'Tresses africaines tendance 2025',
        'Bar à Plantes — soins botaniques pour cheveux crépus',
        'Pourquoi choisir Kadio Coiffure à Longueuil',
      ];

  const scheduled = [];
  for (let i = 0; i < topics.length; i++) {
    const topic = topics[i];
    const styles = ['reels_caption', 'tiktok_script', 'fb_post'];
    const platforms = ['instagram', 'tiktok', 'facebook'];

    const generated = await generateContent({ topic, style: styles[i], platform: platforms[i] });
    const scheduledAt = new Date(Date.now() + (i + 1) * 48 * 60 * 60 * 1000).toISOString();

    const post = await schedulePost({
      platform: platforms[i],
      content: generated.content,
      topic,
      style: styles[i],
      scheduledAt,
    });
    scheduled.push(post);
  }

  bus.system(`[SOCIAL] Pipeline auto: ${scheduled.length} posts générés pour la semaine`);
  return scheduled;
}

module.exports = {
  PLATFORMS,
  CONTENT_STYLES,
  generateContent,
  schedulePost,
  getPendingPosts,
  publishPendingPosts,
  autoGenerateWeeklyContent,
};
