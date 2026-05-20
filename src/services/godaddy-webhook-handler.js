'use strict';
/**
 * GoDaddy Payments Webhook Handler — DALEBA Section 14 [Option B]
 * ──────────────────────────────────────────────────────────────
 * Reçoit les webhooks natifs GoDaddy Payments (Poynt v2).
 * Vérification de signature HMAC-SHA256 obligatoire.
 * Normalise → tenant_ledgers + EventBus.
 *
 * CONFIG MARCHANDE (une seule fois dans le dashboard Poynt) :
 *   1. Login → business.poynt.net → Settings → Webhooks
 *   2. Add Webhook URL: https://<ton-domaine>/api/v1/webhooks/godaddy
 *   3. Secret: valeur de GODADDY_WEBHOOK_SECRET (générer avec openssl rand -hex 32)
 *   4. Events: TRANSACTION_CAPTURED, TRANSACTION_REFUNDED, TRANSACTION_VOIDED
 *
 * ENV REQUIS:
 *   GODADDY_WEBHOOK_SECRET  → secret partagé pour vérification signature
 */
const crypto = require('crypto');
const bus    = require('./event-bus');

const WEBHOOK_SECRET = () => process.env.GODADDY_WEBHOOK_SECRET || '';

// ── Événements supportés ──────────────────────────────────────
const SUPPORTED_EVENTS = new Set([
  'TRANSACTION_CAPTURED',
  'TRANSACTION_AUTHORIZED',
  'TRANSACTION_REFUNDED',
  'TRANSACTION_VOIDED',
  'TRANSACTION_DECLINED',
  'ORDER_COMPLETED',
  'ORDER_UPDATED',
]);

// ── Vérification signature ────────────────────────────────────
/**
 * Vérifie la signature HMAC-SHA256 du payload GoDaddy
 * Header: X-Poynt-Signature ou X-GoDaddy-Signature
 */
function verifySignature(rawBody, signatureHeader) {
  const secret = WEBHOOK_SECRET();
  if (!secret) {
    bus.system('[GDWebhook] ⚠️ GODADDY_WEBHOOK_SECRET non configuré — signature non vérifiée');
    return true; // Permissif si secret pas encore configuré (setup initial)
  }
  if (!signatureHeader) {
    bus.system('[GDWebhook] ❌ Signature absente');
    return false;
  }

  // GoDaddy envoie: sha256=<hmac_hex>
  const sigValue = signatureHeader.replace(/^sha256=/, '');
  const expected = crypto
    .createHmac('sha256', secret)
    .update(typeof rawBody === 'string' ? rawBody : JSON.stringify(rawBody))
    .digest('hex');

  const valid = crypto.timingSafeEqual(
    Buffer.from(sigValue.toLowerCase(), 'hex').slice(0, 32),
    Buffer.from(expected.toLowerCase(), 'hex').slice(0, 32),
  );

  if (!valid) bus.system(`[GDWebhook] ❌ Signature invalide — sig: ${sigValue.slice(0,8)}...`);
  return valid;
}

// ── Normalisation événements ──────────────────────────────────
/**
 * Normalise un événement GoDaddy Payments → format DALEBA standard
 */
function normalizeEvent(event) {
  const tx = event.transaction || event.data?.transaction || event;

  // Montants: GoDaddy envoie en centimes (USD) ou CAD x100
  const grossCents = tx.amounts?.transactionAmount || tx.amount  || 0;
  const tipCents   = tx.amounts?.tipAmount         || tx.tip     || 0;
  const taxCents   = tx.amounts?.taxAmount         || tx.tax     || 0;
  const gross      = Math.round(grossCents) / 100;
  const tip        = Math.round(tipCents)   / 100;
  const tax        = Math.round(taxCents)   / 100;
  const net        = Math.round((gross - tip - tax) * 100) / 100;

  const eventType  = event.eventType || event.type || 'UNKNOWN';
  const isRefund   = eventType.includes('REFUND') || gross < 0;
  const isVoid     = eventType.includes('VOID');

  const card = tx.fundingSource?.card || {};

  return {
    externalId:   tx.id || tx.transactionId || `gd-${Date.now()}`,
    source:      'godaddy_webhook',
    eventType,
    status:       isRefund ? 'refunded' : isVoid ? 'voided' : 'captured',
    amountGross:  isRefund ? -Math.abs(gross) : gross,
    amountNet:    isRefund ? -Math.abs(net)   : net,
    amountTip:    tip,
    amountTax:    tax,
    currency:     tx.amounts?.currency || 'CAD',
    description:  tx.notes || tx.context?.sourceApp || `GoDaddy ${eventType}`,
    cardBrand:    card.type   || card.cardBrand || '',
    last4:        card.numberLast4 || '',
    txDate:       tx.createdAt || tx.updatedAt || new Date().toISOString(),
    businessId:   event.businessId || tx.businessId || '',
    storeId:      event.storeId    || tx.storeId    || '',
    rawEvent:     event,
  };
}

// ── Handler principal ─────────────────────────────────────────
/**
 * Traite un webhook GoDaddy Payments
 * Appelé depuis express route (rawBody déjà extrait)
 */
async function handleWebhook(pool, rawBody, headers) {
  const sig = headers['x-poynt-signature'] || headers['x-godaddy-signature'] || headers['x-webhook-signature'] || '';

  // Vérification signature
  if (!verifySignature(rawBody, sig)) {
    return { success: false, error: 'INVALID_SIGNATURE', code: 401 };
  }

  const event = typeof rawBody === 'string' ? JSON.parse(rawBody) : rawBody;
  const eventType = event.eventType || event.type || '';

  bus.system(`[GDWebhook] 📥 Événement reçu: ${eventType}`);

  // Ignorer événements non supportés
  if (!SUPPORTED_EVENTS.has(eventType)) {
    bus.system(`[GDWebhook] 📋 Événement ignoré: ${eventType}`);
    return { success: true, ignored: true, eventType };
  }

  const tx = normalizeEvent(event);

  // Persister dans tenant_ledgers
  let persisted = false;
  if (pool?.query) {
    try {
      const res = await pool.query(`
        INSERT INTO tenant_ledgers
          (tenant_id, external_id, source, amount_gross, amount_net,
           currency, description, status, tx_date)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
        ON CONFLICT (tenant_id, external_id) DO UPDATE
          SET status=$8, amount_gross=$4, amount_net=$5, updated_at=NOW()
      `, [
        'godaddy', tx.externalId, tx.source,
        tx.amountGross, tx.amountNet,
        tx.currency, tx.description,
        tx.status, tx.txDate,
      ]);
      persisted = res.rowCount > 0;
    } catch(e) {
      bus.system(`[GDWebhook] ⚠️ DB erreur: ${e.message}`);
    }
  }

  // Émettre sur l'Event Bus DALEBA
  const busEvent = `godaddy:${eventType.toLowerCase()}`;
  bus.emit(busEvent, { ...tx, persisted });

  // Événements spéciaux → alertes supplémentaires
  if (eventType === 'TRANSACTION_CAPTURED' && tx.amountGross >= 150) {
    bus.emit('payment:high_value', { amount: tx.amountGross, source: 'godaddy', txId: tx.externalId });
  }
  if (eventType === 'TRANSACTION_REFUNDED') {
    bus.emit('payment:refund', { amount: tx.amountGross, source: 'godaddy', txId: tx.externalId });
  }

  bus.system(`[GDWebhook] ✅ ${eventType} | ${tx.amountGross.toFixed(2)} $${tx.currency} | net: ${tx.amountNet.toFixed(2)} $ | persisted: ${persisted}`);

  return {
    success:   true,
    eventType,
    txId:      tx.externalId,
    amountNet: tx.amountNet,
    persisted,
  };
}

/**
 * Instructions de configuration (affichées dans le HUD)
 */
function getSetupInstructions(baseUrl) {
  const url = `${baseUrl || 'https://daleba-api-production.up.railway.app'}/api/v1/webhooks/godaddy`;
  return {
    webhookUrl:   url,
    steps: [
      '1. Login sur business.poynt.net',
      '2. Settings → Webhooks → Add Webhook',
      `3. URL: ${url}`,
      '4. Secret: valeur de GODADDY_WEBHOOK_SECRET (Railway env vars)',
      '5. Events: TRANSACTION_CAPTURED, TRANSACTION_REFUNDED, TRANSACTION_VOIDED',
      '6. Save → Test Webhook → vérifier status 200 dans DALEBA logs',
    ],
    requiredEnvVar: 'GODADDY_WEBHOOK_SECRET',
    generate:       'openssl rand -hex 32',
  };
}

module.exports = { handleWebhook, verifySignature, normalizeEvent, getSetupInstructions, SUPPORTED_EVENTS };
