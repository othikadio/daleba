/**
 * DALEBA — Meta Messenger & Instagram DM Sender
 * Envoi de messages via Meta Graph API (Messenger + Instagram)
 * 
 * Hiérarchie token:
 *  1. DB (tenant_integrations) — token renouvelé via OAuth
 *  2. ENV var META_ACCESS_TOKEN — fallback si DB vide
 */

const { Pool } = require('pg');

const GRAPH_BASE = 'https://graph.facebook.com/v19.0';

// ─── Cache token en mémoire (TTL 5 min) ──────────────────────────────────────
let _tokenCache = { value: null, at: 0 };
const TOKEN_CACHE_TTL = 5 * 60 * 1000; // 5 minutes

let _pool = null;
function _getPool() {
  if (!_pool && process.env.DATABASE_URL) {
    _pool = new Pool({
      connectionString: process.env.DATABASE_URL,
      ssl: { rejectUnauthorized: false },
    });
  }
  return _pool;
}

/**
 * Récupère le token Meta actif.
 * 1. Cache mémoire (5 min)
 * 2. DB tenant_integrations (provider='meta', business_id='kadio-coiffure')
 * 3. Env var META_ACCESS_TOKEN
 */
async function getActiveToken() {
  // Cache
  if (_tokenCache.value && Date.now() - _tokenCache.at < TOKEN_CACHE_TTL) {
    return _tokenCache.value;
  }

  // DB
  try {
    const pool = _getPool();
    if (pool) {
      const { rows } = await pool.query(
        `SELECT access_token FROM tenant_integrations
         WHERE provider = 'meta'
         ORDER BY updated_at DESC LIMIT 1`
      );
      if (rows.length && rows[0].access_token) {
        _tokenCache = { value: rows[0].access_token, at: Date.now() };
        return _tokenCache.value;
      }
    }
  } catch (_) { /* fallback */ }

  // Env var
  const envToken = process.env.META_ACCESS_TOKEN;
  if (envToken) {
    _tokenCache = { value: envToken, at: Date.now() };
    return envToken;
  }

  console.warn('⚠️ [META] Aucun token disponible (DB vide + env var manquante)');
  return null;
}

/**
 * Invalide le cache token (ex: après renouvellement OAuth)
 */
function invalidateTokenCache() {
  _tokenCache = { value: null, at: 0 };
}

/**
 * Envoie un message via Meta Graph API
 */
async function sendMetaMessage(recipientId, text, platform = 'facebook') {
  const token = await getActiveToken();
  if (!token) {
    console.error('[META] Token manquant — impossible d\'envoyer.');
    return { success: false, error: 'token_missing' };
  }

  const endpoint = `${GRAPH_BASE}/me/messages?access_token=${token}`;
  const body = {
    recipient: { id: recipientId },
    message: { text },
    messaging_type: 'RESPONSE',
  };

  try {
    const res = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    const data = await res.json();

    if (!res.ok || data.error) {
      const errMsg = data.error?.message || `HTTP ${res.status}`;
      const code   = data.error?.code;
      console.error(`[META/${platform.toUpperCase()}] Échec envoi à ${recipientId}: ${errMsg}`);
      // Si token expiré (code 190), vider le cache pour le prochain appel
      if (code === 190) {
        invalidateTokenCache();
        console.warn('[META] Token expiré détecté — cache vidé. Renouvellement requis via /api/oauth/meta/start.');
      }
      return { success: false, error: errMsg, code };
    }

    console.log(`[META/${platform.toUpperCase()}] Message envoyé à ${recipientId}`);
    return { success: true, messageId: data.message_id };

  } catch (err) {
    console.error(`[META/${platform.toUpperCase()}] Erreur réseau: ${err.message}`);
    return { success: false, error: err.message };
  }
}

async function sendMessengerMessage(psid, text) {
  return sendMetaMessage(psid, text, 'facebook');
}

async function sendInstagramMessage(igsid, text) {
  return sendMetaMessage(igsid, text, 'instagram');
}

async function sendMessengerButtonMessage(psid, text, buttonTitle, buttonUrl) {
  const token = await getActiveToken();
  if (!token) return { success: false, error: 'token_missing' };

  const body = {
    recipient: { id: psid },
    message: {
      attachment: {
        type: 'template',
        payload: {
          template_type: 'button',
          text,
          buttons: [{ type: 'web_url', url: buttonUrl, title: buttonTitle, webview_height_ratio: 'full' }],
        },
      },
    },
    messaging_type: 'RESPONSE',
  };

  try {
    const res = await fetch(`${GRAPH_BASE}/me/messages?access_token=${token}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    const data = await res.json();
    if (!res.ok || data.error) {
      return sendMessengerMessage(psid, `${text}\n\n${buttonUrl}`);
    }
    return { success: true, messageId: data.message_id };
  } catch {
    return sendMessengerMessage(psid, `${text}\n\n${buttonUrl}`);
  }
}

module.exports = {
  sendMetaMessage,
  sendMessengerMessage,
  sendInstagramMessage,
  sendMessengerButtonMessage,
  invalidateTokenCache,
  getActiveToken,
};
