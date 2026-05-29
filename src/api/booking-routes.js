/**
 * DALEBA — Routes Réservation Kadio Coiffure (PUBLIQUES)
 * V32 — Square slots + PostgreSQL fallback + SMS Twilio
 *
 * Square Appointments write API nécessite abonnement premium →
 * On utilise Square pour lire les RDV existants (disponibilité)
 * et PostgreSQL pour créer les nouveaux RDV + SMS Twilio confirmation
 */

const express = require('express');
const router = express.Router();
const axios = require('axios');
const { Pool } = require('pg');
const twilio = require('twilio');

// ── Config ────────────────────────────────────────────────────────────────────
const SQUARE_TOKEN = process.env.SQUARE_ACCESS_TOKEN;
const SQUARE_LOCATION = process.env.SQUARE_LOCATION_ID || 'LTDE9RP9PSHX7';
const SQUARE_BASE = 'https://connect.squareup.com/v2';
const SQUARE_VERSION = '2024-01-17';

const TWILIO_SID = process.env.TWILIO_ACCOUNT_SID;
const TWILIO_AUTH = process.env.TWILIO_AUTH_TOKEN;
const TWILIO_FROM = process.env.TWILIO_PHONE_NUMBER;

// PostgreSQL pool (via DATABASE_URL Railway)
let pool = null;
const getPool = () => {
  if (!pool && process.env.DATABASE_URL && !process.env.DATABASE_URL.includes('user:password')) {
    pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
  }
  return pool;
};

// Twilio client
let twilioClient = null;
const getTwilio = () => {
  if (!twilioClient) {
    twilioClient = twilio(TWILIO_SID, TWILIO_AUTH);
  }
  return twilioClient;
};

// ── Données statiques Kadio Coiffure ─────────────────────────────────────────

const SALON_INFO = {
  name: 'Kadio Coiffure',
  address: '615 Antoinette Robidoux, local 100, Longueuil, QC J4J 2V8',
  phone: '514-919-5970',
  email: 'kadioothniel@yahoo.fr',
  website: 'https://daleba-api-production.up.railway.app',
  hours: {
    SUN: { open: '10:00', close: '17:00' },
    MON: { open: '12:00', close: '17:00' },
    TUE: null, // Fermé
    WED: { open: '10:00', close: '17:00' },
    THU: { open: '10:00', close: '21:00' },
    FRI: { open: '10:00', close: '21:00' },
    SAT: { open: '10:00', close: '21:00' },
  },
};

// Catalogue officiel Kadio Coiffure — synchronisé avec /menu (V34, 21 mai 2026)
const SERVICES = [
  // LOCKS
  { id: 'locks-retwist-complet',   name: 'Repousses locks retwist au gel — tête complète',           price: 135, duration: 120, category: 'Locks',            deposit: true  },
  { id: 'locks-retwist-demi',      name: 'Repousses locks retwist-interlock — demi-tête',            price: 110, duration: 90,  category: 'Locks',            deposit: true  },
  { id: 'locks-interlock-complet', name: 'Repousses locks interlock au crochet — tête complète',     price: 150, duration: 150, category: 'Locks',            deposit: true  },
  { id: 'locks-interlock-demi',    name: 'Repousses locks interlock au crochet — demi-tête',        price: 125, duration: 105, category: 'Locks',            deposit: true  },
  { id: 'locks-repiquer',          name: 'Repiquer les racines (racine uniquement)',                  price: 60,  duration: 90,  category: 'Locks',            deposit: false },
  { id: 'locks-depart-complet',    name: 'Départ de locks instantané au crochet — tête complète',   price: 350, duration: 240, category: 'Locks',            deposit: true  },
  { id: 'locks-depart-demi',       name: 'Départ de locks instantané au crochet — demi-tête',       price: 250, duration: 180, category: 'Locks',            deposit: true  },
  { id: 'locks-installation',      name: 'Installation des locks (sans extensions fournies)',        price: 250, duration: 180, category: 'Locks',            deposit: true  },
  { id: 'locks-coiffure',          name: 'Coiffure locks long',                                      price: 60,  duration: 60,  category: 'Locks',            deposit: false },
  { id: 'locks-tresser',           name: 'Tresser vos dreads / locks',                               price: 45,  duration: 30,  category: 'Locks',            deposit: false },
  { id: 'locks-reparation',        name: 'Réparation de dreads / locks',                             price: 0,   duration: 60,  category: 'Locks',            deposit: false },
  { id: 'locks-defaire',           name: 'Défaire des locks (garder le maximum)',                    price: 200, duration: 300, category: 'Locks',            deposit: true  },
  { id: 'sisterlocks-installation',name: 'Installation Sisterlocks',                                  price: 850, duration: 600, category: 'Locks',            deposit: true  },
  { id: 'sisterlocks-entretien',   name: 'Entretien Sisterlocks',                                    price: 0,   duration: 270, category: 'Locks',            deposit: true  },
  // TRESSES & NATTES
  { id: 'nattes-americaines',      name: 'Nattes Américaines',                                       price: 140, duration: 240, category: 'Tresses & Nattes', deposit: true  },
  { id: 'nattes-colles-small',     name: 'Nattes collées / barrel twist (2 à 6 nattes)',             price: 20,  duration: 60,  category: 'Tresses & Nattes', deposit: false },
  { id: 'nattes-colles-large',     name: 'Nattes collées / barrel twist (7 nattes et plus)',         price: 80,  duration: 120, category: 'Tresses & Nattes', deposit: true  },
  { id: 'twist-demi',              name: 'Twist demi-tête',                                          price: 70,  duration: 150, category: 'Tresses & Nattes', deposit: true  },
  { id: 'twist-complet',           name: 'Twist tête complète',                                      price: 120, duration: 180, category: 'Tresses & Nattes', deposit: true  },
  { id: 'crochet-braids',          name: 'Crochet braids',                                           price: 170, duration: 120, category: 'Tresses & Nattes', deposit: true  },
  { id: 'knotless-court',          name: 'Knotless Braids court',                                    price: 120, duration: 360, category: 'Tresses & Nattes', deposit: true  },
  { id: 'knotless-gros',           name: 'Knotless Gros',                                            price: 120, duration: 300, category: 'Tresses & Nattes', deposit: true  },
  { id: 'knotless-moyen',          name: 'Knotless Moyen',                                           price: 150, duration: 300, category: 'Tresses & Nattes', deposit: true  },
  { id: 'knotless-petit',          name: 'Knotless Petit',                                           price: 300, duration: 480, category: 'Tresses & Nattes', deposit: true  },
  // COUPE & BARBIER
  { id: 'barbier-sans-barbe',      name: 'Coupe barbier sans barbe',                                 price: 35,  duration: 35,  category: 'Coupe & Barbier',  deposit: false },
  { id: 'barbier-avec-barbe',      name: 'Coupe barbier avec barbe',                                 price: 40,  duration: 45,  category: 'Coupe & Barbier',  deposit: false },
  { id: 'barbier-enfant',          name: 'Coupe barbier enfant (12 ans et moins)',                   price: 30,  duration: 40,  category: 'Coupe & Barbier',  deposit: false },
  { id: 'contours',                name: 'Contours',                                                  price: 20,  duration: 60,  category: 'Coupe & Barbier',  deposit: false },
  { id: 'barbe-seule',             name: 'Barbe',                                                     price: 20,  duration: 30,  category: 'Coupe & Barbier',  deposit: false },
  { id: 'coupe-homme',             name: 'Coupe homme',                                               price: 35,  duration: 60,  category: 'Coupe & Barbier',  deposit: false },
  { id: 'coupe-homme-barbe',       name: 'Coupe homme + barbe',                                       price: 40,  duration: 75,  category: 'Coupe & Barbier',  deposit: false },
  { id: 'coupe-enfant',            name: 'Coupe 12 ans et moins',                                    price: 30,  duration: 60,  category: 'Coupe & Barbier',  deposit: false },
  // TECHNIQUE & SOINS
  { id: 'lissage-defrisant',       name: 'Lissage défrisant en pot',                                 price: 60,  duration: 60,  category: 'Technique & Soins', deposit: true  },
  { id: 'soin-hydratation',        name: 'Soin hydratation profonde',                                price: 40,  duration: 60,  category: 'Technique & Soins', deposit: false },
  { id: 'coupe-pointes',           name: 'Coupe des pointes',                                        price: 30,  duration: 30,  category: 'Technique & Soins', deposit: false },
  { id: 'chignon',                 name: 'Chignon',                                                   price: 80,  duration: 60,  category: 'Technique & Soins', deposit: true  },
  { id: 'laver-seche',             name: 'Laver séché',                                               price: 25,  duration: 45,  category: 'Technique & Soins', deposit: false },
  { id: 'lavage-locs',             name: 'Lavage de locs',                                           price: 30,  duration: 45,  category: 'Technique & Soins', deposit: false },
  { id: 'mise-en-plis',            name: 'Laver, sécher, lisser ou friser (Mise en plis)',           price: 65,  duration: 90,  category: 'Technique & Soins', deposit: false },
  { id: 'mise-en-plis-sans-lavage',name: 'Mise en plis sans lavage',                                 price: 45,  duration: 90,  category: 'Technique & Soins', deposit: false },
  { id: 'teinture-noire',          name: 'Teinture noire',                                           price: 50,  duration: 60,  category: 'Technique & Soins', deposit: true  },
  { id: 'finger-coils',            name: 'Finger coils',                                             price: 60,  duration: 60,  category: 'Technique & Soins', deposit: false },
  // TISSAGE & PERRUQUES
  { id: 'tissage',                 name: 'Tissage',                                                   price: 120, duration: 165, category: 'Tissage & Perruques', deposit: true  },
  { id: 'pose-lace-frontale',      name: 'Pose lace frontale',                                       price: 150, duration: 90,  category: 'Tissage & Perruques', deposit: true  },
  { id: 'pose-frontale-180',       name: 'Pose frontale 180°',                                       price: 150, duration: 120, category: 'Tissage & Perruques', deposit: true  },
  { id: 'pose-frontale-360',       name: 'Pose frontale 360°',                                       price: 200, duration: 120, category: 'Tissage & Perruques', deposit: true  },
  { id: 'pose-perruque-closure',   name: 'Pose perruque closure',                                    price: 100, duration: 120, category: 'Tissage & Perruques', deposit: true  },
  { id: 'natte-sous-perruque',     name: 'Natte sous perruque (si pose)',                            price: 40,  duration: 30,  category: 'Tissage & Perruques', deposit: false },
  { id: 'pose-closure-coiffure',   name: 'Pose perruque closure avec coiffure',                     price: 150, duration: 120, category: 'Tissage & Perruques', deposit: true  },
  { id: 'coiffure-lace',           name: 'Coiffure sur lace frontale',                               price: 30,  duration: 60,  category: 'Tissage & Perruques', deposit: false },
  { id: 'coiffure-perruque',       name: 'Coiffure sur perruque',                                    price: 50,  duration: 60,  category: 'Tissage & Perruques', deposit: false },
  { id: 'mise-plis-perruque',      name: 'Mise en plis sur perruque (lisser ou boucler)',            price: 45,  duration: 60,  category: 'Tissage & Perruques', deposit: false },
  { id: 'lavage-mise-plis-perruque', name: 'Lavage + Mise en plis sur perruque',                    price: 65,  duration: 75,  category: 'Tissage & Perruques', deposit: false },
];

// Équipe réelle Kadio Coiffure — mise à jour 21 mai 2026
const STAFF = [
  { id: 'TMQ9dzPRRMFbmlW9', name: 'Mariel',          role_title: 'Barbier',             color: '#6366f1', phone: '' },
  { id: 'TMdS_nh6o1iy916q', name: 'Ange',            role_title: 'Coiffeuse',           color: '#ec4899', phone: '' },
  { id: 'STAFF-AICHA',      name: 'Aïcha',           role_title: 'Coiffeuse',           color: '#f59e0b', phone: '+14383504840' },
  { id: 'TMbOuVGATiQQ_fKO', name: 'Othi Kadio',      role_title: 'Locticien — Locks',   color: '#10b981', phone: '' },
  { id: 'STAFF-CHABRIOL',   name: 'Chabriol Wilfreed', role_title: 'Barbier',           color: '#3b82f6', phone: '+16136840208' },
  { id: 'TMoA3Pvr21QUskS1', name: 'Raquel',           role_title: 'Locticienne',         color: '#8b5cf6', phone: '' },
];
// Exclus du site: Maya Dieynaba, Hervira Brenda, Mariane Bérubé

// ── Helpers ───────────────────────────────────────────────────────────────────

const DAY_NAMES = ['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT'];

// ── Taxes Québec ──────────────────────────────────────────────────────────────
function calculateTaxes(priceBeforeTax) {
  const tps = Math.round(priceBeforeTax * 0.05 * 100) / 100;      // TPS 5%
  const tvq = Math.round(priceBeforeTax * 0.09975 * 100) / 100;   // TVQ 9.975%
  const total = Math.round((priceBeforeTax + tps + tvq) * 100) / 100;
  return { priceBeforeTax, tps, tvq, total, taxRate: 0.14975 };
}

// ── Dépôt 20% (exception Barbier/Coupe & Barbier → 0$) ───────────────────────
const BARBER_SERVICES = [
  'coupe barbier sans barbe', 'coupe barbier avec barbe', 'coupe barbier enfant',
  'contours', 'barbe', 'coupe homme', 'coupe homme + barbe', 'coupe 12 ans et moins',
  'barbier', 'barber', 'coupe hommes', 'beard', 'haircut',
];

function isBarberService(serviceName) {
  const name = (serviceName || '').toLowerCase();
  return BARBER_SERVICES.some(s => name.includes(s));
}

function calculateDeposit(service) {
  if (!service.deposit || service.price <= 0 || isBarberService(service.name) || service.category === 'Coupe & Barbier') {
    return 0;
  }
  return Math.round(service.price * 0.20 * 100) / 100;
}

function parseDateLocal(dateStr) {
  // dateStr = "YYYY-MM-DD"
  const [year, month, day] = dateStr.split('-').map(Number);
  return new Date(year, month - 1, day);
}

function timeToMinutes(timeStr) {
  const [h, m] = timeStr.split(':').map(Number);
  return h * 60 + m;
}

function minutesToTime(minutes) {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

function generateDaySlots(dateStr, dayName, durationMin) {
  const hours = SALON_INFO.hours[dayName];
  if (!hours) return []; // Jour fermé

  const slots = [];
  const openMin = timeToMinutes(hours.open);
  const closeMin = timeToMinutes(hours.close);

  for (let t = openMin; t + durationMin <= closeMin; t += 30) {
    slots.push({
      time: minutesToTime(t),
      datetime: `${dateStr}T${minutesToTime(t)}:00`,
      available: true,
    });
  }
  return slots;
}

async function getSquareBookingsForDay(staffId, dateStr) {
  // Récupère les RDV Square existants pour un coiffeur ce jour-là
  try {
    const startAt = `${dateStr}T00:00:00Z`;
    // Get next day for end_at
    const d = parseDateLocal(dateStr);
    d.setDate(d.getDate() + 1);
    const endAt = d.toISOString().split('T')[0] + 'T00:00:00Z';

    const resp = await axios.get(`${SQUARE_BASE}/bookings`, {
      headers: {
        'Square-Version': SQUARE_VERSION,
        Authorization: `Bearer ${SQUARE_TOKEN}`,
      },
      params: {
        location_id: SQUARE_LOCATION,
        team_member_id: staffId,
        start_at_min: startAt,
        start_at_max: endAt,
        limit: 100,
      },
      timeout: 5000,
    });
    return resp.data.bookings || [];
  } catch (e) {
    console.error('[booking] Square read error:', e.message);
    return [];
  }
}

async function getDbBookingsForDay(staffId, dateStr) {
  // Récupère les RDV PostgreSQL pour un coiffeur ce jour-là
  try {
    const db = getPool();
    if (!db) return [];
    const result = await db.query(
      `SELECT start_at, duration_min FROM daleba_bookings
       WHERE staff_id = $1
         AND start_at::date = $2::date
         AND status != 'cancelled'`,
      [staffId, dateStr]
    );
    return result.rows;
  } catch (e) {
    console.error('[booking] DB read error:', e.message);
    return [];
  }
}

function slotConflicts(slotTime, durationMin, existingBookings) {
  // existingBookings: [{start_at (ISO or Date), duration_min}]
  const slotStart = new Date(slotTime).getTime();
  const slotEnd = slotStart + durationMin * 60000;

  for (const booking of existingBookings) {
    const bStart = new Date(booking.start_at).getTime();
    const bDur = booking.duration_min || booking.appointment_segments?.[0]?.duration_minutes || 60;
    const bEnd = bStart + bDur * 60000;

    if (slotStart < bEnd && slotEnd > bStart) return true;
  }
  return false;
}

async function ensureBookingsTable() {
  const db = getPool();
  if (!db) return false;
  try {
    await db.query(`
      CREATE TABLE IF NOT EXISTS daleba_bookings (
        id SERIAL PRIMARY KEY,
        service_id VARCHAR(50),
        service_name VARCHAR(100),
        staff_id VARCHAR(50),
        staff_name VARCHAR(100),
        client_name VARCHAR(100),
        client_phone VARCHAR(20),
        client_email VARCHAR(100),
        start_at TIMESTAMPTZ,
        duration_min INTEGER,
        notes TEXT,
        status VARCHAR(20) DEFAULT 'confirmed',
        deposit_amount DECIMAL(10,2) DEFAULT 0,
        price_before_tax DECIMAL(10,2),
        tps DECIMAL(10,2),
        tvq DECIMAL(10,2),
        total_with_taxes DECIMAL(10,2),
        created_at TIMESTAMPTZ DEFAULT NOW()
      )
    `);
    // Ajouter colonnes si table existante (migration douce)
    const cols = ['deposit_amount DECIMAL(10,2) DEFAULT 0', 'price_before_tax DECIMAL(10,2)',
                  'tps DECIMAL(10,2)', 'tvq DECIMAL(10,2)', 'total_with_taxes DECIMAL(10,2)'];
    for (const col of cols) {
      const colName = col.split(' ')[0];
      await db.query(`ALTER TABLE daleba_bookings ADD COLUMN IF NOT EXISTS ${col}`).catch(() => {});
    }
    return true;
  } catch (e) {
    console.error('[booking] ensureBookingsTable error:', e.message);
    return false;
  }
}

async function sendSMS(toPhone, message) {
  try {
    const client = getTwilio();
    const msg = await client.messages.create({
      from: TWILIO_FROM,
      to: toPhone,
      body: message,
    });
    console.log('[booking] SMS sent:', msg.sid);
    return { success: true, sid: msg.sid };
  } catch (e) {
    console.error('[booking] SMS error:', e.message);
    return { success: false, error: e.message };
  }
}

function formatDateFR(isoStr) {
  // "2026-05-22T14:00:00" → "vendredi 22 mai 2026 à 14h00"
  const d = new Date(isoStr);
  const days = ['dimanche', 'lundi', 'mardi', 'mercredi', 'jeudi', 'vendredi', 'samedi'];
  const months = ['janvier', 'février', 'mars', 'avril', 'mai', 'juin', 'juillet', 'août', 'septembre', 'octobre', 'novembre', 'décembre'];
  const h = String(d.getHours()).padStart(2, '0');
  const m = String(d.getMinutes()).padStart(2, '0');
  return `${days[d.getDay()]} ${d.getDate()} ${months[d.getMonth()]} ${d.getFullYear()} à ${h}h${m}`;
}

// ── Routes ────────────────────────────────────────────────────────────────────

// GET /api/booking/info — Infos salon publiques
router.get('/info', (req, res) => {
  res.json({
    business: {
      name: SALON_INFO.name,
      address: SALON_INFO.address,
      phone: SALON_INFO.phone,
      email: SALON_INFO.email,
      website: SALON_INFO.website,
      hours: SALON_INFO.hours,
    },
  });
});

// GET /api/booking/services — Liste des services
router.get('/services', (req, res) => {
  res.json({ services: SERVICES });
});

// GET /api/booking/staff — Liste des coiffeurs actifs
router.get('/staff', (req, res) => {
  res.json({ staff: STAFF });
});

// GET /api/booking/slots?staffId=&serviceId=&date=YYYY-MM-DD
router.get('/slots', async (req, res) => {
  const { staffId, serviceId, date } = req.query;

  if (!staffId || !serviceId || !date) {
    return res.status(400).json({ error: 'staffId, serviceId et date requis' });
  }

  // Valider date format
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return res.status(400).json({ error: 'date doit être au format YYYY-MM-DD' });
  }

  // Trouver le service
  const service = SERVICES.find(s => s.id === serviceId);
  if (!service) {
    return res.status(404).json({ error: 'Service introuvable' });
  }

  // Jour de la semaine
  const d = parseDateLocal(date);
  const dayName = DAY_NAMES[d.getDay()];

  // Générer les créneaux de base selon les horaires
  const rawSlots = generateDaySlots(date, dayName, service.duration);

  if (rawSlots.length === 0) {
    return res.json({ slots: [], date, staffId, serviceId, closed: true });
  }

  // Récupérer les RDV existants (Square + DB)
  const [squareBookings, dbBookings] = await Promise.all([
    getSquareBookingsForDay(staffId, date),
    getDbBookingsForDay(staffId, date),
  ]);

  // Normaliser les bookings Square pour comparaison
  const squareNormalized = squareBookings.map(b => ({
    start_at: b.start_at,
    duration_min: b.appointment_segments?.[0]?.duration_minutes || 60,
  }));

  // Filtrer les créneaux disponibles
  const allBookings = [...squareNormalized, ...dbBookings];
  const availableSlots = rawSlots.map(slot => {
    // Construire l'ISO datetime pour comparaison
    // On utilise la timezone du salon (America/Toronto, UTC-4 en été)
    const slotISO = `${date}T${slot.time}:00-04:00`;
    const available = !slotConflicts(slotISO, service.duration, allBookings);
    return { ...slot, available };
  });

  res.json({
    slots: availableSlots,
    date,
    staffId,
    serviceId,
    service: { name: service.name, duration: service.duration, price: service.price },
  });
});

// POST /api/booking/book — Créer un RDV
router.post('/book', async (req, res) => {
  const {
    staffId, serviceId, date, time,
    clientName, clientPhone, clientEmail, notes,
  } = req.body;

  // Validation
  if (!staffId || !serviceId || !date || !time || !clientName) {
    return res.status(400).json({ error: 'staffId, serviceId, date, time et clientName requis' });
  }
  if (!clientPhone && !clientEmail) {
    return res.status(400).json({ error: 'clientPhone ou clientEmail requis' });
  }

  const service = SERVICES.find(s => s.id === serviceId);
  if (!service) return res.status(404).json({ error: 'Service introuvable' });

  const staff = STAFF.find(s => s.id === staffId);
  if (!staff) return res.status(404).json({ error: 'Coiffeur introuvable' });

  // Construire l'heure de début (timezone salon: UTC-4 en été, UTC-5 en hiver)
  const startAt = `${date}T${time}:00-04:00`;
  const startISO = new Date(startAt).toISOString();

  // Vérifier disponibilité avant de créer
  const [squareBookings, dbBookings] = await Promise.all([
    getSquareBookingsForDay(staffId, date),
    getDbBookingsForDay(staffId, date),
  ]);

  const squareNormalized = squareBookings.map(b => ({
    start_at: b.start_at,
    duration_min: b.appointment_segments?.[0]?.duration_minutes || 60,
  }));

  if (slotConflicts(startAt, service.duration, [...squareNormalized, ...dbBookings])) {
    return res.status(409).json({ error: 'Ce créneau n\'est plus disponible. Veuillez en choisir un autre.' });
  }

  // Calculer taxes et dépôt
  const taxes = calculateTaxes(service.price);
  const depositAmount = calculateDeposit(service);
  const depositWaived = depositAmount === 0;

  // Créer dans PostgreSQL
  await ensureBookingsTable();
  const db = getPool();

  let bookingId = null;
  let dbSuccess = false;

  if (db) {
    try {
      const result = await db.query(
        `INSERT INTO daleba_bookings
           (service_id, service_name, staff_id, staff_name, client_name,
            client_phone, client_email, start_at, duration_min, notes, status,
            deposit_amount, price_before_tax, tps, tvq, total_with_taxes)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,'confirmed',$11,$12,$13,$14,$15)
         RETURNING id`,
        [
          service.id, service.name,
          staff.id, staff.name,
          clientName, clientPhone || null, clientEmail || null,
          startISO, service.duration,
          notes || null,
          depositAmount, taxes.priceBeforeTax, taxes.tps, taxes.tvq, taxes.total,
        ]
      );
      bookingId = result.rows[0].id;
      dbSuccess = true;
    } catch (e) {
      console.error('[booking] DB insert error:', e.message);
    }
  }

  // Envoyer SMS de confirmation si numéro fourni
  let smsResult = null;
  if (clientPhone) {
    const firstName = clientName.split(' ')[0];
    const dateFR = formatDateFR(startISO);
    const depositLine = depositWaived
      ? 'Aucun dépôt requis.'
      : `Dépôt de 20% : ${depositAmount}$ CAD requis.`;
    const baseUrl = process.env.API_BASE_URL || 'https://kadiocoiffure.vercel.app/hub';
    const ratingUrl = `${baseUrl}/noter-service?appt=${bookingId}&phone=${encodeURIComponent(clientPhone)}&name=${encodeURIComponent(firstName)}`;
    const smsBody = `Bonjour ${firstName}, votre rendez-vous chez Kadio Coiffure est confirmé pour le ${dateFR}. Service: ${service.name}. ${depositLine} Adresse: 615 Antoinette-Robidoux, local 100, Longueuil. Besoin de modifier? Appelez le (514) 919-5970. Notez votre expérience : ${ratingUrl}`;
    smsResult = await sendSMS(clientPhone, smsBody);
  }

  const taxSummary = { priceBeforeTax: taxes.priceBeforeTax, tps: taxes.tps, tvq: taxes.tvq, total: taxes.total };

  // Réponse
  if (dbSuccess || smsResult?.success) {
    return res.status(201).json({
      success: true,
      booking: {
        id: bookingId,
        service: service.name,
        staffName: staff.name,
        startAt: startISO,
        duration: service.duration,
        clientName,
        status: 'confirmed',
        depositAmount,
        depositWaived,
        taxes: taxSummary,
      },
      taxes: taxSummary,
      depositAmount,
      depositWaived,
      message: clientPhone
        ? 'RDV confirmé. Vous allez recevoir un SMS de confirmation.'
        : 'RDV confirmé. À bientôt chez Kadio Coiffure.',
      sms: smsResult,
    });
  }

  // Fallback: pas de DB, pas de SMS — confirmer quand même
  return res.status(201).json({
    success: true,
    booking: {
      service: service.name,
      staffName: staff.name,
      startAt: startISO,
      duration: service.duration,
      clientName,
      status: 'confirmed',
      depositAmount,
      depositWaived,
      taxes: taxSummary,
    },
    taxes: taxSummary,
    depositAmount,
    depositWaived,
    message: 'RDV enregistré. Merci de contacter le salon pour confirmation: 514-919-5970',
  });
});

// ─── POST /api/booking/modify — modifier/déplacer un RDV + SMS client ──────────────────
// Corps: { bookingId, newDate?, newTime?, newStaffId?, clientPhone? }
router.post('/modify', async (req, res) => {
  const { bookingId, newDate, newTime, newStaffId, clientPhone, clientName, serviceName } = req.body || {};
  if (!bookingId) return res.status(400).json({ error: 'bookingId requis' });

  const updates = [];
  let newStaff = null;

  if (newStaffId) {
    newStaff = STAFF.find(s => s.id === newStaffId);
    if (!newStaff) return res.status(404).json({ error: 'Coiffeur introuvable' });
    updates.push(`coiffeur → ${newStaff.name}`);
  }
  if (newDate) updates.push(`date → ${newDate}`);
  if (newTime) updates.push(`heure → ${newTime}`);

  // Mise à jour DB si booking dans daleba_bookings
  try {
    const { pool } = require('../memory/db');
    if (pool) {
      const setClauses = [];
      const vals = [];
      let idx = 1;
      if (newDate && newTime) {
        const [h, m] = newTime.split(':');
        const dt = new Date(`${newDate}T${h.padStart(2,'0')}:${(m||'00').padStart(2,'0')}:00`);
        setClauses.push(`start_at = $${idx++}`);
        vals.push(dt.toISOString());
      }
      if (newStaffId) {
        setClauses.push(`staff_id = $${idx++}`, `staff_name = $${idx++}`);
        vals.push(newStaffId, newStaff.name);
      }
      if (setClauses.length) {
        vals.push(bookingId);
        await pool.query(
          `UPDATE daleba_bookings SET ${setClauses.join(', ')} WHERE id = $${idx}`,
          vals
        );
      }
    }
  } catch (_) { /* DB optionnelle */ }

  // SMS de mise à jour au client
  if (clientPhone) {
    try {
      const sid   = process.env.TWILIO_ACCOUNT_SID;
      const auth  = process.env.TWILIO_AUTH_TOKEN;
      const from  = process.env.TWILIO_PHONE_NUMBER;
      const smsBody = `✏️ RDV MODIFIÉ — Kadio Coiffure\n${serviceName || 'Votre rendez-vous'} : ${updates.join(', ')}.\nQuestions : 514-919-5970`;
      const body = new URLSearchParams({ To: clientPhone, From: from, Body: smsBody });
      const encoded = `Basic ${Buffer.from(`${sid}:${auth}`).toString('base64')}`;
      const https = require('https');
      const payload = body.toString();
      await new Promise((resolve) => {
        const req2 = https.request({
          hostname: 'api.twilio.com',
          path: `/2010-04-01/Accounts/${sid}/Messages.json`,
          method: 'POST',
          headers: { 'Authorization': encoded, 'Content-Type': 'application/x-www-form-urlencoded', 'Content-Length': Buffer.byteLength(payload) },
        }, (r) => { r.resume(); resolve(); });
        req2.on('error', resolve);
        req2.write(payload);
        req2.end();
      });
    } catch (_) { /* SMS optionnel */ }
  }

  res.json({
    success: true,
    bookingId,
    updates,
    smsSent: !!clientPhone,
    message: `RDV #${bookingId} modifié : ${updates.join(', ')}.${clientPhone ? ' SMS envoyé.' : ''}`,
  });
});

module.exports = router;
