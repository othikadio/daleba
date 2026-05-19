/**
 * Twilio Auth Middleware — DALEBA Metacortex Point 203
 *
 * Validation cryptographique HMAC-SHA1 de la signature X-Twilio-Signature.
 * Rejette toute requête dont l'origine ne peut pas être vérifiée.
 *
 * Docs: https://www.twilio.com/docs/usage/webhooks/securing-your-webhooks
 */

'use strict';

const crypto = require('crypto');
const bus    = require('../services/event-bus');

// ─── VALIDATION HMAC-SHA1 [203] ───────────────────────────────────────────────

/**
 * Recalcule la signature attendue selon le protocole Twilio:
 * 1. Prendre l'URL complète de la requête
 * 2. Trier les paramètres POST alphabétiquement
 * 3. Concaténer URL + key + value (pour chaque param)
 * 4. HMAC-SHA1 avec AuthToken, base64
 */
function computeTwilioSignature(authToken, url, params = {}) {
  const sortedKeys = Object.keys(params).sort();
  const payload = sortedKeys.reduce((acc, key) => acc + key + params[key], url);
  return crypto.createHmac('sha1', authToken).update(payload).digest('base64');
}

function validateTwilioSignature(authToken, signature, url, params) {
  if (!signature || !authToken) return false;
  const expected = computeTwilioSignature(authToken, url, params);
  // timing-safe comparison [203]
  try {
    return crypto.timingSafeEqual(
      Buffer.from(signature),
      Buffer.from(expected)
    );
  } catch {
    return false;
  }
}

// ─── MIDDLEWARE EXPRESS [203] ─────────────────────────────────────────────────

function twilioAuthMiddleware(req, res, next) {
  const authToken = process.env.TWILIO_AUTH_TOKEN;

  // Mode développement — skip si pas de token ou pas en prod [203]
  if (!authToken || process.env.NODE_ENV !== 'production') {
    req.twilioValidated = false;
    req.twilioSkipped   = true;
    return next();
  }

  const signature = req.headers['x-twilio-signature'];
  if (!signature) {
    bus.system('🔴 [TwilioAuth] Requête rejetée — X-Twilio-Signature absente');
    return res.status(403).type('text/xml').send(
      '<Response><Say language="fr-CA">Accès refusé.</Say></Response>'
    );
  }

  // Reconstituer l'URL exacte que Twilio a utilisée pour signer
  const proto   = req.headers['x-forwarded-proto'] || req.protocol;
  const host    = req.headers['x-forwarded-host'] || req.hostname;
  const fullUrl = process.env.DALEBA_BASE_URL
    ? `${process.env.DALEBA_BASE_URL}${req.originalUrl}`
    : `${proto}://${host}${req.originalUrl}`;

  const isValid = validateTwilioSignature(authToken, signature, fullUrl, req.body || {});

  if (!isValid) {
    bus.system(`🔴 [TwilioAuth] REQUÊTE REJETÉE — signature invalide | IP: ${req.ip} | URL: ${req.originalUrl}`);
    return res.status(403).type('text/xml').send(
      '<Response><Say language="fr-CA">Requête non autorisée.</Say></Response>'
    );
  }

  req.twilioValidated = true;
  req.twilioUrl       = fullUrl;
  next();
}

// ─── EXPORTS ─────────────────────────────────────────────────────────────────

module.exports = {
  twilioAuthMiddleware,
  validateTwilioSignature,
  computeTwilioSignature,
};
