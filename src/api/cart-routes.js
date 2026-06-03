'use strict';
/**
 * DALEBA — Panier d'Achat + Code Promo + Checkout Multi-Abonnements
 * ==================================================================
 * POST /api/cart/validate-promo  — Valide un code promo
 * POST /api/cart/checkout        — Crée session Stripe avec tous les items
 */

const express = require('express');
const router  = express.Router();
const Stripe  = require('stripe');

const { PACKAGES } = require('../services/stripe-catalog');

// ── Config ────────────────────────────────────────────────────────────────────
const BASE_URL     = process.env.API_BASE_URL || 'https://daleba-api-production.up.railway.app';
const SUCCESS_URL  = `${BASE_URL}/client-login?success=1`;
const CANCEL_URL   = `${BASE_URL}/vente`;

function getStripe() {
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) throw new Error('STRIPE_SECRET_KEY non configuré');
  return Stripe(key);
}

// ── Codes promo (catalogue interne) ─────────────────────────────────────────
// { code → { discountPct, minItems, label, active } }
const PROMO_CODES = {
  FAMILLE: {
    discountPct: 10,
    minItems:    2,
    label:       'Forfait Famille — 10% de réduction',
    active:      true,
  },
  DALEBA10: {
    discountPct: 10,
    minItems:    1,
    label:       'Code partenaire — 10% de réduction',
    active:      true,
  },
};

// ── POST /api/cart/validate-promo ────────────────────────────────────────────
router.post('/validate-promo', (req, res) => {
  const { code, itemCount = 1 } = req.body || {};
  if (!code) return res.status(400).json({ valid: false, error: 'Code requis' });

  const promo = PROMO_CODES[String(code).toUpperCase().trim()];

  if (!promo || !promo.active) {
    return res.status(422).json({ valid: false, error: 'Code promo invalide' });
  }

  if (itemCount < promo.minItems) {
    return res.status(422).json({
      valid: false,
      error: `Ce code nécessite au moins ${promo.minItems} abonnement(s) dans le panier`,
    });
  }

  return res.json({
    valid:       true,
    code:        code.toUpperCase(),
    discountPct: promo.discountPct,
    label:       promo.label,
    message:     `✓ ${promo.label}`,
  });
});

// ── POST /api/cart/checkout ──────────────────────────────────────────────────
// Body: { items: [{id, quantity}], promoCode?: string, phone?: string }
router.post('/checkout', async (req, res) => {
  const { items = [], promoCode, phone } = req.body || {};

  if (!items.length) {
    return res.status(400).json({ error: 'Panier vide' });
  }

  // Résoudre les packages
  const pkgMap = Object.fromEntries(PACKAGES.map(p => [p.id, p]));
  const lineItems = [];
  const cartSummary = []; // pour metadata

  for (const { id, quantity = 1 } of items) {
    const pkg = pkgMap[id];
    if (!pkg) return res.status(422).json({ error: `Package inconnu: ${id}` });
    lineItems.push({ pkg, quantity: Math.min(parseInt(quantity) || 1, 10) });
    cartSummary.push(`${pkg.name} x${quantity}`);
  }

  // Calcul remise
  let discountPct = 0;
  let promoLabel  = '';
  if (promoCode) {
    const promo = PROMO_CODES[String(promoCode).toUpperCase().trim()];
    const totalQty = lineItems.reduce((s, li) => s + li.quantity, 0);
    if (promo && promo.active && totalQty >= promo.minItems) {
      discountPct = promo.discountPct;
      promoLabel  = promo.label;
    }
  }

  const discountFactor = 1 - (discountPct / 100);

  try {
    const stripe = getStripe();

    // Construire les line_items Stripe avec remise incluse dans le prix unitaire
    const stripeLineItems = lineItems.map(({ pkg, quantity }) => ({
      price_data: {
        currency: 'cad',
        product_data: {
          name: discountPct > 0
            ? `${pkg.emoji} ${pkg.name} (−${discountPct}%)`
            : `${pkg.emoji} ${pkg.name}`,
          description: pkg.description,
          metadata: { daleba_id: pkg.id },
        },
        unit_amount: Math.round(pkg.amount * discountFactor),
      },
      quantity,
    }));

    // Calculer total pour affichage
    const totalCents = stripeLineItems.reduce(
      (s, li) => s + li.price_data.unit_amount * li.quantity, 0
    );

    const session = await stripe.checkout.sessions.create({
      mode:                     'payment',
      phone_number_collection:  { enabled: true },
      line_items:               stripeLineItems,
      success_url:              SUCCESS_URL,
      cancel_url:               CANCEL_URL,
      ...(phone ? { customer_creation: 'always' } : {}),
      metadata: {
        daleba_cart:       JSON.stringify(items),           // [{id, quantity}]
        cart_summary:      cartSummary.join(' | '),
        promo_code:        promoCode ? String(promoCode).toUpperCase() : '',
        discount_pct:      String(discountPct),
        client_phone:      phone || '',
        cart_count:        String(items.length),
        total_items:       String(lineItems.reduce((s, li) => s + li.quantity, 0)),
      },
    });

    return res.json({
      success:      true,
      checkoutUrl:  session.url,
      sessionId:    session.id,
      totalCad:     (totalCents / 100).toFixed(2),
      discountPct,
      promoLabel,
    });
  } catch (err) {
    console.error('[CART] checkout error:', err.message);
    return res.status(500).json({ error: `Erreur Stripe: ${err.message}` });
  }
});

// ── GET /api/cart/packages ────────────────────────────────────────────────────
// Retourne les packages avec prix formatés (pour le frontend panier)
router.get('/packages', (req, res) => {
  const pkgs = PACKAGES.map(p => ({
    id:              p.id,
    name:            p.name,
    emoji:           p.emoji,
    description:     p.description,
    amount:          p.amount,
    amountFormatted: new Intl.NumberFormat('fr-CA', { style: 'currency', currency: 'CAD' }).format(p.amount / 100),
    features:        p.features,
    highlight:       p.highlight,
    type:            p.type,
  }));
  res.json({ ok: true, packages: pkgs });
});

module.exports = router;
