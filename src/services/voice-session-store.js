/**
 * Voice Session Store — DALEBA Metacortex Points 227-229, 270
 *
 * [227] Call Concurrency Handler — 50 flux parallèles, zéro fuite de contexte
 * [228] State Machine par CallSid — cache mémoire Redis-compatible (Map volatilisable)
 * [229] État: étape, customer_id, service_id, historique phrases
 * [270] Isolation totale: jamais de mutualisation de sessions vocales entre tenants.
 */

'use strict';

// ─── [270] TENANT-ISOLATED SESSION MAP ────────────────────────────────────────
// Isolation totale [270]: jamais de mutualisation de sessions vocales entre tenants.
// key: tenantId:callSid

const _sessions = new Map(); // key: tenantId:callSid

// ─── [270] TENANT-ISOLATED API ────────────────────────────────────────────────

/**
 * Retourne la session vocale isolée par tenantId [270]
 */
function getSession(callSid, tenantId) {
  return _sessions.get(`${tenantId}:${callSid}`) || null;
}

/**
 * Stocke avec clé tenantId:callSid [270]
 */
function setSession(callSid, tenantId, data) {
  _sessions.set(`${tenantId}:${callSid}`, { ...data, callSid, tenantId, updatedAt: Date.now() });
}

/**
 * Supprime une session [270]
 */
function deleteSession(callSid, tenantId) {
  _sessions.delete(`${tenantId}:${callSid}`);
}

/**
 * Retourne toutes les sessions du tenant (jamais cross-tenant) [270]
 */
function getAllSessions(tenantId) {
  const prefix = `${tenantId}:`;
  const result = [];
  for (const [key, val] of _sessions.entries()) {
    if (key.startsWith(prefix)) result.push(val);
  }
  return result;
}

/**
 * Purge toutes les sessions d'un tenant [270]
 */
function clearTenantSessions(tenantId) {
  const prefix = `${tenantId}:`;
  for (const key of _sessions.keys()) {
    if (key.startsWith(prefix)) _sessions.delete(key);
  }
}

// ─── [227] CONCURRENCY LIMITER ────────────────────────────────────────────────

const MAX_CONCURRENT_CALLS = 50;

// ─── [228] STORE MÉMOIRE ISOLÉ PAR CallSid ────────────────────────────────────

const _store = new Map(); // CallSid → DialogState

// Étapes possibles [229]
const STEPS = {
  WELCOME:           'WELCOME',
  AWAITING_SERVICE:  'AWAITING_SERVICE',
  AWAITING_DATE:     'AWAITING_DATE',
  CONFIRMING:        'CONFIRMING',
  BOOKING_CONFIRM:   'BOOKING_CONFIRM',
  IDENTITY_FIRSTNAME:'IDENTITY_FIRSTNAME',
  IDENTITY_LASTNAME: 'IDENTITY_LASTNAME',
  IDENTITY_CONFIRM:  'IDENTITY_CONFIRM',
  OTP_VERIFY:        'OTP_VERIFY',
  MODIFICATION:      'MODIFICATION',
  CANCELLATION:      'CANCELLATION',
  ESCALATED:         'ESCALATED',
  ENDED:             'ENDED',
};

// ─── [228] CRÉER / LIRE / MAJ ÉTAT ───────────────────────────────────────────

/**
 * Initialise un état de dialogue pour un nouvel appel [228]
 */
function createSession(callSid, opts = {}) {
  if (_store.size >= MAX_CONCURRENT_CALLS) {
    // [227] Refuser si capacité atteinte
    throw new Error(`[VoiceSession] Capacité maximale atteinte (${MAX_CONCURRENT_CALLS} appels)`);
  }

  const session = {
    callSid,
    createdAt:   Date.now(),
    updatedAt:   Date.now(),
    // [229] Champs obligatoires
    step:           STEPS.WELCOME,
    customerId:     opts.customerId     || null,
    customerName:   opts.customerName   || null,
    phoneNumber:    opts.from           || null,
    serviceId:      opts.serviceId      || null,
    serviceName:    opts.serviceName    || null,
    slotStartAt:    opts.slotStartAt    || null,
    slotLabel:      opts.slotLabel      || null,
    bookingId:      opts.bookingId      || null,
    tenantId:       opts.tenantId       || 'kadio',
    tenantName:     opts.tenantName     || 'Kadio Coiffure',
    // [229] Historique complet des phrases
    history: [],
    // Retry counter [230]
    emptyRetries:   0,
    // OTP [221]
    otpCode:        null,
    otpExpiry:      null,
    otpPurpose:     null,
    // Available slots [212-214]
    availableSlots: [],
    // Frustration tracking [223]
    frustrationScore:    0,
    frustrationHistory:  [],
    // Extra data
    meta: {},
    ...opts,
  };

  _store.set(callSid, session);
  return session;
}

/**
 * Récupère la session ou la crée si absente [228]
 */
function getOrCreate(callSid, opts = {}) {
  if (_store.has(callSid)) return _store.get(callSid);
  return createSession(callSid, opts);
}

/**
 * Met à jour l'état d'une session [228]
 */
function update(callSid, patch = {}) {
  const session = _store.get(callSid);
  if (!session) return null;
  Object.assign(session, patch, { updatedAt: Date.now() });
  return session;
}

/**
 * Ajoute une phrase à l'historique [229]
 */
function addToHistory(callSid, role, text) {
  const session = _store.get(callSid);
  if (!session) return;
  session.history.push({ role, text, ts: Date.now() });
  // Garder max 20 entrées (mémoire)
  if (session.history.length > 20) session.history.shift();
  session.updatedAt = Date.now();
}

/**
 * Ferme et détruit la session [227] — libère la slot de concurrence
 */
function closeSession(callSid) {
  const session = _store.get(callSid);
  if (session) {
    session.step = STEPS.ENDED;
    // Cleanup après 30s (logs)
    setTimeout(() => _store.delete(callSid), 30000);
  }
}

/**
 * Métriques de concurrence [227]
 */
function getConcurrencyStats() {
  return {
    active:  _store.size,
    max:     MAX_CONCURRENT_CALLS,
    usagePct: _store.size > 0 ? Math.round((_store.size / MAX_CONCURRENT_CALLS) * 100) : 0,
    calls:   Array.from(_store.keys()),
  };
}

// ─── EXPORTS ─────────────────────────────────────────────────────────────────

module.exports = {
  // [270] Tenant-isolated API
  getSession,
  setSession,
  deleteSession,
  getAllSessions,
  clearTenantSessions,
  // Legacy API [227-229]
  STEPS,
  createSession,
  getOrCreate,
  update,
  addToHistory,
  closeSession,
  getConcurrencyStats,
  MAX_CONCURRENT_CALLS,
};
