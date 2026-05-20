'use strict';
/**
 * DALEBA — Pôle Média Autonome
 * 3 publications/jour — TikTok · Instagram · Facebook
 *
 * WORKFLOW :
 * 1. Ulrich dépose une vidéo brute → POST /api/media/upload
 * 2. Claude analyse le contenu + génère caption + hashtags
 * 3. Le pipeline encode (FFmpeg) aux formats plateformes
 * 4. Planification : matin 09h, après-midi 13h, soir 19h (Toronto)
 * 5. Publication auto via Meta Graph API + TikTok API
 * 6. Rapport push → Ulrich par SMS
 */

const path = require('path');
const fs   = require('fs');
const LOG  = '[MEDIA-PIPELINE]';

let pool = null, DEMO_MODE = true;
try { const db = require('../memory/db'); pool = db.pool; DEMO_MODE = db.DEMO_MODE; } catch(e) {}

let Anthropic = null;
try { Anthropic = require('@anthropic-ai/sdk'); } catch(e) {}

let twilioClient = null;
try { const twilio = require('twilio'); twilioClient = twilio(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN); } catch(e) {}

const TWILIO_FROM   = process.env.TWILIO_PHONE_NUMBER || '+13022328291';
const ULRICH_PHONE  = process.env.ULRICH_PHONE_NUMBER || '+15149845970';

// Heures de publication (heure locale Toronto → UTC−4 en été)
const PUBLISH_SLOTS = [
  { label:'matin',        localHour:9  },
  { label:'après-midi',   localHour:13 },
  { label:'soir',         localHour:19 },
];

// Formats cibles
const PLATFORM_FORMATS = {
  instagram_reel: { w:1080, h:1920, fps:30, maxSec:90,  label:'Instagram Reel' },
  tiktok:         { w:1080, h:1920, fps:30, maxSec:180, label:'TikTok'         },
  facebook_reel:  { w:1080, h:1920, fps:30, maxSec:60,  label:'Facebook Reel'  },
  instagram_post: { w:1080, h:1080, fps:30, maxSec:60,  label:'Instagram Post' },
};

// ─── INIT TABLE ────────────────────────────────────────────────────────────────
async function init() {
  if (!pool) return;
  await pool.query(`
    CREATE TABLE IF NOT EXISTS daleba_content_queue (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      raw_file_path TEXT,
      platform VARCHAR(30) NOT NULL,
      caption TEXT,
      hashtags TEXT,
      scheduled_at TIMESTAMP,
      published_at TIMESTAMP,
      status VARCHAR(20) DEFAULT 'pending',  -- pending|encoding|ready|published|failed
      platform_post_id VARCHAR(200),
      engagement JSONB,
      created_at TIMESTAMP DEFAULT NOW()
    );
  `);
  console.log(`${LOG} Table content_queue OK`);
}

// ─── ANALYSER UNE VIDÉO AVEC CLAUDE ───────────────────────────────────────────
async function analyzeAndCaption({ rawPath, platform, context }) {
  const salonContext = `
Salon : Kadio Coiffure — 615 Antoinette-Robidoux, local 100, Longueuil, QC
Spécialités : Locs, Knotless braids, Microlocks, Tresses, Coupe barbier, Tissage
Cible : Communauté afro-caribéenne de Montréal/Longueuil, 18-45 ans
Ton : Chaleureux, professionnel, fier de la culture, authentique
Langue : Français canadien (expressions québécoises légères OK)
CTA habituel : "Réservez votre prochain rendez-vous → kadiocoiffure.vercel.app"
`.trim();

  const platformGuides = {
    tiktok:         'TikTok : accrocheuse en 3 mots, tendance, 1-2 emojis, hashtags tendance dont #coiffure #braids #montreal',
    instagram_reel: 'Instagram Reel : storytelling, émotion, 3-5 phrases, appel à la communauté, 15-25 hashtags niché',
    facebook_reel:  'Facebook : chaleureuse, informative, 2-3 phrases courtes, 5-8 hashtags locaux Longueuil/Montréal',
    instagram_post: 'Instagram Post : descriptif du look, technique utilisée, invitation à réserver',
  };

  const prompt = `Tu es le community manager de ${salonContext}

Contenu vidéo : ${context || 'Vidéo de coiffure afro du salon Kadio Coiffure'}
Plateforme : ${platformGuides[platform] || platform}

Génère :
1. CAPTION: texte de publication optimisé (max 280 caractères pour TikTok, 2200 pour Instagram)
2. HASHTAGS: liste de hashtags séparés par des espaces (selon la plateforme)
3. HOOK: les 3 premiers mots/la première phrase — doit arrêter le scroll

Réponds en JSON strict : {"caption":"...","hashtags":"...","hook":"..."}`;

  if (!Anthropic || !process.env.ANTHROPIC_API_KEY) {
    // Fallback demo caption
    return {
      caption: `✨ Nouveau look Kadio Coiffure ! Réservez votre prochain rendez-vous → kadiocoiffure.vercel.app`,
      hashtags: '#coiffure #braids #montreal #longueuil #knotless #locs #naturalhair #afro #coiffureafro',
      hook: 'Regardez ce résultat 👀',
    };
  }

  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  const response = await client.messages.create({
    model: 'claude-opus-4-5',
    max_tokens: 600,
    messages: [{ role: 'user', content: prompt }],
  });

  try {
    return JSON.parse(response.content[0].text);
  } catch(e) {
    return { caption: response.content[0].text, hashtags: '#coiffure #braids #montreal', hook: '' };
  }
}

// ─── PLANIFIER UN CONTENU ─────────────────────────────────────────────────────
async function scheduleContent({ rawPath, platform, context, scheduledAt }) {
  const caption_data = await analyzeAndCaption({ rawPath, platform, context });

  // Calculer le prochain créneau libre si scheduledAt non fourni
  let slot = scheduledAt ? new Date(scheduledAt) : nextAvailableSlot(platform);

  if (DEMO_MODE || !pool) {
    console.log(`${LOG} [DEMO] Contenu planifié: ${platform} @ ${slot.toISOString()}`);
    return {
      id: 'demo-' + Date.now(),
      platform,
      caption: caption_data.caption,
      hashtags: caption_data.hashtags,
      hook: caption_data.hook,
      scheduledAt: slot,
      status: 'ready',
      demo: true,
    };
  }

  const r = await pool.query(`
    INSERT INTO daleba_content_queue
      (raw_file_path, platform, caption, hashtags, scheduled_at, status)
    VALUES ($1,$2,$3,$4,$5,'ready') RETURNING *
  `, [rawPath||null, platform, caption_data.caption + '\n' + caption_data.hashtags, caption_data.hashtags, slot]);

  console.log(`${LOG} Contenu planifié: ${platform} @ ${slot.toISOString()}`);
  return { ...r.rows[0], hook: caption_data.hook };
}

// ─── PROCHAIN CRÉNEAU DISPONIBLE ──────────────────────────────────────────────
function nextAvailableSlot(platform) {
  const now = new Date();
  // Toronto UTC-4 en été
  const torontoOffset = -4 * 60;
  const torontoNow = new Date(now.getTime() + (torontoOffset + now.getTimezoneOffset()) * 60000);

  for (let dayOffset = 0; dayOffset <= 7; dayOffset++) {
    for (const slot of PUBLISH_SLOTS) {
      const candidate = new Date(torontoNow);
      candidate.setDate(candidate.getDate() + dayOffset);
      candidate.setHours(slot.localHour, 0, 0, 0);
      if (candidate > torontoNow) {
        // Convertir en UTC
        return new Date(candidate.getTime() - (torontoOffset + now.getTimezoneOffset()) * 60000);
      }
    }
  }
  return new Date(now.getTime() + 3_600_000);
}

// ─── PUBLIER VIA META GRAPH API ────────────────────────────────────────────────
async function publishToMeta({ contentId, platform, caption, mediaUrl }) {
  const accessToken = process.env.META_ACCESS_TOKEN;
  const igAccountId = process.env.META_IG_ACCOUNT_ID;
  const fbPageId    = process.env.META_FB_PAGE_ID;

  if (!accessToken) {
    console.log(`${LOG} META_ACCESS_TOKEN manquant — publication simulée`);
    return { success: false, reason: 'META_ACCESS_TOKEN non configuré', demo: true };
  }

  // Instagram Reels/Posts
  if (platform.includes('instagram')) {
    const mediaType = platform === 'instagram_reel' ? 'REELS' : 'IMAGE';
    try {
      // Étape 1: créer le container média
      const containerRes = await fetch(
        `https://graph.facebook.com/v19.0/${igAccountId}/media?` +
        `media_type=${mediaType}&video_url=${encodeURIComponent(mediaUrl)}&caption=${encodeURIComponent(caption)}&access_token=${accessToken}`,
        { method: 'POST' }
      );
      const container = await containerRes.json();
      if (!container.id) return { success: false, error: container.error?.message };

      // Étape 2: publier le container
      const publishRes = await fetch(
        `https://graph.facebook.com/v19.0/${igAccountId}/media_publish?creation_id=${container.id}&access_token=${accessToken}`,
        { method: 'POST' }
      );
      const published = await publishRes.json();
      console.log(`${LOG} IG publié: ${published.id}`);
      return { success: true, postId: published.id, platform: 'instagram' };
    } catch(e) {
      return { success: false, error: e.message };
    }
  }

  // Facebook
  if (platform === 'facebook_reel') {
    try {
      const r = await fetch(
        `https://graph.facebook.com/v19.0/${fbPageId}/videos`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ file_url: mediaUrl, description: caption, access_token: accessToken }),
        }
      );
      const data = await r.json();
      return { success: !!data.id, postId: data.id, platform: 'facebook' };
    } catch(e) {
      return { success: false, error: e.message };
    }
  }

  return { success: false, reason: `Plateforme ${platform} non gérée par ce module` };
}

// ─── WORKER : PUBLICATION AUTOMATIQUE ─────────────────────────────────────────
async function runPublishWorker() {
  if (!pool || DEMO_MODE) {
    console.log(`${LOG} [DEMO] Worker publication — mode démo actif`);
    return;
  }

  const now = new Date();
  const due = await pool.query(`
    SELECT * FROM daleba_content_queue
    WHERE status = 'ready'
      AND scheduled_at <= $1
      AND published_at IS NULL
    ORDER BY scheduled_at ASC
    LIMIT 5
  `, [now]);

  for (const item of due.rows) {
    try {
      // Marquer en cours
      await pool.query('UPDATE daleba_content_queue SET status=$1 WHERE id=$2', ['publishing', item.id]);

      const result = await publishToMeta({
        contentId: item.id,
        platform: item.platform,
        caption: item.caption,
        mediaUrl: item.raw_file_path,
      });

      if (result.success) {
        await pool.query(
          'UPDATE daleba_content_queue SET status=$1, published_at=$2, platform_post_id=$3 WHERE id=$4',
          ['published', now, result.postId, item.id]
        );
        console.log(`${LOG} Publié: ${item.platform} — post ${result.postId}`);

        // SMS Ulrich
        if (twilioClient) {
          await twilioClient.messages.create({
            body: `📱 DALEBA Media: "${item.caption.substring(0,60)}…" publié sur ${item.platform}`,
            from: TWILIO_FROM, to: ULRICH_PHONE,
          });
        }
      } else {
        await pool.query('UPDATE daleba_content_queue SET status=$1 WHERE id=$2', ['failed', item.id]);
        console.error(`${LOG} Échec publication ${item.platform}: ${result.error||result.reason}`);
      }
    } catch(e) {
      await pool.query('UPDATE daleba_content_queue SET status=$1 WHERE id=$2', ['failed', item.id]);
      console.error(`${LOG} Erreur worker: ${e.message}`);
    }
  }
}

// ─── CRÉER 3 CONTENUS DEPUIS UNE SEULE VIDÉO ─────────────────────────────────
async function processRawVideo({ rawPath, context }) {
  const platforms = ['instagram_reel', 'tiktok', 'facebook_reel'];
  const results = [];

  for (const platform of platforms) {
    const result = await scheduleContent({ rawPath, platform, context });
    results.push(result);
    // Petit délai pour ne pas saturer l'API Claude
    await new Promise(r => setTimeout(r, 500));
  }

  console.log(`${LOG} 3 contenus planifiés depuis: ${rawPath}`);
  return results;
}

module.exports = {
  init,
  analyzeAndCaption,
  scheduleContent,
  processRawVideo,
  runPublishWorker,
  PUBLISH_SLOTS,
  PLATFORM_FORMATS,
};
