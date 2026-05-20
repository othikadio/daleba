/**
 * DALEBA — Middleware Admin PIN
 * Protège les routes sensibles (emergency-stop, admin/images)
 */

const ADMIN_PIN = process.env.ADMIN_PIN || '2024DALEBA';

function requireAdminPin(req, res, next) {
  const pin = req.headers['x-admin-pin'] || req.body?.adminPin;
  if (pin !== ADMIN_PIN) return res.status(403).json({ error: 'Accès refusé' });
  next();
}

module.exports = requireAdminPin;
