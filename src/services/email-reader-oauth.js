/**
 * DALEBA V43 — Email Reader via Gmail API OAuth2
 * Remplace IMAP — connexion robuste, pas de mot de passe d'application requis
 *
 * Flow :
 *   1. GET /api/commercial/oauth/start → URL Google Consent Screen
 *   2. Ulrich clique → Google redirige vers /oauth/callback
 *   3. Callback échange le code contre access_token + refresh_token
 *   4. refresh_token stocké en DB → connexion permanente
 *
 * Variables Railway : GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET
 * (GMAIL_USER reste pour info / from address)
 */
'use strict';

const https = require('https');
const { URLSearchParams } = require('url');

const CLIENT_ID     = process.env.GOOGLE_CLIENT_ID     || '';
const CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET || '';
const GMAIL_USER    = process.env.GMAIL_USER            || 'Daleba2024@gmail.com';
const API_BASE_URL  = process.env.API_BASE_URL          || 'https://daleba-api-production.up.railway.app';
const REDIRECT_URI  = `${API_BASE_URL}/api/commercial/oauth/callback`;

const SCOPES = [
  'https://www.googleapis.com/auth/gmail.readonly',
  'https://www.googleapis.com/auth/gmail.send',
  'https://www.googleapis.com/auth/gmail.modify',
].join(' ');

// ── Token store (DB-backed) ──────────────────────────────────────────────────
let _pool = null;
function setPool(pool) { _pool = pool; }

async function saveTokens({ access_token, refresh_token, expiry_date }) {
  if (!_pool) return;
  await _pool.query(`
    INSERT INTO daleba_settings (key, value, updated_at)
    VALUES ('gmail_oauth_tokens', $1, NOW())
    ON CONFLICT (key) DO UPDATE SET value = $1, updated_at = NOW()
  `, [JSON.stringify({ access_token, refresh_token, expiry_date })]);
}

async function loadTokens() {
  if (!_pool) return null;
  try {
    const { rows } = await _pool.query(
      `SELECT value FROM daleba_settings WHERE key = 'gmail_oauth_tokens'`
    );
    return rows.length ? JSON.parse(rows[0].value) : null;
  } catch { return null; }
}

// ── OAuth2 helpers ────────────────────────────────────────────────────────────
function buildAuthUrl(state = 'daleba-oauth') {
  const params = new URLSearchParams({
    client_id:     CLIENT_ID,
    redirect_uri:  REDIRECT_URI,
    response_type: 'code',
    scope:         SCOPES,
    access_type:   'offline',
    prompt:        'consent',
    state,
  });
  return `https://accounts.google.com/o/oauth2/v2/auth?${params}`;
}

function exchangeCode(code) {
  return new Promise((resolve, reject) => {
    const body = new URLSearchParams({
      code,
      client_id:     CLIENT_ID,
      client_secret: CLIENT_SECRET,
      redirect_uri:  REDIRECT_URI,
      grant_type:    'authorization_code',
    }).toString();

    const req = https.request({
      hostname: 'oauth2.googleapis.com',
      path:     '/token',
      method:   'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'Content-Length': Buffer.byteLength(body) },
    }, (res) => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => {
        try {
          const d = JSON.parse(data);
          if (d.error) return reject(new Error(d.error_description || d.error));
          resolve(d);
        } catch (e) { reject(e); }
      });
    });
    req.on('error', reject);
    req.write(body); req.end();
  });
}

async function refreshAccessToken(refresh_token) {
  return new Promise((resolve, reject) => {
    const body = new URLSearchParams({
      refresh_token,
      client_id:     CLIENT_ID,
      client_secret: CLIENT_SECRET,
      grant_type:    'refresh_token',
    }).toString();

    const req = https.request({
      hostname: 'oauth2.googleapis.com',
      path:     '/token',
      method:   'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'Content-Length': Buffer.byteLength(body) },
    }, (res) => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => {
        try {
          const d = JSON.parse(data);
          if (d.error) return reject(new Error(d.error_description || d.error));
          resolve(d);
        } catch (e) { reject(e); }
      });
    });
    req.on('error', reject);
    req.write(body); req.end();
  });
}

async function getValidToken() {
  const tokens = await loadTokens();
  if (!tokens) throw new Error('OAuth2 non configuré — visite /api/commercial/oauth/start');

  const now = Date.now();
  if (tokens.expiry_date && tokens.expiry_date > now + 60000) {
    return tokens.access_token;
  }
  // Refresh
  if (!tokens.refresh_token) throw new Error('refresh_token manquant — refaire l\'autorisation OAuth2');
  const refreshed = await refreshAccessToken(tokens.refresh_token);
  const newTokens = {
    access_token:  refreshed.access_token,
    refresh_token: tokens.refresh_token, // garder l'ancien si pas de nouveau
    expiry_date:   now + (refreshed.expires_in || 3600) * 1000,
  };
  await saveTokens(newTokens);
  return newTokens.access_token;
}

// ── Gmail API helpers ─────────────────────────────────────────────────────────
function gmailRequest(path, accessToken, method = 'GET', body = null) {
  return new Promise((resolve, reject) => {
    const options = {
      hostname: 'gmail.googleapis.com',
      path:     `/gmail/v1/users/me${path}`,
      method,
      headers: {
        'Authorization': `Bearer ${accessToken}`,
        'Content-Type':  'application/json',
      },
    };
    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => {
        try {
          const d = JSON.parse(data);
          if (d.error) return reject(new Error(d.error.message || JSON.stringify(d.error)));
          resolve(d);
        } catch (e) { reject(new Error('Réponse non-JSON: ' + data.slice(0, 100))); }
      });
    });
    req.on('error', reject);
    if (body) req.write(JSON.stringify(body));
    req.end();
  });
}

// ── Décoder email Gmail (base64url) ───────────────────────────────────────────
function decodeBase64Url(str) {
  try {
    return Buffer.from(str.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8');
  } catch { return ''; }
}

function extractPart(payload, mimeType) {
  if (payload.mimeType === mimeType && payload.body?.data) {
    return decodeBase64Url(payload.body.data);
  }
  if (payload.parts) {
    for (const part of payload.parts) {
      const found = extractPart(part, mimeType);
      if (found) return found;
    }
  }
  return '';
}

function getHeader(headers, name) {
  return headers?.find(h => h.name.toLowerCase() === name.toLowerCase())?.value || '';
}

// ── Fetch emails non-lus ──────────────────────────────────────────────────────
async function fetchUnreadEmails(limit = 20) {
  const accessToken = await getValidToken();

  // Lister les messages non-lus
  const listResult = await gmailRequest(
    `/messages?maxResults=${limit}&q=is:unread in:inbox`,
    accessToken
  );

  const messages = listResult.messages || [];
  if (!messages.length) return { emails: [], total: 0 };

  const emails = [];
  for (const msg of messages.slice(0, limit)) {
    try {
      const full = await gmailRequest(`/messages/${msg.id}?format=full`, accessToken);
      const headers = full.payload?.headers || [];

      const text = extractPart(full.payload, 'text/plain') ||
                   extractPart(full.payload, 'text/html').replace(/<[^>]+>/g, ' ').slice(0, 3000);

      emails.push({
        uid:       msg.id,
        messageId: getHeader(headers, 'Message-ID') || msg.id,
        from:      getHeader(headers, 'From'),
        fromEmail: getHeader(headers, 'From').match(/<(.+)>/)?.[1] || getHeader(headers, 'From'),
        to:        getHeader(headers, 'To'),
        subject:   getHeader(headers, 'Subject') || '(sans objet)',
        text:      text.slice(0, 3000),
        date:      new Date(parseInt(full.internalDate)),
        inReplyTo: getHeader(headers, 'In-Reply-To'),
        threadId:  full.threadId,
        gmailId:   msg.id,
      });
    } catch (e) {
      console.warn('[email-oauth] Erreur lecture message', msg.id, e.message);
    }
  }

  return { emails, total: listResult.resultSizeEstimate || emails.length };
}

// ── Envoyer un email ──────────────────────────────────────────────────────────
async function sendEmail({ to, subject, text, html, inReplyTo, threadId }) {
  const accessToken = await getValidToken();

  const boundary = 'daleba_boundary_' + Date.now();
  let raw = [
    `From: DALEBA OS <${GMAIL_USER}>`,
    `To: ${to}`,
    `Subject: ${subject}`,
    `MIME-Version: 1.0`,
    `Content-Type: multipart/alternative; boundary="${boundary}"`,
    inReplyTo ? `In-Reply-To: ${inReplyTo}` : '',
    '',
    `--${boundary}`,
    `Content-Type: text/plain; charset=UTF-8`,
    '',
    text,
    '',
    `--${boundary}`,
    `Content-Type: text/html; charset=UTF-8`,
    '',
    html || `<p>${text.replace(/\n/g, '<br>')}</p>`,
    '',
    `--${boundary}--`,
  ].filter(l => l !== undefined).join('\r\n');

  const encoded = Buffer.from(raw).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

  const body = { raw: encoded };
  if (threadId) body.threadId = threadId;

  const result = await gmailRequest('/messages/send', accessToken, 'POST', body);
  return { messageId: result.id, threadId: result.threadId };
}

// ── Marquer comme lu ──────────────────────────────────────────────────────────
async function markAsRead(gmailId) {
  try {
    const accessToken = await getValidToken();
    await gmailRequest(`/messages/${gmailId}/modify`, accessToken, 'POST', {
      removeLabelIds: ['UNREAD'],
    });
    return true;
  } catch { return false; }
}

// ── Vérifier la connexion ─────────────────────────────────────────────────────
async function checkConnection() {
  if (!CLIENT_ID || !CLIENT_SECRET) {
    return {
      ok:       false,
      error:    'GOOGLE_CLIENT_ID ou GOOGLE_CLIENT_SECRET manquant dans Railway',
      authUrl:  null,
      setup:    true,
    };
  }

  const tokens = await loadTokens();
  if (!tokens) {
    return {
      ok:      false,
      error:   'Autorisation OAuth2 requise',
      authUrl: buildAuthUrl(),
      setup:   true,
    };
  }

  try {
    const accessToken = await getValidToken();
    const profile = await gmailRequest('/profile', accessToken);
    return {
      ok:          true,
      user:        profile.emailAddress,
      totalMessages: profile.messagesTotal,
    };
  } catch (err) {
    return {
      ok:      false,
      error:   err.message,
      authUrl: buildAuthUrl(),
      setup:   true,
    };
  }
}

module.exports = {
  buildAuthUrl,
  exchangeCode,
  saveTokens,
  loadTokens,
  getValidToken,
  fetchUnreadEmails,
  sendEmail,
  markAsRead,
  checkConnection,
  setPool,
  GMAIL_USER,
  REDIRECT_URI,
};
