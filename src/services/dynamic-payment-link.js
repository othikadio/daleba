/**
 * DALEBA — Dynamic Payment Link Generator (Squad #801-#850)
 * ===========================================================
 * Génère des liens Stripe Payment Link ajustés au prix calculé par
 * le Negotiation Engine. Cache les liens par montant pour éviter
 * de créer des objets Stripe dupliqués.
 *
 * Liens pré-créés (fallback si Stripe KO) :
 *  - 150 CAD : https://buy.stripe.com/fZu8wO78Vaq6eAe6F96wE0r
 */
'use strict';

const https = require('https');

// ── Config ──────────────────────────────────────────────────────────────────
const STRIPE_KEY     = process.env.STRIPE_SECRET_KEY;
const DALEBA_PRODUCT = process.env.DALEBA_STRIPE_PRODUCT || null; // ID produit existant (optionnel)
const REDIRECT_URL   = process.env.DALEBA_SUCCESS_URL || 'https://daleba.vercel.app/merci';

// ── Cache mémoire : évite de recréer les mêmes liens ─────────────────────────
// Clé : "CAD_150", "CAD_950", etc.
const _cache = new Map();

// ── Fallbacks hardcodés (si Stripe API inaccessible) ─────────────────────────
const FALLBACK_LINKS = {
  150:  'https://buy.stripe.com/fZu8wO78Vaq6eAe6F96wE0r',
  // Ajoutés dynamiquement par le cache au fil des créations
};

// ── Appel Stripe REST ─────────────────────────────────────────────────────────
function stripePost(path, params) {
  return new Promise((resolve, reject) => {
    if (!STRIPE_KEY) return reject(new Error('STRIPE_SECRET_KEY non configuré'));

    const body = Object.entries(params)
      .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`)
      .join('&');

    const auth = Buffer.from(`${STRIPE_KEY}:`).toString('base64');

    const req = https.request({
      hostname: 'api.stripe.com',
      path,
      method:   'POST',
      headers: {
        'Authorization':  `Basic ${auth}`,
        'Content-Type':   'application/x-www-form-urlencoded',
        'Content-Length': Buffer.byteLength(body),
      },
      timeout: 15000,
    }, (res) => {
      let data = '';
      res.on('data', c => { data += c; });
      res.on('end', () => {
        try {
          const json = JSON.parse(data);
          if (res.statusCode >= 400) reject(new Error(`Stripe ${res.statusCode}: ${json.error?.message || data}`));
          else resolve(json);
        } catch (e) { reject(new Error('Parse: ' + data.slice(0, 100))); }
      });
    });

    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error('Stripe timeout')); });
    req.write(body);
    req.end();
  });
}

/**
 * Retourne ou crée un Stripe Payment Link pour un montant CAD donné.
 *
 * @param {number}  amountCAD      - Montant en CAD (entier)
 * @param {string}  projectTitle   - Titre de l'opportunité (pour label Stripe)
 * @returns {Promise<{url: string, paymentLinkId: string, created: boolean}>}
 */
async function getPaymentLink(amountCAD, projectTitle = 'Projet DALEBA') {
  const key = `CAD_${amountCAD}`;

  // 1. Cache mémoire
  if (_cache.has(key)) {
    const cached = _cache.get(key);
    console.log(`[dynamic-payment] #803 — Cache hit ${key} → ${cached.url.slice(0, 50)}`);
    return { ...cached, created: false };
  }

  // 2. Fallback hardcodé
  if (FALLBACK_LINKS[amountCAD]) {
    const result = { url: FALLBACK_LINKS[amountCAD], paymentLinkId: 'hardcoded', created: false };
    _cache.set(key, result);
    return result;
  }

  // 3. Créer dynamiquement via Stripe API
  if (!STRIPE_KEY) {
    // Pas de clé Stripe → fallback vers 150 CAD
    console.warn(`[dynamic-payment] STRIPE_SECRET_KEY absent — fallback 150 CAD`);
    return { url: FALLBACK_LINKS[150], paymentLinkId: 'fallback_no_key', created: false };
  }

  try {
    console.log(`[dynamic-payment] #804 — Création payment link Stripe ${amountCAD} CAD pour "${projectTitle.slice(0, 60)}"`);

    // 3a. Créer le Price
    const priceParams = {
      'unit_amount': amountCAD * 100, // centimes
      'currency':    'cad',
    };

    if (DALEBA_PRODUCT) {
      priceParams['product'] = DALEBA_PRODUCT;
    } else {
      priceParams['product_data[name]'] = `DALEBA — ${projectTitle.slice(0, 80)}`;
    }

    const price = await stripePost('/v1/prices', priceParams);

    // 3b. Créer le Payment Link
    const pl = await stripePost('/v1/payment_links', {
      'line_items[0][price]':    price.id,
      'line_items[0][quantity]': '1',
      'after_completion[type]':  'redirect',
      'after_completion[redirect][url]': REDIRECT_URL,
      'phone_number_collection[enabled]': 'false',
    });

    const result = { url: pl.url, paymentLinkId: pl.id, created: true };
    _cache.set(key, result);

    console.log(`[dynamic-payment] ✅ Lien créé : ${pl.url}`);
    return result;

  } catch (err) {
    console.error(`[dynamic-payment] Stripe KO (${err.message}) — fallback 150 CAD`);
    return { url: FALLBACK_LINKS[150], paymentLinkId: 'fallback_stripe_error', created: false, error: err.message };
  }
}

/**
 * Préchauffe le cache pour les montants courants.
 * À appeler au démarrage du serveur.
 */
async function warmCache() {
  const commonAmounts = [150, 200, 300, 500, 750, 1000, 1250, 1500, 2000, 2500];
  console.log(`[dynamic-payment] Préchauffage cache pour ${commonAmounts.length} montants courants...`);
  // On ne crée PAS les liens Stripe à l'avance (éviter les frais)
  // On initialise juste les fallbacks dans le cache
  for (const [amount, url] of Object.entries(FALLBACK_LINKS)) {
    _cache.set(`CAD_${amount}`, { url, paymentLinkId: 'hardcoded', created: false });
  }
  console.log(`[dynamic-payment] Cache initialisé (${_cache.size} entrées, création à la demande)`);
}

module.exports = { getPaymentLink, warmCache };
