/**
 * KADIO OS — Axe 3: Stripe pour l'Usine
 * Génère des liens de paiement pour les audits SEO
 */

async function createAuditPaymentLink(lead, amount = 15000) {
  const stripeKey = process.env.STRIPE_SECRET_KEY;
  if (!stripeKey) {
    console.warn('[StripeUsine] STRIPE_SECRET_KEY non définie');
    return 'https://kadiocoiffure.vercel.app';
  }

  try {
    const Stripe = require('stripe');
    const stripe = Stripe(stripeKey);

    const paymentLink = await stripe.paymentLinks.create({
      line_items: [
        {
          price_data: {
            currency: 'cad',
            product_data: {
              name: 'Correction SEO Complète — DALEBA',
              description: `Correction de tous les problèmes SEO pour ${lead.company_name || lead.website} · Optimisation mots-clés · Rapport de suivi 30 jours`,
              images: []
            },
            unit_amount: amount
          },
          quantity: 1
        }
      ],
      metadata: {
        lead_id: String(lead.id || ''),
        lead_email: lead.email || '',
        lead_website: lead.website || ''
      }
    });

    return paymentLink.url;
  } catch (e) {
    console.warn('[StripeUsine] createAuditPaymentLink error:', e.message);
    return 'https://kadiocoiffure.vercel.app';
  }
}

// Récupérer les revenus générés depuis Stripe (webhooks + charges)
async function getUsineRevenue() {
  const stripeKey = process.env.STRIPE_SECRET_KEY;
  if (!stripeKey) return 0;

  try {
    const Stripe = require('stripe');
    const stripe = Stripe(stripeKey);

    // Chercher les paiements liés à l'usine (metadata.lead_id présent)
    const charges = await stripe.charges.list({ limit: 100, created: { gte: Math.floor(Date.now()/1000) - 30*86400 } });
    const usineRevenue = charges.data
      .filter(c => c.paid && c.metadata?.lead_id)
      .reduce((sum, c) => sum + c.amount, 0);

    return usineRevenue; // En centimes
  } catch (e) {
    return 0;
  }
}

module.exports = { createAuditPaymentLink, getUsineRevenue };
