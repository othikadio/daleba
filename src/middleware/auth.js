/**
 * DALEBA — Middleware d'Authentification JWT
 * Rôles : super_admin (Ulrich) > business_admin > employee > client
 */

const jwt = require('jsonwebtoken');

const JWT_SECRET = process.env.JWT_SECRET || 'daleba-secret-change-in-prod';

const ROLES = {
  SUPER_ADMIN: 'super_admin',   // Ulrich — accès à TOUT
  BUSINESS_ADMIN: 'business_admin', // Gérant d'une entreprise
  EMPLOYEE: 'employee',          // Employé (coiffeur, etc.)
  CLIENT: 'client',              // Client final
};

const ROLE_LEVELS = {
  super_admin: 4,
  business_admin: 3,
  employee: 2,
  client: 1,
};

/**
 * Génère un token JWT
 */
function generateToken(payload, expiresIn = '30d') {
  return jwt.sign(payload, JWT_SECRET, { expiresIn });
}

/**
 * Vérifie un token JWT
 */
function verifyToken(token) {
  return jwt.verify(token, JWT_SECRET);
}

/**
 * Middleware : vérifie que la requête est authentifiée
 */
function requireAuth(req, res, next) {
  const authHeader = req.headers.authorization;
  const token = authHeader?.startsWith('Bearer ') ? authHeader.slice(7) : null;

  if (!token) {
    return res.status(401).json({ error: 'Token requis' });
  }

  try {
    const decoded = verifyToken(token);
    req.user = decoded;
    next();
  } catch (err) {
    return res.status(401).json({ error: 'Token invalide ou expiré' });
  }
}

/**
 * Middleware : vérifie un rôle minimum
 */
function requireRole(minRole) {
  return (req, res, next) => {
    if (!req.user) return res.status(401).json({ error: 'Non authentifié' });

    const userLevel = ROLE_LEVELS[req.user.role] || 0;
    const requiredLevel = ROLE_LEVELS[minRole] || 0;

    if (userLevel < requiredLevel) {
      return res.status(403).json({ error: 'Accès refusé — permissions insuffisantes' });
    }

    next();
  };
}

/**
 * Middleware : super admin seulement (Ulrich)
 */
const requireSuperAdmin = requireRole(ROLES.SUPER_ADMIN);
const requireBusinessAdmin = requireRole(ROLES.BUSINESS_ADMIN);
const requireEmployee = requireRole(ROLES.EMPLOYEE);

/**
 * Middleware : session employé Kadio RH (login téléphone + PIN, rôle 'employe_rh').
 * Distinct des rôles JWT classiques ci-dessus — pose req.employeId.
 */
function requireEmployeRH(req, res, next) {
  const authHeader = req.headers.authorization;
  const token = authHeader?.startsWith('Bearer ') ? authHeader.slice(7) : null;
  if (!token) return res.status(401).json({ error: 'Token requis' });
  try {
    const decoded = verifyToken(token);
    if (decoded.role !== 'employe_rh') return res.status(403).json({ error: 'Accès réservé aux employés' });
    req.employeId = decoded.employeId;
    next();
  } catch (err) { return res.status(401).json({ error: 'Session expirée — reconnectez-vous' }); }
}

module.exports = {
  ROLES,
  ROLE_LEVELS,
  generateToken,
  verifyToken,
  requireAuth,
  requireRole,
  requireSuperAdmin,
  requireBusinessAdmin,
  requireEmployee,
  requireEmployeRH,
};
