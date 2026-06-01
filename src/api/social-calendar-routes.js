'use strict';
/**
 * DALEBA — Routes Calendrier Social Media (Rituel du Lundi)
 * POST /api/social/generate-week    — génère 21 posts via Claude
 * GET  /api/social/week-status      — statut semaine courante
 * POST /api/social/approve/:postId  — approuver un post
 * POST /api/social/schedule-all     — programmer via Publora
 */
const express = require('express');
const router = express.Router();

let pool = null, DEMO_MODE = true;
try { const db = require('../memory/db'); pool = db.pool; DEMO_MODE = db.DEMO_MODE; } catch(e) {}

const PUBLORA_KEY = process.env.PUBLORA_API_KEY || 'sk_mpnctvim_42eefe4d.4f8f32fb9e08ab9a7fb29af54bec4ec596c16d91b8d6d522d037';
const PUBLORA_ACCOUNTS = {
  instagram: 'instagram-17841459218131579',
  facebook:  'facebook-255568957645612',
  tiktok:    'tiktok--000RfouGS0MJJ0gNbRlYGrMuY-jnNaX0Wpw'
};

// Migration table
async function ensureSocialTable() {
  if (!pool || DEMO_MODE) return;
  await pool.query(`
    CREATE TABLE IF NOT EXISTS daleba_social_calendar (
      id SERIAL PRIMARY KEY,
      platform VARCHAR(20) NOT NULL,
      account_id VARCHAR(100),
      day_of_week INTEGER,
      scheduled_at TIMESTAMPTZ,
      caption TEXT,
      hashtags TEXT,
      image_prompt TEXT,
      status VARCHAR(30) DEFAULT 'draft',
      publora_post_id VARCHAR(100),
      week_start DATE,
      created_at TIMESTAMPTZ DEFAULT NOW()
    )
  `);
}
ensureSocialTable().catch(e => console.warn('[Social] Table init:', e.message));

// Obtenir le lundi de la semaine courante
function getWeekStart() {
  const now = new Date();
  const day = now.getDay();
  const diff = now.getDate() - day + (day === 0 ? -6 : 1);
  const monday = new Date(now);
  monday.setDate(diff);
  monday.setHours(0, 0, 0, 0);
  return monday;
}

// HTTP helper générique (pas d'axios requis)
function httpPost(url, headers, body) {
  return new Promise((resolve, reject) => {
    const https = require('https');
    const http = require('http');
    const parsed = new URL(url);
    const isHttps = parsed.protocol === 'https:';
    const lib = isHttps ? https : http;
    const data = JSON.stringify(body);
    const options = {
      hostname: parsed.hostname,
      port: parsed.port || (isHttps ? 443 : 80),
      path: parsed.pathname + parsed.search,
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data), ...headers }
    };
    const req = lib.request(options, (res) => {
      let raw = '';
      res.on('data', c => raw += c);
      res.on('end', () => {
        try { resolve({ status: res.statusCode, body: JSON.parse(raw) }); }
        catch { resolve({ status: res.statusCode, body: raw }); }
      });
    });
    req.on('error', reject);
    req.write(data);
    req.end();
  });
}

// Générer posts via Claude
async function generatePostsWithClaude(weekStart) {
  const Anthropic = require('@anthropic-ai/sdk');
  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

  const days = ['Lundi', 'Mardi', 'Mercredi', 'Jeudi', 'Vendredi', 'Samedi', 'Dimanche'];
  const platforms = ['instagram', 'tiktok', 'facebook'];

  const prompt = `Tu es le community manager de Kadio Coiffure, un salon afro-caribéen à Longueuil, Québec.
Génère un calendrier éditorial de 7 jours × 3 plateformes = 21 posts.

Contexte:
- Spécialités: tresses, locks dreadlocks, coiffures naturelles afro, twists
- Clientèle: communauté afro-caribéenne du Québec
- Ton: chaleureux, authentique, professionnel
- Langue: français québécois

Réponds UNIQUEMENT en JSON valide, tableau de 21 objets:
[{"platform":"instagram|tiktok|facebook","dayIndex":0,"dayName":"Lundi","hour":"12:00","caption":"...","hashtags":"#...","imagePrompt":"..."}]`;

  const response = await client.messages.create({
    model: 'claude-3-5-sonnet-20241022',
    max_tokens: 4000,
    messages: [{ role: 'user', content: prompt }]
  });

  const text = response.content[0].text;
  const jsonMatch = text.match(/\[[\s\S]*\]/);
  if (!jsonMatch) throw new Error('Claude n\'a pas retourné de JSON valide');

  const posts = JSON.parse(jsonMatch[0]);

  return posts.map(p => {
    const date = new Date(weekStart);
    date.setDate(date.getDate() + (p.dayIndex || 0));
    const [h, m] = (p.hour || '12:00').split(':');
    date.setHours(parseInt(h), parseInt(m), 0, 0);

    return {
      platform: p.platform || 'instagram',
      account_id: PUBLORA_ACCOUNTS[p.platform] || PUBLORA_ACCOUNTS.instagram,
      day_of_week: p.dayIndex || 0,
      day_name: p.dayName || days[p.dayIndex || 0],
      scheduled_at: date.toISOString(),
      caption: p.caption || '',
      hashtags: p.hashtags || '',
      image_prompt: p.imagePrompt || '',
      status: 'draft',
      week_start: weekStart.toISOString().split('T')[0]
    };
  });
}

/**
 * POST /api/social/generate-week
 */
router.post('/generate-week', async (req, res) => {
  try {
    const weekStart = getWeekStart();
    const days = ['Lundi', 'Mardi', 'Mercredi', 'Jeudi', 'Vendredi', 'Samedi', 'Dimanche'];
    const platforms = ['instagram', 'tiktok', 'facebook'];

    let posts;
    try {
      posts = await generatePostsWithClaude(weekStart);
    } catch(e) {
      console.warn('[Social] Claude error, using fallback:', e.message);
      posts = [];
      for (let d = 0; d < 7; d++) {
        for (const platform of platforms) {
          const date = new Date(weekStart);
          date.setDate(date.getDate() + d);
          date.setHours(12, 0, 0, 0);
          posts.push({
            platform,
            account_id: PUBLORA_ACCOUNTS[platform],
            day_of_week: d,
            day_name: days[d],
            scheduled_at: date.toISOString(),
            caption: `✨ ${days[d]} beauté! Venez sublimer vos cheveux chez Kadio Coiffure. Prenez RDV en ligne! 🌺`,
            hashtags: '#kadiocoiffure #coiffureafro #tresses #locks #longueuil #quebec',
            image_prompt: `Coiffure afro professionnelle en salon, ${days[d]}`,
            status: 'draft',
            week_start: weekStart.toISOString().split('T')[0]
          });
        }
      }
    }

    if (pool && !DEMO_MODE) {
      await pool.query(`
        DELETE FROM daleba_social_calendar WHERE week_start = $1 AND status = 'draft'
      `, [weekStart.toISOString().split('T')[0]]);

      for (const p of posts) {
        await pool.query(`
          INSERT INTO daleba_social_calendar
            (platform, account_id, day_of_week, scheduled_at, caption, hashtags, image_prompt, status, week_start)
          VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
        `, [p.platform, p.account_id, p.day_of_week, p.scheduled_at, p.caption, p.hashtags, p.image_prompt, p.status, p.week_start]);
      }
    }

    res.json({ success: true, count: posts.length, weekStart: weekStart.toISOString(), posts });
  } catch(e) {
    console.error('[Social] generate-week:', e);
    res.status(500).json({ error: e.message });
  }
});

/**
 * GET /api/social/week-status
 */
router.get('/week-status', async (req, res) => {
  try {
    const weekStart = getWeekStart();

    if (!pool || DEMO_MODE) {
      const days = ['Lundi', 'Mardi', 'Mercredi', 'Jeudi', 'Vendredi', 'Samedi', 'Dimanche'];
      const platforms = ['instagram', 'tiktok', 'facebook'];
      const demoData = [];
      for (let d = 0; d < 7; d++) {
        for (const platform of platforms) {
          const date = new Date(weekStart);
          date.setDate(date.getDate() + d);
          date.setHours(12, 0, 0, 0);
          demoData.push({
            id: d * 3 + platforms.indexOf(platform) + 1,
            platform, account_id: PUBLORA_ACCOUNTS[platform],
            day_of_week: d, day_name: days[d],
            scheduled_at: date.toISOString(),
            caption: `Post ${platform} du ${days[d]} — Spécialiste coiffures afro à Longueuil 🌺`,
            hashtags: '#kadiocoiffure #coiffureafro #tresses #longueuil',
            image_prompt: `Coiffure ${d % 2 === 0 ? 'tresses' : 'locks'} en salon`,
            status: d === 0 ? 'approved' : 'draft'
          });
        }
      }
      return res.json({ weekStart: weekStart.toISOString(), posts: demoData, isDemo: true });
    }

    const result = await pool.query(`
      SELECT * FROM daleba_social_calendar
      WHERE week_start = $1 ORDER BY day_of_week, platform
    `, [weekStart.toISOString().split('T')[0]]);

    res.json({ weekStart: weekStart.toISOString(), posts: result.rows });
  } catch(e) {
    res.status(500).json({ error: e.message });
  }
});

/**
 * POST /api/social/approve/:postId
 */
router.post('/approve/:postId', async (req, res) => {
  try {
    const { postId } = req.params;
    if (pool && !DEMO_MODE) {
      await pool.query(`UPDATE daleba_social_calendar SET status = 'approved' WHERE id = $1`, [postId]);
    }
    res.json({ success: true, postId, status: 'approved' });
  } catch(e) {
    res.status(500).json({ error: e.message });
  }
});

/**
 * POST /api/social/schedule-all
 */
router.post('/schedule-all', async (req, res) => {
  try {
    const weekStart = getWeekStart();
    let approvedPosts = [];

    if (pool && !DEMO_MODE) {
      const result = await pool.query(`
        SELECT * FROM daleba_social_calendar
        WHERE week_start = $1 AND status = 'approved'
      `, [weekStart.toISOString().split('T')[0]]);
      approvedPosts = result.rows;
    }

    if (!approvedPosts.length) {
      return res.json({ success: true, message: 'Aucun post approuvé à programmer', scheduled: 0 });
    }

    const results = [];
    for (const post of approvedPosts) {
      try {
        const resp = await httpPost(
          'https://api.publora.com/api/v1/posts',
          { 'x-publora-key': PUBLORA_KEY },
          {
            accountId: post.account_id,
            content: `${post.caption}\n\n${post.hashtags}`,
            scheduledAt: post.scheduled_at,
            mediaUrls: []
          }
        );

        const publoraId = resp.body?.id || resp.body?.postId || null;
        if (pool && !DEMO_MODE && publoraId) {
          await pool.query(
            `UPDATE daleba_social_calendar SET status = 'scheduled', publora_post_id = $1 WHERE id = $2`,
            [publoraId, post.id]
          );
        }
        results.push({ postId: post.id, platform: post.platform, status: 'scheduled', publoraId });
      } catch(e) {
        results.push({ postId: post.id, platform: post.platform, status: 'error', error: e.message });
      }
    }

    const scheduled = results.filter(r => r.status === 'scheduled').length;
    res.json({ success: true, scheduled, total: approvedPosts.length, results });
  } catch(e) {
    console.error('[Social] schedule-all:', e);
    res.status(500).json({ error: e.message });
  }
});

module.exports = router;
