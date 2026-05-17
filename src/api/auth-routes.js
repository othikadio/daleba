/**
 * DALEBA — Routes Authentification
 * Login, register, token refresh pour tous les rôles
 */

const express = require('express');
const router = express.Router();
const bcrypt = require('bcryptjs');
const { pool, DEMO_MODE } = require('../memory/db');
const { generateToken, verifyToken, ROLES } = require('../middleware/auth');

// POST /api/auth/register — Créer un compte (via invitation ou super_admin)
router.post('/register', async (req, res) => {
  const { name, email, password, inviteToken } = req.body;

  if (!name || !email || !password) {
    return res.status(400).json({ error: 'name, email et password requis' });
  }

  let role = ROLES.CLIENT;
  let businessId = null;

  // Si invitation, extraire le contexte
  if (inviteToken) {
    try {
      const decoded = verifyToken(inviteToken);
      if (decoded.type !== 'invitation' || decoded.email !== email) {
        return res.status(400).json({ error: 'Token d\'invitation invalide' });
      }
      role = decoded.role;
      businessId = decoded.businessId;
    } catch {
      return res.status(400).json({ error: 'Token d\'invitation expiré ou invalide' });
    }
  }

  try {
    const hash = await bcrypt.hash(password, 12);

    const result = await pool.query(`
      INSERT INTO users (name, email, password_hash, role, business_id, created_at)
      VALUES ($1, $2, $3, $4, $5, NOW())
      RETURNING id, name, email, role, business_id
    `, [name, email, hash, role, businessId]);

    const user = result.rows[0];
    const token = generateToken({ id: user.id, email: user.email, role: user.role, businessId: user.business_id });

    res.status(201).json({ success: true, token, user });
  } catch (err) {
    if (err.code === '23505') {
      return res.status(409).json({ error: 'Email déjà utilisé' });
    }
    res.status(500).json({ error: err.message });
  }
});

// POST /api/auth/login — Connexion
router.post('/login', async (req, res) => {
  const { email, password } = req.body;

  if (!email || !password) {
    return res.status(400).json({ error: 'email et password requis' });
  }

  // Mode démo : login avec compte admin par défaut
  if (DEMO_MODE) {
    const DEMO_CREDENTIALS = [
      { email: 'admin@kadiocoiffure.ca', password: 'demo1234', role: 'admin', name: 'Ulrich Kadio', businessId: 1 },
      { email: 'staff@kadiocoiffure.ca', password: 'demo1234', role: 'staff', name: 'Marie-Claire', businessId: 1 },
    ];
    const match = DEMO_CREDENTIALS.find(u => u.email === email && u.password === password);
    if (!match) return res.status(401).json({ error: 'Identifiants incorrects (démo: admin@kadiocoiffure.ca / demo1234)' });
    const token = generateToken({ id: 1, email: match.email, name: match.name, role: match.role, businessId: match.businessId });
    return res.json({ success: true, token, user: { id: 1, ...match }, demo: true });
  }

  try {
    const result = await pool.query(
      'SELECT * FROM users WHERE email = $1 AND is_active = true',
      [email]
    );

    if (!result.rows.length) {
      return res.status(401).json({ error: 'Identifiants incorrects' });
    }

    const user = result.rows[0];
    const valid = await bcrypt.compare(password, user.password_hash);

    if (!valid) {
      return res.status(401).json({ error: 'Identifiants incorrects' });
    }

    // Mise à jour last_login
    await pool.query('UPDATE users SET last_login = NOW() WHERE id = $1', [user.id]);

    const token = generateToken({
      id: user.id,
      email: user.email,
      name: user.name,
      role: user.role,
      businessId: user.business_id,
    });

    res.json({
      success: true,
      token,
      user: {
        id: user.id,
        name: user.name,
        email: user.email,
        role: user.role,
        businessId: user.business_id,
      },
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/auth/super — Login super_admin (Ulrich) via masterKey
router.post('/super', async (req, res) => {
  const { masterKey } = req.body;

  if (!masterKey || masterKey !== process.env.DALEBA_MASTER_KEY) {
    return res.status(403).json({ error: 'Accès refusé' });
  }

  const token = generateToken({
    id: 0,
    email: 'ulrich@daleba.app',
    name: 'Kadio Ulrich',
    role: ROLES.SUPER_ADMIN,
    businessId: null,
  });

  res.json({
    success: true,
    token,
    role: ROLES.SUPER_ADMIN,
    message: '🔥 DALEBA Super Admin — Bienvenue, Ulrich',
  });
});

// GET /api/auth/me — Profil de l'utilisateur connecté
router.get('/me', async (req, res) => {
  const authHeader = req.headers.authorization;
  const token = authHeader?.startsWith('Bearer ') ? authHeader.slice(7) : null;

  if (!token) return res.status(401).json({ error: 'Token requis' });

  try {
    const decoded = verifyToken(token);
    res.json({ user: decoded });
  } catch {
    res.status(401).json({ error: 'Token invalide' });
  }
});

module.exports = router;
