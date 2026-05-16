/**
 * DALEBA — Service Stripe
 * Gestion des paiements : acomptes RDV, abonnements, webhooks
 */

const Stripe = require('stripe');

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);
const WEBHOOK_SECRET = process.env.STRIPE_WEBHOOK_SECRET;

/**
 * Crée une session de paiement Checkout (acompte ou paiement complet)
 * @param {Object} options
 * @param {string} options.clientName - Nom du client
 * @param {string} options.clientEmail - Email du client
 * @param {number} options.amount - Montant en cents (ex: 2500 = 25.00 CAD)
 * @param {string} options.description - Description du service
 * @param {string} options.sessionId - ID de session DALEBA
 * @param {string} options.successUrl - URL de redirection succès
 * @param {string} options.cancelUrl - URL de redirection annulation
 */
async function createCheckoutSession({
  clientName,
  clientEmail,
  amount,
  description,
  sessionId,
  successUrl = process.env.STRIPE_SUCCESS_URL || 'https://kadiocoiffure.com/confirmation',
  cancelUrl = process.env.STRIPE_CANCEL_URL || 'https://kadiocoiffure.com/annulation',
}) {
  const session = await stripe.checkout.sessions.create({
    payment_method_types: ['card'],
    customer_email: clientEmail,
    line_items: [
      {
        price_data: {
          currency: 'cad',
          product_data: {
            name: description || 'Kadio Coiffure — Réservation',
            description: `Réservation pour ${clientName}`,
          },
          unit_amount: amount,
        },
        quantity: 1,
      },
    ],
    mode: 'payment',
    success_url: `${successUrl}?session_id={CHECKOUT_SESSION_ID}`,
    cancel_url: cancelUrl,
    metadata: {
      daleba_session_id: sessionId || '',
      client_name: clientName,
    },
  });

  return {
    checkoutUrl: session.url,
    stripeSessionId: session.id,
    amount,
    currency: 'cad',
  };
}

/**
 * Crée un abonnement récurrent (forfait mensuel)
 * @param {Object} options
 * @param {string} options.clientEmail
 * @param {string} options.priceId - ID du Price Stripe (créé dans le dashboard)
 * @param {string} options.successUrl
 * @param {string} options.cancelUrl
 */
async function createSubscription({ clientEmail, priceId, successUrl, cancelUrl }) {
  const session = await stripe.checkout.sessions.create({
    payment_method_types: ['card'],
    customer_email: clientEmail,
    line_items: [{ price: priceId, quantity: 1 }],
    mode: 'subscription',
    success_url: successUrl || process.env.STRIPE_SUCCESS_URL,
    cancel_url: cancelUrl || process.env.STRIPE_CANCEL_URL,
  });

  return {
    checkoutUrl: session.url,
    stripeSessionId: session.id,
  };
}

/**
 * Vérifie et parse un webhook Stripe (signature sécurisée)
 * À utiliser dans le endpoint POST /api/payment/webhook
 * @param {Buffer} rawBody - Corps brut de la requête (pas parsé en JSON)
 * @param {string} signature - Header stripe-signature
 */
function parseWebhook(rawBody, signature) {
  return stripe.webhooks.constructEvent(rawBody, signature, WEBHOOK_SECRET);
}

/**
 * Récupère le détail d'une session Checkout
 */
async function getSession(stripeSessionId) {
  return stripe.checkout.sessions.retrieve(stripeSessionId);
}

/**
 * Rembourse un paiement
 * @param {string} paymentIntentId
 * @param {number} amount - Montant en cents (optionnel, remboursement total si omis)
 */
async function refund(paymentIntentId, amount) {
  const params = { payment_intent: paymentIntentId };
  if (amount) params.amount = amount;
  return stripe.refunds.create(params);
}

module.exports = {
  createCheckoutSession,
  createSubscription,
  parseWebhook,
  getSession,
  refund,
};
