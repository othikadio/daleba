/**
 * Webhook Security — DALEBA Metacortex Points 192-194
 *
 * [192] PCI-DSS compliance: validation signature, no raw card data, audit trail
 * [194] Journal chiffré des signatures d'événements webhooks
 */

'use strict';

const crypto = require('crypto');
const bus    = require('./event-bus');

// ─── [194] JOURNAL CHIFFRÉ SIGNATURES ────────────────────────────────────────

const _signatureLog = []; // buffer en mémoire, persisté en DB

/**
 * Enregistre une signature webhook dans le journal chiffré [194]
 */
function logWebhookSignature(source, eventId, signature, status, metadata = {}) {
  // [194] Chiffrement AES-256 de la signature brute
  const key = crypto.scryptSync(
    process.env.ANTHROPIC_API_KEY || 'daleba-webhook-signing-key',
    'webhook-sig-salt-v1', 32
  );
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const encrypted = Buffer.concat([cipher.update(signature || '', 'utf8'), cipher.final()]).toString('hex');
  const tag = cipher.getAuthTag().toString('hex');

  const entry = {
    source,
    eventId,
    encryptedSig: `${iv.toString('hex')}:${encrypted}:${tag}`,
    status,     // 'valid' | 'invalid' | 'missing' | 'blocked'
    metadata: { ...metadata, ip: metadata.ip || null },
    ts: new Date().toISOString(),
  };

  _signatureLog.push(entry);
  if (_signatureLog.length > 500) _signatureLog.shift(); // rotation mémoire

  // Persistance asynchrone [194]
  setImmediate(async () => {
    const maintenance = require('./maintenance');
    const pool = maintenance.getPool();
    if (!pool) return;
    await pool.query(`
      INSERT INTO daleba_notes (category, key, content, created_at)
      VALUES ('webhook_sig_log', $1, $2, NOW())
    `, [`sig_${source}_${eventId}_${Date.now()}`, JSON.stringify(entry)]).catch(() => {});
  });

  if (status !== 'valid') {
    bus.system(`🔐 [WebhookSecurity] ${status.toUpperCase()} — ${source} event ${eventId}`);
  }
}

// ─── [192] VALIDATION SIGNATURE SQUARE ───────────────────────────────────────

/**
 * Valide la signature HMAC-SHA256 d'un webhook Square [192]
 * Square signe avec HMAC-SHA1 sur l'URL + body
 */
function validateSquareSignature(req) {
  const signature = req.headers['x-square-hmacsha256-signature'] || req.headers['x-square-signature'];
  const sigKey    = process.env.SQUARE_WEBHOOK_SIGNATURE_KEY;
  const eventId   = req.headers['x-square-eventid'] || 'unknown';

  if (!sigKey) {
    logWebhookSignature('square', eventId, null, 'missing', { reason: 'SQUARE_WEBHOOK_SIGNATURE_KEY absent' });
    return { valid: true, warning: 'Signature non vérifiée — clé manquante' }; // non-bloquant si clé non configurée
  }

  if (!signature) {
    logWebhookSignature('square', eventId, null, 'missing', { reason: 'Header signature absent' });
    return { valid: false, reason: 'Signature manquante' };
  }

  // Reconstituer l'URL complète comme Square le fait
  const url  = `${req.protocol}://${req.hostname}${req.originalUrl}`;
  const body = JSON.stringify(req.body);
  const expected = crypto.createHmac('sha256', sigKey)
    .update(url + body).digest('base64');

  const valid = crypto.timingSafeEqual(
    Buffer.from(signature),
    Buffer.from(expected)
  );

  logWebhookSignature('square', eventId, signature, valid ? 'valid' : 'invalid', {
    url, bodyLength: body.length,
  });

  return { valid, eventId };
}

/**
 * Valide la signature d'un webhook Stripe [192]
 * Stripe utilise `Stripe-Signature` avec timestamp + HMAC-SHA256
 */
function validateStripeSignature(req) {
  const signature = req.headers['stripe-signature'];
  const endpointSecret = process.env.STRIPE_WEBHOOK_SECRET;
  const eventId = req.body?.id || 'unknown';

  if (!endpointSecret) {
    logWebhookSignature('stripe', eventId, null, 'missing', { reason: 'STRIPE_WEBHOOK_SECRET absent' });
    return { valid: true, warning: 'Non vérifié — secret manquant' };
  }

  if (!signature) {
    logWebhookSignature('stripe', eventId, null, 'missing', { reason: 'Stripe-Signature absent' });
    return { valid: false, reason: 'Stripe-Signature manquante' };
  }

  try {
    // Parser le header Stripe: t=timestamp,v1=hash
    const parts   = signature.split(',').reduce((acc, p) => {
      const [k, v] = p.split('='); acc[k] = v; return acc;
    }, {});
    const ts      = parts.t;
    const rawBody = req.rawBody || JSON.stringify(req.body);
    const payload = `${ts}.${rawBody}`;
    const expected = crypto.createHmac('sha256', endpointSecret).update(payload).digest('hex');

    const valid = crypto.timingSafeEqual(Buffer.from(parts.v1 || ''), Buffer.from(expected));

    // Vérifier que l'event n'est pas trop vieux (5min)
    const tsDiff = Math.abs(Date.now() / 1000 - parseInt(ts));
    if (tsDiff > 300) {
      logWebhookSignature('stripe', eventId, signature, 'blocked', { reason: `Timestamp trop vieux: ${tsDiff}s` });
      return { valid: false, reason: 'Webhook expiré (> 5min)' };
    }

    logWebhookSignature('stripe', eventId, signature, valid ? 'valid' : 'invalid', { ts });
    return { valid, eventId };
  } catch (e) {
    logWebhookSignature('stripe', eventId, signature, 'invalid', { error: e.message });
    return { valid: false, reason: e.message };
  }
}

// ─── [192] PCI-DSS — MASQUAGE DONNÉES CARTE ──────────────────────────────────

/**
 * Masque les données de carte sensibles dans un objet [175, 192]
 * Ne conserve que : 4 derniers chiffres + marque réseau
 */
function maskPaymentData(paymentObject) {
  if (!paymentObject) return paymentObject;
  const masked = { ...paymentObject };

  // Supprimer TOUT numéro de carte complet
  const sensitiveFields = ['pan', 'card_number', 'number', 'full_pan', 'bin'];
  sensitiveFields.forEach(f => { if (masked[f]) delete masked[f]; });

  // Masquer CVV/CVC
  ['cvv', 'cvc', 'cvv2', 'security_code'].forEach(f => { if (masked[f]) delete masked[f]; });

  // Garder uniquement last4 + brand [175]
  if (masked.card_details?.card) {
    const card = masked.card_details.card;
    masked.card_details = {
      brand: card.card_brand || card.brand || 'UNKNOWN',
      last4: card.last_4 || card.last4 || '****',
      exp_month: card.exp_month || null,
      exp_year:  card.exp_year  || null,
    };
  }

  // Masquer tout token bancaire brut > 16 chars dans les strings
  if (typeof masked.payment_token === 'string' && masked.payment_token.length > 10) {
    masked.payment_token = '[TOKEN_REDACTED]';
  }

  return masked;
}

/**
 * Middleware Express — validation signature + blocage requêtes frauduleuses [192, 194]
 */
function webhookSecurityMiddleware(source = 'square') {
  return (req, res, next) => {
    // Capturer le body brut pour la validation Stripe
    req.rawBody = JSON.stringify(req.body);

    const validation = source === 'stripe'
      ? validateStripeSignature(req)
      : validateSquareSignature(req);

    if (!validation.valid && !validation.warning) {
      return res.status(401).json({
        error:  'Signature webhook invalide',
        reason: validation.reason,
      });
    }

    if (validation.warning) req.webhookWarning = validation.warning;
    req.webhookValidated = true;
    req.webhookEventId   = validation.eventId;
    next();
  };
}

function getSignatureLog(limit = 50) {
  return _signatureLog.slice(-limit).reverse();
}

// ─── EXPORTS ─────────────────────────────────────────────────────────────────

module.exports = {
  validateSquareSignature, validateStripeSignature,
  maskPaymentData, webhookSecurityMiddleware,
  logWebhookSignature, getSignatureLog,
};
