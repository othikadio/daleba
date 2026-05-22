/**
 * DALEBA — Auth Staff (JWT PIN)
 * POST /api/staff-auth/login
 * POST /api/staff-auth/verify
 * GET  /api/staff-auth/me
 * PUT  /api/staff-auth/profile
 * POST /api/staff-auth/change-pin
 */

const express = require('express');
const router  = express.Router();
const bcrypt  = require('bcryptjs');
const jwt     = require('jsonwebtoken');
const { pool } = require('../memory/db');

const JWT_SECRET = process.env.JWT_SECRET || 'daleba-secret-2026';

/* ── Helpers ── */
function signToken(staff) {
  return jwt.sign(
    { id: staff.id, squareId: staff.square_id, role: staff.role, name: staff.name },
    JWT_SECRET,
    { expiresIn: '24h' }
  );
}

/* ── Middleware exports ── */
function requireAuth(req, res, next) {
  const auth = req.headers.authorization;
  if (!auth || !auth.startsWith('Bearer ')) return res.status(401).json({ error: 'Token manquant' });
  try {
    req.staff = jwt.verify(auth.slice(7), JWT_SECRET);
    next();
  } catch {
    res.status(401).json({ error: 'Token invalide ou expiré' });
  }
}

function requireAdmin(req, res, next) {
  requireAuth(req, res, () => {
    if (req.staff.role !== 'admin') return res.status(403).json({ error: 'Accès admin requis' });
    next();
  });
}

/* ── Ensure tables ── */
async function ensureTables() {
  if (!pool) return;
  await pool.query(`
    CREATE TABLE IF NOT EXISTS daleba_staff (
      id            SERIAL PRIMARY KEY,
      square_id     VARCHAR(50) UNIQUE,
      name          VARCHAR(100) NOT NULL,
      email         VARCHAR(100) UNIQUE,
      phone         VARCHAR(20),
      role          VARCHAR(20) DEFAULT 'staff',
      pin           VARCHAR(6),
      password_hash VARCHAR(255),
      speciality    VARCHAR(100),
      bio           TEXT,
      is_active     BOOLEAN DEFAULT true,
      created_at    TIMESTAMPTZ DEFAULT NOW()
    );
    CREATE TABLE IF NOT EXISTS daleba_client_notes (
      id                 SERIAL PRIMARY KEY,
      client_name        VARCHAR(100),
      client_phone       VARCHAR(20),
      square_customer_id VARCHAR(50),
      note               TEXT NOT NULL,
      category           VARCHAR(30) DEFAULT 'general',
      staff_id           INTEGER REFERENCES daleba_staff(id),
      created_at         TIMESTAMPTZ DEFAULT NOW(),
      updated_at         TIMESTAMPTZ DEFAULT NOW()
    );
    CREATE TABLE IF NOT EXISTS daleba_staff_notes (
      id         SERIAL PRIMARY KEY,
      author_id  INTEGER REFERENCES daleba_staff(id),
      target_id  INTEGER REFERENCES daleba_staff(id),
      note       TEXT NOT NULL,
      is_private BOOLEAN DEFAULT true,
      created_at TIMESTAMPTZ DEFAULT NOW()
    );
  `);
  await seedStaff();
}

const STAFF_SEED = [
  { square_id: 'TMbOuVGATiQQ_fKO', name: 'Ulrich Kadio',   email: 'kadioothniel@yahoo.fr', phone: '+15149195970', role: 'admin',      pin: '5970' },
  { square_id: 'TMEhGkHirhYmHO2h', name: 'Maya',           email: 'maya@kadiocoiffure.com',    phone: '+15142074649', role: 'staff',      pin: '4649' },
  { square_id: 'TMQ9dzPRRMFbmlW9', name: 'Mariel Yonkeu',  email: 'mariel@kadiocoiffure.com',  phone: '+15149539733', role: 'staff',      pin: '9733' },
  { square_id: 'TMV-l2aFfTFgg3yM', name: 'Mariane Bérubé', email: 'mariane@kadiocoiffure.com', phone: '+14504059626', role: 'staff',      pin: '9626' },
  { square_id: 'TMoA3Pvr21QUskS1', name: 'Raquel Lafortune',email:'raquel@kadiocoiffure.com',  phone: '+14389299781', role: 'staff',      pin: '9781' },
  { square_id: 'TMMe7adVJWQa7Yjd', name: 'Hervira Brenda', email: 'hervira@kadiocoiffure.com', phone: '+14384544414', role: 'staff',      pin: '4414' },
  { square_id: 'TMdS_nh6o1iy916q', name: 'Ange Zan',       email: 'ange@kadiocoiffure.com',    phone: '+15147553039', role: 'staff',      pin: '3039' },
];

async function seedStaff() {
  for (const s of STAFF_SEED) {
    const exists = await pool.query('SELECT id FROM daleba_staff WHERE square_id=$1', [s.square_id]);
    if (exists.rows.length) continue;
    const pinHash = await bcrypt.hash(s.pin, 10);
    await pool.query(
      `INSERT INTO daleba_staff (square_id, name, email, phone, role, pin, password_hash)
       VALUES ($1,$2,$3,$4,$5,$6,$7) ON CONFLICT (square_id) DO NOTHING`,
      [s.square_id, s.name, s.email, s.phone, s.role, s.pin, pinHash]
    );
  }
}

// Init tables on load
if (pool) ensureTables().catch(e => console.warn('[StaffAuth] Init tables:', e.message));

/* ── POST /login ── */
router.post('/login', async (req, res) => {
  const { squareId, email, pin } = req.body;
  if (!pin) return res.status(400).json({ error: 'PIN requis' });
  if (!squareId && !email) return res.status(400).json({ error: 'squareId ou email requis' });

  try {
    let row;
    if (pool) {
      const q = squareId
        ? await pool.query('SELECT * FROM daleba_staff WHERE square_id=$1 AND is_active=true', [squareId])
        : await pool.query('SELECT * FROM daleba_staff WHERE email=$1 AND is_active=true', [email]);
      row = q.rows[0];
    } else {
      // demo fallback
      row = STAFF_SEED.find(s => (squareId ? s.square_id === squareId : s.email === email));
      if (row) row = { ...row, id: 1 };
    }

    if (!row) return res.status(401).json({ error: 'Staff non trouvé' });

    // Compare PIN (plain text or hashed)
    let pinOk = false;
    if (pool && row.password_hash) {
      pinOk = await bcrypt.compare(pin, row.password_hash);
    }
    if (!pinOk) {
      // fallback plain pin
      pinOk = (row.pin === pin);
    }
    if (!pinOk) return res.status(401).json({ error: 'PIN incorrect' });

    const token = signToken(row);
    res.json({
      token,
      staff: { id: row.id, name: row.name, role: row.role, squareId: row.square_id, email: row.email }
    });
  } catch (err) {
    console.error('[StaffAuth] login error:', err.message);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

/* ── POST /verify ── */
router.post('/verify', requireAuth, (req, res) => {
  res.json({ valid: true, staff: req.staff });
});

/* ── GET /me ── */
router.get('/me', requireAuth, async (req, res) => {
  if (!pool) return res.json(req.staff);
  try {
    const q = await pool.query(
      'SELECT id,name,email,phone,role,square_id,speciality,bio,is_active,created_at FROM daleba_staff WHERE id=$1',
      [req.staff.id]
    );
    if (!q.rows[0]) return res.status(404).json({ error: 'Staff non trouvé' });
    res.json(q.rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/* ── PUT /profile ── */
router.put('/profile', requireAuth, async (req, res) => {
  const { bio, speciality } = req.body;
  if (!pool) return res.json({ ok: true });
  try {
    await pool.query(
      'UPDATE daleba_staff SET bio=$1, speciality=$2 WHERE id=$3',
      [bio, speciality, req.staff.id]
    );
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/* ── POST /change-pin ── */
router.post('/change-pin', requireAuth, async (req, res) => {
  const { currentPin, newPin } = req.body;
  if (!currentPin || !newPin) return res.status(400).json({ error: 'currentPin et newPin requis' });
  if (!/^\d{4,6}$/.test(newPin)) return res.status(400).json({ error: 'PIN doit être 4-6 chiffres' });

  if (!pool) return res.json({ ok: true });
  try {
    const q = await pool.query('SELECT * FROM daleba_staff WHERE id=$1', [req.staff.id]);
    const row = q.rows[0];
    if (!row) return res.status(404).json({ error: 'Staff non trouvé' });

    let ok = await bcrypt.compare(currentPin, row.password_hash || '');
    if (!ok) ok = (row.pin === currentPin);
    if (!ok) return res.status(401).json({ error: 'PIN actuel incorrect' });

    const hash = await bcrypt.hash(newPin, 10);
    await pool.query('UPDATE daleba_staff SET pin=$1, password_hash=$2 WHERE id=$3', [newPin, hash, row.id]);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
module.exports.requireAuth = requireAuth;
module.exports.requireAdmin = requireAdmin;
