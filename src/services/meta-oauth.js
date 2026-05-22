'use strict';

/**
 * DALEBA — Meta OAuth2 (Facebook + Instagram)
 * Flux d'autorisation officiel Meta Graph API.
 *
 * Un clic client → Token Page + Page ID + IG User ID → tout en DB.
 * Zéro complexité pour la PME.
 */

const crypto  = require('crypto');
const https   = require('https');
const http    = require('https'); // alias
const { Pool } = require('pg');
const bus     = require('./event-bus');

const META_OAUTH_BASE = 'https://www.facebook.com/v19.0/dialog/oauth';
const META_TOKEN_URL  = 'https://graph.facebook.com/v19.0/oauth/access_token';
const META_GRAPH_BASE = 'https://graph.facebook.com/v19.0';

// Permissions nécessaires pour Messenger + Instagram DMs + Pages
const META_SCOPES = [
  'pages_show_list',
  'pages_read_engagement',
  'pages_messaging',
  'instagram_basic',
  'instagram_manage_messages',
  'business_management',
].join(',');

const STATE_EXPIRY_MS = 15 * 60 * 1000; // 15 minutes

// ─── STATE JWT sécurisé (CSRF protection) ─────────────────────────────────────

function _stateSecret() {
  return process.env.META_STATE_SECRET
    || process.env.VAULT_SECRET
    || process.env.ANTHROPIC_API_KEY
    || 'daleba-meta-state-secret';
}

function _signState(payload) {
  const json = JSON.stringify(payload);
  const b64  = Buffer.from(json).toString('base64url');
  const sig  = crypto
    .createHmac('sha256', _stateSecret())
    .update(b64)
    .digest('hex');
  return `${b64}.${sig}`;
}

function _parseState(state) {
  const [b64, sig] = (state || '').split('.');
  if (!b64 || !sig) throw new Error('State invalide');
  const expected = crypto
    .createHmac('sha256', _stateSecret())
    .update(b64)
    .digest('hex');
  if (!crypto.timingSafeEqual(
    Buffer.from(sig.padEnd(64, '0').slice(0, 64), 'hex'),
    Buffer.from(expected.padEnd(64, '0').slice(0, 64), 'hex')
  )) throw new Error('State signature invalide');
  const payload = JSON.parse(Buffer.from(b64, 'base64url').toString());
  if (Date.now() > payload.exp) throw new Error('State expiré');
  return payload;
}

// ─── Requête HTTPS brute (sans dépendance axios) ──────────────────────────────

function _get(url) {
  return new Promise((resolve, reject) => {
    https.get(url, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try { resolve(JSON.parse(data)); }
        catch { reject(new Error(`Parse error: ${data.slice(0, 100)}`)); }
      });
    }).on('error', reject);
  });
}

// ─── ÉTAPE 1 : Générer l'URL d'autorisation ───────────────────────────────────

/**
 * Génère l'URL que le client clique pour connecter son Facebook.
 * @param {string} tenantId  - ID du tenant dans DALEBA
 * @param {string} baseUrl   - URL de base de l'API (ex: https://daleba-api.up.railway.app)
 */
function buildAuthUrl(tenantId, baseUrl) {
  const appId       = process.env.META_APP_ID;
  const redirectUri = `${baseUrl}/api/oauth/meta/callback`;

  if (!appId) throw new Error('META_APP_ID non configuré');

  const state = _signState({
    tenantId,
    exp: Date.now() + STATE_EXPIRY_MS,
    nonce: crypto.randomBytes(8).toString('hex'),
  });

  const params = new URLSearchParams({
    client_id:     appId,
    redirect_uri:  redirectUri,
    scope:         META_SCOPES,
    response_type: 'code',
    state,
  });

  return `${META_OAUTH_BASE}?${params.toString()}`;
}

// ─── ÉTAPE 2 : Échanger le code contre un token ───────────────────────────────

async function exchangeCode(code, redirectUri) {
  const params = new URLSearchParams({
    client_id:     process.env.META_APP_ID,
    client_secret: process.env.META_APP_SECRET,
    redirect_uri:  redirectUri,
    code,
  });
  const data = await _get(`${META_TOKEN_URL}?${params.toString()}`);
  if (data.error) throw new Error(`Meta token error: ${data.error.message}`);
  return data; // { access_token, token_type, expires_in? }
}

// ─── ÉTAPE 3 : Obtenir un token de longue durée ───────────────────────────────

async function getLongLivedToken(shortToken) {
  const params = new URLSearchParams({
    grant_type:        'fb_exchange_token',
    client_id:         process.env.META_APP_ID,
    client_secret:     process.env.META_APP_SECRET,
    fb_exchange_token: shortToken,
  });
  const data = await _get(`${META_TOKEN_URL}?${params.toString()}`);
  if (data.error) throw new Error(`Long-lived token error: ${data.error.message}`);
  return data.access_token;
}

// ─── ÉTAPE 4 : Récupérer toutes les infos de la page ─────────────────────────

async function fetchPageData(userToken) {
  // Récupère toutes les pages managées + leur token de page
  const data = await _get(
    `${META_GRAPH_BASE}/me/accounts?fields=id,name,access_token,instagram_business_account&access_token=${userToken}`
  );
  if (data.error) throw new Error(`Pages fetch error: ${data.error.message}`);
  if (!data.data || data.data.length === 0) {
    throw new Error('Aucune page Facebook trouvée pour ce compte');
  }

  // Prend la première page (ou on peut laisser le client choisir)
  const page = data.data[0];
  return {
    pageId:       page.id,
    pageName:     page.name,
    pageToken:    page.access_token, // Token de PAGE (permanent si app approuvée)
    igUserId:     page.instagram_business_account?.id || null,
  };
}

// ─── ÉTAPE 5 : Souscrire la page au webhook ───────────────────────────────────

async function subscribePageToWebhook(pageId, pageToken) {
  return new Promise((resolve, reject) => {
    const postData = new URLSearchParams({
      subscribed_fields: 'messages,messaging_postbacks',
      access_token: pageToken,
    }).toString();

    const options = {
      hostname: 'graph.facebook.com',
      path: `/v19.0/${pageId}/subscribed_apps`,
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'Content-Length': Buffer.byteLength(postData),
      },
    };

    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          const json = JSON.parse(data);
          if (json.error) return reject(new Error(`Webhook sub error: ${json.error.message}`));
          resolve(json);
        } catch { reject(new Error(`Parse error: ${data.slice(0, 100)}`)); }
      });
    });
    req.on('error', reject);
    req.write(postData);
    req.end();
  });
}

// ─── FLUX COMPLET : callback OAuth ────────────────────────────────────────────

/**
 * Point d'entrée du callback OAuth.
 * Appelé automatiquement par Meta après autorisation du client.
 * Récupère tout, stocke en DB, souscrit le webhook.
 */
async function handleCallback(code, state, baseUrl) {
  // 1. Valider le state CSRF
  const { tenantId } = _parseState(state);

  const redirectUri = `${baseUrl}/api/oauth/meta/callback`;

  // 2. Échange code → token court
  const shortData  = await exchangeCode(code, redirectUri);

  // 3. Token long durée
  const longToken  = await getLongLivedToken(shortData.access_token);

  // 4. Infos page + IG
  const pageData   = await fetchPageData(longToken);

  // 5. Souscrire le webhook
  await subscribePageToWebhook(pageData.pageId, pageData.pageToken);

  // 6. Stocker en DB (table tenant_integrations)
  await _saveIntegration(tenantId, pageData, longToken);

  // 7. Invalider le cache token meta-messenger
  try { require('./meta-messenger').invalidateTokenCache(); } catch (_) {}

  bus.emit('meta:connected', {
    tenantId,
    pageName: pageData.pageName,
    pageId:   pageData.pageId,
    hasIG:    !!pageData.igUserId,
  });

  return pageData;
}

// ─── Stockage DB ──────────────────────────────────────────────────────────────

let _pool = null;
function _getPool() {
  if (!_pool) _pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
  return _pool;
}

async function _saveIntegration(tenantId, pageData, userToken) {
  const pool = _getPool();
  await pool.query(`
    INSERT INTO tenant_integrations (business_id, provider, access_token, extra, updated_at)
    VALUES ($1, 'meta', $2, $3, NOW())
    ON CONFLICT (business_id, provider)
    DO UPDATE SET
      access_token = EXCLUDED.access_token,
      extra        = EXCLUDED.extra,
      updated_at   = NOW()
  `, [
    tenantId,
    pageData.pageToken,
    JSON.stringify({
      pageId:    pageData.pageId,
      pageName:  pageData.pageName,
      igUserId:  pageData.igUserId,
      userToken, // Gardé pour futures opérations Graph API
    }),
  ]);
}

/**
 * Récupère les credentials Meta d'un tenant depuis la DB.
 */
async function getTenantMetaCredentials(tenantId) {
  const pool = _getPool();
  const { rows } = await pool.query(
    `SELECT access_token, extra FROM tenant_integrations WHERE business_id = $1 AND provider = 'meta'`,
    [tenantId]
  );
  if (!rows.length) return null;
  return {
    pageToken: rows[0].access_token,
    ...JSON.parse(rows[0].extra || '{}'),
  };
}

module.exports = {
  buildAuthUrl,
  handleCallback,
  fetchPageData,
  subscribePageToWebhook,
  getTenantMetaCredentials,
};
