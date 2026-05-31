/**
 * DALEBA — Service Airtable (REST API)
 * Sync bidirectionnel : Stripe + Square → Airtable
 * Variables requises : AIRTABLE_API_KEY, AIRTABLE_BASE_ID
 * Mode dégradé : si les variables manquent, toutes les fonctions retournent null sans planter
 */

const API_KEY = process.env.AIRTABLE_API_KEY;
const BASE_ID = process.env.AIRTABLE_BASE_ID;
const BASE_URL = 'https://api.airtable.com/v0';

// ─── HELPERS ─────────────────────────────────────────────────────────────────

function isConfigured() {
  return !!(API_KEY && BASE_ID);
}

function headers() {
  return {
    Authorization: `Bearer ${API_KEY}`,
    'Content-Type': 'application/json',
  };
}

// Rate limit helper : 200ms entre appels batch (Airtable = 5 req/sec max)
function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function airtableFetch(path, options = {}) {
  const url = path.startsWith('http') ? path : `${BASE_URL}/${BASE_ID}/${path}`;
  const res = await fetch(url, { ...options, headers: headers() });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`Airtable [${res.status}] ${path}: ${body.slice(0, 200)}`);
  }
  return res.json();
}

// ─── INITIALISATION BASE ──────────────────────────────────────────────────────

/**
 * Tente de créer la base DALEBA si workspaceId fourni.
 * En pratique, le token PAT nécessite scope `schema.bases:write`.
 * Si absent, log un avertissement et retourne null.
 */
async function initializeBase(workspaceId) {
  if (!API_KEY) {
    console.warn('[Airtable] AIRTABLE_API_KEY manquant — mode dégradé');
    return null;
  }
  if (BASE_ID) {
    console.log(`[Airtable] Base existante configurée : ${BASE_ID}`);
    return BASE_ID;
  }
  if (!workspaceId) {
    console.warn('[Airtable] workspaceId requis pour créer la base. Créez-la manuellement et configurez AIRTABLE_BASE_ID.');
    return null;
  }
  try {
    const res = await fetch('https://api.airtable.com/v0/meta/bases', {
      method: 'POST',
      headers: headers(),
      body: JSON.stringify({
        name: 'DALEBA — Kadio Coiffure',
        workspaceId,
        tables: [{ name: 'Abonnés', fields: [{ name: 'Nom', type: 'singleLineText' }] }],
      }),
    });
    if (!res.ok) {
      const err = await res.text();
      console.warn('[Airtable] Création base impossible (scope insuffisant). Créez-la manuellement.', err.slice(0, 200));
      return null;
    }
    const data = await res.json();
    console.log(`[Airtable] Base créée : ${data.id}`);
    return data.id;
  } catch (e) {
    console.warn('[Airtable] initializeBase error:', e.message);
    return null;
  }
}

// ─── TABLES STRUCTURE ────────────────────────────────────────────────────────

const TABLE_SCHEMAS = {
  'Abonnés': [
    { name: 'Nom', type: 'singleLineText' },
    { name: 'Email', type: 'email' },
    { name: 'Téléphone', type: 'phoneNumber' },
    { name: 'Stripe Customer ID', type: 'singleLineText' },
    { name: 'Subscription ID', type: 'singleLineText' },
    { name: 'Plan', type: 'singleLineText' },
    { name: 'Statut', type: 'singleSelect', options: { choices: [
      { name: 'actif' }, { name: 'annulé' }, { name: 'en_retard' }, { name: 'incomplet' }
    ]}},
    { name: 'Montant', type: 'currency', options: { symbol: '$', precision: 2 } },
    { name: 'Date début', type: 'date', options: { dateFormat: { name: 'iso' } } },
    { name: 'Prochain renouvellement', type: 'date', options: { dateFormat: { name: 'iso' } } },
    { name: 'Dernière visite', type: 'date', options: { dateFormat: { name: 'iso' } } },
    { name: 'Profil capillaire', type: 'singleLineText' },
    { name: 'Notes', type: 'multilineText' },
    { name: 'Rappels envoyés', type: 'number', options: { precision: 0 } },
  ],
  'Paiements': [
    { name: 'Payment ID', type: 'singleLineText' },
    { name: 'Client', type: 'singleLineText' },
    { name: 'Email', type: 'email' },
    { name: 'Téléphone', type: 'phoneNumber' },
    { name: 'Montant', type: 'currency', options: { symbol: '$', precision: 2 } },
    { name: 'Source', type: 'singleSelect', options: { choices: [
      { name: 'Stripe' }, { name: 'Square' }, { name: 'Cash' }
    ]}},
    { name: 'Statut', type: 'singleSelect', options: { choices: [
      { name: 'complété' }, { name: 'remboursé' }, { name: 'échoué' }, { name: 'en_attente' }
    ]}},
    { name: 'Service', type: 'singleLineText' },
    { name: 'Date paiement', type: 'dateTime', options: { dateFormat: { name: 'iso' }, timeFormat: { name: '24hour' }, timeZone: 'America/Toronto' } },
    { name: 'Stripe Customer ID', type: 'singleLineText' },
    { name: 'Square Payment ID', type: 'singleLineText' },
    { name: 'Notes', type: 'multilineText' },
  ],
  'Rendez-vous': [
    { name: 'Square Appointment ID', type: 'singleLineText' },
    { name: 'Client', type: 'singleLineText' },
    { name: 'Email', type: 'email' },
    { name: 'Téléphone', type: 'phoneNumber' },
    { name: 'Service', type: 'singleLineText' },
    { name: 'Coiffeur', type: 'singleLineText' },
    { name: 'Date RDV', type: 'dateTime', options: { dateFormat: { name: 'iso' }, timeFormat: { name: '24hour' }, timeZone: 'America/Toronto' } },
    { name: 'Durée', type: 'number', options: { precision: 0 } },
    { name: 'Prix', type: 'currency', options: { symbol: '$', precision: 2 } },
    { name: 'Statut', type: 'singleSelect', options: { choices: [
      { name: 'confirmé' }, { name: 'annulé' }, { name: 'complété' }, { name: 'no_show' }
    ]}},
    { name: 'Rappel 24h', type: 'checkbox' },
    { name: 'Rappel 1h', type: 'checkbox' },
    { name: 'SMS envoyé', type: 'checkbox' },
    { name: 'Notes', type: 'multilineText' },
  ],
  'Fiches Capillaires': [
    { name: 'Client', type: 'singleLineText' },
    { name: 'Email', type: 'email' },
    { name: 'Téléphone', type: 'phoneNumber' },
    { name: 'Type de cheveux', type: 'singleSelect', options: { choices: [
      { name: 'lisse' }, { name: 'ondulé' }, { name: 'bouclé' }, { name: 'crépu' }, { name: 'coily' }
    ]}},
    { name: 'Texture', type: 'singleSelect', options: { choices: [
      { name: 'fin' }, { name: 'moyen' }, { name: 'épais' }
    ]}},
    { name: 'Problèmes', type: 'multilineText' },
    { name: 'Traitements actuels', type: 'multilineText' },
    { name: 'Allergies', type: 'multilineText' },
    { name: 'Couleur actuelle', type: 'singleLineText' },
    { name: 'Dernière couleur', type: 'date', options: { dateFormat: { name: 'iso' } } },
    { name: 'Fréquence visite', type: 'singleSelect', options: { choices: [
      { name: 'hebdo' }, { name: 'bi-mensuel' }, { name: 'mensuel' }, { name: 'trimestriel' }, { name: 'occasionnel' }
    ]}},
    { name: 'Objectifs', type: 'multilineText' },
    { name: 'Notes coiffeur', type: 'multilineText' },
    { name: 'Créé le', type: 'date', options: { dateFormat: { name: 'iso' } } },
    { name: 'Mis à jour', type: 'date', options: { dateFormat: { name: 'iso' } } },
  ],
  'Historique Visites': [
    { name: 'Visit ID', type: 'singleLineText' },
    { name: 'Client', type: 'singleLineText' },
    { name: 'Email', type: 'email' },
    { name: 'Date visite', type: 'dateTime', options: { dateFormat: { name: 'iso' }, timeFormat: { name: '24hour' }, timeZone: 'America/Toronto' } },
    { name: 'Services', type: 'multilineText' },
    { name: 'Coiffeur', type: 'singleLineText' },
    { name: 'Total', type: 'currency', options: { symbol: '$', precision: 2 } },
    { name: 'Moyen paiement', type: 'singleSelect', options: { choices: [
      { name: 'carte' }, { name: 'cash' }, { name: 'stripe' }, { name: 'square' }
    ]}},
    { name: 'Rating', type: 'number', options: { precision: 0 } },
    { name: 'Commentaire', type: 'multilineText' },
    { name: 'Square Appointment ID', type: 'singleLineText' },
    { name: 'Produits utilisés', type: 'multilineText' },
  ],
  'Rappels SMS': [
    { name: 'Client', type: 'singleLineText' },
    { name: 'Téléphone', type: 'phoneNumber' },
    { name: 'Email', type: 'email' },
    { name: 'Date RDV', type: 'dateTime', options: { dateFormat: { name: 'iso' }, timeFormat: { name: '24hour' }, timeZone: 'America/Toronto' } },
    { name: 'Type rappel', type: 'singleSelect', options: { choices: [
      { name: '24h' }, { name: '1h' }, { name: 'confirmation' }, { name: 'anniversaire' }, { name: 'réengagement' }
    ]}},
    { name: 'Message', type: 'multilineText' },
    { name: 'Statut', type: 'singleSelect', options: { choices: [
      { name: 'en_attente' }, { name: 'envoyé' }, { name: 'échoué' }, { name: 'annulé' }
    ]}},
    { name: 'Envoyé le', type: 'dateTime', options: { dateFormat: { name: 'iso' }, timeFormat: { name: '24hour' }, timeZone: 'America/Toronto' } },
    { name: 'Square Appointment ID', type: 'singleLineText' },
    { name: 'Tentatives', type: 'number', options: { precision: 0 } },
    { name: 'Twilio SID', type: 'singleLineText' },
  ],
};

/**
 * Crée les 6 tables si elles n'existent pas encore dans la base.
 * Nécessite scope `schema.bases:write`.
 */
async function ensureTablesExist(baseId) {
  if (!API_KEY || !baseId) {
    console.warn('[Airtable] ensureTablesExist : API_KEY ou baseId manquant');
    return null;
  }
  try {
    // Récupérer tables existantes
    const meta = await fetch(`https://api.airtable.com/v0/meta/bases/${baseId}/tables`, { headers: headers() });
    if (!meta.ok) {
      console.warn('[Airtable] Impossible de lister les tables (scope insuffisant)');
      return null;
    }
    const { tables: existing } = await meta.json();
    const existingNames = (existing || []).map(t => t.name);

    for (const [tableName, fields] of Object.entries(TABLE_SCHEMAS)) {
      if (existingNames.includes(tableName)) {
        console.log(`[Airtable] Table "${tableName}" existe déjà`);
        continue;
      }
      await delay(200);
      const res = await fetch(`https://api.airtable.com/v0/meta/bases/${baseId}/tables`, {
        method: 'POST',
        headers: headers(),
        body: JSON.stringify({ name: tableName, fields }),
      });
      if (res.ok) {
        console.log(`[Airtable] ✅ Table "${tableName}" créée`);
      } else {
        const err = await res.text();
        console.warn(`[Airtable] ⚠️ Table "${tableName}" non créée:`, err.slice(0, 200));
      }
    }
    return true;
  } catch (e) {
    console.warn('[Airtable] ensureTablesExist error:', e.message);
    return null;
  }
}

// ─── CRUD GÉNÉRIQUE ───────────────────────────────────────────────────────────

async function createRecord(tableName, fields) {
  if (!isConfigured()) {
    console.warn(`[Airtable] Non configuré — skip createRecord(${tableName})`);
    return null;
  }
  try {
    const encoded = encodeURIComponent(tableName);
    const data = await airtableFetch(encoded, {
      method: 'POST',
      body: JSON.stringify({ fields }),
    });
    return data.id ? data : null;
  } catch (e) {
    console.warn(`[Airtable] createRecord(${tableName}) error:`, e.message);
    return null;
  }
}

async function updateRecord(tableName, recordId, fields) {
  if (!isConfigured() || !recordId) return null;
  try {
    const encoded = encodeURIComponent(tableName);
    const data = await airtableFetch(`${encoded}/${recordId}`, {
      method: 'PATCH',
      body: JSON.stringify({ fields }),
    });
    return data;
  } catch (e) {
    console.warn(`[Airtable] updateRecord(${tableName}/${recordId}) error:`, e.message);
    return null;
  }
}

async function findRecords(tableName, filterFormula, maxRecords = 100) {
  if (!isConfigured()) return [];
  try {
    const encoded = encodeURIComponent(tableName);
    const params = new URLSearchParams({ maxRecords });
    if (filterFormula) params.set('filterByFormula', filterFormula);
    const data = await airtableFetch(`${encoded}?${params}`);
    return data.records || [];
  } catch (e) {
    console.warn(`[Airtable] findRecords(${tableName}) error:`, e.message);
    return [];
  }
}

async function deleteRecord(tableName, recordId) {
  if (!isConfigured() || !recordId) return null;
  try {
    const encoded = encodeURIComponent(tableName);
    const data = await airtableFetch(`${encoded}/${recordId}`, { method: 'DELETE' });
    return data;
  } catch (e) {
    console.warn(`[Airtable] deleteRecord(${tableName}/${recordId}) error:`, e.message);
    return null;
  }
}

// ─── UPSERT ABONNÉ ────────────────────────────────────────────────────────────

async function upsertSubscriber(subscriberData) {
  if (!isConfigured()) return null;
  try {
    const email = subscriberData.email || subscriberData.customerEmail;
    if (!email) return null;

    const existing = await findRecords('Abonnés', `{Email} = "${email}"`);
    const fields = {
      'Nom': subscriberData.name || subscriberData.customerName || '',
      'Email': email,
      'Téléphone': subscriberData.phone || '',
      'Stripe Customer ID': subscriberData.customerId || subscriberData.stripeCustomerId || '',
      'Subscription ID': subscriberData.subscriptionId || subscriberData.id || '',
      'Plan': subscriberData.plan || '',
      'Statut': mapStripeStatus(subscriberData.status),
      'Montant': typeof subscriberData.amount === 'number'
        ? subscriberData.amount
        : parseFloat(subscriberData.amount || 0),
      'Date début': subscriberData.startDate || subscriberData.createdAt
        ? toIsoDate(subscriberData.startDate || subscriberData.createdAt)
        : null,
      'Prochain renouvellement': subscriberData.nextRenewal || subscriberData.currentPeriodEnd
        ? toIsoDate(subscriberData.nextRenewal || subscriberData.currentPeriodEnd, true)
        : null,
    };

    // Nettoyer les null
    Object.keys(fields).forEach(k => { if (fields[k] === null || fields[k] === undefined) delete fields[k]; });

    if (existing.length > 0) {
      return await updateRecord('Abonnés', existing[0].id, fields);
    } else {
      return await createRecord('Abonnés', fields);
    }
  } catch (e) {
    console.warn('[Airtable] upsertSubscriber error:', e.message);
    return null;
  }
}

// ─── UPSERT RDV ───────────────────────────────────────────────────────────────

async function upsertAppointment(appointmentData) {
  if (!isConfigured()) return null;
  try {
    const squareId = appointmentData.squareAppointmentId || appointmentData.id;
    if (!squareId) return null;

    const existing = await findRecords('Rendez-vous', `{Square Appointment ID} = "${squareId}"`);
    const fields = {
      'Square Appointment ID': squareId,
      'Client': appointmentData.client || appointmentData.customerName || '',
      'Email': appointmentData.email || '',
      'Téléphone': appointmentData.phone || '',
      'Service': appointmentData.service || appointmentData.serviceName || '',
      'Coiffeur': appointmentData.staff || appointmentData.staffName || '',
      'Date RDV': appointmentData.startAt || appointmentData.dateRdv || null,
      'Durée': appointmentData.duration || appointmentData.durationMinutes || null,
      'Prix': typeof appointmentData.price === 'number'
        ? appointmentData.price
        : parseFloat(appointmentData.price || 0),
      'Statut': mapAppointmentStatus(appointmentData.status),
      'Notes': appointmentData.notes || '',
    };
    Object.keys(fields).forEach(k => { if (fields[k] === null || fields[k] === undefined || fields[k] === '') delete fields[k]; });

    if (existing.length > 0) {
      return await updateRecord('Rendez-vous', existing[0].id, fields);
    } else {
      return await createRecord('Rendez-vous', fields);
    }
  } catch (e) {
    console.warn('[Airtable] upsertAppointment error:', e.message);
    return null;
  }
}

// ─── UPSERT PAIEMENT ─────────────────────────────────────────────────────────

async function upsertPayment(paymentData) {
  if (!isConfigured()) return null;
  try {
    const paymentId = paymentData.paymentId || paymentData.id || paymentData.stripePaymentIntentId;
    if (!paymentId) return null;

    const existing = await findRecords('Paiements', `{Payment ID} = "${paymentId}"`);
    const fields = {
      'Payment ID': paymentId,
      'Client': paymentData.client || paymentData.customerName || '',
      'Email': paymentData.email || paymentData.customerEmail || '',
      'Téléphone': paymentData.phone || '',
      'Montant': typeof paymentData.amount === 'number'
        ? paymentData.amount
        : parseFloat(paymentData.amount || 0),
      'Source': paymentData.source || 'Stripe',
      'Statut': mapPaymentStatus(paymentData.status),
      'Service': paymentData.service || paymentData.description || '',
      'Date paiement': paymentData.date || paymentData.createdAt || new Date().toISOString(),
      'Stripe Customer ID': paymentData.stripeCustomerId || paymentData.customerId || '',
      'Square Payment ID': paymentData.squarePaymentId || '',
      'Notes': paymentData.notes || '',
    };
    Object.keys(fields).forEach(k => { if (fields[k] === null || fields[k] === undefined || fields[k] === '') delete fields[k]; });

    if (existing.length > 0) {
      return await updateRecord('Paiements', existing[0].id, fields);
    } else {
      return await createRecord('Paiements', fields);
    }
  } catch (e) {
    console.warn('[Airtable] upsertPayment error:', e.message);
    return null;
  }
}

// ─── UPSERT FICHE CAPILLAIRE ─────────────────────────────────────────────────

async function upsertHairProfile(profileData) {
  if (!isConfigured()) return null;
  try {
    const email = profileData.email;
    if (!email) return null;

    const existing = await findRecords('Fiches Capillaires', `{Email} = "${email}"`);
    const now = new Date().toISOString().slice(0, 10);
    const fields = {
      'Client': profileData.name || profileData.client || '',
      'Email': email,
      'Téléphone': profileData.phone || '',
      'Type de cheveux': profileData.hairType || '',
      'Texture': profileData.texture || '',
      'Problèmes': profileData.problems || '',
      'Traitements actuels': profileData.treatments || '',
      'Allergies': profileData.allergies || '',
      'Couleur actuelle': profileData.currentColor || '',
      'Objectifs': profileData.goals || '',
      'Notes coiffeur': profileData.notes || '',
      'Mis à jour': now,
    };
    if (!existing.length) fields['Créé le'] = now;
    Object.keys(fields).forEach(k => { if (fields[k] === null || fields[k] === undefined || fields[k] === '') delete fields[k]; });

    if (existing.length > 0) {
      return await updateRecord('Fiches Capillaires', existing[0].id, fields);
    } else {
      return await createRecord('Fiches Capillaires', fields);
    }
  } catch (e) {
    console.warn('[Airtable] upsertHairProfile error:', e.message);
    return null;
  }
}

// ─── LOG VISITE (toujours INSERT) ─────────────────────────────────────────────

async function logVisit(visitData) {
  if (!isConfigured()) return null;
  try {
    const fields = {
      'Visit ID': visitData.visitId || visitData.id || `visit-${Date.now()}`,
      'Client': visitData.client || visitData.customerName || '',
      'Email': visitData.email || '',
      'Date visite': visitData.date || visitData.visitDate || new Date().toISOString(),
      'Services': visitData.services || '',
      'Coiffeur': visitData.staff || '',
      'Total': typeof visitData.total === 'number' ? visitData.total : parseFloat(visitData.total || 0),
      'Moyen paiement': visitData.paymentMethod || 'carte',
      'Rating': visitData.rating || null,
      'Commentaire': visitData.comment || '',
      'Square Appointment ID': visitData.squareAppointmentId || '',
      'Produits utilisés': visitData.products || '',
    };
    Object.keys(fields).forEach(k => { if (fields[k] === null || fields[k] === undefined || fields[k] === '') delete fields[k]; });
    return await createRecord('Historique Visites', fields);
  } catch (e) {
    console.warn('[Airtable] logVisit error:', e.message);
    return null;
  }
}

// ─── REQUÊTES SPÉCIALISÉES ────────────────────────────────────────────────────

async function getSubscriberByEmail(email) {
  if (!isConfigured() || !email) return null;
  try {
    const records = await findRecords('Abonnés', `{Email} = "${email}"`, 1);
    return records.length > 0 ? records[0] : null;
  } catch (e) {
    console.warn('[Airtable] getSubscriberByEmail error:', e.message);
    return null;
  }
}

async function getAppointmentsByDate(date) {
  if (!isConfigured() || !date) return [];
  try {
    // date au format YYYY-MM-DD — filtrer par début de journée
    const formula = `AND(IS_AFTER({Date RDV}, "${date}T00:00:00.000Z"), IS_BEFORE({Date RDV}, "${date}T23:59:59.999Z"))`;
    return await findRecords('Rendez-vous', formula, 100);
  } catch (e) {
    console.warn('[Airtable] getAppointmentsByDate error:', e.message);
    return [];
  }
}

/**
 * Récupère les rappels SMS en attente pour des RDV dans les 24h prochaines
 */
async function getPendingReminders() {
  if (!isConfigured()) return [];
  try {
    const now = new Date();
    const in24h = new Date(now.getTime() + 24 * 60 * 60 * 1000);
    const formula = `AND(
      {Statut} = "en_attente",
      IS_AFTER({Date RDV}, "${now.toISOString()}"),
      IS_BEFORE({Date RDV}, "${in24h.toISOString()}")
    )`.replace(/\s+/g, ' ');
    return await findRecords('Rappels SMS', formula, 50);
  } catch (e) {
    console.warn('[Airtable] getPendingReminders error:', e.message);
    return [];
  }
}

// ─── STATUS ───────────────────────────────────────────────────────────────────

async function getStatus() {
  if (!isConfigured()) {
    return { configured: false, message: 'AIRTABLE_API_KEY ou AIRTABLE_BASE_ID manquant' };
  }
  try {
    const tables = Object.keys(TABLE_SCHEMAS);
    const stats = {};
    for (const table of tables) {
      await delay(200);
      try {
        const records = await findRecords(table, null, 1);
        // Pour avoir le vrai count, on fait une requête sans filtre avec pageSize mini
        const encoded = encodeURIComponent(table);
        const data = await airtableFetch(`${encoded}?pageSize=1`);
        stats[table] = data.offset ? '100+' : (data.records || []).length;
      } catch {
        stats[table] = 'erreur';
      }
    }
    return { configured: true, baseId: BASE_ID, tables: stats };
  } catch (e) {
    return { configured: true, baseId: BASE_ID, error: e.message };
  }
}

// ─── HELPERS INTERNES ─────────────────────────────────────────────────────────

function mapStripeStatus(status) {
  const map = {
    active: 'actif',
    canceled: 'annulé',
    cancelled: 'annulé',
    past_due: 'en_retard',
    incomplete: 'incomplet',
    trialing: 'actif',
  };
  return map[status] || 'incomplet';
}

function mapPaymentStatus(status) {
  const map = {
    succeeded: 'complété',
    completed: 'complété',
    refunded: 'remboursé',
    failed: 'échoué',
    pending: 'en_attente',
    requires_payment_method: 'en_attente',
  };
  return map[status] || 'en_attente';
}

function mapAppointmentStatus(status) {
  if (!status) return 'confirmé';
  const s = status.toUpperCase();
  if (s.includes('CANCEL')) return 'annulé';
  if (s.includes('COMPLET')) return 'complété';
  if (s.includes('NO_SHOW') || s.includes('NOSHOW')) return 'no_show';
  return 'confirmé';
}

function toIsoDate(value, isTimestamp = false) {
  if (!value) return null;
  try {
    if (isTimestamp && typeof value === 'number') {
      return new Date(value * 1000).toISOString().slice(0, 10);
    }
    if (typeof value === 'number' && value > 1e10) {
      // milliseconds timestamp
      return new Date(value).toISOString().slice(0, 10);
    }
    if (typeof value === 'number') {
      // seconds timestamp (Stripe)
      return new Date(value * 1000).toISOString().slice(0, 10);
    }
    return new Date(value).toISOString().slice(0, 10);
  } catch {
    return null;
  }
}

module.exports = {
  isConfigured,
  initializeBase,
  ensureTablesExist,
  createRecord,
  updateRecord,
  findRecords,
  deleteRecord,
  upsertSubscriber,
  upsertAppointment,
  upsertPayment,
  upsertHairProfile,
  logVisit,
  getSubscriberByEmail,
  getAppointmentsByDate,
  getPendingReminders,
  getStatus,
  delay,
};
