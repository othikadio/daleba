/**
 * Square Appointments — DALEBA Metacortex Points 212-215, 217-218
 *
 * [212] Interface Square Appointments pour VoiceAgent
 * [213] SearchAvailability avec filtre service/employé
 * [214] Max 3 créneaux retournés pour interaction vocale
 * [215] Format fr-CA naturel (ex: "jeudi à 14h00")
 * [217] Création client Square depuis identité vocale
 * [218] CreateBooking autonome après confirmation orale
 */

'use strict';

const bus = require('./event-bus');

const SQUARE_BASE  = 'https://connect.squareup.com';
const LOCATION_ID  = process.env.SQUARE_LOCATION_ID  || 'LTDE9RP9PSHX7';
const SQUARE_TOKEN = process.env.SQUARE_ACCESS_TOKEN;

function headers() {
  if (!SQUARE_TOKEN) throw new Error('SQUARE_ACCESS_TOKEN manquant');
  return {
    'Authorization':  `Bearer ${SQUARE_TOKEN}`,
    'Content-Type':   'application/json',
    'Square-Version': '2024-02-22',
  };
}

// ─── [213] SEARCH AVAILABILITY ────────────────────────────────────────────────

/**
 * Interroge l'API Square SearchAvailability pour les créneaux libres.
 * @param {object} opts
 *   serviceVariationId  {string} — ID de la variation de service Square
 *   teamMemberId        {string} — filtre par employé (optionnel)
 *   startAt             {string} — ISO8601 début de la fenêtre de recherche
 *   endAt               {string} — ISO8601 fin de la fenêtre
 *   durationMinutes     {number} — durée du service en minutes
 */
async function searchAvailability(opts = {}) {
  const {
    serviceVariationId,
    teamMemberId      = null,
    startAt           = new Date().toISOString(),
    endAt             = new Date(Date.now() + 7 * 86400000).toISOString(), // +7j
    durationMinutes   = 60,
  } = opts;

  if (!SQUARE_TOKEN) {
    return { availabilities: [], demo: true, slots: _demoSlots() };
  }

  const body = {
    query: {
      filter: {
        start_at_range: { start_at: startAt, end_at: endAt },
        location_id:    LOCATION_ID,
        segment_filters: [{
          service_variation_id: serviceVariationId,
          ...(teamMemberId ? { team_member_id_filter: { any: [teamMemberId] } } : {}),
        }],
      },
    },
  };

  try {
    const res = await fetch(`${SQUARE_BASE}/v2/bookings/availability/search`, {
      method: 'POST',
      headers: headers(),
      body:   JSON.stringify(body),
    });

    if (!res.ok) {
      const err = await res.text();
      console.warn(`[SquareAppts] SearchAvailability [${res.status}]:`, err.slice(0, 100));
      // Retourne des créneaux démo si Square non joignable
      return { availabilities: [], demo: true, slots: _demoSlots() };
    }

    const data = await res.json();
    const avail = data.availabilities || [];

    // [214] Limiter à 3 créneaux + formater en fr-CA [215]
    const slots = avail.slice(0, 3).map(a => ({
      startAt:    a.start_at,
      durationMn: Math.round(durationMinutes),
      label:      _formatSlotFrCA(a.start_at),     // [215]
      teamMember: a.appointment_segments?.[0]?.team_member_id || null,
    }));

    return { availabilities: avail, slots, demo: false };

  } catch (err) {
    console.warn('[SquareAppts] SearchAvailability:', err.message);
    return { availabilities: [], demo: true, slots: _demoSlots() };
  }
}

// ─── [215] FORMAT FR-CA NATUREL ───────────────────────────────────────────────

/**
 * Formate un créneau au format vocal fr-CA naturel [215]
 * ex: "ce jeudi à 14h00" / "vendredi à 10h30" / "samedi matin à 9h00"
 */
function _formatSlotFrCA(isoString) {
  const dt   = new Date(isoString);
  const now  = new Date();

  const JOURS = ['dimanche','lundi','mardi','mercredi','jeudi','vendredi','samedi'];
  const dayName = JOURS[dt.getDay()];
  const h       = dt.getHours();
  const m       = dt.getMinutes();
  const hStr    = m === 0 ? `${h}h` : `${h}h${String(m).padStart(2,'0')}`;

  // Déterminer "ce X" vs "X prochain" vs date explicite
  const diffDays = Math.floor((dt - now) / 86400000);
  let prefix;
  if (diffDays === 0)      prefix = `aujourd'hui`;
  else if (diffDays === 1) prefix = `demain`;
  else if (diffDays < 7)  prefix = `ce ${dayName}`;
  else                     prefix = `${dayName} prochain`;

  // Partie de la journée pour contextualisation naturelle [209]
  let moment = '';
  if (h >= 5  && h < 12) moment = ' le matin';
  if (h >= 12 && h < 14) moment = ' à midi';
  if (h >= 14 && h < 18) moment = ' l\'après-midi';
  if (h >= 18)            moment = ' en soirée';

  return `${prefix}${moment} à ${hStr}`;
}

// Créneaux de démonstration si Square non disponible
function _demoSlots() {
  const base = Date.now() + 86400000;
  return [
    { startAt: new Date(base).toISOString(),              label: _formatSlotFrCA(new Date(base + 36000000).toISOString()),  demo: true },
    { startAt: new Date(base + 86400000).toISOString(),   label: _formatSlotFrCA(new Date(base + 172800000 + 37800000).toISOString()), demo: true },
    { startAt: new Date(base + 172800000).toISOString(),  label: _formatSlotFrCA(new Date(base + 259200000 + 46800000).toISOString()), demo: true },
  ];
}

// ─── [216] RECHERCHE CLIENT PAR TÉLÉPHONE ────────────────────────────────────

/**
 * Cherche un client Square par son numéro de téléphone (From Twilio) [216]
 */
async function findCustomerByPhone(phoneNumber) {
  if (!SQUARE_TOKEN) return null;

  try {
    // Normaliser le numéro (E.164 → format Square)
    const normalized = phoneNumber.replace(/\s+/g, '');

    const res = await fetch(`${SQUARE_BASE}/v2/customers/search`, {
      method:  'POST',
      headers: headers(),
      body:    JSON.stringify({
        query: {
          filter: {
            phone_number: { exact: normalized },
          },
        },
      }),
    });

    if (!res.ok) return null;
    const data = await res.json();
    const customer = data.customers?.[0] || null;

    if (customer) {
      bus.system(`[VoiceAgent] Client identifié: ${customer.given_name} ${customer.family_name || ''} | ${phoneNumber}`);
    }

    return customer; // { id, given_name, family_name, email_address, phone_number }
  } catch (e) {
    console.warn('[SquareAppts] findCustomerByPhone:', e.message);
    return null;
  }
}

// ─── [217] CRÉATION CLIENT SQUARE ────────────────────────────────────────────

/**
 * Crée une nouvelle fiche client Square depuis l'identité vocale [217]
 * @param {object} identity — { firstName, lastName, phoneNumber }
 */
async function createCustomerFromVoice(identity = {}) {
  const { firstName, lastName, phoneNumber } = identity;
  if (!SQUARE_TOKEN) return { error: 'SQUARE_ACCESS_TOKEN manquant' };

  try {
    const res = await fetch(`${SQUARE_BASE}/v2/customers`, {
      method:  'POST',
      headers: headers(),
      body:    JSON.stringify({
        given_name:    firstName,
        family_name:   lastName || '',
        phone_number:  phoneNumber,
        reference_id:  `voice_${Date.now()}`,
        note:          'Créé automatiquement par DALEBA Voice Agent',
      }),
    });

    if (!res.ok) {
      const err = await res.text();
      return { error: `Square createCustomer [${res.status}]: ${err.slice(0, 80)}` };
    }

    const data = await res.json();
    bus.system(`[VoiceAgent] Nouveau client créé: ${firstName} ${lastName} | ${phoneNumber}`);
    return data.customer;

  } catch (e) {
    return { error: e.message };
  }
}

// ─── [218] CREATE BOOKING ─────────────────────────────────────────────────────

/**
 * Crée un rendez-vous Square après confirmation orale [218]
 * @param {object} params
 *   customerId         {string} — ID client Square
 *   serviceVariationId {string} — ID variation service
 *   startAt            {string} — ISO8601 du créneau confirmé
 *   teamMemberId       {string} — employé assigné (optionnel)
 *   durationMinutes    {number}
 */
async function createBooking(params = {}) {
  const {
    customerId, serviceVariationId,
    startAt, teamMemberId = null, durationMinutes = 60,
    customerNote = 'Réservé via DALEBA Voice Agent',
  } = params;

  if (!SQUARE_TOKEN) return { error: 'SQUARE_ACCESS_TOKEN manquant' };
  if (!customerId || !serviceVariationId || !startAt) {
    return { error: 'customerId, serviceVariationId et startAt sont requis' };
  }

  try {
    const res = await fetch(`${SQUARE_BASE}/v2/bookings`, {
      method:  'POST',
      headers: headers(),
      body:    JSON.stringify({
        booking: {
          start_at:      startAt,
          location_id:   LOCATION_ID,
          customer_id:   customerId,
          customer_note: customerNote,
          appointment_segments: [{
            duration_minutes:       durationMinutes,
            service_variation_id:   serviceVariationId,
            service_variation_version: 0,
            ...(teamMemberId ? { team_member_id: teamMemberId } : {}),
          }],
        },
        idempotency_key: `voice_booking_${customerId}_${Date.now()}`,
      }),
    });

    if (!res.ok) {
      const err = await res.text();
      console.warn(`[SquareAppts] CreateBooking [${res.status}]:`, err.slice(0, 120));
      return { error: `Square [${res.status}]: ${err.slice(0, 80)}` };
    }

    const data = await res.json();
    const booking = data.booking || {};

    bus.system(`[VoiceAgent] Réservation créée: ${booking.id} | ${_formatSlotFrCA(startAt)} | client ${customerId}`);
    return booking;

  } catch (e) {
    return { error: e.message };
  }
}

// ─── HELPERS CATALOGUE VOCAUX ─────────────────────────────────────────────────

/**
 * Récupère les services du catalogue pour l'identification de l'intention
 */
async function getCatalogServices() {
  if (!SQUARE_TOKEN) return [];

  try {
    const res = await fetch(
      `${SQUARE_BASE}/v2/catalog/list?types=ITEM`,
      { headers: headers() }
    );
    if (!res.ok) return [];
    const data = await res.json();
    return (data.objects || [])
      .filter(o => o.type === 'ITEM')
      .map(o => ({
        id:          o.id,
        name:        o.item_data?.name,
        description: o.item_data?.description,
        variations:  o.item_data?.variations?.map(v => ({
          id:    v.id,
          name:  v.item_variation_data?.name,
          price: (v.item_variation_data?.price_money?.amount || 0) / 100,
        })) || [],
      }));
  } catch (e) {
    return [];
  }
}

// ─── EXPORTS ─────────────────────────────────────────────────────────────────

module.exports = {
  searchAvailability,
  findCustomerByPhone,
  createCustomerFromVoice,
  createBooking,
  getCatalogServices,
  formatSlotFrCA: _formatSlotFrCA,
};
