'use strict';
/**
 * DALEBA WhatsApp Salon — Square Booking
 * Disponibilités, services, réservations
 */
const { v4: uuidv4 } = require('uuid');

const SQUARE_BASE  = 'https://connect.squareup.com';
const LOCATION_ID  = process.env.SQUARE_LOCATION_ID;
const SQUARE_TOKEN = process.env.SQUARE_ACCESS_TOKEN;

function headers() {
  return {
    'Authorization': `Bearer ${SQUARE_TOKEN}`,
    'Content-Type': 'application/json',
    'Square-Version': '2024-01-17',
  };
}

// Récupère les services + prix depuis le catalogue Square
async function getServicesWithPrices() {
  if (!SQUARE_TOKEN) return [];
  const res = await fetch(`${SQUARE_BASE}/v2/catalog/list?types=ITEM,ITEM_VARIATION`, { headers: headers() });
  const data = await res.json();
  const objects = data.objects || [];

  const items = objects.filter(o => o.type === 'ITEM');
  const variations = objects.filter(o => o.type === 'ITEM_VARIATION');

  const services = [];
  for (const item of items) {
    const name = item.item_data?.name || '';
    const category = item.item_data?.category_v2_ids?.[0] || '';
    for (const varId of (item.item_data?.variations || [])) {
      const v = variations.find(vv => vv.id === varId.id);
      if (!v) continue;
      const priceAmt = v.item_variation_data?.price_money?.amount || 0; // en cents
      const duration = v.item_variation_data?.service_duration || 3600000; // ms
      services.push({
        id:          v.id,
        itemId:      item.id,
        name:        `${name}${v.item_variation_data?.name && v.item_variation_data.name !== 'Regular' ? ' – ' + v.item_variation_data.name : ''}`,
        rawName:     name,
        variationName: v.item_variation_data?.name || '',
        priceCents:  priceAmt,
        priceDollars: (priceAmt / 100).toFixed(2),
        durationMs:  duration,
        durationMin: Math.round(duration / 60000),
        // Détecte si c'est un service Barbier
        isBarbier:   /barbier|barber|fade|dégradé|degrade|rasage|shave|beard|barba/i.test(name),
        // Détecte si c'est Expert Locks
        isLocks:     /lock|dreadlock|dread|nattage|tresse africaine|twist/i.test(name),
      });
    }
  }
  return services;
}

// Recherche les disponibilités Square pour un service et une période
async function searchAvailability(serviceVariationId, teamMemberId = null, startDate = null) {
  if (!SQUARE_TOKEN) return [];
  const now = startDate ? new Date(startDate) : new Date();
  const start = new Date(now);
  start.setHours(9, 0, 0, 0);
  if (start < new Date()) start.setTime(new Date().getTime() + 30 * 60 * 1000);
  const end = new Date(start);
  end.setDate(end.getDate() + 7);

  const body = {
    query: {
      filter: {
        start_at_range: {
          start_at: start.toISOString(),
          end_at:   end.toISOString(),
        },
        location_id: LOCATION_ID,
        segment_filters: [{
          service_variation_id: serviceVariationId,
          ...(teamMemberId ? { team_member_id_filter: { any: [teamMemberId] } } : {}),
        }],
      },
    },
  };

  const res = await fetch(`${SQUARE_BASE}/v2/bookings/availability/search`, {
    method: 'POST', headers: headers(), body: JSON.stringify(body),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.errors?.[0]?.detail || `Square [${res.status}]`);
  return (data.availabilities || []).slice(0, 8); // 8 premiers créneaux
}

// Formate les disponibilités pour affichage WhatsApp
function formatAvailabilities(avails) {
  if (!avails.length) return 'Aucun créneau disponible dans les 7 prochains jours.';
  const lines = avails.map((a, i) => {
    const dt = new Date(a.start_at);
    const day = dt.toLocaleDateString('fr-CA', { weekday: 'long', month: 'long', day: 'numeric' });
    const hour = dt.toLocaleTimeString('fr-CA', { hour: '2-digit', minute: '2-digit' });
    return `*${i + 1}.* ${day} à ${hour}`;
  });
  return lines.join('\n');
}

// Crée un rendez-vous Square
async function createBooking({ serviceVariationId, teamMemberId, startAt, customerName, customerPhone, customerEmail }) {
  if (!SQUARE_TOKEN) throw new Error('SQUARE_ACCESS_TOKEN manquant');

  // 1. Créer ou retrouver le client
  let customerId = null;
  try {
    const searchRes = await fetch(`${SQUARE_BASE}/v2/customers/search`, {
      method: 'POST', headers: headers(),
      body: JSON.stringify({ query: { filter: { phone_number: { exact: customerPhone } } } }),
    });
    const sd = await searchRes.json();
    if (sd.customers?.length) {
      customerId = sd.customers[0].id;
    } else {
      const [givenName, ...rest] = (customerName || 'Client').split(' ');
      const cr = await fetch(`${SQUARE_BASE}/v2/customers`, {
        method: 'POST', headers: headers(),
        body: JSON.stringify({
          idempotency_key: uuidv4(),
          given_name: givenName, family_name: rest.join(' ') || '',
          phone_number: customerPhone, email_address: customerEmail || undefined,
        }),
      });
      const cd = await cr.json();
      customerId = cd.customer?.id;
    }
  } catch(_) {}

  // 2. Créer le RDV
  const body = {
    idempotency_key: uuidv4(),
    booking: {
      start_at: startAt,
      location_id: LOCATION_ID,
      customer_id: customerId || undefined,
      customer_note: `RDV via WhatsApp IA — ${customerName}`,
      appointment_segments: [{
        service_variation_id: serviceVariationId,
        team_member_id: teamMemberId,
        service_variation_version: 0,
      }],
    },
  };

  const res = await fetch(`${SQUARE_BASE}/v2/bookings`, {
    method: 'POST', headers: headers(), body: JSON.stringify(body),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.errors?.[0]?.detail || `Square booking [${res.status}]`);
  return data.booking;
}

// Annule un RDV Square (ex: paiement non reçu)
async function cancelBooking(bookingId, bookingVersion = 0) {
  if (!SQUARE_TOKEN) return;
  await fetch(`${SQUARE_BASE}/v2/bookings/${bookingId}/cancel`, {
    method: 'POST', headers: headers(),
    body: JSON.stringify({ idempotency_key: uuidv4(), booking_version: bookingVersion }),
  });
}

// Bloque un créneau (placeholder) en attendant le paiement Stripe
async function holdBooking(params) {
  return createBooking({ ...params, customerNote: '[EN ATTENTE DÉPÔT STRIPE]' });
}

module.exports = { getServicesWithPrices, searchAvailability, formatAvailabilities, createBooking, cancelBooking, holdBooking };
