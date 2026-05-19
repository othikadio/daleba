'use strict';
/**
 * Loyalty Phone Mask — DALEBA Metacortex Point 445
 * Masquage téléphone sur toutes les routes publiques du module fidélité.
 */

/**
 * +15141234567 → +1514***4567
 */
function maskPhone(phone) {
  if (!phone) return null;
  const s = phone.replace(/\s/g, '');
  if (s.length < 7) return '***';
  return s.slice(0, 4) + '***' + s.slice(-4);
}

/**
 * Masque récursivement tous les champs téléphone d'un objet/tableau
 */
function maskPhoneInObject(obj) {
  if (!obj || typeof obj !== 'object') return obj;
  if (Array.isArray(obj)) return obj.map(maskPhoneInObject);
  const out = {};
  for (const [k, v] of Object.entries(obj)) {
    if (['phone', 'customer_phone', 'referrer_phone', 'referee_phone', 'to'].includes(k) && typeof v === 'string') {
      out[k] = maskPhone(v);
    } else if (typeof v === 'object' && v !== null) {
      out[k] = maskPhoneInObject(v);
    } else {
      out[k] = v;
    }
  }
  return out;
}

/** Middleware Express pour masquer les téléphones dans les réponses JSON publiques */
function maskPhoneMiddleware(req, res, next) {
  const originalJson = res.json.bind(res);
  res.json = (body) => originalJson(maskPhoneInObject(body));
  next();
}

module.exports = { maskPhone, maskPhoneInObject, maskPhoneMiddleware };
