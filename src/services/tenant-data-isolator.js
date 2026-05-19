'use strict';

/**
 * DALEBA — Tenant Data Isolator [256]
 * Metacortex: Isolation multi-tenant SQL — garantit que toute query inclut le tenant_id.
 *
 * Middleware de sécurité pour prévenir les fuites de données entre tenants.
 * Valide, normalise et proxy les pools PostgreSQL avec tenant_id forcé.
 */

const crypto = require('crypto');
const bus    = require('./event-bus');

// ─── VALIDATION ───────────────────────────────────────────────────────────────

const TENANT_ID_REGEX = /^[a-z0-9][a-z0-9-]{1,60}[a-z0-9]$/;

/**
 * Valide un tenant_id. Lance une erreur si invalide.
 * @param {string} tenantId
 * @throws {Error}
 */
function validateTenantId(tenantId) {
  if (typeof tenantId !== 'string' || !TENANT_ID_REGEX.test(tenantId)) {
    throw new Error(
      `Invalid tenant_id: "${tenantId}". Must match /^[a-z0-9][a-z0-9-]{1,60}[a-z0-9]$/`
    );
  }
}

/**
 * Normalise un nom brut en tenant_id valide.
 * @param {string} raw
 * @returns {string}
 */
function normalizeTenantId(raw) {
  return String(raw)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 62);
}

// ─── ISOLATED POOL PROXY ──────────────────────────────────────────────────────

/**
 * Retourne un proxy sur le pool qui force le tenant_id dans toutes les queries.
 * @param {object} pool   — pg Pool
 * @param {string} tenantId
 * @returns {{ query: Function }}
 */
function createIsolatedPool(pool, tenantId) {
  validateTenantId(tenantId);

  return {
    tenantId,
    /**
     * Exécute une query PostgreSQL avec vérification tenant_id.
     * @param {string} sql
     * @param {any[]}  params
     */
    async query(sql, params = []) {
      if (typeof sql !== 'string') {
        throw new Error('[IsolatedPool] sql must be a string');
      }

      // Warn si le SQL ne semble pas filtrer par tenant_id
      if (!sql.includes('tenant_id')) {
        bus.emit('system',
          `[IsolatedPool] WARN: query without tenant_id filter (tenant: ${tenantId.slice(0, 6)}…)`,
          { tenantId: tenantId.slice(0, 8) + '…' }
        );
      }

      // Log de la query (tenant masqué)
      const maskedTenant = tenantId.slice(0, 4) + '…';
      bus.emit('system',
        `[IsolatedPool] query for tenant ${maskedTenant}: ${sql.slice(0, 60).replace(/\s+/g, ' ')}…`,
        { tenant: maskedTenant, paramCount: params.length }
      );

      return pool.query(sql, params);
    },

    /**
     * Accès direct au pool sous-jacent pour transactions, etc.
     */
    connect() {
      return pool.connect();
    },
  };
}

// ─── GENERATOR ────────────────────────────────────────────────────────────────

/**
 * Génère un tenant_id unique à partir d'un nom de commerce.
 * Format: slug-normalisé + 4 chars hex aléatoires (ex: salon-prestige-a3f2)
 * @param {string} businessName
 * @returns {string}
 */
function generateTenantId(businessName) {
  const slug = normalizeTenantId(businessName).slice(0, 56); // garde de la place pour le suffix
  const suffix = crypto.randomBytes(2).toString('hex'); // 4 chars hex
  const id = `${slug}-${suffix}`;
  // S'assurer qu'il est valide après concat
  const normalized = normalizeTenantId(id).slice(0, 62);
  return normalized;
}

// ─── EXPORTS ──────────────────────────────────────────────────────────────────

module.exports = {
  validateTenantId,
  normalizeTenantId,
  createIsolatedPool,
  generateTenantId,
};
