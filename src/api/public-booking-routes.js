/**
 * DALEBA — Public Booking Routes (Site Kadio Coiffure)
 *
 * GET  /api/public/services      → catalogue Square (services bookables)
 * GET  /api/public/staff         → équipe avec descriptions
 * POST /api/public/availability  → créneaux dispo (proxy Square)
 * POST /api/public/book          → créer réservation + SMS Twilio
 * GET  /api/public/booking/:id   → confirmation RDV
 */

const express = require('express');
const router = express.Router();

const SQUARE_BASE   = 'https://connect.squareup.com';
const SQUARE_TOKEN  = process.env.SQUARE_ACCESS_TOKEN;
const LOCATION_ID   = process.env.SQUARE_LOCATION_ID;
const TWILIO_SID    = process.env.TWILIO_ACCOUNT_SID;
const TWILIO_TOKEN  = process.env.TWILIO_AUTH_TOKEN;
const TWILIO_NUMBER = process.env.TWILIO_NUMBER || '+13022328291';

// ── Square helpers ──────────────────────────────────────────────────────────

function sqHeaders() {
  return {
    'Authorization': `Bearer ${SQUARE_TOKEN}`,
    'Content-Type': 'application/json',
    'Square-Version': '2024-02-22',
  };
}

async function sqGet(path) {
  const res = await fetch(`${SQUARE_BASE}${path}`, { headers: sqHeaders() });
  const data = await res.json();
  if (!res.ok) throw new Error(data.errors?.[0]?.detail || `Square ${res.status}`);
  return data;
}

async function sqPost(path, body) {
  const res = await fetch(`${SQUARE_BASE}${path}`, {
    method: 'POST',
    headers: sqHeaders(),
    body: JSON.stringify(body),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.errors?.[0]?.detail || `Square ${res.status}`);
  return data;
}

// ── Category mapping ────────────────────────────────────────────────────────

function categorize(name) {
  const n = name.toLowerCase();
  if (n.includes('lock') || n.includes('dread') || n.includes('interlock') || n.includes('microloc')) return 'Locks';
  if (n.includes('tresse') || n.includes('braid') || n.includes('knotless') || n.includes('twist')) return 'Tresses';
  if (n.includes('extension') || n.includes('tissage')) return 'Extensions';
  if (n.includes('barb') || n.includes('fade')) return 'Barbier';
  if (n.includes('color') || n.includes('soin')) return 'Soins';
  return 'Autre';
}

function cleanFrName(name) {
  return name.split('/')[0].trim();
}

// ── GET /api/public/services ────────────────────────────────────────────────

router.get('/services', async (req, res) => {
  try {
    let cursor = null;
    const allItems = [];

    // Paginate through catalog
    do {
      const qs = `types=ITEM${cursor ? `&cursor=${cursor}` : ''}`;
      const data = await sqGet(`/v2/catalog/list?${qs}`);
      allItems.push(...(data.objects || []));
      cursor = data.cursor;
    } while (cursor);

    const services = [];
    for (const item of allItems) {
      if (item.type !== 'ITEM') continue;
      const variations = item.item_data?.variations || [];
      for (const v of variations) {
        const dur = v.item_variation_data?.service_duration;
        if (!dur) continue; // Skip non-bookable (retail products)

        const price = v.item_variation_data?.price_money;
        services.push({
          id:          v.id,
          catalogId:   item.id,
          name:        item.item_data?.name || 'Service',
          displayName: cleanFrName(item.item_data?.name || 'Service'),
          description: item.item_data?.description || '',
          price:       price ? (price.amount / 100).toFixed(2) : '0.00',
          currency:    price?.currency || 'CAD',
          durationMin: Math.round(dur / 60000),
          category:    categorize(item.item_data?.name || ''),
        });
      }
    }

    // Sort: priced first, then by category
    services.sort((a, b) => {
      if (parseFloat(b.price) !== parseFloat(a.price)) return parseFloat(b.price) - parseFloat(a.price);
      return a.category.localeCompare(b.category);
    });

    res.json({ services, count: services.length });
  } catch (err) {
    console.error('[public/services]', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ── GET /api/public/staff ───────────────────────────────────────────────────

const STAFF_META = {
  'TMEhGkHirhYmHO2h': {
    role: 'Coiffeuse Afro',
    bio: 'Spécialiste cheveux afro avec un savoir-faire sénégalais authentique. Maya maîtrise toutes les techniques de coiffure afro.',
    specialties: ['Tresses', 'Coiffure afro', 'Soins'],
  },
  'TMoA3Pvr21QUskS1': {
    role: 'Spécialiste Locks & Dreads',
    bio: 'Experte reconnue en locks et dreadlocks. Raquel maîtrise toutes les techniques : interlock, microlocks, sisterlocks.',
    specialties: ['Locks', 'Dreads', 'Interlock', 'Sisterlocks'],
  },
  'TMQ9dzPRRMFbmlW9': {
    role: 'Barbier Expert',
    bio: 'Barbier expert spécialisé dans les fades et contours de précision. Résultats nets et propres à chaque visite.',
    specialties: ['Fades', 'Contours', 'Barbe', 'Coupes'],
  },
  'TMV-l2aFfTFgg3yM': {
    role: 'Manucuriste',
    bio: 'Manucuriste professionnelle certifiée. Soins des mains et des ongles avec délicatesse et précision.',
    specialties: ['Manucure', 'Nail Art', 'Soins ongles'],
  },
  'TMMe7adVJWQa7Yjd': {
    role: 'Coiffeuse',
    bio: 'Coiffeuse polyvalente avec un talent naturel pour la mise en beauté et les coiffures de protection.',
    specialties: ['Coiffure', 'Styles naturels', 'Tresses'],
  },
  'TMdS_nh6o1iy916q': {
    role: 'Coiffeur',
    bio: 'Coiffeur créatif passionné par son métier. Apporte une touche artistique à chaque coiffure.',
    specialties: ['Coiffure créative', 'Tresses', 'Styles afro'],
  },
  'TMbOuVGATiQQ_fKO': {
    role: 'Gérant & Propriétaire',
    bio: 'Fondateur et gérant de Kadio Coiffure. Créateur d\'une expérience de coiffure afro authentique et de qualité à Longueuil.',
    specialties: ['Direction', 'Coiffure', 'Conseil'],
  },
};

router.get('/staff', async (req, res) => {
  try {
    const data = await sqGet(`/v2/team-members?location_id=${LOCATION_ID}`);
    const members = (data.team_members || [])
      .filter(m => m.status === 'ACTIVE')
      .map(m => {
        const meta = STAFF_META[m.id] || {};
        const firstName = m.given_name || m.display_name?.split(' ')[0] || 'Coiffeur';
        const lastName  = m.family_name || '';
        return {
          id:          m.id,
          name:        firstName + (lastName ? ' ' + lastName : ''),
          firstName,
          lastName,
          role:        meta.role || 'Coiffeur',
          bio:         meta.bio || '',
          specialties: meta.specialties || [],
          phone:       m.phone_number || '',
          email:       m.email_address || '',
        };
      });

    res.json({ staff: members, count: members.length });
  } catch (err) {
    console.error('[public/staff]', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ── POST /api/public/availability ──────────────────────────────────────────

router.post('/availability', async (req, res) => {
  try {
    const { date, staffId, serviceId, durationMinutes } = req.body;
    if (!date) return res.status(400).json({ error: 'date requis' });

    const startAt = `${date}T00:00:00Z`;
    const endAt   = `${date}T23:59:59Z`;

    const body = {
      query: {
        filter: {
          location_id: LOCATION_ID,
          start_at_range: { start_at: startAt, end_at: endAt },
        },
      },
    };
    if (staffId) body.query.filter.team_member_id_filter = { any: [staffId] };

    // Use Square's search availability endpoint
    const sqBody = {
      query: {
        filter: {
          location_id:  LOCATION_ID,
          start_at_range: { start_at: startAt, end_at: endAt },
          segment_filters: [{
            service_variation_id: serviceId || undefined,
            team_member_id_filter: staffId ? { any: [staffId] } : undefined,
          }].filter(f => f.service_variation_id || f.team_member_id_filter),
        },
      },
    };

    let availabilities = [];
    try {
      const sqData = await sqPost('/v2/bookings/availability/search', sqBody);
      availabilities = sqData.availabilities || [];
    } catch (sqErr) {
      // Fallback: generate synthetic slots for the date
      return res.json({ slots: generateFallbackSlots(date), fallback: true });
    }

    const slots = availabilities.map(a => ({
      startAt:    a.start_at,
      label:      new Date(a.start_at).toLocaleTimeString('fr-CA', { hour: '2-digit', minute: '2-digit', timeZone: 'America/Toronto' }),
      staffIds:   (a.appointment_segments || []).map(s => s.team_member_id),
    }));

    if (!slots.length) {
      // Fallback synthetic
      return res.json({ slots: generateFallbackSlots(date), fallback: true });
    }

    res.json({ slots, count: slots.length });
  } catch (err) {
    console.error('[public/availability]', err.message);
    res.json({ slots: generateFallbackSlots(req.body?.date), fallback: true, error: err.message });
  }
});

function generateFallbackSlots(date) {
  if (!date) return [];
  const slots = [];
  const d = new Date(date + 'T12:00:00');
  const day = d.getDay(); // 0=Sun, 1=Mon
  if (day === 1) return []; // Monday closed
  const minH = day === 0 ? 10 : 9;
  const maxH = day === 0 ? 17 : 19;
  for (let h = minH; h < maxH; h++) {
    for (const m of [0, 30]) {
      const label = `${String(h).padStart(2,'0')}:${String(m).padStart(2,'0')}`;
      slots.push({ startAt: `${date}T${label}:00`, label });
    }
  }
  return slots;
}

// ── POST /api/public/book ───────────────────────────────────────────────────

router.post('/book', async (req, res) => {
  try {
    const { serviceId, staffId, startAt, durationMinutes, customer, customerNote } = req.body;

    if (!serviceId || !staffId || !startAt) {
      return res.status(400).json({ error: 'serviceId, staffId, startAt requis' });
    }
    if (!customer?.firstName || !customer?.phone) {
      return res.status(400).json({ error: 'customer.firstName et customer.phone requis' });
    }

    // 1. Find or create Square customer
    let customerId = null;
    try {
      const searchRes = await sqPost('/v2/customers/search', {
        query: { filter: { phone_number: { exact: customer.phone } } },
      });
      customerId = searchRes.customers?.[0]?.id || null;

      if (!customerId) {
        const createRes = await sqPost('/v2/customers', {
          given_name:   customer.firstName,
          family_name:  customer.lastName || '',
          phone_number: customer.phone,
          email_address: customer.email || undefined,
        });
        customerId = createRes.customer?.id;
      }
    } catch (cErr) {
      console.warn('[public/book] Customer lookup failed:', cErr.message);
    }

    // 2. Create Square booking
    const bookingBody = {
      idempotency_key: `kc-${Date.now()}-${Math.random().toString(36).slice(2,8)}`,
      booking: {
        start_at:    startAt,
        location_id: LOCATION_ID,
        appointment_segments: [{
          duration_minutes:      durationMinutes || 60,
          service_variation_id:  serviceId,
          team_member_id:        staffId,
          service_variation_version: 1,
        }],
        customer_id:   customerId || undefined,
        customer_note: customerNote || undefined,
      },
    };

    const bookData = await sqPost('/v2/bookings', bookingBody);
    const booking  = bookData.booking;

    // 3. Send SMS via Twilio
    if (TWILIO_SID && TWILIO_TOKEN && customer.phone) {
      try {
        const dt = new Date(startAt);
        const dateLabel = dt.toLocaleDateString('fr-CA', { weekday:'long', year:'numeric', month:'long', day:'numeric', timeZone:'America/Toronto' });
        const timeLabel = dt.toLocaleTimeString('fr-CA', { hour:'2-digit', minute:'2-digit', timeZone:'America/Toronto' });

        const staffMeta = STAFF_META[staffId] || {};
        const staffName = req.body.staffName || staffMeta.role || 'votre coiffeur';
        const serviceName = req.body.serviceName || 'votre service';

        const smsBody = [
          `Bonjour ${customer.firstName} !`,
          `Votre RDV chez Kadio Coiffure est confirmé :`,
          `📅 ${dateLabel} à ${timeLabel}`,
          `✂️ ${serviceName}`,
          `👤 Avec ${staffName}`,
          `📍 615 Antoinette-Robidoux, local 100, Longueuil`,
          `Pour annuler : 514-919-5970`,
        ].join('\n');

        const twilioUrl = `https://api.twilio.com/2010-04-01/Accounts/${TWILIO_SID}/Messages.json`;
        const formData  = new URLSearchParams({
          From: TWILIO_NUMBER,
          To:   customer.phone,
          Body: smsBody,
        });

        const twilioRes = await fetch(twilioUrl, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/x-www-form-urlencoded',
            'Authorization': 'Basic ' + Buffer.from(`${TWILIO_SID}:${TWILIO_TOKEN}`).toString('base64'),
          },
          body: formData.toString(),
        });
        const twilioData = await twilioRes.json();
        if (!twilioRes.ok) console.warn('[SMS] Twilio error:', twilioData.message);
        else console.log('[SMS] Sent to', customer.phone, '— SID:', twilioData.sid);
      } catch (smsErr) {
        console.warn('[SMS] Failed:', smsErr.message);
      }
    }

    res.json({
      success:   true,
      bookingId: booking.id,
      status:    booking.status,
      startAt:   booking.start_at,
    });
  } catch (err) {
    console.error('[public/book]', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ── GET /api/public/booking/:id ─────────────────────────────────────────────

router.get('/booking/:id', async (req, res) => {
  try {
    const data = await sqGet(`/v2/bookings/${req.params.id}`);
    const b = data.booking;
    if (!b) return res.status(404).json({ error: 'Réservation introuvable' });

    res.json({
      id:          b.id,
      status:      b.status,
      startAt:     b.start_at,
      serviceId:   b.appointment_segments?.[0]?.service_variation_id,
      staffId:     b.appointment_segments?.[0]?.team_member_id,
      duration:    b.appointment_segments?.[0]?.duration_minutes,
      customerId:  b.customer_id,
      customerNote: b.customer_note || '',
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
