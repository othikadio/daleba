/**
 * social-calendar-routes.js — Rituel du Lundi: Calendrier éditorial Social Media
 * POST /api/social/generate-week   — génère 7 posts IA par plateforme
 * POST /api/social/schedule-all    — programme les posts approuvés via Publora
 * GET  /api/social/week-status     — retourne le calendrier semaine en cours
 */
const express = require('express');
const router = express.Router();
const axios = require('axios');
const Anthropic = require('@anthropic-ai/sdk');
const { pool } = require('../memory/db');

const PUBLORA_KEY = process.env.PUBLORA_API_KEY || 'sk_mpnctvim_42eefe4d.4f8f32fb9e08ab9a7fb29af54bec4ec596c16d91b8d6d522d037';
const PUBLORA_BASE = 'https://api.publora.com/api/v1';

const ACCOUNTS = {
  instagram: 'instagram-17841459218131579',
  facebook:  'facebook-255568957645612',
  tiktok:    'tiktok--000RfouGS0MJJ0gNbRlYGrMuY-jnNaX0Wpw'
};

const publoraHeaders = () => ({ 'x-publora-key': PUBLORA_KEY, 'Content-Type': 'application/json' });

// ── Ensure table ─────────────────────────────────────────────────────────────
async function ensureSocialCalendarTable() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS social_calendar_posts (
      id SERIAL PRIMARY KEY,
      week_start DATE NOT NULL,
      day_of_week INT NOT NULL,  -- 0=Lundi, 6=Dimanche
      platform VARCHAR(32) NOT NULL,
      caption TEXT NOT NULL,
      image_url TEXT,
      hashtags TEXT,
      publish_at TIMESTAMPTZ,
      status VARCHAR(32) DEFAULT 'draft',  -- draft, approved, scheduled, published, failed
      publora_post_id TEXT,
      created_at TIMESTAMPTZ DEFAULT NOW(),
      updated_at TIMESTAMPTZ DEFAULT NOW()
    );
    CREATE INDEX IF NOT EXISTS idx_social_week ON social_calendar_posts(week_start);
  `);
}
ensureSocialCalendarTable().catch(e => console.warn('[social-calendar] table:', e.message));

// ── Get current week start (Monday) ─────────────────────────────────────────
function getWeekStart(date = new Date()) {
  const d = new Date(date);
  const day = d.getDay();
  const diff = (day === 0 ? -6 : 1 - day); // Monday
  d.setDate(d.getDate() + diff);
  d.setHours(0, 0, 0, 0);
  return d;
}

// ── POST /api/social/generate-week ──────────────────────────────────────────
router.post('/generate-week', async (req, res) => {
  try {
    const weekStart = getWeekStart();
    const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

    const platforms = ['instagram', 'facebook', 'tiktok'];
    const dayNames = ['Lundi', 'Mardi', 'Mercredi', 'Jeudi', 'Vendredi', 'Samedi', 'Dimanche'];
    const posts = [];

    // Delete existing drafts for this week
    await pool.query(
      `DELETE FROM social_calendar_posts WHERE week_start = $1 AND status = 'draft'`,
      [weekStart.toISOString().split('T')[0]]
    );

    // Generate 7 posts per platform via Claude
    for (const platform of platforms) {
      const platformCtx = {
        instagram: 'visuels élégants, tresses afro, bobwigs, tendances capillaires québécoises. Ton inspirant et beau. Max 2200 chars, 5-8 hashtags.',
        facebook: 'contenu communautaire, promos, témoignages clients. Ton chaleureux et proche. Max 500 mots.',
        tiktok: 'contenu accrocheur et viral, challenges, avant/après, tendances. Ton dynamique et jeune. Max 300 chars + 3-5 hashtags.'
      };

      const prompt = `Tu es le responsable social media de Kadio Coiffure, salon afro à Longueuil, Québec.

Génère 7 posts (un pour chaque jour de la semaine, lundi à dimanche) pour ${platform.toUpperCase()}.
Chaque post doit être unique et pertinent.

Contexte plateforme: ${platformCtx[platform]}

Pour chaque jour, retourne un objet JSON avec:
- day: 0-6 (0=lundi)
- caption: le texte du post
- hashtags: string de hashtags (ex: "#tresses #afro #montreal")
- imageDescription: description courte de l'image idéale à utiliser

Thèmes suggérés (1 par jour): 
- Lundi: Transformation/Avant-Après
- Mardi: Conseil capillaire
- Mercredi: Mise en avant d'une coiffure du portfolio
- Jeudi: Témoignage client
- Vendredi: Promo weekend / RDV disponibles
- Samedi: Derrière les coulisses du salon
- Dimanche: Inspiration tendance

Réponds UNIQUEMENT avec un tableau JSON valide de 7 objets. Pas de markdown, pas de texte avant/après.`;

      const response = await anthropic.messages.create({
        model: 'claude-opus-4-5',
        max_tokens: 3000,
        messages: [{ role: 'user', content: prompt }]
      });

      let generated;
      try {
        const text = response.content[0].text.trim();
        // Extract JSON from response
        const match = text.match(/\[[\s\S]*\]/);
        generated = JSON.parse(match ? match[0] : text);
      } catch (e) {
        console.warn('[social/gen] JSON parse error:', e.message);
        // Fallback posts
        generated = Array.from({length:7}, (_,i) => ({
          day: i,
          caption: `Post ${dayNames[i]} — ${platform} — Kadio Coiffure ✂️`,
          hashtags: '#kadiocoiffure #longueuil #coiffureafro',
          imageDescription: 'Photo de coiffure du salon'
        }));
      }

      // Insert posts
      for (const post of generated) {
        const dayIndex = typeof post.day === 'number' ? post.day : 0;
        const publishDate = new Date(weekStart);
        publishDate.setDate(publishDate.getDate() + dayIndex);
        publishDate.setHours(platform === 'tiktok' ? 18 : platform === 'instagram' ? 12 : 15, 0, 0, 0);

        const res2 = await pool.query(`
          INSERT INTO social_calendar_posts (week_start, day_of_week, platform, caption, hashtags, publish_at, status)
          VALUES ($1, $2, $3, $4, $5, $6, 'draft')
          RETURNING id
        `, [
          weekStart.toISOString().split('T')[0],
          dayIndex,
          platform,
          post.caption || '',
          post.hashtags || '#kadiocoiffure',
          publishDate.toISOString()
        ]);
        posts.push({
          id: res2.rows[0].id,
          day: dayIndex,
          dayName: dayNames[dayIndex],
          platform,
          caption: post.caption,
          hashtags: post.hashtags,
          imageDescription: post.imageDescription,
          publishAt: publishDate.toISOString(),
          status: 'draft'
        });
      }
    }

    res.json({ success: true, weekStart: weekStart.toISOString(), postsGenerated: posts.length, posts });
  } catch (e) {
    console.error('[social/generate-week]', e.message);
    res.status(500).json({ error: e.message });
  }
});

// ── POST /api/social/schedule-all ────────────────────────────────────────────
router.post('/schedule-all', async (req, res) => {
  try {
    const weekStart = getWeekStart();
    const { postIds } = req.body || {}; // optionnel: IDs spécifiques à programmer

    let query = `
      SELECT * FROM social_calendar_posts
      WHERE week_start = $1 AND status = 'approved'
    `;
    const params = [weekStart.toISOString().split('T')[0]];

    if (postIds?.length) {
      query += ` AND id = ANY($2)`;
      params.push(postIds);
    }

    const result = await pool.query(query, params);
    const approvedPosts = result.rows;

    if (!approvedPosts.length) {
      return res.json({ success: true, scheduled: 0, message: 'Aucun post approuvé à programmer.' });
    }

    const scheduled = [];
    const failed = [];

    for (const post of approvedPosts) {
      try {
        const accountId = ACCOUNTS[post.platform];
        if (!accountId) { failed.push({ id: post.id, error: 'Plateforme inconnue' }); continue; }

        const caption = post.hashtags
          ? `${post.caption}\n\n${post.hashtags}`
          : post.caption;

        const publoraPayload = {
          account_ids: [accountId],
          content: caption,
          scheduled_at: post.publish_at
        };

        const pubRes = await axios.post(`${PUBLORA_BASE}/posts`, publoraPayload, {
          headers: publoraHeaders(),
          timeout: 15000
        });

        const pubData = pubRes.data;
        const publoraId = pubData?.id || pubData?.post_id || null;

        await pool.query(
          `UPDATE social_calendar_posts SET status='scheduled', publora_post_id=$1, updated_at=NOW() WHERE id=$2`,
          [String(publoraId || ''), post.id]
        );

        scheduled.push({ id: post.id, platform: post.platform, publoraId, publishAt: post.publish_at });
      } catch (e) {
        console.warn('[social/schedule]', post.id, e.message);
        await pool.query(`UPDATE social_calendar_posts SET status='failed', updated_at=NOW() WHERE id=$1`, [post.id]);
        failed.push({ id: post.id, error: e.message });
      }
    }

    res.json({ success: true, scheduled: scheduled.length, failed: failed.length, details: { scheduled, failed } });
  } catch (e) {
    console.error('[social/schedule-all]', e.message);
    res.status(500).json({ error: e.message });
  }
});

// ── GET /api/social/week-status ──────────────────────────────────────────────
router.get('/week-status', async (req, res) => {
  try {
    const weekStart = getWeekStart();
    const result = await pool.query(`
      SELECT id, day_of_week, platform, caption, hashtags, publish_at, status, publora_post_id, image_url
      FROM social_calendar_posts
      WHERE week_start = $1
      ORDER BY day_of_week, platform
    `, [weekStart.toISOString().split('T')[0]]);

    const dayNames = ['Lundi', 'Mardi', 'Mercredi', 'Jeudi', 'Vendredi', 'Samedi', 'Dimanche'];
    const posts = result.rows.map(p => ({
      ...p,
      dayName: dayNames[p.day_of_week]
    }));

    const stats = {
      total: posts.length,
      draft: posts.filter(p=>p.status==='draft').length,
      approved: posts.filter(p=>p.status==='approved').length,
      scheduled: posts.filter(p=>p.status==='scheduled').length,
      published: posts.filter(p=>p.status==='published').length,
    };

    res.json({ success: true, weekStart: weekStart.toISOString(), posts, stats });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ── PATCH /api/social/posts/:id — Approuver/Modifier un post ────────────────
router.patch('/posts/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const { status, caption, hashtags, publish_at } = req.body;

    const updates = [];
    const vals = [];
    let i = 1;

    if (status)     { updates.push(`status=$${i++}`);     vals.push(status); }
    if (caption)    { updates.push(`caption=$${i++}`);    vals.push(caption); }
    if (hashtags)   { updates.push(`hashtags=$${i++}`);   vals.push(hashtags); }
    if (publish_at) { updates.push(`publish_at=$${i++}`); vals.push(publish_at); }
    updates.push(`updated_at=NOW()`);
    vals.push(id);

    await pool.query(`UPDATE social_calendar_posts SET ${updates.join(',')} WHERE id=$${i}`, vals);
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

module.exports = router;
