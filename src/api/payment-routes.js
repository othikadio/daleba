/**
 * DALEBA — Routes Paiement (Stripe)
 */

const express = require('express');
const router = express.Router();
const stripe = require('../services/stripe');

// GET /api/payment/portal — Génère un lien Customer Portal Stripe
router.post('/portal', async (req, res) => {
  const { email, customerId, returnUrl } = req.body;
  if (!email && !customerId) {
    return res.status(400).json({ error: 'email ou customerId requis' });
  }
  try {
    let result;
    if (customerId) {
      result = await stripe.createCustomerPortalSession(customerId, returnUrl);
    } else {
      result = await stripe.getPortalLinkByEmail(email, returnUrl);
    }
    res.json({ success: true, ...result });
  } catch (err) {
    console.error('\u274c Portal error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// GET /api/payment/subscriptions — Liste des abonnés Stripe
router.get('/subscriptions', async (req, res) => {
  const { status = 'all' } = req.query;
  try {
    const subs = await stripe.listSubscriptions({ status });
    res.json({ success: true, count: subs.length, subscriptions: subs });
  } catch (err) {
    console.error('\u274c Subscriptions error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// POST /api/payment/create — Créer une session de paiement
router.post('/create', async (req, res) => {
  const { clientName, clientEmail, amount, description, sessionId } = req.body;

  if (!clientEmail || !amount) {
    return res.status(400).json({ error: 'clientEmail et amount requis' });
  }

  try {
    const session = await stripe.createCheckoutSession({
      clientName,
      clientEmail,
      amount: parseInt(amount), // en cents
      description,
      sessionId,
    });

    res.json({ success: true, ...session });
  } catch (err) {
    console.error('❌ Stripe error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// POST /api/payment/subscription — Créer un abonnement
router.post('/subscription', async (req, res) => {
  const { clientEmail, priceId } = req.body;

  if (!clientEmail || !priceId) {
    return res.status(400).json({ error: 'clientEmail et priceId requis' });
  }

  try {
    const session = await stripe.createSubscription({ clientEmail, priceId });
    res.json({ success: true, ...session });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/payment/webhook — Webhook Stripe (raw body nécessaire)
router.post('/webhook', express.raw({ type: 'application/json' }), async (req, res) => {
  const sig = req.headers['stripe-signature'];

  let event;
  try {
    event = stripe.parseWebhook(req.body, sig);
  } catch (err) {
    console.error('❌ Webhook signature invalide:', err.message);
    return res.status(400).json({ error: 'Signature invalide' });
  }

  const bus = require('../services/event-bus');

  // Traitement des événements Stripe → Event Bus temps réel
  switch (event.type) {
    case 'checkout.session.completed': {
      const session = event.data.object;
      const amount = (session.amount_total / 100).toFixed(2);
      bus.payment(`Paiement reçu: ${session.customer_email} — ${amount} CAD`, {
        type: 'checkout_completed',
        email: session.customer_email,
        amount,
        currency: session.currency?.toUpperCase() || 'CAD',
        stripeSessionId: session.id,
      });
      break;
    }
    case 'invoice.payment_succeeded': {
      const inv = event.data.object;
      const amount = (inv.amount_paid / 100).toFixed(2);
      bus.payment(`Abonnement facturé: ${inv.customer_email} — ${amount} CAD`, {
        type: 'subscription_payment',
        email: inv.customer_email,
        amount,
        subscriptionId: inv.subscription,
      });
      break;
    }
    case 'invoice.payment_failed': {
      const invoice = event.data.object;
      bus.emit('error', `Paiement échoué: ${invoice.customer_email}`, {
        type: 'payment_failed',
        email: invoice.customer_email,
        invoiceId: invoice.id,
      });
      break;
    }
    case 'customer.subscription.created': {
      bus.payment(`Nouvel abonnement: ${event.data.object.customer}`, {
        type: 'subscription_created',
        customerId: event.data.object.customer,
        plan: event.data.object.plan?.nickname || 'Plan',
      });
      break;
    }
    case 'customer.subscription.deleted': {
      bus.emit('error', `Abonnement annulé: ${event.data.object.customer}`, {
        type: 'subscription_deleted',
        customerId: event.data.object.customer,
      });
      break;
    }
    default:
      console.log(`📌 Événement Stripe non-traité: ${event.type}`);
  }

  res.json({ received: true });
});

// POST /api/payment/refund — Remboursement
router.post('/refund', async (req, res) => {
  const { paymentIntentId, amount } = req.body;

  if (!paymentIntentId) {
    return res.status(400).json({ error: 'paymentIntentId requis' });
  }

  try {
    const refund = await stripe.refund(paymentIntentId, amount);
    res.json({ success: true, refundId: refund.id, status: refund.status });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;

// POST /api/payment/create-intent — Créer un PaymentIntent Stripe
router.post('/create-intent', async (req, res) => {
  const { amount, currency = 'cad', description, clientEmail, metadata = {} } = req.body;
  if (!amount) return res.status(400).json({ error: 'amount requis (en cents)' });

  try {
    const stripeService = require('../services/stripe');
    // Utiliser createCheckoutSession si pas de PaymentIntent direct
    const session = await stripeService.createCheckoutSession({
      clientEmail: clientEmail || 'client@kadiocoiffure.ca',
      clientName: metadata.clientName || 'Client',
      amount: parseInt(amount),
      description: description || 'Paiement Kadio Coiffure',
      sessionId: `intent-${Date.now()}`,
    });
    res.json({ success: true, ...session, intentType: 'checkout_session' });
  } catch (err) {
    console.error('[payment/create-intent]', err.message);
    res.status(500).json({ error: err.message });
  }
});

// POST /api/payment/square-checkout — Paiement via Square
router.post('/square-checkout', async (req, res) => {
  const { amount, currency = 'CAD', sourceId, note, customerId } = req.body;
  if (!amount || !sourceId) {
    return res.status(400).json({ error: 'amount et sourceId requis' });
  }

  const SQUARE_TOKEN = process.env.SQUARE_ACCESS_TOKEN;
  const LOCATION_ID  = process.env.SQUARE_LOCATION_ID || 'LTDE9RP9PSHX7';

  if (!SQUARE_TOKEN) {
    return res.status(503).json({ error: 'SQUARE_ACCESS_TOKEN non configuré' });
  }

  try {
    const idempotencyKey = `kc-sq-${Date.now()}-${Math.random().toString(36).slice(2,8)}`;
    const body = {
      idempotency_key: idempotencyKey,
      source_id: sourceId,
      amount_money: { amount: parseInt(amount), currency },
      location_id: LOCATION_ID,
      note: note || 'Paiement Kadio Coiffure',
      ...(customerId ? { customer_id: customerId } : {}),
    };

    const response = await fetch('https://connect.squareup.com/v2/payments', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${SQUARE_TOKEN}`,
        'Content-Type': 'application/json',
        'Square-Version': '2024-02-22',
      },
      body: JSON.stringify(body),
    });
    const data = await response.json();
    if (!response.ok) {
      const errMsg = data.errors?.[0]?.detail || `Square ${response.status}`;
      return res.status(response.status).json({ error: errMsg, squareErrors: data.errors });
    }
    res.json({ success: true, payment: data.payment });
  } catch (err) {
    console.error('[payment/square-checkout]', err.message);
    res.status(500).json({ error: err.message });
  }
});

// POST /api/payment/deposit — Créer un paiement de dépôt (20% via Stripe)
router.post('/deposit', async (req, res) => {
  const { bookingId, servicePrice, serviceName, clientEmail, clientName, staffId } = req.body;
  if (!servicePrice || !clientEmail) {
    return res.status(400).json({ error: 'servicePrice et clientEmail requis' });
  }

  // Calculer dépôt 20% avec exception barbier
  const BARBER_STAFF_IDS = ['TMQ9dzPRRMFbmlW9'];
  const price = parseFloat(servicePrice);
  const isBarbier = BARBER_STAFF_IDS.includes(staffId);
  if (isBarbier || price <= 0) {
    return res.json({
      success: true,
      depositRequired: false,
      depositAmount: 0,
      message: 'Service barbier — aucun dépôt requis.',
    });
  }

  const depositAmount = Math.round(price * 0.20 * 100) / 100;
  const depositCents  = Math.round(depositAmount * 100);

  try {
    const BASE_URL = process.env.BASE_URL || 'https://daleba-api-production.up.railway.app';
    const stripeService = require('../services/stripe');
    const session = await stripeService.createCheckoutSession({
      clientEmail,
      clientName: clientName || 'Client',
      amount: depositCents,
      description: `Dépôt 20% — ${serviceName || 'Service'} chez Kadio Coiffure`,
      sessionId: `deposit-${bookingId || Date.now()}`,
      successUrl: `${BASE_URL}/booking-confirmation.html?booking_id=${bookingId || 0}&session_id={CHECKOUT_SESSION_ID}`,
      cancelUrl: `${BASE_URL}/booking.html?cancelled=1`,
    });
    res.json({
      success: true,
      depositRequired: true,
      depositAmount,
      depositPercent: 20,
      ...session,
    });
  } catch (err) {
    console.error('[payment/deposit]', err.message);
    res.status(500).json({ error: err.message });
  }
});
