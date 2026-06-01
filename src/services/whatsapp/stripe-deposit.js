'use strict';
/**
 * DALEBA WhatsApp Salon — Stripe Deposit 20%
 * Génère un Payment Link Stripe pour le dépôt de sécurité
 */
const Stripe = require('stripe');

const stripe = process.env.STRIPE_SECRET_KEY ? new Stripe(process.env.STRIPE_SECRET_KEY) : null;
const BASE_URL = process.env.API_BASE_URL || 'https://daleba-api-production.up.railway.app';
const SUCCESS_URL = 'https://kadiocoiffure.vercel.app/hub?rdv=confirme';
const CANCEL_URL  = 'https://kadiocoiffure.vercel.app/hub?rdv=annule';

const DEPOSIT_PCT = 0.20; // 20%

/**
 * Crée un lien de paiement Stripe pour le dépôt de 20%
 * @param {object} opts
 * @param {number} opts.servicePriceCents  - Prix du service en cents (ex: 8000 = $80.00)
 * @param {string} opts.serviceName        - Nom du service
 * @param {string} opts.phone              - Numéro WhatsApp client
 * @param {string} opts.bookingRef         - Référence RDV (bookingId Square ou uuid)
 * @param {string} opts.clientName         - Nom du client
 * @returns {{ url, depositCents, depositDollars, paymentLinkId }}
 */
async function createDepositLink({ servicePriceCents, serviceName, phone, bookingRef, clientName }) {
  if (!stripe) throw new Error('Stripe non configuré — STRIPE_SECRET_KEY manquant');

  const depositCents   = Math.round(servicePriceCents * DEPOSIT_PCT);
  const depositDollars = (depositCents / 100).toFixed(2);
  const totalDollars   = (servicePriceCents / 100).toFixed(2);

  // Payment Link Stripe (checkout sans abonnement, lien unique)
  const link = await stripe.paymentLinks.create({
    line_items: [{
      price_data: {
        currency: 'cad',
        product_data: {
          name: `Dépôt de sécurité — ${serviceName}`,
          description: `Dépôt de 20% requis pour confirmer votre rendez-vous chez Kadio Coiffure. Total du service : $${totalDollars} CAD. Solde restant ($${(servicePriceCents / 100 * 0.8).toFixed(2)} CAD) payable en salon.`,
          images: [],
        },
        unit_amount: depositCents,
      },
      quantity: 1,
    }],
    metadata: {
      phone,
      booking_ref: bookingRef,
      client_name: clientName || '',
      service_name: serviceName,
      deposit_pct: '20',
      total_cents: String(servicePriceCents),
    },
    after_completion: {
      type: 'redirect',
      redirect: { url: SUCCESS_URL + `&ref=${bookingRef}` },
    },
    payment_method_types: ['card'],
    invoice_creation: { enabled: false },
    allow_promotion_codes: false,
    phone_number_collection: { enabled: false },
  });

  return {
    url:           link.url,
    depositCents,
    depositDollars,
    totalDollars,
    paymentLinkId: link.id,
  };
}

/**
 * Vérifie si un Payment Link a été payé (polling)
 */
async function isDepositPaid(paymentLinkId) {
  if (!stripe) return false;
  try {
    const sessions = await stripe.checkout.sessions.list({ payment_link: paymentLinkId, limit: 5 });
    return sessions.data.some(s => s.payment_status === 'paid');
  } catch(_) { return false; }
}

/**
 * Extrait les métadonnées d'un Payment Intent (appelé depuis le webhook Stripe)
 */
function extractDepositMeta(paymentIntent) {
  return {
    phone:      paymentIntent.metadata?.phone,
    bookingRef: paymentIntent.metadata?.booking_ref,
    clientName: paymentIntent.metadata?.client_name,
    depositPct: paymentIntent.metadata?.deposit_pct,
    totalCents: parseInt(paymentIntent.metadata?.total_cents || '0'),
  };
}

module.exports = { createDepositLink, isDepositPaid, extractDepositMeta, DEPOSIT_PCT };
