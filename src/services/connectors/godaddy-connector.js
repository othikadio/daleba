'use strict';
/**
 * GoDaddy Connector — DALEBA Section 14
 * ──────────────────────────────────────────────────────────────
 * Connecte les agents DALEBA (Comptabilité, Staff) aux services GoDaddy:
 *  - GoDaddy Appointments (réservation en ligne)
 *  - GoDaddy Payments (Poynt terminal)
 *  - GoDaddy Domains API (gestion DNS kadiocoiffure.com)
 *  - Event Bus: pousse chaque réservation/paiement vers DALEBA
 *
 * Variables d'env requises:
 *   GODADDY_API_KEY       → Clé API (developer.godaddy.com)
 *   GODADDY_API_SECRET    → Secret API
 *   GODADDY_CUSTOMER_ID   → ID compte GoDaddy (URL dashboard)
 *   GODADDY_WEBSITE_ID    → ID du site avec Appointments actif
 *   GODADDY_DOMAIN        → kadiocoiffure.com
 */
const https   = require('https');
const crypto  = require('crypto');
const bus     = require('../event-bus');

const BASE_URL    = 'https://api.godaddy.com';
const API_KEY     = () => process.env.GODADDY_API_KEY    || '';
const API_SECRET  = () => process.env.GODADDY_API_SECRET || '';
const DOMAIN      = () => process.env.GODADDY_DOMAIN     || 'kadiocoiffure.com';
const CUSTOMER_ID = () => process.env.GODADDY_CUSTOMER_ID || '';

// ── Helper HTTP ───────────────────────────────────────────────
function gdRequest(method, path, body = null) {
  return new Promise((resolve, reject) => {
    const key    = API_KEY();
    const secret = API_SECRET();
    if (!key || !secret) {
      // Mode démo — retourne données fictives cohérentes
      bus.system('[GoDaddy] ⚠️ Clés API manquantes — mode démonstration');
      return resolve({ _demo: true, message: 'GODADDY_API_KEY / GODADDY_API_SECRET non configurés' });
    }

    const payload = body ? JSON.stringify(body) : null;
    const options = {
      hostname: 'api.godaddy.com',
      path,
      method,
      headers: {
        'Authorization': `sso-key ${key}:${secret}`,
        'Content-Type':  'application/json',
        'Accept':        'application/json',
        ...(payload ? { 'Content-Length': Buffer.byteLength(payload) } : {}),
      },
    };

    const req = https.request(options, res => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try { resolve(JSON.parse(data)); }
        catch { resolve({ raw: data, status: res.statusCode }); }
      });
    });
    req.on('error', reject);
    if (payload) req.write(payload);
    req.end();
  });
}

// ═══════════════════════════════════════════════════════════════
// APPOINTMENTS — Réservations GoDaddy
// ═══════════════════════════════════════════════════════════════

/**
 * Récupère les rendez-vous GoDaddy et les synchronise avec DALEBA
 * Pousse chaque nouveau RDV sur l'Event Bus
 */
async function syncAppointments(pool, tenantId = 'kadiocoiffure') {
  bus.system('[GoDaddy] 🔄 Synchronisation des rendez-vous...');
  const customerId = CUSTOMER_ID();
  if (!customerId) {
    bus.system('[GoDaddy] ⚠️ GODADDY_CUSTOMER_ID non configuré');
    return { synced: 0, _demo: true };
  }

  const appointments = await gdRequest('GET', `/v2/customers/${customerId}/appointments?status=PENDING,CONFIRMED&limit=50`);
  if (appointments._demo) return appointments;
  if (appointments.code) {
    bus.system(`[GoDaddy] ❌ Erreur API: ${appointments.message}`);
    return { error: appointments.message };
  }

  const items = appointments.appointments || appointments.results || [];
  let synced = 0;

  for (const appt of items) {
    try {
      const normalized = normalizeAppointment(appt);
      // Insérer dans la table tenant_appointments si elle existe
      if (pool?.query) {
        await pool.query(`
          INSERT INTO tenant_appointments
            (tenant_id, external_id, external_source, client_name, client_phone,
             service_name, start_time, status, raw_data)
          VALUES ($1,$2,'godaddy',$3,$4,$5,$6,$7,$8)
          ON CONFLICT (tenant_id, external_id) DO UPDATE
          SET status=$7, updated_at=NOW()
        `, [
          tenantId,
          normalized.id,
          normalized.clientName,
          normalized.clientPhone,
          normalized.serviceName,
          normalized.startTime,
          normalized.status,
          JSON.stringify(appt),
        ]).catch(() => {});
      }

      // Event Bus → DALEBA réagit à chaque RDV
      bus.emit('godaddy:appointment:synced', {
        tenantId, ...normalized, source: 'godaddy',
      });
      synced++;
    } catch(e) {
      bus.system(`[GoDaddy] ⚠️ Erreur sync appt ${appt.id}: ${e.message}`);
    }
  }

  bus.system(`[GoDaddy] ✅ ${synced}/${items.length} rendez-vous synchronisés`);
  return { synced, total: items.length };
}

/**
 * Crée un rendez-vous GoDaddy depuis DALEBA
 */
async function createAppointment({ clientName, clientPhone, clientEmail, serviceName, startTime, duration = 60, notes = '' }) {
  const customerId = CUSTOMER_ID();
  if (!customerId) return { _demo: true, id: `DEMO-${Date.now()}` };

  const payload = {
    customer: { firstName: clientName.split(' ')[0], lastName: clientName.split(' ')[1] || '', phone: clientPhone, email: clientEmail || '' },
    service:  { name: serviceName },
    startTime,
    duration,
    notes,
    status: 'CONFIRMED',
  };

  const result = await gdRequest('POST', `/v2/customers/${customerId}/appointments`, payload);
  if (result.id) {
    bus.emit('godaddy:appointment:created', { id: result.id, clientName, serviceName, startTime });
    bus.system(`[GoDaddy] 📅 RDV créé: ${clientName} → ${serviceName} @ ${startTime}`);
  }
  return result;
}

/**
 * Confirme / annule un rendez-vous GoDaddy
 */
async function updateAppointmentStatus(appointmentId, status) {
  const customerId = CUSTOMER_ID();
  if (!customerId) return { _demo: true };
  const result = await gdRequest('PATCH', `/v2/customers/${customerId}/appointments/${appointmentId}`, { status });
  bus.emit(`godaddy:appointment:${status.toLowerCase()}`, { appointmentId });
  return result;
}

// ═══════════════════════════════════════════════════════════════
// PAYMENTS (Poynt / GoDaddy Payments)
// ═══════════════════════════════════════════════════════════════

/**
 * Récupère les transactions du terminal GoDaddy Payments
 * Compatible avec la table tenant_ledgers de DALEBA
 */
async function fetchPayments(pool, tenantId = 'kadiocoiffure', { from, to } = {}) {
  const customerId = CUSTOMER_ID();
  if (!customerId) return { _demo: true, transactions: [] };

  const params = new URLSearchParams({
    status: 'CAPTURED',
    limit:  '100',
    ...(from ? { startTime: from } : {}),
    ...(to   ? { endTime:   to   } : {}),
  });

  const result = await gdRequest('GET', `/v1/payments/transactions?${params}`);
  if (result._demo || result.code) return result;

  const txs = result.transactions || result.results || [];
  let imported = 0;

  for (const tx of txs) {
    const normalized = normalizePayment(tx);
    if (pool?.query) {
      await pool.query(`
        INSERT INTO tenant_ledgers
          (tenant_id, external_id, source, amount_gross, amount_net, currency,
           description, status, tx_date)
        VALUES ($1,$2,'godaddy',$3,$4,$5,$6,$7,$8)
        ON CONFLICT (tenant_id, external_id) DO NOTHING
      `, [
        tenantId, normalized.id,
        normalized.amountGross, normalized.amountNet,
        normalized.currency, normalized.description,
        normalized.status, normalized.txDate,
      ]).catch(() => {});
    }
    bus.emit('godaddy:payment:synced', { tenantId, ...normalized });
    imported++;
  }

  bus.system(`[GoDaddy] 💳 ${imported} transactions importées`);
  return { imported, total: txs.length };
}

// ═══════════════════════════════════════════════════════════════
// DOMAINES DNS — kadiocoiffure.com
// ═══════════════════════════════════════════════════════════════

/**
 * Vérifie le statut du domaine kadiocoiffure.com
 */
async function checkDomainStatus() {
  const domain = DOMAIN();
  const result = await gdRequest('GET', `/v1/domains/${domain}`);
  if (result._demo) return { domain, status: 'DEMO', nameServers: ['ns.cloudflare.com'] };
  return {
    domain: result.domain,
    status: result.status,
    expires: result.expires,
    nameServers: result.nameServers,
    autoRenew: result.renewAuto,
  };
}

/**
 * Met à jour les enregistrements DNS (A record → VPS)
 */
async function updateDNSRecord(type, name, value, ttl = 600) {
  const domain = DOMAIN();
  const result = await gdRequest('PUT', `/v1/domains/${domain}/records/${type}/${name}`, [{ data: value, ttl }]);
  bus.system(`[GoDaddy] 🌐 DNS mis à jour: ${type} ${name} → ${value}`);
  return result;
}

/**
 * Point le domaine vers le VPS principal (IP fournie)
 */
async function pointDomainToVPS(vpsIP) {
  const domain = DOMAIN();
  bus.system(`[GoDaddy] 🚀 Pointage ${domain} → VPS ${vpsIP}`);
  const [root, www] = await Promise.all([
    updateDNSRecord('A', '@', vpsIP),
    updateDNSRecord('A', 'www', vpsIP),
  ]);
  return { domain, vpsIP, root, www };
}

// ═══════════════════════════════════════════════════════════════
// NORMALISATION (Square → GoDaddy compat)
// ═══════════════════════════════════════════════════════════════

function normalizeAppointment(raw) {
  return {
    id:          raw.id || raw.appointmentId,
    clientName:  `${raw.customer?.firstName || ''} ${raw.customer?.lastName || ''}`.trim() || raw.customerName || 'Client',
    clientPhone: raw.customer?.phone || raw.customerPhone || '',
    clientEmail: raw.customer?.email || raw.customerEmail || '',
    serviceName: raw.service?.name  || raw.serviceName  || 'Service',
    startTime:   raw.startTime || raw.appointmentTime,
    duration:    raw.duration  || 60,
    status:      raw.status    || 'CONFIRMED',
    source:      'godaddy',
  };
}

function normalizePayment(raw) {
  const amountGross = (raw.amounts?.transactionAmount || raw.amount || 0) / 100;
  const fee         = (raw.amounts?.tipAmount || 0) / 100;
  return {
    id:           raw.id || raw.transactionId,
    amountGross,
    amountNet:    amountGross - fee,
    currency:     raw.currency || 'CAD',
    description:  raw.notes   || raw.description || 'GoDaddy Payment',
    status:       raw.status  || 'CAPTURED',
    txDate:       raw.createdAt || raw.transactionTime || new Date().toISOString(),
    source:       'godaddy',
  };
}

/**
 * Widget HTML de réservation GoDaddy — à embedder dans kadiocoiffure.com
 */
function getBookingWidgetHTML(options = {}) {
  const websiteId  = process.env.GODADDY_WEBSITE_ID || 'CONFIGURE_WEBSITE_ID';
  const businessId = CUSTOMER_ID() || 'CONFIGURE_CUSTOMER_ID';
  const { primaryColor = '#1a1a1a', buttonText = 'Réserver maintenant' } = options;

  // Si GODADDY_WEBSITE_ID est configuré → widget officiel GoDaddy
  if (process.env.GODADDY_WEBSITE_ID) {
    return `
<!-- Widget de réservation GoDaddy Appointments -->
<script src="https://embed.appointment.godaddy.com/embed/script.js"></script>
<div id="godaddy-appointment-widget"
     data-business-id="${businessId}"
     data-website-id="${websiteId}"
     data-primary-color="${primaryColor}"
     data-locale="fr-CA"
     data-timezone="America/Toronto">
</div>
<script>
  window.GoDaddyAppointments && window.GoDaddyAppointments.init({
    containerId: 'godaddy-appointment-widget',
    onBookingComplete: function(booking) {
      // Notifier DALEBA Event Bus
      fetch('/api/v1/godaddy/booking-webhook', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(booking)
      });
    }
  });
</script>`;
  }

  // Fallback: widget DALEBA natif (Square → DALEBA booking)
  return `
<!-- Widget DALEBA Booking natif (fallback) -->
<div id="daleba-booking-widget" data-color="${primaryColor}">
  <button onclick="window.open('/booking','_blank','width=480,height=640')"
          style="background:${primaryColor};color:#fff;padding:14px 32px;border:none;border-radius:4px;font-size:16px;cursor:pointer;letter-spacing:1px;">
    ${buttonText}
  </button>
</div>`;
}

module.exports = {
  syncAppointments, createAppointment, updateAppointmentStatus,
  fetchPayments, checkDomainStatus, updateDNSRecord, pointDomainToVPS,
  getBookingWidgetHTML, normalizeAppointment, normalizePayment,
};
