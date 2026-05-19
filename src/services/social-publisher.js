/**
 * Social Publisher — DALEBA Metacortex Points 127-131
 *
 * [127] Meta Graph API (Instagram/Facebook) + TikTok Business API
 * [128] Validation pré-upload: taille, AAC-LC, format
 * [129] Publication 100% autonome
 * [130] Capture erreurs → Notification Loop Shield → fallback
 * [131] Fallback: ré-encodage bitrate réduit + retry 15min
 */

'use strict';

const fs    = require('fs').promises;
const fsSync = require('fs');
const path  = require('path');
const axios = require('axios');
const ffmpeg = require('fluent-ffmpeg');
const { execSync } = require('child_process');

// ─── CONFIG API ───────────────────────────────────────────────────────────────

const META_ACCESS_TOKEN   = () => process.env.META_ACCESS_TOKEN;
const META_IG_ACCOUNT_ID  = () => process.env.META_IG_ACCOUNT_ID;
const META_FB_PAGE_ID     = () => process.env.META_FB_PAGE_ID;
const TIKTOK_BUSINESS_TOKEN = () => process.env.TIKTOK_BUSINESS_TOKEN;
const TIKTOK_OPEN_ID      = () => process.env.TIKTOK_OPEN_ID;

const MAX_SIZE_BYTES = 100 * 1024 * 1024; // [128] 100 MB max Reels

// ─── VALIDATION PRÉ-UPLOAD [128] ─────────────────────────────────────────────

async function validateVideoForUpload(filePath) {
  const stat = await fs.stat(filePath).catch(() => null);
  if (!stat) throw new Error(`Fichier introuvable: ${filePath}`);

  // [128] Taille max 100 MB
  if (stat.size > MAX_SIZE_BYTES) {
    throw Object.assign(new Error(`Taille ${(stat.size/1024/1024).toFixed(1)}MB dépasse 100MB`),
      { code: 'TOO_LARGE', sizeBytes: stat.size });
  }

  // [128] Validation codec/audio via ffprobe
  return new Promise((resolve, reject) => {
    ffmpeg.ffprobe(filePath, (err, meta) => {
      if (err) return reject(err);

      const video = meta.streams.find(s => s.codec_type === 'video');
      const audio = meta.streams.find(s => s.codec_type === 'audio');

      const issues = [];
      if (!video) issues.push('Aucun flux vidéo');
      if (video && !['h264', 'hevc'].includes(video.codec_name?.toLowerCase())) {
        issues.push(`Codec vidéo ${video.codec_name} non supporté (requis: h264/hevc)`);
      }
      if (!audio) issues.push('Aucun flux audio');
      if (audio) {
        // [128] AAC-LC stéréo ≥ 128kbps
        if (audio.codec_name?.toLowerCase() !== 'aac') issues.push(`Codec audio ${audio.codec_name} (requis: aac)`);
        if (audio.channels < 2) issues.push('Mono détecté (requis: stéréo)');
        const audioBr = parseInt(audio.bit_rate || 0);
        if (audioBr > 0 && audioBr < 128000) issues.push(`Bitrate audio ${Math.round(audioBr/1000)}kbps < 128kbps`);
      }

      if (issues.length > 0) {
        return reject(Object.assign(new Error(`Validation: ${issues.join('; ')}`),
          { code: 'VALIDATION_FAILED', issues }));
      }

      resolve({
        valid: true,
        sizeBytes: stat.size,
        sizeMB: (stat.size / 1024 / 1024).toFixed(2),
        duration: parseFloat(meta.format.duration),
        videoCodec: video.codec_name,
        audioCodec: audio?.codec_name,
        audioBitrate: Math.round((parseInt(audio?.bit_rate||0)) / 1000),
      });
    });
  });
}

// ─── RE-ENCODAGE FALLBACK [131] ───────────────────────────────────────────────

/**
 * [131] Ré-encode la vidéo avec un bitrate réduit pour passer la validation
 * Si shadowbanned: modifie le framerate de ±0.1% [134]
 */
async function reEncodeForFallback(filePath, options = {}) {
  const OUTPUT_DIR = process.env.VIDEO_OUTPUT_DIR || '/tmp/daleba_renders';
  await fs.mkdir(OUTPUT_DIR, { recursive: true });

  const ts         = Date.now();
  const suffix     = options.shadowban ? '_reprint' : '_reenc';
  const outputPath = path.join(OUTPUT_DIR, path.basename(filePath, '.mp4') + `${suffix}_${ts}.mp4`);

  const targetBitrate = options.targetBitrate || '2500k';

  // [134] Fingerprint altéré si shadowban — framerate ±0.1%
  const fpsMod = options.shadowban ? (options.fpsDelta || 0.001) : 0;

  return new Promise((resolve, reject) => {
    const cmd = ffmpeg(filePath)
      .videoCodec('libx264')
      .outputOptions([
        `-b:v ${targetBitrate}`,
        '-preset fast',
        '-crf 20',
        '-pix_fmt yuv420p',
        '-c:a aac',
        '-b:a 192k',
        '-ac 2',                         // Stéréo forcé
        '-movflags +faststart',
      ]);

    // [134] Modification légère du framerate pour changer la signature numérique
    if (fpsMod !== 0) {
      const currentFps = options.currentFps || 30;
      const newFps = Math.round((currentFps + fpsMod) * 1000) / 1000;
      cmd.outputOptions([`-r ${newFps}`]);
      console.log(`[Publisher] Fingerprint modifié: fps ${currentFps} → ${newFps}`);
    }

    cmd.output(outputPath)
      .on('end', () => resolve(outputPath))
      .on('error', reject)
      .run();
  });
}

// ─── META GRAPH — INSTAGRAM REELS [127] ──────────────────────────────────────

async function publishToInstagram(item) {
  const token  = META_ACCESS_TOKEN();
  const igId   = META_IG_ACCOUNT_ID();
  if (!token || !igId) throw Object.assign(new Error('META_ACCESS_TOKEN ou META_IG_ACCOUNT_ID manquant'),
    { code: 'NO_CREDENTIALS' });

  const { filePath, seo_title, description, hashtags } = item;
  const caption = [description, (hashtags || []).join(' ')].filter(Boolean).join('\n\n');

  // 1. Initier le container upload
  const initRes = await axios.post(
    `https://graph.facebook.com/v19.0/${igId}/media`,
    {
      video_url:    null, // On utilisera upload résumable
      caption,
      media_type:   'REELS',
      share_to_feed: true,
    },
    { headers: { Authorization: `Bearer ${token}` }, timeout: 15000 }
  );

  const containerId = initRes.data.id;
  if (!containerId) throw new Error('Instagram: container ID non reçu');

  // 2. Upload binaire
  const fileBuffer = await fs.readFile(filePath);
  await axios.post(
    `https://rupload.facebook.com/video-upload/v19.0/${containerId}`,
    fileBuffer,
    {
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/octet-stream',
        'offset': '0',
        'file_size': String(fileBuffer.length),
      },
      timeout: 120000,
      maxBodyLength: MAX_SIZE_BYTES,
    }
  );

  // 3. Attendre processing (polling max 60s)
  let status = 'IN_PROGRESS';
  for (let i = 0; i < 12 && status === 'IN_PROGRESS'; i++) {
    await new Promise(r => setTimeout(r, 5000));
    const poll = await axios.get(
      `https://graph.facebook.com/v19.0/${containerId}?fields=status_code`,
      { headers: { Authorization: `Bearer ${token}` } }
    );
    status = poll.data.status_code;
  }

  if (status !== 'FINISHED') throw new Error(`Instagram: processing ${status}`);

  // 4. Publier
  const pubRes = await axios.post(
    `https://graph.facebook.com/v19.0/${igId}/media_publish`,
    { creation_id: containerId },
    { headers: { Authorization: `Bearer ${token}` }, timeout: 15000 }
  );

  return { platform: 'instagram', postId: pubRes.data.id, containerId };
}

// ─── TIKTOK BUSINESS [127] ───────────────────────────────────────────────────

async function publishToTikTok(item) {
  const token  = TIKTOK_BUSINESS_TOKEN();
  const openId = TIKTOK_OPEN_ID();
  if (!token || !openId) throw Object.assign(new Error('TIKTOK_BUSINESS_TOKEN ou TIKTOK_OPEN_ID manquant'),
    { code: 'NO_CREDENTIALS' });

  const { filePath, description, hashtags } = item;
  const caption = `${description}\n${(hashtags || []).slice(0, 5).join(' ')}`.slice(0, 2200);

  // 1. Initier upload
  const initRes = await axios.post(
    'https://open.tiktokapis.com/v2/post/publish/video/init/',
    {
      post_info: { title: caption, privacy_level: 'PUBLIC_TO_EVERYONE' },
      source_info: { source: 'FILE_UPLOAD' },
    },
    {
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json; charset=UTF-8' },
      timeout: 10000,
    }
  );

  const uploadUrl = initRes.data?.data?.upload_url;
  const publishId = initRes.data?.data?.publish_id;
  if (!uploadUrl) throw new Error('TikTok: upload_url non reçu');

  // 2. Upload chunks
  const fileBuffer = await fs.readFile(filePath);
  await axios.put(uploadUrl, fileBuffer, {
    headers: {
      'Content-Type': 'video/mp4',
      'Content-Range': `bytes 0-${fileBuffer.length - 1}/${fileBuffer.length}`,
    },
    timeout: 120000,
    maxBodyLength: MAX_SIZE_BYTES,
  });

  return { platform: 'tiktok', postId: publishId };
}

// ─── PUBLIER SUR UNE PLATEFORME [129] ────────────────────────────────────────

const PUBLISHERS = {
  instagram: publishToInstagram,
  tiktok:    publishToTikTok,
};

/**
 * [129] Point d'entrée principal — publication autonome
 * [130] Capture erreur → Shield → fallback
 * [131] Fallback ré-encodage + retry 15min
 */
async function publishItem(item) {
  const bus      = (() => { try { return require('./event-bus'); } catch { return null; } })();
  const shield   = require('./notification-shield');
  const queue    = require('./content-queue');
  const platform = item.platform || 'instagram';

  console.log(`[Publisher] 🚀 Publication ${platform}: ${path.basename(item.file_path)}`);

  // [128] Validation pré-upload
  let validation;
  try {
    validation = await validateVideoForUpload(item.file_path);
  } catch (valErr) {
    // [131] Essai ré-encodage si trop gros ou codec invalide
    if (valErr.code === 'TOO_LARGE' || valErr.code === 'VALIDATION_FAILED') {
      console.log(`[Publisher] Validation échouée (${valErr.code}) — ré-encodage…`);
      const reEncPath = await reEncodeForFallback(item.file_path,
        { targetBitrate: '2000k', shadowban: item.shadowbanned });
      // Mettre à jour l'item avec le nouveau fichier
      await queue.markFailed(item.id, `Ré-encodage en cours: ${valErr.message}`, true);
      await queue.markScheduled(item.id, new Date(Date.now() + 15 * 60 * 1000));
      // Re-queue avec nouveau fichier
      await queue.addToQueue({ ...item, filePath: reEncPath, scheduledAt: new Date(Date.now() + 15 * 60 * 1000) });
      return { status: 'requeued', reason: valErr.message, reEncPath };
    }
    throw valErr;
  }

  // Publication
  const publisher = PUBLISHERS[platform];
  if (!publisher) throw new Error(`Plateforme non supportée: ${platform}`);

  try {
    const result = await publisher(item);
    await queue.markPublished(item.id, result.postId);
    bus?.system(`✅ Publié sur ${platform}: ${result.postId}`);
    return { status: 'published', ...result };

  } catch (pubErr) {
    // [130] Capture erreur → Shield
    const errMsg = pubErr.message || String(pubErr);
    console.error(`[Publisher] ❌ Erreur ${platform}: ${errMsg}`);

    await shield.shieldedSMS(
      process.env.ULRICH_PHONE_NUMBER,
      process.env.TWILIO_PHONE_NUMBER,
      `⚠️ Publication ${platform} échouée: ${errMsg.slice(0, 120)}`,
      { windowMs: 30 * 60 * 1000 }
    ).catch(() => {});

    // [131] Fallback ré-encodage + retry 15 min
    const isRetryable = pubErr.response?.status !== 401 && item.retry_count < 3;
    if (isRetryable) {
      try {
        const reEncPath = await reEncodeForFallback(item.file_path, { targetBitrate: '1800k' });
        await queue.markFailed(item.id, errMsg, true);
        await queue.addToQueue({
          ...item,
          filePath:    reEncPath,
          scheduledAt: new Date(Date.now() + 15 * 60 * 1000),
          retryCount:  (item.retry_count || 0) + 1,
        });
        return { status: 'retry_queued', error: errMsg, nextAttempt: '15min' };
      } catch (encErr) {
        console.error('[Publisher] Re-encode failed:', encErr.message);
      }
    }

    await queue.markFailed(item.id, errMsg, false);
    return { status: 'failed', error: errMsg };
  }
}

// ─── EXPORTS ─────────────────────────────────────────────────────────────────

module.exports = {
  validateVideoForUpload, reEncodeForFallback,
  publishToInstagram, publishToTikTok, publishItem,
  PUBLISHERS,
};
