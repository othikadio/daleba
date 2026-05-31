/**
 * DALEBA — Service Stripe
 * Gestion des paiements : acomptes RDV, abonnements, webhooks
 */

const Stripe = require('stripe');

const stripe = process.env.STRIPE_SECRET_KEY
  ? new Stripe(process.env.STRIPE_SECRET_KEY)
  : null;
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
  successUrl = process.env.STRIPE_SUCCESS_URL || 'https://kadiocoiffure.vercel.app/hub/hub',
  cancelUrl = process.env.STRIPE_CANCEL_URL || 'https://kadiocoiffure.vercel.app/hub/hub',
}) {
  if (!stripe) throw new Error('Stripe non configuré — ajoutez STRIPE_SECRET_KEY');
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

/**
 * Crée une session Stripe Customer Portal (autogestion carte + forfait)
 * @param {string} customerId - Stripe Customer ID (cus_xxx)
 * @param {string} returnUrl - URL de retour après fermeture du portail
 */
async function createCustomerPortalSession(customerId, returnUrl) {
  if (!stripe) throw new Error('Stripe non configuré — ajoutez STRIPE_SECRET_KEY');
  const session = await stripe.billingPortal.sessions.create({
    customer: customerId,
    return_url: returnUrl || 'https://kadiocoiffure.vercel.app/hub',
  });
  return { portalUrl: session.url };
}

/**
 * Trouve ou crée un customer Stripe par email, puis génère son lien portail
 * @param {string} email
 * @param {string} returnUrl
 */
async function getPortalLinkByEmail(email, returnUrl) {
  if (!stripe) throw new Error('Stripe non configuré — ajoutez STRIPE_SECRET_KEY');
  // Cherche client existant
  const customers = await stripe.customers.list({ email, limit: 1 });
  let customer;
  if (customers.data.length > 0) {
    customer = customers.data[0];
  } else {
    // Crée le client s'il n'existe pas encore
    customer = await stripe.customers.create({ email });
  }
  return createCustomerPortalSession(customer.id, returnUrl);
}

/**
 * Liste tous les abonnements actifs/annulés avec info client
 * @param {Object} options
 * @param {string} options.status - 'active' | 'canceled' | 'past_due' | 'all'
 * @param {number} options.limit - max 100
 */
async function listSubscriptions({ status = 'all', limit = 100 } = {}) {
  if (!stripe) throw new Error('Stripe non configuré — ajoutez STRIPE_SECRET_KEY');
  const params = { limit, expand: ['data.customer', 'data.default_payment_method', 'data.items.data.price'] };
  if (status !== 'all') params.status = status;
  const subs = await stripe.subscriptions.list(params);
  // Collecter les IDs produit uniques pour les résoudre en un batch
  const productIds = [...new Set(subs.data
    .map(s => s.items.data[0]?.price?.product)
    .filter(id => id && typeof id === 'string')
  )];
  const productNames = {};
  await Promise.all(productIds.map(async pid => {
    try {
      const prod = await stripe.products.retrieve(pid);
      productNames[pid] = prod.name;
    } catch(e) { /* silencieux */ }
  }));
  return subs.data.map(sub => {
    const cust = sub.customer;
    const item = sub.items.data[0];
    const price = item?.price;
    const productId = typeof price?.product === 'string' ? price.product : null;
    const planName = productNames[productId]
                  || price?.nickname
                  || price?.id
                  || 'Plan';
    return {
      id: sub.id,
      status: sub.status,
      customerId: typeof cust === 'string' ? cust : cust.id,
      customerName: typeof cust === 'object' ? (cust.name || cust.email || cust.id) : cust,
      customerEmail: typeof cust === 'object' ? cust.email : null,
      plan: planName,
      amount: sub.items.data[0]?.price?.unit_amount
        ? (sub.items.data[0].price.unit_amount / 100).toFixed(2)
        : null,
      currency: sub.items.data[0]?.price?.currency?.toUpperCase() || 'CAD',
      currentPeriodStart: sub.current_period_start,
      currentPeriodEnd: sub.current_period_end,
      createdAt: sub.created,
      cancelAtPeriodEnd: sub.cancel_at_period_end,
    };
  });
}

/**
 * Détails complets d'un abonnement Stripe
 * Inclut : plan, prix, dernière facture, prochain renouvellement, historique paiements
 * @param {string} subscriptionId
 */
async function getSubscriptionDetails(subscriptionId) {
  if (!stripe) throw new Error('Stripe non configuré');

  const sub = await stripe.subscriptions.retrieve(subscriptionId, {
    expand: [
      'customer',
      'default_payment_method',
      'latest_invoice',
      'items.data.price.product',
    ]
  });

  const customer = sub.customer;
  const item = sub.items.data[0];
  const price = item?.price;
  const product = price?.product;

  // Historique des 10 dernières factures
  const invoices = await stripe.invoices.list({
    customer: typeof customer === 'string' ? customer : customer.id,
    limit: 10,
  });

  const lastPaid = invoices.data.find(inv => inv.status === 'paid');

  return {
    id: sub.id,
    status: sub.status,
    cancelAtPeriodEnd: sub.cancel_at_period_end,
    // Client
    customer: {
      id: typeof customer === 'string' ? customer : customer.id,
      name: typeof customer === 'object' ? customer.name : null,
      email: typeof customer === 'object' ? customer.email : null,
      phone: typeof customer === 'object' ? customer.phone : null,
    },
    // Forfait
    plan: {
      name: (typeof product === 'object' ? product.name : null) ||
            price?.nickname ||
            price?.id || 'Forfait',
      description: typeof product === 'object' ? (product.description || '') : '',
      features: typeof product === 'object'
        ? (product.marketing_features || []).map(f => f.name).filter(Boolean)
        : [],
      amount: price?.unit_amount ? (price.unit_amount / 100).toFixed(2) : null,
      currency: price?.currency?.toUpperCase() || 'CAD',
      interval: price?.recurring?.interval || 'month',
      intervalCount: price?.recurring?.interval_count || 1,
    },
    // Dates clés
    currentPeriodStart: sub.current_period_start,
    currentPeriodEnd: sub.current_period_end,
    createdAt: sub.created,
    trialEnd: sub.trial_end,
    // Paiements
    lastPayment: lastPaid ? {
      amount: (lastPaid.amount_paid / 100).toFixed(2),
      currency: lastPaid.currency?.toUpperCase() || 'CAD',
      date: lastPaid.status_transitions?.paid_at || lastPaid.created,
      invoiceUrl: lastPaid.hosted_invoice_url,
    } : null,
    // Historique factures
    invoiceHistory: invoices.data.slice(0, 6).map(inv => ({
      id: inv.id,
      amount: (inv.amount_paid / 100).toFixed(2),
      currency: inv.currency?.toUpperCase() || 'CAD',
      status: inv.status,
      date: inv.created,
      url: inv.hosted_invoice_url,
    })),
    // Moyen de paiement
    paymentMethod: sub.default_payment_method ? {
      brand: sub.default_payment_method.card?.brand,
      last4: sub.default_payment_method.card?.last4,
      expMonth: sub.default_payment_method.card?.exp_month,
      expYear: sub.default_payment_method.card?.exp_year,
    } : null,
  };
}

module.exports = {
  createCheckoutSession,
  createSubscription,
  parseWebhook,
  getSession,
  refund,
  createCustomerPortalSession,
  getPortalLinkByEmail,
  listSubscriptions,
  getSubscriptionDetails,
};
