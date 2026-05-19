/**
 * Studio Auth Middleware — DALEBA Metacortex Point 148
 *
 * Protège /public/studio/exports contre les accès non autorisés.
 * Validation session admin + token JWT ou clé API interne.
 */

'use strict';

const jwt = require('jsonwebtoken');
const JWT_SECRET = process.env.JWT_SECRET || process.env.ANTHROPIC_API_KEY?.slice(0, 32) || 'daleba-studio-secret';

/**
 * Middleware de protection des ressources studio [148]
 */
function requireStudioAccess(req, res, next) {
  // 1. Cookie session (dashboard admin)
  const sessionToken = req.cookies?.daleba_admin || req.headers['x-daleba-session'];

  // 2. Bearer JWT
  const authHeader = req.headers.authorization || '';
  const bearerToken = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null;

  // 3. Clé API interne
  const apiKey = req.headers['x-daleba-api-key'] || req.query.token;

  const token = sessionToken || bearerToken || apiKey;

  if (!token) {
    return res.status(401).json({ error: 'Accès studio non autorisé — session requise' });
  }

  try {
    // Validation JWT
    const decoded = jwt.verify(token, JWT_SECRET);
    if (!decoded.admin && !decoded.studio) {
      return res.status(403).json({ error: 'Permissions insuffisantes — accès studio refusé' });
    }
    req.studioUser = decoded;
    return next();
  } catch {
    // Token invalide
    return res.status(401).json({ error: 'Token invalide ou expiré' });
  }
}

/**
 * Génère un token d'accès studio (à appeler depuis /api/auth/admin)
 */
function generateStudioToken(payload = {}) {
  return jwt.sign({ admin: true, studio: true, ...payload }, JWT_SECRET, { expiresIn: '8h' });
}

/**
 * Middleware pour servir les fichiers /public/studio/exports
 * S'utilise AVANT express.static pour ce chemin
 */
function studioStaticGuard(req, res, next) {
  // Bypass pour les assets hors exports (thumbnails publics OK)
  if (!req.path.includes('/exports/') && !req.path.includes('/studio/exports')) {
    return next();
  }
  return requireStudioAccess(req, res, next);
}

module.exports = { requireStudioAccess, studioStaticGuard, generateStudioToken };
