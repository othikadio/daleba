'use strict';

/**
 * DALEBA — Square OAuth2 [257]
 * Metacortex: Intégration OAuth2 Square production.
 *
 * Gère le flux d'autorisation Square complet:
 * - Construction URL d'autorisation avec state JWT signé
 * - Vérification du state (HMAC + expiry)
 * - Échange du code contre access_token
 * - Récupération du location actif
 * - Révocation de token
 */

const crypto = require('crypto');
const https  = require('https');
const bus    = require('./event-bus');

const SQUARE_OAUTH_BASE  = 'https://connect.squareup.com/oauth2';
const SQUARE_API_BASE    = 'https://connect.squareup.com/v2';
const STATE_EXPIRY_MS    = 10 * 60 * 1000; // 10 minutes
const OAUTH_SCOPE        = [
  'APPOINTMENTS_READ',
  'APPOINTMENTS_WRITE',
  'CUSTOMERS_READ',
  'CATALOG_READ',
  'PAYMENTS_READ',
  'MERCHANT_PROFILE_READ',
].join(' ');

// ─── STATE JWT (HMAC-SHA256) ──────────────────────────────────────────────────

function _stateSecret() {
  return process.env.SQUARE_STATE_SECRET
    || process.env.VAULT_SECRET
    || process.env.ANTHROPIC_API_KEY
    || 'daleba-square-state-secret';
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
  if (!b64 || !sig) throw new Error('Invalid state format');
  const expected = crypto
    .createHmac('sha256', _stateSecret())
    .update(b64)
    .digest('hex');
  // Constant-time comparison
  if (!crypto.timingSafeEqual(Buffer.from(sig, 'hex'), Buffer.from(expected, 'hex'))) {
    throw new Error('State signature mismatch');
  }
  return JSON.parse(Buffer.from(b64, 'base64url').toString('utf8'));
}

// ─── HELPERS HTTP ─────────────────────────────────────────────────────────────

function _httpsPost(url, body, headers = {}) {
  return new Promise((resolve, reject) => {
    const payload = JSON.stringify(body);
    const parsed  = new URL(url);
    const options = {
      hostname: parsed.hostname,
      path: parsed.pathname + parsed.search,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(payload),
        'Square-Version': '2024-01-17',
        ...headers,
      },
    };
    const req = https.request(options, res => {
      let data = '';
      res.on('data', chunk => { data += chunk; });
      res.on('end', () => {
        try {
          const parsed = JSON.parse(data);
          if (res.statusCode >= 400) {
            reject(Object.assign(new Error(`Square API ${res.statusCode}`), { body: parsed, status: res.statusCode }));
          } else {
            resolve(parsed);
          }
        } catch (e) { reject(e); }
      });
    });
    req.on('error', reject);
    req.write(payload);
    req.end();
  });
}

function _httpsGet(url, accessToken) {
  return new Promise((resolve, reject) => {
    const parsed  = new URL(url);
    const options = {
      hostname: parsed.hostname,
      path: parsed.pathname + parsed.search,
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${accessToken}`,
        'Square-Version': '2024-01-17',
        'Content-Type': 'application/json',
      },
    };
    const req = https.request(options, res => {
      let data = '';
      res.on('data', chunk => { data += chunk; });
      res.on('end', () => {
        try {
          const parsed = JSON.parse(data);
          if (res.statusCode >= 400) {
            reject(Object.assign(new Error(`Square API ${res.statusCode}`), { body: parsed, status: res.statusCode }));
          } else {
            resolve(parsed);
          }
        } catch (e) { reject(e); }
      });
    });
    req.on('error', reject);
    req.end();
  });
}

// ─── PUBLIC API ───────────────────────────────────────────────────────────────

/**
 * Construit l'URL d'autorisation Square avec state signé.
 * @param {string} tenantId
 * @param {string} redirectUri
 * @returns {string} URL
 */
function buildAuthUrl(tenantId, redirectUri) {
  const clientId = process.env.SQUARE_APP_ID || process.env.SQUARE_APPLICATION_ID;
  if (!clientId) throw new Error('Missing SQUARE_APP_ID or SQUARE_APPLICATION_ID env var');

  const state = _signState({ tenantId, ts: Date.now() });
  const params = new URLSearchParams({
    client_id: clientId,
    scope:     OAUTH_SCOPE,
    state,
    redirect_uri: redirectUri,
    session: 'false',
  });

  const url = `${SQUARE_OAUTH_BASE}/authorize?${params.toString()}`;
  bus.emit('system', `[SquareOAuth] buildAuthUrl for tenant ${tenantId}`);
  return url;
}

/**
 * Vérifie le state JWT (HMAC + expiry 10 min).
 * @param {string} state
 * @returns {{ tenantId: string, ts: number }}
 * @throws {Error}
 */
function verifyState(state) {
  const payload = _parseState(state);
  const age     = Date.now() - payload.ts;
  if (age > STATE_EXPIRY_MS) {
    throw new Error(`State expired (age: ${Math.round(age / 1000)}s)`);
  }
  return payload;
}

/**
 * Échange un code d'autorisation contre un access_token Square.
 * @param {string} code
 * @param {string} redirectUri
 * @returns {{ accessToken: string, merchantId: string, expiresAt: string }}
 */
async function exchangeCode(code, redirectUri) {
  try {
    const clientId     = process.env.SQUARE_APP_ID || process.env.SQUARE_APPLICATION_ID;
    const clientSecret = process.env.SQUARE_APP_SECRET || process.env.SQUARE_APPLICATION_SECRET;
    if (!clientId || !clientSecret) {
      throw new Error('Missing SQUARE_APP_ID/SECRET env vars');
    }

    const data = await _httpsPost(`${SQUARE_OAUTH_BASE}/token`, {
      client_id:     clientId,
      client_secret: clientSecret,
      code,
      grant_type:    'authorization_code',
      redirect_uri:  redirectUri,
    });

    bus.emit('system', `[SquareOAuth] code exchanged for merchant ${data.merchant_id}`);
    return {
      accessToken: data.access_token,
      merchantId:  data.merchant_id,
      expiresAt:   data.expires_at,
    };
  } catch (err) {
    bus.emit('error', `[SquareOAuth] exchangeCode failed: ${err.message}`);
    throw err;
  }
}

/**
 * Récupère le premier location actif du merchant.
 * @param {string} accessToken
 * @returns {string} locationId
 */
async function getLocationId(accessToken) {
  try {
    const data = await _httpsGet(`${SQUARE_API_BASE}/locations`, accessToken);
    const active = (data.locations || []).find(l => l.status === 'ACTIVE');
    if (!active) throw new Error('No active Square location found');
    bus.emit('system', `[SquareOAuth] location found: ${active.id}`);
    return active.id;
  } catch (err) {
    bus.emit('error', `[SquareOAuth] getLocationId failed: ${err.message}`);
    throw err;
  }
}

/**
 * Révoque un access_token Square.
 * @param {string} accessToken
 * @param {string} tenantId
 */
async function revokeToken(accessToken, tenantId) {
  try {
    const clientId     = process.env.SQUARE_APP_ID || process.env.SQUARE_APPLICATION_ID;
    const clientSecret = process.env.SQUARE_APP_SECRET || process.env.SQUARE_APPLICATION_SECRET;
    await _httpsPost(
      `${SQUARE_OAUTH_BASE}/revoke`,
      { client_id: clientId, access_token: accessToken },
      { Authorization: `Client ${clientSecret}` }
    );
    bus.emit('system', `[SquareOAuth] token revoked for tenant ${tenantId}`);
  } catch (err) {
    bus.emit('error', `[SquareOAuth] revokeToken failed: ${err.message}`, { tenantId });
    throw err;
  }
}

// ─── EXPORTS ──────────────────────────────────────────────────────────────────

module.exports = { buildAuthUrl, verifyState, exchangeCode, getLocationId, revokeToken };
