/**
 * DALEBA — Middleware Authentification par Rôle
 * Section 17 — Public / Staff / Admin
 *
 * Clés dans les headers :
 *   X-DALEBA-ROLE : 'staff' | 'admin'
 *   X-DALEBA-KEY  : clé correspondante
 */

'use strict';

const KEYS = {
  staff:  process.env.STAFF_API_KEY  || 'staff-kc-2026',
  admin:  process.env.ADMIN_API_KEY  || 'admin-kc-ulrich-2026',
};

/**
 * Vérifie qu'une requête a le rôle staff ou admin
 */
function requireStaff(req, res, next) {
  const role = req.headers['x-daleba-role'];
  const key  = req.headers['x-daleba-key'];
  if ((role === 'staff' || role === 'admin') && key === KEYS[role]) return next();
  return res.status(401).json({ error: 'Accès réservé au personnel — clé invalide' });
}

/**
 * Vérifie qu'une requête a le rôle admin uniquement
 */
function requireAdmin(req, res, next) {
  const role = req.headers['x-daleba-role'];
  const key  = req.headers['x-daleba-key'];
  if (role === 'admin' && key === KEYS.admin) return next();
  return res.status(401).json({ error: 'Accès réservé à l\'administration' });
}

module.exports = { requireStaff, requireAdmin };
