/**
 * DALEBA — Middleware Multi-Tenant
 * Résout le contexte business de chaque requête
 * Supporte : subdomain, header X-Business-ID, ou JWT payload
 */

const { pool, DEMO_MODE } = require('../memory/db');

/**
 * Résout le business_id depuis :
 * 1. Le JWT (req.user.businessId) — si authentifié
 * 2. Le header X-Business-ID
 * 3. Le subdomain (ex: kadiocoiffure.daleba.app → slug = kadiocoiffure)
 * 4. Le query param ?business=slug
 */
async function resolveTenant(req, res, next) {
  // Super admin = pas de restriction de tenant
  if (req.user?.role === 'super_admin') {
    // Peut accéder à n'importe quel business via header ou param
    const overrideId = req.headers['x-business-id'] || req.query.business;
    if (overrideId) {
      req.businessId = parseInt(overrideId) || overrideId;
    }
    return next();
  }

  // Depuis le JWT
  if (req.user?.businessId) {
    req.businessId = req.user.businessId;
    return next();
  }

  // Depuis le header
  if (req.headers['x-business-id']) {
    req.businessId = req.headers['x-business-id'];
    return next();
  }

  // Depuis le subdomain
  const host = req.hostname || '';
  const subdomain = host.split('.')[0];
  if (!DEMO_MODE && pool && subdomain && subdomain !== 'www' && subdomain !== 'api' && subdomain !== 'daleba') {
    try {
      // Vérifier si la table businesses et la colonne slug existent avant de requêter
      const tableCheck = await pool.query(`
        SELECT column_name FROM information_schema.columns
        WHERE table_name = 'businesses' AND column_name = 'slug' LIMIT 1
      `);
      if (tableCheck.rows.length > 0) {
        const result = await pool.query(
          'SELECT id FROM businesses WHERE slug = $1 AND is_active = true',
          [subdomain]
        );
        if (result.rows.length > 0) {
          req.businessId = result.rows[0].id;
          return next();
        }
      }
      // Table/colonne absente — silencieux, pas d’erreur dans les logs
    } catch (err) {
      // Silencieux en production — la table businesses sera créée lors du setup multi-tenant
    }
  }

  // Depuis le query param
  if (req.query.business) {
    req.businessId = req.query.business;
    return next();
  }

  // Aucun tenant résolu — routes publiques passent quand même
  next();
}

/**
 * Middleware : exige un tenant résolu
 */
function requireTenant(req, res, next) {
  if (!req.businessId) {
    return res.status(400).json({ error: 'Business non identifié' });
  }
  next();
}

module.exports = { resolveTenant, requireTenant };
