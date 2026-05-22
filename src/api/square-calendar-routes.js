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

module.exports = router;
