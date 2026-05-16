/**
 * DALEBA — Routes Paiement (Stripe)
 */

const express = require('express');
const router = express.Router();
const stripe = require('../services/stripe');

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

  // Traitement des événements Stripe
  switch (event.type) {
    case 'checkout.session.completed': {
      const session = event.data.object;
      console.log(`✅ Paiement reçu — ${session.customer_email} — ${session.amount_total / 100} CAD`);
      // TODO: marquer le RDV comme payé dans la DB
      break;
    }
    case 'invoice.payment_failed': {
      const invoice = event.data.object;
      console.log(`❌ Paiement échoué — ${invoice.customer_email}`);
      break;
    }
    case 'customer.subscription.deleted': {
      console.log(`🔴 Abonnement annulé — ${event.data.object.customer}`);
      break;
    }
    default:
      console.log(`📌 Événement Stripe: ${event.type}`);
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
