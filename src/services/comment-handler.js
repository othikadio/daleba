/**
 * Comment Handler — DALEBA Metacortex Points 135-138
 *
 * [135] Lecture 100% des commentaires, asynchrone
 * [136] Claude réponse humaine, haut de gamme, < 30 min
 * [137] Intent achat/question → extraction user ID → DM automatique
 * [138] DM: salutation personnalisée + données Square + lien réservation unique
 */

'use strict';

const axios = require('axios');
const crypto = require('crypto');
const maintenance = require('./maintenance');

// ─── TYPES D'INTENT COMMERCIAUX [137] ────────────────────────────────────────

const PURCHASE_PATTERNS = [
  /prix|tarif|coût|combien|coute|coûte/i,
  /disponib|place|rdv|rendez.?vous|réserver|réservation|book/i,
  /samedi|dimanche|lundi|mardi|mercredi|jeudi|vendredi|weekend|semaine/i,
  /appointment|availability|schedule|open/i,
  /où|adresse|location|address|where/i,
  /téléphone|appel|call|contact|numéro|number/i,
];

function detectPurchaseIntent(text) {
  const matched = PURCHASE_PATTERNS.filter(p => p.test(text));
  return {
    hasPurchaseIntent: matched.length > 0,
    patterns:          matched.length,
    confidence:        Math.min(matched.length * 0.33, 1.0),
  };
}

// ─── GÉNÉRATION LIEN RÉSERVATION UNIQUE [138] ────────────────────────────────

function generateBookingLink(userId, platform) {
  const token   = crypto.createHmac('sha256', process.env.ANTHROPIC_API_KEY || 'daleba')
    .update(`${userId}_${platform}_${Date.now()}`)
    .digest('hex')
    .slice(0, 16);
  const baseUrl = process.env.DALEBA_BASE_URL || 'https://daleba-api-production.up.railway.app';
  return `${baseUrl}/api/booking/reserve?ref=${token}&src=${platform}`;
}

// ─── COLLECTE COMMENTAIRES META [135] ────────────────────────────────────────

async function fetchInstagramComments(postId) {
  const token = process.env.META_ACCESS_TOKEN;
  if (!token) return [];

  try {
    const r = await axios.get(
      `https://graph.facebook.com/v19.0/${postId}/comments`,
      {
        params: {
          fields: 'id,text,from,timestamp,like_count,replies{id,text,from,timestamp}',
          access_token: token,
          limit: 100,
        },
        timeout: 10000,
      }
    );
    return (r.data?.data || []).map(c => ({
      id: c.id, text: c.text, platform: 'instagram',
      userId: c.from?.id, userName: c.from?.name,
      timestamp: c.timestamp,
      replies: c.replies?.data || [],
    }));
  } catch (err) {
    console.warn(`[CommentHandler] Instagram comments ${postId}:`, err.message);
    return [];
  }
}

async function fetchTikTokComments(postId) {
  const token = process.env.TIKTOK_BUSINESS_TOKEN;
  if (!token) return [];

  try {
    const r = await axios.post(
      'https://open.tiktokapis.com/v2/comment/list/',
      { video_id: postId, count: 50, cursor: 0 },
      {
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json; charset=UTF-8' },
        timeout: 10000,
      }
    );
    return (r.data?.data?.comments || []).map(c => ({
      id: String(c.id), text: c.text, platform: 'tiktok',
      userId: String(c.user.open_id), userName: c.user.display_name,
      timestamp: new Date(c.create_time * 1000).toISOString(),
      likes: c.like_count || 0,
    }));
  } catch (err) {
    console.warn(`[CommentHandler] TikTok comments ${postId}:`, err.message);
    return [];
  }
}

// ─── GÉNÉRER RÉPONSE CLAUDE [136] ────────────────────────────────────────────

async function generateCommentReply(comment, postContext = {}) {
  const claude = require('../agents/claude');

  const prompt = `Tu réponds à un commentaire Instagram/TikTok pour Kadio Coiffure, salon premium à Longueuil, QC.

COMMENTAIRE de ${comment.userName || 'un client'}:
"${comment.text}"

CONTEXTE DU POST: ${postContext.description || 'Vidéo du salon Kadio Coiffure'}

RÈGLES STRICTES:
- Ton premium, chaleureux, personnel — jamais corporate ou robotique
- Max 2-3 phrases — concis et impactant
- Inclure le prénom si disponible
- Emoji naturel (1-2 max) si approprié
- Jamais de fautes / anglicismes forcés
- Si question prix/RDV → rediriger vers DM : "Je t'envoie les détails en DM ✨"
- Répondre en français sauf si commentaire en anglais

Réponds UNIQUEMENT avec le texte de la réponse, sans guillemets ni explication.`;

  const result = await claude.query(prompt,
    'Tu es le community manager premium de Kadio Coiffure. Naturel, chaleureux, haut de gamme.',
    []
  );

  return result.content.trim();
}

// ─── PUBLIER RÉPONSE [136] ────────────────────────────────────────────────────

async function replyToComment(comment, replyText) {
  const token = process.env.META_ACCESS_TOKEN;

  if (comment.platform === 'instagram' && token) {
    try {
      await axios.post(
        `https://graph.facebook.com/v19.0/${comment.id}/replies`,
        { message: replyText },
        { params: { access_token: token }, timeout: 8000 }
      );
      return { replied: true, platform: 'instagram' };
    } catch (err) {
      console.warn('[CommentHandler] Reply instagram:', err.message);
    }
  }

  if (comment.platform === 'tiktok') {
    const tkToken = process.env.TIKTOK_BUSINESS_TOKEN;
    if (tkToken) {
      try {
        await axios.post(
          'https://open.tiktokapis.com/v2/comment/reply/',
          { video_id: comment.postId, text: replyText, comment_id: comment.id },
          { headers: { Authorization: `Bearer ${tkToken}` }, timeout: 8000 }
        );
        return { replied: true, platform: 'tiktok' };
      } catch (err) {
        console.warn('[CommentHandler] Reply tiktok:', err.message);
      }
    }
  }

  return { replied: false };
}

// ─── ENVOYER DM [137-138] ────────────────────────────────────────────────────

async function sendPurchaseDM(comment, postContext = {}) {
  const claude = require('../agents/claude');
  const token  = process.env.META_ACCESS_TOKEN;

  if (!token) return { sent: false, reason: 'no_credentials' };

  // [138] Données Square pour réponse précise
  let squareData = null;
  try {
    const square = require('./square');
    const audit  = await square.getSquareWeeklyAudit();
    squareData   = audit;
  } catch { /* Square indisponible → on continue sans */ }

  // [138] Lien réservation unique
  const bookingLink = generateBookingLink(comment.userId, comment.platform);

  // [138] Message DM personnalisé avec Claude
  const prompt = `Tu rédiges un message privé (DM) pour ${comment.userName || 'un client potentiel'} de Kadio Coiffure.

Question/commentaire original: "${comment.text}"

${squareData ? `Données salon actuelles:
- Disponibilités approximatives: ${squareData.appointments?.available || 'consultez le lien'}
- Services: Coupe, tresses, locks, soins, coloration` : ''}

Lien de réservation: ${bookingLink}

Rédige un DM:
1. Salutation personnalisée avec le prénom ${comment.userName?.split(' ')[0] || ''}
2. Réponse directe à leur question (prix indicatifs si demandé, dispo si demandée)
3. Invitation à réserver via le lien
4. Signature: "L'équipe Kadio Coiffure 💜"

Max 5-6 phrases. Ton premium et chaleureux.`;

  const result = await claude.query(prompt,
    'Tu es l\'assistant premium de Kadio Coiffure. Message privé personnalisé.', []
  );
  const dmText = result.content.trim();

  // Envoi DM Instagram
  if (comment.platform === 'instagram' && token) {
    try {
      // Instagram DM via Messenger API
      await axios.post(
        `https://graph.facebook.com/v19.0/${process.env.META_FB_PAGE_ID}/messages`,
        {
          recipient: { id: comment.userId },
          message:   { text: dmText },
          messaging_type: 'RESPONSE',
        },
        { params: { access_token: token }, timeout: 10000 }
      );
      return { sent: true, platform: 'instagram', bookingLink };
    } catch (err) {
      console.warn('[CommentHandler] DM Instagram:', err.message);
      return { sent: false, error: err.message };
    }
  }

  return { sent: false, reason: 'platform_not_supported', dmText };
}

// ─── PIPELINE COMPLET COMMENTAIRES [135-138] ─────────────────────────────────

const processedComments = new Set(); // Anti-doublon session

/**
 * Traite tous les commentaires d'un post
 * Asynchrone et non-bloquant [135]
 */
async function processPostComments(postId, platform, postContext = {}) {
  const comments = platform === 'instagram'
    ? await fetchInstagramComments(postId)
    : await fetchTikTokComments(postId);

  if (comments.length === 0) return { processed: 0 };

  let processed = 0;

  for (const comment of comments) {
    const key = `${comment.platform}:${comment.id}`;
    if (processedComments.has(key)) continue;
    processedComments.add(key);

    // [136] Générer et poster la réponse (< 30 min implicite via scheduler)
    setImmediate(async () => {
      try {
        const replyText = await generateCommentReply(comment, postContext);
        await replyToComment({ ...comment, postId }, replyText);

        // [137] Détecter intent achat → DM
        const intent = detectPurchaseIntent(comment.text);
        if (intent.hasPurchaseIntent && comment.userId) {
          await sendPurchaseDM({ ...comment, postId }, postContext);
        }
      } catch (err) {
        console.warn(`[CommentHandler] Comment ${comment.id}:`, err.message);
      }
    });

    processed++;
  }

  return { processed, total: comments.length };
}

// ─── SCHEDULER COMMENTAIRES ───────────────────────────────────────────────────

function startCommentPoller(intervalMs = 30 * 60 * 1000) {
  setInterval(async () => {
    try {
      const pool = maintenance.getPool();
      if (!pool) return;

      const recent = await pool.query(`
        SELECT platform_post_id, platform, description
        FROM daleba_content_queue
        WHERE status='published'
        AND published_at >= NOW() - INTERVAL '7 days'
        AND platform_post_id IS NOT NULL
        ORDER BY published_at DESC LIMIT 20
      `);

      for (const row of recent.rows) {
        await processPostComments(row.platform_post_id, row.platform, { description: row.description });
      }
    } catch (err) {
      console.warn('[CommentHandler] Poller:', err.message);
    }
  }, intervalMs);

  console.log(`[CommentHandler] ✅ Poller démarré (toutes les ${intervalMs / 60000} min)`);
}

// ─── EXPORTS ─────────────────────────────────────────────────────────────────

module.exports = {
  fetchInstagramComments, fetchTikTokComments,
  generateCommentReply, replyToComment,
  detectPurchaseIntent, sendPurchaseDM,
  generateBookingLink, processPostComments,
  startCommentPoller,
};
