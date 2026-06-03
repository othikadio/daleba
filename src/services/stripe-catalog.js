'use strict';
const Stripe = require('stripe');

const PACKAGES = [
  {
    id: 'audit',
    name: 'Audit IA Express',
    description: 'Diagnostic complet de votre entreprise par nos agents IA. Rapport d\'opportunités + plan d\'action livré en 48h.',
    amount: 15000, // centimes CAD
    currency: 'cad',
    type: 'one_time',
    features: ['Analyse IA de vos processus', 'Rapport d\'opportunités', 'Plan d\'action 30 jours', 'Appel de suivi 30 min'],
    emoji: '🔍',
    highlight: false,
  },
  {
    id: 'starter',
    name: 'Pack Starter',
    description: 'Site web IA + prise de rendez-vous en ligne + automatisations de base pour démarrer immédiatement.',
    amount: 75000,
    currency: 'cad',
    type: 'one_time',
    features: ['Site web IA sur mesure', 'Prise de RDV en ligne', 'Rappels automatiques SMS/Email', 'Tableau de bord clients', 'Support 30 jours'],
    emoji: '🚀',
    highlight: false,
  },
  {
    id: 'business',
    name: 'Pack Business',
    description: 'La solution IA complète pour automatiser votre croissance : marketing, agents autonomes, fidélisation.',
    amount: 250000,
    currency: 'cad',
    type: 'one_time',
    features: ['Tout du Pack Starter', 'Agents IA autonomes', 'Marketing automatisé (Meta/Google)', 'Fidélisation clients', 'Analyse financière IA', 'Support prioritaire 90 jours'],
    emoji: '⚡',
    highlight: true,
  },
  {
    id: 'enterprise',
    name: 'Pack Enterprise',
    description: 'Solution complète sur mesure + accompagnement 3 mois + formation de votre équipe.',
    amount: 500000,
    currency: 'cad',
    type: 'one_time',
    features: ['Tout du Pack Business', 'Développement sur mesure', 'Intégration systèmes existants', 'Formation équipe complète', 'Accompagnement 3 mois', 'SLA prioritaire'],
    emoji: '👑',
    highlight: false,
  },
  {
    id: 'monthly',
    name: 'Maintenance Mensuelle',
    description: 'Support continu, optimisations IA, mises à jour et monitoring de votre système DALEBA.',
    amount: 29900,
    currency: 'cad',
    type: 'recurring',
    interval: 'month',
    features: ['Monitoring 24/7', 'Mises à jour IA', 'Optimisations continues', 'Support prioritaire', 'Rapport mensuel'],
    emoji: '🔄',
    highlight: false,
  },
];

const cache = {}; // { packageId: { priceId, paymentLinkUrl, productId } }

function getStripe() {
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) throw new Error('STRIPE_SECRET_KEY non configuré');
  return Stripe(key);
}

async function syncPackage(pkg) {
  const stripe = getStripe();

  // Chercher produit existant par metadata.daleba_id
  const existing = await stripe.products.search({
    query: `metadata['daleba_id']:'${pkg.id}'`,
  }).catch(() => ({ data: [] }));

  let product;
  if (existing.data.length > 0) {
    product = existing.data[0];
  } else {
    product = await stripe.products.create({
      name: pkg.name,
      description: pkg.description,
      metadata: { daleba_id: pkg.id, emoji: pkg.emoji },
    });
  }

  // Chercher prix existant
  const prices = await stripe.prices.list({ product: product.id, active: true, limit: 5 });
  let price;

  if (prices.data.length > 0) {
    price = prices.data[0];
  } else {
    const priceData = {
      product: product.id,
      currency: pkg.currency,
      unit_amount: pkg.amount,
      metadata: { daleba_id: pkg.id },
    };
    if (pkg.type === 'recurring') {
      priceData.recurring = { interval: pkg.interval };
    }
    price = await stripe.prices.create(priceData);
  }

  // Créer payment link (seulement pour one_time)
  let paymentLinkUrl = null;
  if (pkg.type === 'one_time') {
    try {
      const existingLinks = await stripe.paymentLinks.list({ active: true, limit: 20 });
      const existingLink = existingLinks.data.find(l => l.metadata && l.metadata.daleba_id === pkg.id);
      if (existingLink) {
        paymentLinkUrl = existingLink.url;
      } else {
        const link = await stripe.paymentLinks.create({
          line_items: [{ price: price.id, quantity: 1 }],
          metadata: { daleba_id: pkg.id },
          after_completion: {
            type: 'hosted_confirmation',
            hosted_confirmation: { custom_message: 'Merci ! Notre équipe DALEBA vous contacte dans les 24h. Email : kadioothniel@yahoo.fr' },
          },
        });
        paymentLinkUrl = link.url;
      }
    } catch (e) {
      console.warn('[stripe-catalog] Payment link error:', e.message);
    }
  }

  cache[pkg.id] = { priceId: price.id, paymentLinkUrl, productId: product.id };
  return { product, price, paymentLinkUrl };
}

async function syncAll() {
  console.log('[stripe-catalog] Synchronisation catalogue DALEBA → Stripe...');
  const results = [];
  for (const pkg of PACKAGES) {
    try {
      const r = await syncPackage(pkg);
      console.log(`[stripe-catalog] ✅ ${pkg.name} — price: ${r.price.id} | link: ${r.paymentLinkUrl || 'recurring'}`);
      results.push({ ...pkg, ...cache[pkg.id] });
    } catch (e) {
      console.error(`[stripe-catalog] ❌ ${pkg.name}: ${e.message}`);
    }
  }
  return results;
}

async function getPackagesWithLinks() {
  // Si cache vide, sync d'abord
  if (Object.keys(cache).length === 0) {
    await syncAll();
  }
  return PACKAGES.map(pkg => ({
    ...pkg,
    amountFormatted: new Intl.NumberFormat('fr-CA', { style: 'currency', currency: 'CAD' }).format(pkg.amount / 100),
    ...cache[pkg.id],
  }));
}

async function createDynamicPaymentLink(amount, description, customerEmail) {
  const stripe = getStripe();
  const link = await stripe.paymentLinks.create({
    line_items: [{
      price_data: {
        currency: 'cad',
        product_data: { name: description, description: 'DALEBA — Service IA pour votre entreprise' },
        unit_amount: Math.round(amount * 100),
      },
      quantity: 1,
    }],
    ...(customerEmail ? { customer_creation: 'always' } : {}),
    after_completion: {
      type: 'hosted_confirmation',
      hosted_confirmation: { custom_message: 'Merci ! Notre équipe DALEBA vous contacte dans les 24h. Email : kadioothniel@yahoo.fr' },
    },
  });
  return link.url;
}

module.exports = { syncAll, getPackagesWithLinks, createDynamicPaymentLink, PACKAGES, cache };
