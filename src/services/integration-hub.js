/**
 * Integration Hub — DALEBA Metacortex Points 081-088
 *
 * Architecture d'accueil pour applications externes (esthétique, botanique…)
 * Multi-tenant · Isolation logique · Webhooks sync · Docs auto-générées
 */

'use strict';

const crypto = require('crypto');

// ─── REGISTRE DES APPLICATIONS EXTERNES [081] ────────────────────────────────

const APP_REGISTRY = new Map();
// appId → { name, apiKey, tables, webhooks, createdAt, active }

// Apps prédéfinies
const DEFAULT_APPS = {
  'esth-app': {
    name: 'Application Esthétique Externe',
    tables: ['esth_clients', 'esth_treatments', 'esth_products'],
    category: 'esthetic',
    description: 'Fiches clients esthétiques, historiques soins cutanés',
  },
  'botanique-app': {
    name: 'Bar à Plantes Botanique',
    tables: ['botan_leads', 'botan_diagnostics', 'botan_products'],
    category: 'botanique',
    description: 'Diagnostics capillaires botanique, leads site',
  },
};

// ─── GÉNÉRATION CLÉS API [082] ────────────────────────────────────────────────

function generateApiKey(appId) {
  const prefix = 'dlb_ext_';
  const secret = crypto.randomBytes(32).toString('hex');
  return `${prefix}${appId}_${secret}`;
}

function registerApp(appId, config = {}) {
  const defaults = DEFAULT_APPS[appId] || {};
  const apiKey = config.apiKey || generateApiKey(appId);

  APP_REGISTRY.set(appId, {
    id: appId,
    name: config.name || defaults.name || appId,
    apiKey,
    apiKeyHash: crypto.createHash('sha256').update(apiKey).digest('hex').slice(0, 16),
    tables: config.tables || defaults.tables || [],
    category: config.category || defaults.category || 'generic',
    description: config.description || defaults.description || '',
    webhooks: config.webhooks || [],
    createdAt: Date.now(),
    active: true,
  });

  return { appId, apiKey, registered: true };
}

function validateApiKey(apiKey) {
  for (const [appId, app] of APP_REGISTRY.entries()) {
    if (app.apiKey === apiKey && app.active) return { valid: true, appId, app };
  }
  return { valid: false };
}

// Auto-enregistrement des apps par défaut au boot
for (const [id, cfg] of Object.entries(DEFAULT_APPS)) {
  if (!APP_REGISTRY.has(id)) {
    const envKey = process.env[`EXT_APP_KEY_${id.toUpperCase().replace(/-/g, '_')}`];
    registerApp(id, envKey ? { ...cfg, apiKey: envKey } : cfg);
  }
}

// ─── ISOLATION DONNÉES MULTI-TENANT [083, 084] ────────────────────────────────

/**
 * Schéma d'isolation : chaque app a ses propres tables préfixées
 * Injection par table — aucune réécriture du cœur coiffure
 *
 * Convention : {category}_{entity}
 * Ex: esth_clients, esth_treatments, botan_leads
 */
const TENANT_SCHEMAS = {
  coiffure: {
    prefix: '',  // tables principales sans préfixe
    tables: ['customers', 'appointments', 'services', 'daleba_notes', 'daleba_loyalty',
             'daleba_content_queue', 'daleba_chat_sessions'],
    protected: true,  // [083] jamais modifiées par les apps externes
  },
  esthetic: {
    prefix: 'esth_',
    tables: ['esth_clients', 'esth_treatments', 'esth_products', 'esth_appointments'],
    protected: false,
  },
  botanique: {
    prefix: 'botan_',
    tables: ['botan_leads', 'botan_diagnostics', 'botan_products'],
    protected: false,
  },
};

/**
 * Vérifie qu'une app externe ne touche pas aux tables coiffure [083]
 */
function assertTenantIsolation(appId, tableName) {
  const app = APP_REGISTRY.get(appId);
  if (!app) throw new Error(`App inconnue: ${appId}`);

  const coiffureTables = TENANT_SCHEMAS.coiffure.tables;
  if (coiffureTables.includes(tableName)) {
    throw new Error(`[IntegHub] ISOLATION VIOLATION: ${appId} tente d'accéder à ${tableName} (table coiffure protégée)`);
  }

  // L'app doit opérer dans ses tables déclarées
  if (app.tables.length > 0 && !app.tables.includes(tableName)) {
    throw new Error(`[IntegHub] Table ${tableName} hors scope de ${appId}`);
  }

  return true;
}

/**
 * [084] Génère le SQL de création de tables pour une nouvelle app
 * Injection sans toucher au schéma existant
 */
function generateTenantSchema(category, entities) {
  const prefix = TENANT_SCHEMAS[category]?.prefix || `${category}_`;
  const statements = entities.map(entity => `
-- Table ${prefix}${entity} — tenant: ${category}
CREATE TABLE IF NOT EXISTS ${prefix}${entity} (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     VARCHAR(50) NOT NULL DEFAULT '${category}',
  external_ref  VARCHAR(255),
  data          JSONB NOT NULL DEFAULT '{}',
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_${prefix}${entity}_tenant ON ${prefix}${entity}(tenant_id);
CREATE INDEX IF NOT EXISTS idx_${prefix}${entity}_ref ON ${prefix}${entity}(external_ref);
  `.trim());

  return statements.join('\n\n');
}

// ─── WEBHOOKS SYNC [085] ──────────────────────────────────────────────────────

const webhookListeners = new Map(); // event → [{ appId, url, secret }]

function registerWebhook(appId, event, url, secret = null) {
  if (!webhookListeners.has(event)) webhookListeners.set(event, []);
  webhookListeners.get(event).push({ appId, url, secret: secret || generateApiKey(appId).slice(0, 32) });
  console.log(`[IntegHub] Webhook enregistré: ${appId} → ${event} → ${url}`);
}

async function fireWebhook(event, payload) {
  const listeners = webhookListeners.get(event) || [];
  const axios = (() => { try { return require('axios'); } catch { return null; } })();
  if (!axios || listeners.length === 0) return;

  const results = await Promise.allSettled(
    listeners.map(async ({ appId, url, secret }) => {
      const body = JSON.stringify({ event, payload, ts: Date.now() });
      const sig  = crypto.createHmac('sha256', secret).update(body).digest('hex');

      await axios.post(url, body, {
        headers: {
          'Content-Type': 'application/json',
          'X-DALEBA-Signature': sig,
          'X-DALEBA-Event': event,
        },
        timeout: 5000,
      });

      return { appId, event, success: true };
    })
  );

  return results.map(r => r.value || r.reason);
}

// Événements client sync coiffure ↔ esthétique [085]
const CLIENT_SYNC_EVENTS = ['client.created', 'client.updated', 'appointment.completed', 'appointment.cancelled'];

// ─── MOUNT POINTS AGENTS MARKETING [086] ──────────────────────────────────────

const MARKETING_AGENTS = new Map();
// agentId → { name, category, handler, active }

function mountMarketingAgent(agentId, config) {
  MARKETING_AGENTS.set(agentId, {
    id: agentId,
    name: config.name,
    category: config.category || 'generic', // esthetic, botanique, coiffure
    handler: config.handler,               // async (context) => { }
    triggerEvents: config.triggerEvents || [],
    active: true,
    mountedAt: Date.now(),
  });
  console.log(`[IntegHub] Agent marketing monté: ${agentId} (${config.category})`);
}

async function triggerMarketingAgents(event, context) {
  const matching = [...MARKETING_AGENTS.values()].filter(a =>
    a.active && (a.triggerEvents.includes(event) || a.triggerEvents.includes('*'))
  );

  return Promise.allSettled(
    matching.map(agent => agent.handler(context).catch(err =>
      console.warn(`[IntegHub] Agent ${agent.id} failed:`, err.message)
    ))
  );
}

// ─── AUTO-GENERATED DOCS [088] ───────────────────────────────────────────────

function generateAPIDocs(routesMap = {}) {
  const apps = [...APP_REGISTRY.values()].map(a => ({
    id: a.id, name: a.name, category: a.category,
    tables: a.tables, description: a.description,
  }));

  const schemas = Object.entries(TENANT_SCHEMAS).map(([name, schema]) => ({
    name, prefix: schema.prefix, tables: schema.tables, protected: schema.protected,
  }));

  const webhooks = {};
  for (const [event, listeners] of webhookListeners.entries()) {
    webhooks[event] = listeners.map(l => ({ appId: l.appId, url: l.url }));
  }

  return {
    _generated: new Date().toISOString(),
    title: 'DALEBA Integration Hub API',
    version: '1.0.0',
    baseUrl: process.env.DALEBA_BASE_URL || 'https://daleba-api-production.up.railway.app',
    authentication: {
      type: 'API Key',
      header: 'X-DALEBA-API-Key',
      description: 'Clé fournie lors de l\'enregistrement de l\'application',
    },
    endpoints: {
      'POST /api/v1/integration/ext-app/data': {
        description: 'Injecter des données depuis une app externe',
        auth: 'X-DALEBA-API-Key',
        body: { table: 'string', records: 'array', upsert: 'boolean?' },
      },
      'GET /api/v1/integration/ext-app/clients': {
        description: 'Récupérer les fiches clients (scope app)',
        auth: 'X-DALEBA-API-Key',
        query: { limit: 'number?', offset: 'number?' },
      },
      'POST /api/v1/integration/ext-app/webhook': {
        description: 'Enregistrer un webhook de synchronisation',
        auth: 'X-DALEBA-API-Key',
        body: { event: 'string', url: 'string', secret: 'string?' },
      },
      'GET /api/v1/integration/ext-app/schema': {
        description: 'Récupérer le schéma SQL pour une nouvelle app',
        auth: 'X-DALEBA-API-Key',
        query: { category: 'string', entities: 'string (csv)' },
      },
      'GET /api/dare/status': { description: 'État du moteur IA DARE', auth: 'none' },
      'GET /api/commander/swarm-status': { description: 'Dashboard agents', auth: 'none' },
      'GET /api/docs': { description: 'Cette documentation', auth: 'none' },
    },
    registeredApps: apps,
    tenantSchemas: schemas,
    activeWebhooks: webhooks,
    syncEvents: CLIENT_SYNC_EVENTS,
  };
}

// ─── EXPORTS ─────────────────────────────────────────────────────────────────

module.exports = {
  // App registry
  registerApp, validateApiKey, APP_REGISTRY,
  // Tenant isolation
  assertTenantIsolation, generateTenantSchema, TENANT_SCHEMAS,
  // Webhooks
  registerWebhook, fireWebhook, CLIENT_SYNC_EVENTS,
  // Marketing agents
  mountMarketingAgent, triggerMarketingAgents, MARKETING_AGENTS,
  // Docs
  generateAPIDocs,
};
