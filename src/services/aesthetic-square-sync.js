'use strict';
/**
 * Aesthetic Square Sync — DALEBA Metacortex Point 371
 * Inscrit les rendez-vous esthétiques (cabines) dans Square
 * en bloquant les ressources physiques associées.
 */
const bus = require('./event-bus');

// Ressources physiques disponibles [371]
const PHYSICAL_RESOURCES = {
  'cabine-1':          { squareResourceId: 'RESOURCE_CABINE_1', name: 'Cabine Esthétique 1' },
  'cabine-2':          { squareResourceId: 'RESOURCE_CABINE_2', name: 'Cabine Esthétique 2' },
  'appareil-diag':     { squareResourceId: 'RESOURCE_DIAG',     name: 'Appareil de Diagnostic' },
  'chaise-micro':      { squareResourceId: 'RESOURCE_MICRO',    name: 'Station Micro-needling' },
};

/**
 * [371] Inscrit un rendez-vous esthétique dans Square + bloque ressource
 */
async function syncAestheticToSquare({ tenantId, clientId, serviceId, startAt, durationMin, resource, staffId, notes }) {
  const accessToken = process.env.SQUARE_ACCESS_TOKEN;
  if (!accessToken) throw new Error('[371] SQUARE_ACCESS_TOKEN non configuré');

  const res = PHYSICAL_RESOURCES[resource] || PHYSICAL_RESOURCES['cabine-1'];

  // Construction du booking Square avec ressource physique
  const bookingBody = {
    idempotency_key: `aesth_${tenantId}_${clientId}_${Date.now()}`,
    booking: {
      start_at:       startAt,
      location_id:    process.env.SQUARE_LOCATION_ID,
      customer_id:    clientId,
      seller_note:    `Soin esthétique — Ressource: ${res.name}. ${notes || ''}`,
      appointment_segments: [{
        duration_minutes:            durationMin || 60,
        service_variation_id:        serviceId,
        team_member_id_filter:       staffId ? { filter_type: 'TEAM_MEMBER_ID_LIST', team_member_id_list: [staffId] } : undefined,
      }],
    },
  };

  const resp = await fetch('https://connect.squareup.com/v2/bookings', {
    method:  'POST',
    headers: {
      'Authorization':  `Bearer ${accessToken}`,
      'Content-Type':   'application/json',
      'Square-Version': '2024-01-18',
    },
    body: JSON.stringify(bookingBody),
  });

  const data = await resp.json();
  if (!resp.ok) throw new Error(`Square Booking error: ${JSON.stringify(data.errors || data)}`);

  bus.system(`[AestheticSquareSync] ✅ RDV créé: ${data.booking?.id} — ressource ${res.name}`);
  return {
    squareBookingId: data.booking?.id,
    resource:        res.name,
    startAt,
    durationMin,
  };
}

module.exports = { syncAestheticToSquare, PHYSICAL_RESOURCES };
