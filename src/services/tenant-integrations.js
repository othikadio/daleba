/**
 * DALEBA — Service Tenant Integrations
 * Gestion centralisée des tokens OAuth par business (Square, Meta, Twilio, Stripe)
 */

const { pool, DEMO_MODE } = require('../memory/db');

const SQUARE_BASE = 'https://connect.squareup.com';

// Cache en mémoire pour éviter trop de requêtes DB
const integrationCache = new Map(); // key: `${businessId}:${provider}`
const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

/**
 * Récupère l'intégration d'un provider pour un business
 * @param {number} businessId
 * @param {string} provider - 'square' | 'meta' | 'twilio' | 'stripe'
 */
async function getIntegration(businessId, provider) {
  const cacheKey = `${businessId}:${provider}`;
  const cached = integrationCache.get(cacheKey);
  if (cached && Date.now() - cached.ts < CACHE_TTL_MS) return cached.data;

  if (DEMO_MODE || !pool) {
    // Mode démo: retourne les tokens env comme fallback
    return getDemoIntegration(provider);
  }

  const result = await pool.query(
    'SELECT * FROM tenant_integrations WHERE business_id = $1 AND provider = $2 AND is_active = true',
    [businessId, provider]
  );

  const data = result.rows[0] || null;
  integrationCache.set(cacheKey, { data, ts: Date.now() });
  return data;
}

/**
 * Intégration démo (fallback sur variables d'environnement)
 */
function getDemoIntegration(provider) {
  if (provider === 'square') {
    return {
      access_token: process.env.SQUARE_ACCESS_TOKEN,
      extra: { location_id: process.env.SQUARE_LOCATION_ID }
    };
  }
  return null;
}

/**
 * Enregistre ou met à jour une intégration OAuth
 */
async function upsertIntegration(businessId, provider, { accessToken, refreshToken, tokenExpires, scope, extra = {} }) {
  if (DEMO_MODE || !pool) return;

  // Invalider le cache
  integrationCache.delete(`${businessId}:${provider}`);

  await pool.query(`
    INSERT INTO tenant_integrations (business_id, provider, access_token, refresh_token, token_expires, scope, extra, updated_at)
    VALUES ($1, $2, $3, $4, $5, $6, $7, NOW())
    ON CONFLICT (business_id, provider) DO UPDATE
      SET access_token = EXCLUDED.access_token,
          refresh_token = EXCLUDED.refresh_token,
          token_expires = EXCLUDED.token_expires,
          scope = EXCLUDED.scope,
          extra = EXCLUDED.extra,
          updated_at = NOW()
  `, [businessId, provider, accessToken, refreshToken, tokenExpires, scope, JSON.stringify(extra)]);
}

/**
 * Déconnecte une intégration
 */
async function disconnectIntegration(businessId, provider) {
  if (DEMO_MODE || !pool) return;
  integrationCache.delete(`${businessId}:${provider}`);
  await pool.query(
    'UPDATE tenant_integrations SET is_active = false, updated_at = NOW() WHERE business_id = $1 AND provider = $2',
    [businessId, provider]
  );
}

/**
 * Client Square dynamique par tenant (remplace la lecture globale SQUARE_ACCESS_TOKEN)
 * Retourne les headers + location_id pour un businessId donné
 */
async function getSquareContext(businessId) {
  const integration = await getIntegration(businessId, 'square');
  
  if (!integration?.access_token) {
    throw new Error(`Square non connecté pour business #${businessId}`);
  }

  const token = integration.access_token;
  const locationId = integration.extra?.location_id || process.env.SQUARE_LOCATION_ID;

  return {
    token,
    locationId,
    headers: {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json',
      'Square-Version': '2024-02-22',
    },
    baseUrl: SQUARE_BASE,
  };
}

/**
 * Config Twilio dynamique par tenant
 */
async function getTwilioContext(businessId) {
  if (DEMO_MODE || !pool) {
    return {
      accountSid: process.env.TWILIO_ACCOUNT_SID,
      authToken: process.env.TWILIO_AUTH_TOKEN,
      phoneNumber: process.env.TWILIO_PHONE_NUMBER,
      isMaster: true,
    };
  }

  const result = await pool.query(
    'SELECT * FROM tenant_twilio WHERE business_id = $1 AND status = $2',
    [businessId, 'active']
  );

  if (result.rows.length === 0) {
    // Fallback: utiliser le compte master
    return {
      accountSid: process.env.TWILIO_ACCOUNT_SID,
      authToken: process.env.TWILIO_AUTH_TOKEN,
      phoneNumber: process.env.TWILIO_PHONE_NUMBER,
      isMaster: true,
    };
  }

  const row = result.rows[0];
  return {
    accountSid: row.twilio_account_sid || process.env.TWILIO_ACCOUNT_SID,
    authToken: row.twilio_auth_token || process.env.TWILIO_AUTH_TOKEN,
    phoneNumber: row.phone_number || process.env.TWILIO_PHONE_NUMBER,
    isMaster: !row.subaccount_sid,
    subaccountSid: row.subaccount_sid,
  };
}

/**
 * Liste toutes les intégrations actives d'un business
 */
async function listIntegrations(businessId) {
  if (DEMO_MODE || !pool) return [];
  const result = await pool.query(
    'SELECT provider, is_active, connected_at, updated_at FROM tenant_integrations WHERE business_id = $1 ORDER BY provider',
    [businessId]
  );
  return result.rows;
}

module.exports = {
  getIntegration,
  upsertIntegration,
  disconnectIntegration,
  getSquareContext,
  getTwilioContext,
  listIntegrations,
};
