'use strict';
/**
 * Tenant Security Sentry — DALEBA Metacortex Point 276
 * Détecte les injections SQL cross-tenant et bride instantanément l'instance.
 */
const bus    = require('./event-bus');
const crypto = require('crypto');

// Map tenant_id → { violations: N, bridled: bool, bridledAt: timestamp }
const _tenantStatus = new Map();

const CROSS_TENANT_PATTERNS = [
  /tenant_id\s*[!=<>]+\s*['"]?(?!.*\$\d)/i,   // tenant_id sans paramètre
  /OR\s+['"]?\d+['"]?\s*=\s*['"]?\d+['"]?/i,  // OR 1=1
  /UNION\s+SELECT/i,
  /;\s*DROP\s+TABLE/i,
  /;\s*DELETE\s+FROM/i,
  /information_schema/i,
  /pg_tables/i,
];

function inspectQuery(sql, tenantId) {
  if (!sql || typeof sql !== 'string') return { safe: true };
  
  for (const pattern of CROSS_TENANT_PATTERNS) {
    if (pattern.test(sql)) {
      return { safe: false, pattern: pattern.toString(), sql: sql.slice(0, 100) };
    }
  }
  
  // Vérifie que le SQL inclut tenant_id si c'est une query de données
  const isDataQuery = /SELECT|INSERT|UPDATE|DELETE/i.test(sql);
  const hasTenantId = /tenant_id/i.test(sql);
  
  if (isDataQuery && !hasTenantId) {
    return { safe: true, warn: 'Query sans tenant_id — isolation non garantie' };
  }
  
  return { safe: true };
}

async function reportViolation(tenantId, violationData) {
  const status = _tenantStatus.get(tenantId) || { violations: 0, bridled: false };
  status.violations++;
  
  if (status.violations >= 3 || violationData.severity === 'critical') {
    status.bridled = true;
    status.bridledAt = Date.now();
    bus.system(`🚨 [SecuritySentry] TENANT BRIDÉ: ${tenantId} | ${status.violations} violations`);
    
    // Alerte SMS Commandant
    try {
      const twilio = require('twilio')(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN);
      await twilio.messages.create({
        body: `🚨 SÉCURITÉ DALEBA\nTenant bridé: ${tenantId}\nViolations: ${status.violations}\nPattern: ${violationData.pattern || 'inconnu'}\nAction requise.`,
        from: process.env.TWILIO_PHONE_NUMBER,
        to:   process.env.ULRICH_PHONE_NUMBER,
      });
    } catch {}
  }
  
  _tenantStatus.set(tenantId, status);
  bus.system(`[SecuritySentry] Violation #${status.violations} | Tenant: ${tenantId} | ${JSON.stringify(violationData).slice(0, 80)}`);
  return status;
}

function isBridled(tenantId) {
  const s = _tenantStatus.get(tenantId);
  if (!s?.bridled) return false;
  // Auto-débridage après 1h si < 5 violations
  if (s.violations < 5 && Date.now() - s.bridledAt > 3600000) {
    s.bridled = false;
    return false;
  }
  return true;
}

function getTenantStatus(tenantId) {
  return _tenantStatus.get(tenantId) || { violations: 0, bridled: false };
}

// Middleware Express
function sentryMiddleware(req, res, next) {
  const tenantId = req.headers['x-tenant-id'] || req.body?.tenantId || req.query?.tenantId;
  if (tenantId && isBridled(tenantId)) {
    return res.status(403).json({ error: 'Instance suspendue pour raison de sécurité.', code: 'TENANT_BRIDLED' });
  }
  next();
}

module.exports = { inspectQuery, reportViolation, isBridled, getTenantStatus, sentryMiddleware };
