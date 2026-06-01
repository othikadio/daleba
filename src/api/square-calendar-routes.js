/**
 * DALEBA — Square Calendar Routes (Chantier 2)
 * Interface calendrier Square multi-staff pour /admin/calendar
 *
 * GET  /api/sq-calendar/appointments?start=YYYY-MM-DD&end=YYYY-MM-DD&staffId=xxx
 * POST /api/sq-calendar/appointments
 * POST /api/sq-calendar/appointments/:id/cancel
 * GET  /api/sq-calendar/staff
 * GET  /api/sq-calendar/services
 * POST /api/sq-calendar/availability
 * GET  /api/sq-calendar/customers/search?q=nom
 */

const express = require('express');
const router = express.Router();
const { requireAuth } = require('./auth-staff-routes');

// Route d'import VCF publique (pin requis) — AVANT requireAuth
router.post('/contact-book/vcf-import', async (req, res) => {
  const pin = req.headers['x-import-pin'] || req.body?.pin;
  if (pin !== (process.env.ADMIN_PIN || '2024DALEBA')) return res.status(403).json({ error: 'Pin invalide' });
  const { pool } = require('../memory/db');
  const contacts = req.body.contacts || [];
  if (!contacts.length) return res.status(400).json({ error: 'Vide' });
  await pool.query(`CREATE TABLE IF NOT EXISTS daleba_contact_book (id SERIAL PRIMARY KEY, name VARCHAR(200), phone VARCHAR(50), source VARCHAR(50) DEFAULT 'vcf_import', imported_at TIMESTAMP DEFAULT NOW(), UNIQUE(phone))`);
  let ins = 0;
  for (const c of contacts) {
    if (!c.phone) continue;
    try { await pool.query(`INSERT INTO daleba_contact_book (name,phone,source) VALUES ($1,$2,'vcf_import') ON CONFLICT (phone) DO UPDATE SET name=EXCLUDED.name`, [c.name||'Contact', c.phone]); ins++; } catch(_) {}
  }
  res.json({ ok: true, inserted: ins, total: contacts.length });
});

// Protéger toutes les routes /api/sq-calendar/*
router.use(requireAuth);

const SQUARE_BASE  = 'https://connect.squareup.com';
const SQUARE_TOKEN = process.env.SQUARE_ACCESS_TOKEN;
const LOCATION_ID  = process.env.SQUARE_LOCATION_ID;

function headers() {
  if (!SQUARE_TOKEN) throw new Error('SQUARE_ACCESS_TOKEN manquant');
  return {
    'Authorization': `Bearer ${SQUARE_TOKEN}`,
    'Content-Type': 'application/json',
    'Square-Version': '2024-02-22',
  };
}

async function squareGet(path) {
  const res = await fetch(`${SQUARE_BASE}${path}`, { headers: headers() });
  const data = await res.json();
  if (!res.ok) {
    const msg = data.errors?.[0]?.detail || data.errors?.[0]?.code || `HTTP ${res.status}`;
    throw new Error(`Square [${res.status}]: ${msg}`);
  }
  return data;
}

async function squarePost(path, body) {
  const res = await fetch(`${SQUARE_BASE}${path}`, {
    method: 'POST',
    headers: headers(),
    body: JSON.stringify(body),
  });
  const data = await res.json();
  if (!res.ok) {
    const msg = data.errors?.[0]?.detail || data.errors?.[0]?.code || `HTTP ${res.status}`;
    throw new Error(`Square [${res.status}]: ${msg}`);
  }
  return data;
}

// ─── APPOINTMENTS ─────────────────────────────────────────────────────────────

/**
 * GET /api/sq-calendar/appointments
 * Query: start=YYYY-MM-DD&end=YYYY-MM-DD&staffId=xxx
 */
router.get('/appointments', async (req, res) => {
  try {
    const { start, end, staffId } = req.query;
    const startAt = start ? `${start}T00:00:00Z` : new Date().toISOString().slice(0, 10) + 'T00:00:00Z';
    const endAt   = end   ? `${end}T23:59:59Z`   : new Date(Date.now() + 7 * 86400000).toISOString().slice(0, 10) + 'T23:59:59Z';

    const params = new URLSearchParams({
      location_id: LOCATION_ID || '',
      start_at_min: startAt,
      start_at_max: endAt,
      limit: '100',
    });
    if (staffId) params.set('team_member_id', staffId);

    const data = await squareGet(`/v2/bookings?${params}`);
    const bookings = data.bookings || [];

    // Enrichir chaque booking avec le nom du client si possible
    const enriched = bookings.map(b => ({
      id:         b.id,
      status:     b.status,
      startAt:    b.start_at,
      duration:   b.appointment_segments?.[0]?.duration_minutes || 60,
      serviceId:  b.appointment_segments?.[0]?.service_variation_id,
      staffId:    b.appointment_segments?.[0]?.team_member_id,
      customerId: b.customer_id,
      customerNote: b.customer_note || '',
      locationId: b.location_id,
      version:    b.version,
      raw:        b,
    }));

    res.json({ appointments: enriched, count: enriched.length, start: startAt, end: endAt });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * POST /api/sq-calendar/appointments
 * Body: { serviceId, staffId, customerId, startAt, durationMinutes?, customerNote? }
 */
router.post('/appointments', async (req, res) => {
  try {
    const { serviceId, staffId, customerId, startAt, durationMinutes = 60, customerNote = '' } = req.body;
    if (!serviceId || !staffId || !startAt) {
      return res.status(400).json({ error: 'serviceId, staffId, startAt requis' });
    }

    const idempotencyKey = `daleba-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

    const body = {
      idempotency_key: idempotencyKey,
      booking: {
        location_id: LOCATION_ID,
        customer_id: customerId || undefined,
        customer_note: customerNote,
        start_at: startAt,
        appointment_segments: [{
          duration_minutes: durationMinutes,
          service_variation_id: serviceId,
          team_member_id: staffId,
          service_variation_version: 1,
        }],
      },
    };

    const data = await squarePost('/v2/bookings', body);
    res.status(201).json({ ok: true, booking: data.booking });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * POST /api/sq-calendar/appointments/:id/cancel
 */
router.post('/appointments/:id/cancel', async (req, res) => {
  try {
    const { id } = req.params;
    const { version = 1 } = req.body;
    const data = await squarePost(`/v2/bookings/${id}/cancel`, {
      idempotency_key: `cancel-${id}-${Date.now()}`,
      booking_version: version,
    });
    res.json({ ok: true, booking: data.booking });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── STAFF ────────────────────────────────────────────────────────────────────

/**
 * GET /api/sq-calendar/staff
 * Liste les membres de l'équipe Square
 */
router.get('/staff', async (req, res) => {
  try {
    // Filtrer par location
    const body = {
      query: {
        filter: {
          location_ids: LOCATION_ID ? [LOCATION_ID] : [],
          status: 'ACTIVE',
        },
      },
    };
    const data = await squarePost('/v2/team-members/search', body);
    const members = (data.team_members || []).map(m => ({
      id:         m.id,
      givenName:  m.given_name || '',
      familyName: m.family_name || '',
      name:       `${m.given_name || ''} ${m.family_name || ''}`.trim(),
      status:     m.status,
      phone:      m.phone_number,
      email:      m.email_address,
    }));
    res.json({ staff: members, count: members.length });
  } catch (err) {
    // Fallback: liste manuelle connue
    console.warn('[SQ-CALENDAR] Team members API error:', err.message, '— returning fallback list');
    res.json({
      staff: [
        { id: 'MAYA',   name: 'Maya',   givenName: 'Maya',   status: 'ACTIVE' },
        { id: 'MARIEL', name: 'Mariel', givenName: 'Mariel', status: 'ACTIVE' },
        { id: 'ULRICH', name: 'Ulrich', givenName: 'Ulrich', status: 'ACTIVE' },
      ],
      count: 3,
      fallback: true,
      error: err.message,
    });
  }
});

// ─── SERVICES ─────────────────────────────────────────────────────────────────

/**
 * GET /api/sq-calendar/services
 * Catalogue des services + prix depuis Square
 */
router.get('/services', async (req, res) => {
  try {
    const data = await squareGet(`/v2/catalog/list?types=ITEM&location_id=${LOCATION_ID || ''}`);
    const items = (data.objects || [])
      .filter(o => o.type === 'ITEM')
      .map(item => {
        const variation = item.item_data?.variations?.[0];
        const priceMoney = variation?.item_variation_data?.price_money;
        return {
          id:           variation?.id || item.id,
          catalogId:    item.id,
          name:         item.item_data?.name || 'Service',
          description:  item.item_data?.description || '',
          price:        priceMoney ? (priceMoney.amount / 100).toFixed(2) : null,
          currency:     priceMoney?.currency || 'CAD',
          durationMin:  variation?.item_variation_data?.service_duration ? Math.round(variation.item_variation_data.service_duration / 60000) : 60,
        };
      });
    res.json({ services: items, count: items.length });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── DISPONIBILITÉS ───────────────────────────────────────────────────────────

/**
 * POST /api/sq-calendar/availability
 * Body: { serviceId, staffId, date }  (date = YYYY-MM-DD)
 */
router.post('/availability', async (req, res) => {
  try {
    const { serviceId, staffId, date } = req.body;
    if (!serviceId || !date) return res.status(400).json({ error: 'serviceId et date requis' });

    const startAt = `${date}T00:00:00Z`;
    const endAt   = `${date}T23:59:59Z`;

    const body = {
      query: {
        filter: {
          location_id: LOCATION_ID,
          start_at_range: { start_at: startAt, end_at: endAt },
          segment_filters: [{
            service_variation_id: serviceId,
            team_member_id_filter: staffId ? { any: [staffId] } : undefined,
          }],
        },
      },
    };

    const data = await squarePost('/v2/availability/search', body);
    const slots = (data.availabilities || []).map(a => ({
      startAt:   a.start_at,
      locationId: a.location_id,
      staffId:   a.appointment_segments?.[0]?.team_member_id,
      serviceId: a.appointment_segments?.[0]?.service_variation_id,
    }));
    res.json({ slots, count: slots.length, date });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── CLIENTS ──────────────────────────────────────────────────────────────────

/**
 * GET /api/sq-calendar/customers/search?q=nom
 */
router.get('/customers/search', async (req, res) => {
  try {
    const { q } = req.query;
    if (!q || q.length < 2) return res.json({ customers: [] });

    const body = {
      query: {
        filter: {
          group_ids: { any: [] },
          segment_ids: { any: [] },
        },
        sort: { field: 'CREATED_AT', order: 'DESC' },
      },
      limit: 10,
    };

    // Square Customer Search par nom/prénom/email/tel
    const searchBody = {
      query: {
        filter: {
          // Square supporte text search via email_address ou phone_number
          // Pour la recherche par nom, on utilise le endpoint search avec fuzzy
        },
      },
    };

    // Essai recherche par email si q ressemble à un email
    if (q.includes('@')) {
      const data = await squarePost('/v2/customers/search', {
        query: { filter: { email_address: { exact: q } } },
        limit: 10,
      });
      const customers = (data.customers || []).map(c => ({
        id: c.id, name: `${c.given_name || ''} ${c.family_name || ''}`.trim(),
        phone: c.phone_number, email: c.email_address,
      }));
      return res.json({ customers });
    }

    // Sinon chercher par nom fuzzy (list + filter côté client)
    const data = await squarePost('/v2/customers/search', {
      query: {
        filter: {
          group_ids: { any: [] },
        },
        sort: { field: 'CREATED_AT', order: 'DESC' },
      },
      limit: 100,
    });

    const lower = q.toLowerCase();
    const customers = (data.customers || [])
      .filter(c => {
        const full = `${c.given_name || ''} ${c.family_name || ''} ${c.phone_number || ''} ${c.email_address || ''}`.toLowerCase();
        return full.includes(lower);
      })
      .slice(0, 10)
      .map(c => ({
        id: c.id,
        name: `${c.given_name || ''} ${c.family_name || ''}`.trim(),
        phone: c.phone_number || '',
        email: c.email_address || '',
      }));

    res.json({ customers, count: customers.length });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * GET /api/sq-calendar/clients-sync
 * Fusion clients Square + contacts SMS campaign (Twilio daleba_sms_ratings)
 * Retourne une liste dédupliquée par numéro de téléphone
 */
router.get('/clients-sync', async (req, res) => {
  const merged = new Map(); // clé = phone normalisé

  // ── SOURCE 1 : Square Customers ────────────────────────────────────────
  try {
    let cursor = null;
    let page = 0;
    do {
      const body = { limit: 100, ...(cursor ? { cursor } : {}) };
      const data = await squarePost('/v2/customers/list', body);
      const customers = data.customers || [];
      for (const c of customers) {
        const phone = (c.phone_number || '').replace(/\D/g, '');
        const key   = phone || c.id;
        merged.set(key, {
          source:     'square',
          squareId:   c.id,
          name:       `${c.given_name || ''} ${c.family_name || ''}`.trim() || 'Client inconnu',
          phone:      c.phone_number || '',
          email:      c.email_address || '',
          createdAt:  c.created_at || null,
          visitCount: 0,
        });
      }
      cursor = data.cursor || null;
      page++;
    } while (cursor && page < 20);
  } catch (e) { console.warn('[clients-sync] Square:', e.message); }

  // ── SOURCE 2 : Contacts SMS Campaign (daleba_sms_ratings) ──────────────
  try {
    const { pool } = require('../memory/db');
    const r = await pool.query(
      `SELECT DISTINCT ON (client_phone) client_phone, client_name, service_name, created_at
       FROM daleba_sms_ratings
       WHERE client_phone IS NOT NULL AND client_phone != ''
       ORDER BY client_phone, created_at DESC
       LIMIT 2000`
    );
    for (const row of r.rows) {
      const phone = (row.client_phone || '').replace(/\D/g, '');
      if (!phone) continue;
      if (merged.has(phone)) {
        // Enrichir le profil Square avec les données SMS
        merged.get(phone).smsSource = true;
        merged.get(phone).lastService = row.service_name || merged.get(phone).lastService;
      } else {
        merged.set(phone, {
          source:      'sms_campaign',
          squareId:    null,
          name:        row.client_name || 'Contact SMS',
          phone:       row.client_phone,
          email:       '',
          createdAt:   row.created_at,
          lastService: row.service_name || '',
          smsSource:   true,
        });
      }
    }
  } catch (e) { console.warn('[clients-sync] SMS ratings:', e.message); }

  // ── SOURCE 3 : Historique confirmations SMS ─────────────────────────────
  try {
    const { pool } = require('../memory/db');
    const r2 = await pool.query(
      `SELECT DISTINCT ON (client_phone) client_phone, client_name, appointment_datetime
       FROM daleba_sms_ratings
       WHERE client_phone IS NOT NULL
       ORDER BY client_phone, appointment_datetime DESC NULLS LAST
       LIMIT 2000`
    );
    for (const row of r2.rows) {
      const phone = (row.client_phone || '').replace(/\D/g, '');
      if (phone && !merged.has(phone)) {
        merged.set(phone, {
          source:   'sms_confirmation',
          squareId: null,
          name:     row.client_name || 'Contact',
          phone:    row.client_phone,
          email:    '',
          createdAt: row.appointment_datetime,
        });
      }
    }
  } catch (_) {}

  // ── SOURCE 4 : Contact Book (imports VCF) ───────────────────────────
  try {
    const { pool } = require('../memory/db');
    await pool.query(`
      CREATE TABLE IF NOT EXISTS daleba_contact_book (
        id SERIAL PRIMARY KEY, name VARCHAR(200), phone VARCHAR(50),
        source VARCHAR(50) DEFAULT 'vcf_import', imported_at TIMESTAMP DEFAULT NOW(),
        UNIQUE(phone)
      )
    `);
    const r3 = await pool.query(`SELECT name, phone FROM daleba_contact_book LIMIT 3000`);
    for (const row of r3.rows) {
      const phone = (row.phone || '').replace(/\D/g, '');
      if (!phone || merged.has(phone)) continue;
      merged.set(phone, {
        source:   'vcf_contact',
        squareId: null,
        name:     row.name || 'Contact',
        phone:    row.phone,
        email:    '',
        createdAt: null,
        vcfImport: true,
      });
    }
  } catch (_) {}

  const clients = Array.from(merged.values()).sort((a, b) =>
    (a.name || '').localeCompare(b.name || '', 'fr')
  );

  res.json({ clients, total: clients.length, sources: { square: 0, sms: 0 } });
});

module.exports = router;

/**
 * POST /api/sq-calendar/contact-book/import
 * Importe des contacts depuis un VCF parsé (JSON array [{name, phone}])
 */
router.post('/contact-book/import', async (req, res) => {
  const { pool } = require('../memory/db');
  const contacts = req.body.contacts || [];
  if (!contacts.length) return res.status(400).json({ error: 'Aucun contact' });

  await pool.query(`
    CREATE TABLE IF NOT EXISTS daleba_contact_book (
      id SERIAL PRIMARY KEY,
      name VARCHAR(200),
      phone VARCHAR(50),
      source VARCHAR(50) DEFAULT 'vcf_import',
      imported_at TIMESTAMP DEFAULT NOW(),
      UNIQUE(phone)
    )
  `);

  let inserted = 0, skipped = 0;
  for (const c of contacts) {
    if (!c.phone) continue;
    try {
      await pool.query(
        `INSERT INTO daleba_contact_book (name, phone, source)
         VALUES ($1, $2, 'vcf_import')
         ON CONFLICT (phone) DO UPDATE SET name = EXCLUDED.name`,
        [c.name || 'Contact', c.phone]
      );
      inserted++;
    } catch (_) { skipped++; }
  }
  res.json({ ok: true, inserted, skipped, total: contacts.length });
});

/**
 * GET /api/sq-calendar/contact-book
 * Liste tous les contacts importés
 */
router.get('/contact-book', async (req, res) => {
  const { pool } = require('../memory/db');
  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS daleba_contact_book (
        id SERIAL PRIMARY KEY, name VARCHAR(200), phone VARCHAR(50),
        source VARCHAR(50) DEFAULT 'vcf_import', imported_at TIMESTAMP DEFAULT NOW(),
        UNIQUE(phone)
      )
    `);
    const r = await pool.query(`SELECT * FROM daleba_contact_book ORDER BY name ASC`);
    res.json({ contacts: r.rows, total: r.rowCount });
  } catch (e) { res.status(500).json({ error: e.message }); }
});
