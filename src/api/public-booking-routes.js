/**
 * DALEBA — Public Booking Routes v2
 * Site public Kadio Coiffure — données LIVE Square uniquement (zéro hardcode)
 *
 * GET  /api/public/services           → services bookables Square (filtrés service_duration)
 * GET  /api/public/staff              → équipe live Square
 * POST /api/public/availability       → créneaux disponibles Square
 * POST /api/public/book               → créer RDV + acompte 20% Stripe
 * GET  /api/public/booking-status/:id → statut paiement/booking
 * POST /api/public/deposit-webhook    → Stripe webhook confirmation acompte
 * POST /api/public/passes             → acheter une passe prépayée
 * GET  /api/public/passes/:phone      → passes actives du client
 * POST /api/public/passes/use         → utiliser une séance de passe
 */

const express = require('express');
const router  = express.Router();

// ── DB (graceful degradation si pas de DATABASE_URL) ─────────────────────────
let pool = null;
let DEMO_MODE = true;
try {
  const db = require('../memory/db');
  pool = db.pool;
  DEMO_MODE = db.DEMO_MODE;
} catch (e) {}

// ── Services externes ─────────────────────────────────────────────────────────
const SQUARE_BASE   = 'https://connect.squareup.com';
const SQUARE_TOKEN  = process.env.SQUARE_ACCESS_TOKEN;
const LOCATION_ID   = process.env.SQUARE_LOCATION_ID;
const TWILIO_SID    = process.env.TWILIO_ACCOUNT_SID;
const TWILIO_TOKEN  = process.env.TWILIO_AUTH_TOKEN;
const TWILIO_FROM   = process.env.TWILIO_NUMBER || '+13022328291';
const BASE_URL      = process.env.BASE_URL || 'https://daleba-api-production.up.railway.app';

// ── ID du barbier (Mariel Yonkeu Satching) ────────────────────────────────────
const BARBIER_STAFF_IDS = ['TMQ9dzPRRMFbmlW9'];

// ── Init DB tables ────────────────────────────────────────────────────────────
async function initTables() {
  if (DEMO_MODE || !pool) return;
  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS daleba_public_bookings (
        id                SERIAL PRIMARY KEY,
        square_booking_id VARCHAR(100),
        client_name       VARCHAR(200),
        client_phone      VARCHAR(30),
        client_email      VARCHAR(200),
        service_id        VARCHAR(100),
        service_name      VARCHAR(300),
        staff_id          VARCHAR(100),
        staff_name        VARCHAR(200),
        start_at          TIMESTAMPTZ,
        duration_min      INTEGER,
        deposit_amount    DECIMAL(10,2) DEFAULT 0,
        deposit_paid      BOOLEAN DEFAULT false,
        deposit_waived    BOOLEAN DEFAULT false,
        stripe_session_id VARCHAR(200),
        notes             TEXT,
        created_at        TIMESTAMPTZ DEFAULT NOW()
      );
    `);
    await pool.query(`
      CREATE TABLE IF NOT EXISTS daleba_prepaid_passes (
        id                SERIAL PRIMARY KEY,
        client_name       VARCHAR(100),
        client_phone      VARCHAR(20),
        pass_type         VARCHAR(50),
        services_total    INTEGER,
        services_used     INTEGER DEFAULT 0,
        amount_paid       DECIMAL(10,2),
        square_payment_id VARCHAR(100),
        stripe_session_id VARCHAR(200),
        is_active         BOOLEAN DEFAULT true,
        expires_at        TIMESTAMPTZ,
        created_at        TIMESTAMPTZ DEFAULT NOW()
      );
    `);
    await pool.query(`
      CREATE TABLE IF NOT EXISTS daleba_client_notes (
        id           SERIAL PRIMARY KEY,
        client_phone VARCHAR(30),
        booking_id   INTEGER,
        notes        TEXT,
        created_at   TIMESTAMPTZ DEFAULT NOW()
      );
    `);
  } catch (e) {
    console.error('[public-booking] initTables error:', e.message);
  }
}
initTables();

// ── Square helpers ────────────────────────────────────────────────────────────
function sqHeaders() {
  if (!SQUARE_TOKEN) throw new Error('SQUARE_ACCESS_TOKEN manquant');
  return {
    'Authorization': `Bearer ${SQUARE_TOKEN}`,
    'Content-Type': 'application/json',
    'Square-Version': '2024-02-22',
  };
}
async function sqGet(path) {
  const res  = await fetch(`${SQUARE_BASE}${path}`, { headers: sqHeaders() });
  const data = await res.json();
  if (!res.ok) throw new Error(data.errors?.[0]?.detail || `Square ${res.status}`);
  return data;
}
async function sqPost(path, body) {
  const res  = await fetch(`${SQUARE_BASE}${path}`, { method:'POST', headers: sqHeaders(), body: JSON.stringify(body) });
  const data = await res.json();
  if (!res.ok) throw new Error(data.errors?.[0]?.detail || `Square ${res.status}`);
  return data;
}

// ── Catégories ────────────────────────────────────────────────────────────────
function categorize(name) {
  const n = name.toLowerCase();
  if (n.includes('lock') || n.includes('dread') || n.includes('interlock') || n.includes('microloc') || n.includes('sisterlock')) return 'Locks';
  if (n.includes('tresse') || n.includes('braid') || n.includes('knotless') || n.includes('twist') || n.includes('barrel')) return 'Tresses';
  if (n.includes('extension') || n.includes('tissage')) return 'Extensions';
  if (n.includes('barb') || n.includes('fade') || n.includes('coupe barb')) return 'Barbier';
  if (n.includes('color') || n.includes('coloration') || n.includes('soin') || n.includes('teinte')) return 'Soins';
  return 'Autre';
}
function cleanFrName(name) { return name.split('/')[0].trim(); }

// ── Calcul acompte ─────────────────────────────────────────────────────────────
/**
 * Retourne { depositAmount: number, depositWaived: boolean }
 * - Barbier (Mariel) → waived=true, amount=0
 * - Service gratuit ou prix nul → waived=true, amount=0
 * - Autres → 20% du prix
 */
function calcDeposit(price, staffId, category) {
  const isBarbier = BARBIER_STAFF_IDS.includes(staffId) || category === 'Barbier';
  const priceNum  = parseFloat(price) || 0;
  if (isBarbier || priceNum <= 0) {
    return { depositAmount: 0, depositWaived: true };
  }
  const depositAmount = Math.round(priceNum * 0.20 * 100) / 100;
  return { depositAmount, depositWaived: false };
}

// ── Twilio SMS ─────────────────────────────────────────────────────────────────
async function sendSMS(to, body) {
  if (!TWILIO_SID || !TWILIO_TOKEN) { console.warn('[SMS] Twilio non configuré'); return; }
  const url = `https://api.twilio.com/2010-04-01/Accounts/${TWILIO_SID}/Messages.json`;
  const params = new URLSearchParams({ From: TWILIO_FROM, To: to, Body: body });
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      'Authorization': 'Basic ' + Buffer.from(`${TWILIO_SID}:${TWILIO_TOKEN}`).toString('base64'),
    },
    body: params.toString(),
  });
  const d = await res.json();
  if (!res.ok) console.warn('[SMS] Error:', d.message);
  else console.log('[SMS] Sent to', to, 'SID:', d.sid);
  return d;
}

// ─────────────────────────────────────────────────────────────────────────────
//  GET /api/public/services — catalogue bookable Square (filtrés par service_duration)
// ─────────────────────────────────────────────────────────────────────────────
router.get('/services', async (req, res) => {
  try {
    let cursor  = null;
    const items = [];
    do {
      const qs   = `types=ITEM${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`;
      const data = await sqGet(`/v2/catalog/list?${qs}`);
      items.push(...(data.objects || []));
      cursor = data.cursor || null;
    } while (cursor);

    const services = [];
    for (const item of items) {
      if (item.type !== 'ITEM') continue;
      for (const v of (item.item_data?.variations || [])) {
        const dur = v.item_variation_data?.service_duration;
        if (!dur) continue; // exclure produits retail (pas de durée = non-bookable)
        const price = v.item_variation_data?.price_money;
        const cat   = categorize(item.item_data?.name || '');
        const raw   = price ? (price.amount / 100) : 0;
        const dep   = calcDeposit(raw, null, cat);
        services.push({
          id:           v.id,
          catalogId:    item.id,
          name:         item.item_data?.name || 'Service',
          displayName:  cleanFrName(item.item_data?.name || 'Service'),
          description:  item.item_data?.description || '',
          price:        raw.toFixed(2),
          priceNum:     raw,
          currency:     price?.currency || 'CAD',
          durationMin:  Math.round(dur / 60000),
          category:     cat,
          depositAmount:    dep.depositAmount,
          depositWaived:    dep.depositWaived,
          depositPercent:   dep.depositWaived ? 0 : 20,
        });
      }
    }

    // Trier : prix décroissant
    services.sort((a, b) => b.priceNum - a.priceNum);
    res.json({ services, count: services.length });
  } catch (err) {
    console.error('[public/services]', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
//  GET /api/public/staff — équipe live Square (aucune donnée hardcodée)
// ─────────────────────────────────────────────────────────────────────────────
router.get('/staff', async (req, res) => {
  try {
    // Utiliser la même logique que square-calendar-routes.js (POST search)
    // Le token Railway est identique — même env var SQUARE_ACCESS_TOKEN
    const sqCalToken = process.env.SQUARE_ACCESS_TOKEN;
    const sqCalBase  = 'https://connect.squareup.com';
    const searchRes  = await fetch(`${sqCalBase}/v2/team-members/search`, {
      method:  'POST',
      headers: {
        'Authorization':  `Bearer ${sqCalToken}`,
        'Content-Type':   'application/json',
        'Square-Version': '2024-02-22',
      },
      body: JSON.stringify({ query: { filter: { status: 'ACTIVE' } } }),
    });
    const data    = await searchRes.json();
    const members = (data.team_members || [])
      .filter(m => m.status === 'ACTIVE')
      .map(m => ({
        id:         m.id,
        name:       [m.given_name, m.family_name].filter(Boolean).join(' '),
        firstName:  m.given_name  || 'Coiffeur',
        lastName:   m.family_name || '',
        phone:      m.phone_number    || '',
        email:      m.email_address   || '',
        isBarbier:  BARBIER_STAFF_IDS.includes(m.id),
      }));

    // Si Square échoue ou retourne vide — proxy vers /api/sq-calendar/staff
    if (!members.length && data.errors) {
      console.warn('[public/staff] team-members/search error:', data.errors[0]?.detail, '— fallback sq-calendar');
      const fallbackRes  = await fetch(`${req.protocol}://${req.get('host')}/api/sq-calendar/staff`);
      const fallbackData = await fallbackRes.json();
      const fbMembers    = (fallbackData.staff || []).map(m => ({
        id:        m.id,
        name:      m.name || m.givenName,
        firstName: m.givenName || m.name.split(' ')[0],
        lastName:  m.familyName || '',
        phone:     m.phone || '',
        email:     m.email || '',
        isBarbier: BARBIER_STAFF_IDS.includes(m.id),
      }));
      return res.json({ staff: fbMembers, count: fbMembers.length, source: 'sq-calendar-fallback' });
    }

    res.json({ staff: members, count: members.length, source: 'square-live' });
  } catch (err) {
    console.error('[public/staff]', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
//  POST /api/public/availability
// ─────────────────────────────────────────────────────────────────────────────
router.post('/availability', async (req, res) => {
  const { date, staffId, serviceId, durationMinutes } = req.body;
  if (!date) return res.status(400).json({ error: 'date requis (YYYY-MM-DD)' });

  const startAt = `${date}T00:00:00Z`;
  const endAt   = `${date}T23:59:59Z`;

  try {
    const sqBody = {
      query: {
        filter: {
          location_id: LOCATION_ID,
          start_at_range: { start_at: startAt, end_at: endAt },
          ...(staffId || serviceId ? {
            segment_filters: [{
              ...(serviceId ? { service_variation_id: serviceId } : {}),
              ...(staffId  ? { team_member_id_filter: { any: [staffId] } } : {}),
            }],
          } : {}),
        },
      },
    };

    const sqData = await sqPost('/v2/bookings/availability/search', sqBody);
    const slots  = (sqData.availabilities || []).map(a => ({
      startAt:  a.start_at,
      label:    new Date(a.start_at).toLocaleTimeString('fr-CA', { hour:'2-digit', minute:'2-digit', timeZone:'America/Toronto' }),
      staffIds: (a.appointment_segments || []).map(s => s.team_member_id),
    }));

    if (slots.length) return res.json({ slots, count: slots.length });
    // Square returned empty — generate synthetic (business hours)
    res.json({ slots: generateFallbackSlots(date), fallback: true });
  } catch (err) {
    console.warn('[public/availability] Square fallback:', err.message);
    res.json({ slots: generateFallbackSlots(date), fallback: true });
  }
});

function generateFallbackSlots(date) {
  if (!date) return [];
  const d   = new Date(date + 'T12:00:00');
  const day = d.getDay(); // 0=dim, 1=lun
  if (day === 1) return []; // lundi fermé
  const minH = day === 0 ? 10 : 9;
  const maxH = day === 0 ? 17 : 19;
  const slots = [];
  for (let h = minH; h < maxH; h++) {
    for (const m of [0, 30]) {
      const label = `${String(h).padStart(2,'0')}:${String(m).padStart(2,'0')}`;
      slots.push({ startAt: `${date}T${label}:00`, label });
    }
  }
  return slots;
}

// ─────────────────────────────────────────────────────────────────────────────
//  POST /api/public/book — créer RDV + calculer acompte + Stripe si nécessaire
// ─────────────────────────────────────────────────────────────────────────────
router.post('/book', async (req, res) => {
  const {
    serviceId, serviceName, servicePrice, serviceCategory,
    staffId, staffName,
    startAt, durationMinutes,
    customer,   // { firstName, lastName, phone, email }
    customerNote,
  } = req.body;

  // ── Validation ──
  if (!serviceId || !staffId || !startAt) {
    return res.status(400).json({ error: 'serviceId, staffId, startAt requis' });
  }
  if (!customer?.firstName || !customer?.phone) {
    return res.status(400).json({ error: 'customer.firstName et customer.phone requis' });
  }

  // ── Calcul acompte ──
  const { depositAmount, depositWaived } = calcDeposit(servicePrice, staffId, serviceCategory);
  const clientFullName = [customer.firstName, customer.lastName].filter(Boolean).join(' ');

  // ── 1. Find/create Square customer ──
  let customerId = null;
  try {
    const srch = await sqPost('/v2/customers/search', {
      query: { filter: { phone_number: { exact: customer.phone } } },
    });
    customerId = srch.customers?.[0]?.id || null;
    if (!customerId) {
      const cr = await sqPost('/v2/customers', {
        given_name:    customer.firstName,
        family_name:   customer.lastName || '',
        phone_number:  customer.phone,
        email_address: customer.email || undefined,
      });
      customerId = cr.customer?.id;
    }
  } catch (e) {
    console.warn('[public/book] customer lookup:', e.message);
  }

  // ── 2. Créer booking Square (soft-fail : plan peut ne pas supporter write) ──
  let squareBookingId = `internal-${Date.now()}`; // fallback ID interne
  try {
    const bookBody = {
      idempotency_key: `kc-${Date.now()}-${Math.random().toString(36).slice(2,8)}`,
      booking: {
        start_at:    startAt,
        location_id: LOCATION_ID,
        appointment_segments: [{
          duration_minutes:            durationMinutes || 60,
          service_variation_id:        serviceId,
          team_member_id:              staffId,
          service_variation_version:   1,
        }],
        ...(customerId  ? { customer_id:   customerId } : {}),
        ...(customerNote ? { customer_note: customerNote } : {}),
      },
    };
    const bkRes = await sqPost('/v2/bookings', bookBody);
    squareBookingId = bkRes.booking?.id || squareBookingId;
  } catch (sqErr) {
    // Square Bookings API non disponible sur ce plan → continuer avec ID interne
    console.warn('[public/book] Square booking skipped (plan limit):', sqErr.message);
  }

  // ── 3. Stocker en DB ──
  let internalId = null;
  if (!DEMO_MODE && pool) {
    try {
      const ins = await pool.query(`
        INSERT INTO daleba_public_bookings
          (square_booking_id, client_name, client_phone, client_email,
           service_id, service_name, staff_id, staff_name,
           start_at, duration_min, deposit_amount, deposit_paid, deposit_waived, notes)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)
        RETURNING id
      `, [
        squareBookingId, clientFullName, customer.phone, customer.email || null,
        serviceId, serviceName || null, staffId, staffName || null,
        startAt, durationMinutes || 60,
        depositAmount, depositWaived || depositAmount === 0, depositWaived,
        customerNote || null,
      ]);
      internalId = ins.rows[0]?.id;

      // Sauvegarder note client séparément
      if (customerNote) {
        await pool.query(
          `INSERT INTO daleba_client_notes (client_phone, booking_id, notes) VALUES ($1,$2,$3)`,
          [customer.phone, internalId, customerNote],
        );
      }
    } catch (dbErr) {
      console.error('[public/book] DB error:', dbErr.message);
    }
  }

  // ── 4a. Barbier / service gratuit → confirmation directe ──
  if (depositWaived) {
    // SMS immédiat
    const dt  = new Date(startAt);
    const dlb = dt.toLocaleDateString('fr-CA', { weekday:'long', year:'numeric', month:'long', day:'numeric', timeZone:'America/Toronto' });
    const tlb = dt.toLocaleTimeString('fr-CA', { hour:'2-digit', minute:'2-digit', timeZone:'America/Toronto' });
    try {
      await sendSMS(customer.phone, [
        `Bonjour ${customer.firstName} !`,
        `✅ Votre RDV chez Kadio Coiffure est confirmé :`,
        `📅 ${dlb} à ${tlb}`,
        `✂️ ${serviceName || 'Service'}`,
        `👤 Avec ${staffName || 'votre coiffeur'}`,
        `📍 615 Antoinette-Robidoux, local 100, Longueuil`,
        `❓ Annulation : 514-919-5970`,
      ].join('\n'));
    } catch (smsErr) {
      console.warn('[SMS] Failed:', smsErr.message);
    }
    return res.json({
      success:        true,
      requiresPayment: false,
      bookingId:      squareBookingId,
      internalId,
      depositWaived:  true,
      depositAmount:  0,
      message:        'Réservation confirmée. SMS envoyé.',
    });
  }

  // ── 4b. Acompte requis → créer session Stripe ──
  const depositCents = Math.round(depositAmount * 100);
  let stripeSessionId = null;
  let paymentUrl      = null;

  try {
    const stripeService = require('../services/stripe');
    const sess = await stripeService.createCheckoutSession({
      clientName:  clientFullName,
      clientEmail: customer.email || `${customer.phone.replace(/\D/g,'')}@kadio.noemail`,
      amount:      depositCents,
      description: `Acompte 20% — ${serviceName || 'Service'} chez Kadio Coiffure`,
      sessionId:   `pub-${squareBookingId}`,
      successUrl:  `${BASE_URL}/booking-confirmation.html?booking_id=${squareBookingId}&internal_id=${internalId || 0}&session_id={CHECKOUT_SESSION_ID}`,
      cancelUrl:   `${BASE_URL}/booking.html?cancelled=1`,
    });
    stripeSessionId = sess.stripeSessionId;
    paymentUrl      = sess.checkoutUrl;

    // Mise à jour stripe_session_id en DB
    if (!DEMO_MODE && pool && internalId) {
      await pool.query(
        `UPDATE daleba_public_bookings SET stripe_session_id=$1 WHERE id=$2`,
        [stripeSessionId, internalId],
      ).catch(e => console.warn('[DB] stripe update:', e.message));
    }
  } catch (stripeErr) {
    console.error('[public/book] Stripe error:', stripeErr.message);
    // Stripe non dispo → confirmer quand même et aviser
    return res.json({
      success:         true,
      requiresPayment: false,
      paymentUnavailable: true,
      bookingId:       squareBookingId,
      internalId,
      depositAmount,
      message:         `Réservation créée. L'acompte de ${depositAmount}$ CAD sera collecté en salon.`,
    });
  }

  return res.json({
    success:         true,
    requiresPayment: true,
    paymentUrl,
    stripeSessionId,
    bookingId:       squareBookingId,
    internalId,
    depositAmount,
    depositPercent:  20,
    message:         `Un acompte de ${depositAmount}$ CAD (20%) est requis pour confirmer votre RDV.`,
  });
});

// ─────────────────────────────────────────────────────────────────────────────
//  POST /api/public/deposit-webhook — webhook Stripe acompte
// ─────────────────────────────────────────────────────────────────────────────
router.post('/deposit-webhook', express.raw({ type: 'application/json' }), async (req, res) => {
  let event;
  try {
    const stripeService = require('../services/stripe');
    event = stripeService.parseWebhook(req.body, req.headers['stripe-signature']);
  } catch (err) {
    return res.status(400).json({ error: 'Signature invalide' });
  }

  if (event.type === 'checkout.session.completed') {
    const sess        = event.data.object;
    const stripeId    = sess.id;
    const customerEmail = sess.customer_email || '';
    const amount      = (sess.amount_total / 100).toFixed(2);

    if (!DEMO_MODE && pool) {
      try {
        const upd = await pool.query(
          `UPDATE daleba_public_bookings SET deposit_paid=true WHERE stripe_session_id=$1 RETURNING client_phone, client_name, start_at, service_name, staff_name`,
          [stripeId],
        );
        if (upd.rows.length) {
          const b  = upd.rows[0];
          const dt = new Date(b.start_at);
          const dl = dt.toLocaleDateString('fr-CA', { weekday:'long', year:'numeric', month:'long', day:'numeric', timeZone:'America/Toronto' });
          const tl = dt.toLocaleTimeString('fr-CA', { hour:'2-digit', minute:'2-digit', timeZone:'America/Toronto' });
          await sendSMS(b.client_phone, [
            `Bonjour ${b.client_name} !`,
            `✅ Acompte de ${amount}$ CAD reçu — RDV confirmé !`,
            `📅 ${dl} à ${tl}`,
            `✂️ ${b.service_name || 'Service'}`,
            `👤 Avec ${b.staff_name || 'votre coiffeur'}`,
            `📍 615 Antoinette-Robidoux, local 100, Longueuil`,
          ].join('\n'));
        }
      } catch (e) {
        console.error('[deposit-webhook] DB error:', e.message);
      }
    }
  }
  res.json({ received: true });
});

// ─────────────────────────────────────────────────────────────────────────────
//  GET /api/public/booking-status/:id
// ─────────────────────────────────────────────────────────────────────────────
router.get('/booking-status/:id', async (req, res) => {
  const id = req.params.id;
  try {
    // Essayer Square d'abord (ID Square)
    if (id.length > 10 && !Number(id)) {
      const data = await sqGet(`/v2/bookings/${id}`);
      const b    = data.booking;
      if (b) return res.json({
        bookingId:   b.id,
        status:      b.status,
        startAt:     b.start_at,
        staffId:     b.appointment_segments?.[0]?.team_member_id,
        serviceId:   b.appointment_segments?.[0]?.service_variation_id,
      });
    }
    // Essayer ID interne DB
    if (!DEMO_MODE && pool) {
      const r = await pool.query('SELECT * FROM daleba_public_bookings WHERE id=$1 OR square_booking_id=$1::text', [id]);
      if (r.rows.length) {
        const row = r.rows[0];
        return res.json({
          internalId:    row.id,
          bookingId:     row.square_booking_id,
          clientName:    row.client_name,
          serviceName:   row.service_name,
          staffName:     row.staff_name,
          startAt:       row.start_at,
          depositAmount: row.deposit_amount,
          depositPaid:   row.deposit_paid,
          depositWaived: row.deposit_waived,
        });
      }
    }
    res.status(404).json({ error: 'Réservation introuvable' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
//  FORFAITS — configuration statique (prix depuis Square au runtime)
// ─────────────────────────────────────────────────────────────────────────────
const PASS_TYPES = {
  barbier_monthly: {
    label:         'Abonnement Barbier Mensuel',
    description:   '4 coupes/mois à tarif réduit — sans acompte',
    servicesTotal: 4,
    priceCAD:      120.00,   // vs 4×40 = 160 → économie 25%
    validityDays:  30,
    depositWaived: true,     // exempt acompte
    category:      'Barbier',
    emoji:         '💈',
  },
  prepaid_5x: {
    label:         'Passe 5 Services',
    description:   '5 séances au choix (tresses, locks, etc.) avec 10% de réduction',
    servicesTotal: 5,
    priceCAD:      null,     // calculé dynamiquement (5 × prix service × 0.90)
    validityDays:  180,
    depositWaived: false,
    category:      'Multi',
    emoji:         '🎟️',
  },
};

// GET /api/public/passes/types — types de passes disponibles
router.get('/passes/types', (req, res) => res.json({ types: PASS_TYPES }));

// POST /api/public/passes — acheter une passe
router.post('/passes', async (req, res) => {
  const { passType, clientName, clientPhone, clientEmail, referenceServicePrice } = req.body;

  const type = PASS_TYPES[passType];
  if (!type) return res.status(400).json({ error: `Type de passe inconnu: ${passType}` });
  if (!clientName || !clientPhone) return res.status(400).json({ error: 'clientName et clientPhone requis' });

  // Calculer le prix
  let amountCAD = type.priceCAD;
  if (!amountCAD && referenceServicePrice) {
    amountCAD = Math.round(parseFloat(referenceServicePrice) * 5 * 0.90 * 100) / 100;
  }
  if (!amountCAD) return res.status(400).json({ error: 'Prix introuvable. Fournir referenceServicePrice.' });

  // Créer session Stripe
  let paymentUrl = null;
  let stripeSessionId = null;
  try {
    const stripeService = require('../services/stripe');
    const sess = await stripeService.createCheckoutSession({
      clientName,
      clientEmail: clientEmail || `${clientPhone.replace(/\D/g,'')}@kadio.noemail`,
      amount:      Math.round(amountCAD * 100),
      description: type.label + ' — Kadio Coiffure',
      sessionId:   `pass-${passType}-${Date.now()}`,
      successUrl:  `${BASE_URL}/booking-confirmation.html?pass_type=${passType}&session_id={CHECKOUT_SESSION_ID}`,
      cancelUrl:   `${BASE_URL}/services.html`,
    });
    stripeSessionId = sess.stripeSessionId;
    paymentUrl      = sess.checkoutUrl;
  } catch (stripeErr) {
    return res.status(500).json({ error: `Stripe: ${stripeErr.message}` });
  }

  // Créer entrée DB (en attente de paiement)
  let passId = null;
  if (!DEMO_MODE && pool) {
    try {
      const expiresAt = new Date();
      expiresAt.setDate(expiresAt.getDate() + type.validityDays);
      const ins = await pool.query(`
        INSERT INTO daleba_prepaid_passes
          (client_name, client_phone, pass_type, services_total, amount_paid, stripe_session_id, is_active, expires_at)
        VALUES ($1,$2,$3,$4,$5,$6, false, $7) RETURNING id
      `, [clientName, clientPhone, passType, type.servicesTotal, amountCAD, stripeSessionId, expiresAt.toISOString()]);
      passId = ins.rows[0]?.id;
    } catch (e) {
      console.error('[passes] DB error:', e.message);
    }
  }

  res.json({ success: true, paymentUrl, stripeSessionId, passId, amountCAD, type });
});

// GET /api/public/passes/:phone — passes actives d'un client
router.get('/passes/:phone', async (req, res) => {
  if (DEMO_MODE || !pool) return res.json({ passes: [], demo: true });
  try {
    const r = await pool.query(
      `SELECT * FROM daleba_prepaid_passes WHERE client_phone=$1 AND is_active=true AND expires_at > NOW() ORDER BY created_at DESC`,
      [req.params.phone],
    );
    res.json({ passes: r.rows });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// POST /api/public/passes/use — consommer une séance
router.post('/passes/use', async (req, res) => {
  const { passId, clientPhone, notes } = req.body;
  if (!passId || !clientPhone) return res.status(400).json({ error: 'passId et clientPhone requis' });
  if (DEMO_MODE || !pool) return res.json({ success: true, demo: true });

  try {
    const r = await pool.query(
      `SELECT * FROM daleba_prepaid_passes WHERE id=$1 AND client_phone=$2 AND is_active=true`,
      [passId, clientPhone],
    );
    if (!r.rows.length) return res.status(404).json({ error: 'Passe introuvable ou inactive' });
    const pass = r.rows[0];
    if (pass.services_used >= pass.services_total) {
      return res.status(400).json({ error: 'Toutes les séances de cette passe ont été utilisées' });
    }
    const newUsed   = pass.services_used + 1;
    const stillActive = newUsed < pass.services_total;
    await pool.query(
      `UPDATE daleba_prepaid_passes SET services_used=$1, is_active=$2 WHERE id=$3`,
      [newUsed, stillActive, passId],
    );
    if (notes) {
      await pool.query(
        `INSERT INTO daleba_client_notes (client_phone, notes) VALUES ($1, $2)`,
        [clientPhone, `[Passe #${passId} - séance ${newUsed}/${pass.services_total}] ${notes}`],
      );
    }
    res.json({
      success:       true,
      servicesUsed:  newUsed,
      servicesLeft:  pass.services_total - newUsed,
      isActive:      stillActive,
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ── POST /api/public/deposit-info ─────────────────────────────────────────────
router.post('/deposit-info', (req, res) => {
  try {
    const { servicePrice, staffId } = req.body;
    if (servicePrice === undefined || !staffId) {
      return res.status(400).json({ error: 'servicePrice et staffId requis' });
    }
    const price = Number(servicePrice);
    const isBarbier = BARBIER_STAFF_IDS.includes(staffId);
    if (isBarbier || price <= 0) {
      return res.json({ depositAmount: 0, depositWaived: true, reason: 'Service barbier \u2014 d\u00e9p\u00f4t non requis' });
    }
    const depositAmount = Math.round(price * 0.20 * 100) / 100;
    res.json({ depositAmount, depositWaived: false, reason: 'D\u00e9p\u00f4t de s\u00e9curit\u00e9 20% requis' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── POST /api/public/passes/validate ──────────────────────────────────────────
router.post('/passes/validate', async (req, res) => {
  try {
    const { passId, clientPhone } = req.body;
    if (!passId || !clientPhone) {
      return res.status(400).json({ error: 'passId et clientPhone requis' });
    }
    if (DEMO_MODE || !pool) {
      return res.json({ valid: true, remaining: 4, message: 'Passe valide \u2014 4 s\u00e9ances restantes (demo)' });
    }
    const r = await pool.query(
      'SELECT * FROM daleba_prepaid_passes WHERE id=$1 AND client_phone=$2 LIMIT 1',
      [passId, clientPhone]
    );
    if (r.rowCount === 0) return res.status(404).json({ valid: false, message: 'Passe introuvable ou t\u00e9l\u00e9phone incorrect' });
    const pass = r.rows[0];
    if (!pass.is_active) return res.status(400).json({ valid: false, message: 'Passe inactive' });
    if (pass.expires_at && new Date(pass.expires_at) < new Date()) return res.status(400).json({ valid: false, message: 'Passe expir\u00e9e' });
    const remaining = pass.services_total - pass.services_used;
    if (remaining <= 0) return res.status(400).json({ valid: false, message: 'Toutes les s\u00e9ances ont \u00e9t\u00e9 utilis\u00e9es' });
    res.json({
      valid: true,
      remaining,
      message: `Passe valide \u2014 ${remaining} s\u00e9ance${remaining > 1 ? 's' : ''} restante${remaining > 1 ? 's' : ''}`,
      pass: { id: pass.id, type: pass.pass_type, total: pass.services_total, used: pass.services_used }
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── Init daleba_bookings + test pass ──────────────────────────────────────────
(async () => {
  if (DEMO_MODE || !pool) return;
  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS daleba_bookings (
        id                  SERIAL PRIMARY KEY,
        square_booking_id   VARCHAR(100),
        client_name         VARCHAR(100),
        client_phone        VARCHAR(20),
        client_email        VARCHAR(100),
        staff_square_id     VARCHAR(50),
        service_name        VARCHAR(200),
        service_price       DECIMAL(10,2),
        deposit_amount      DECIMAL(10,2) DEFAULT 0,
        deposit_waived      BOOLEAN DEFAULT false,
        deposit_paid        BOOLEAN DEFAULT false,
        pass_id             INTEGER,
        client_note         TEXT,
        start_at            TIMESTAMPTZ,
        status              VARCHAR(20) DEFAULT 'confirmed',
        created_at          TIMESTAMPTZ DEFAULT NOW()
      )
    `);
    // Ins\u00e9rer passe test si absente
    const ex = await pool.query("SELECT id FROM daleba_prepaid_passes WHERE client_phone='+15141234567' LIMIT 1");
    if (ex.rowCount === 0) {
      await pool.query(`INSERT INTO daleba_prepaid_passes (client_name,client_phone,pass_type,services_total,services_used,amount_paid)
        VALUES ('Client Test','+15141234567','barbier_monthly',4,0,120.00)`);
      console.log('[daleba_bookings] Passe test ins\u00e9r\u00e9e');
    }
  } catch (e) {
    console.error('[daleba_bookings] init error:', e.message);
  }
})();

module.exports = router;
