/**
 * DALEBA — Catalogue Officiel des Services & Coordonnées Salon
 * Section 15 — Menu Officiel + Coordonnées Salon
 *
 * Tous les prix sont HORS TAXES.
 * Québec : TPS 5% + TVQ 9.975% = 14.975% total
 */

'use strict';

// ─── COORDONNÉES SALON ───────────────────────────────────────────────────────

const SALON_INFO = {
  name:      'Kadio Coiffure',
  address:   '615 Antoinette Robidoux, local 100, Longueuil, QC J4J 2V8',
  whatsapp:  '514-919-5970',
  phone:     '514-919-5970',
  facebook:  'kadio coiffure',
  instagram: '@kadiocoiffure',
  tiktok:    '@kadiocoiffure',
  website:   'kadiocoiffure.com',
  hours: {
    'Lundi – Vendredi': '9h00 – 20h00',
    'Samedi':           '8h00 – 18h00',
    'Dimanche':         'Fermé',
  },
};

// ─── TAXES QUÉBEC ────────────────────────────────────────────────────────────

/**
 * Calcule les taxes québécoises sur un prix hors taxes.
 * @param {number} price - Prix hors taxes (CAD)
 * @returns {{ subtotal: number, tps: number, tvq: number, total: number, formatted: object }}
 */
function calculateTaxes(price) {
  const tps  = price * 0.05;
  const tvq  = price * 0.09975;
  const total = price + tps + tvq; // = price * 1.14975

  const fmt = (n) => parseFloat(n.toFixed(2));

  return {
    subtotal:  fmt(price),
    tps:       fmt(tps),
    tvq:       fmt(tvq),
    total:     fmt(total),
    formatted: {
      subtotal: `${fmt(price).toFixed(2)} $`,
      tps:      `${fmt(tps).toFixed(2)} $`,
      tvq:      `${fmt(tvq).toFixed(2)} $`,
      total:    `${fmt(total).toFixed(2)} $`,
    },
  };
}

// ─── CATALOGUE DES SERVICES ──────────────────────────────────────────────────
// Tous les prix sont HORS TAXES — afficher "(+ taxes)" côté client

const SERVICES = [
  {
    id:          'coupe-homme',
    icon:        '✂️',
    name:        'Coupe Homme',
    description: 'Dégradé, tondeuse, style afro — propre et soigné',
    priceFrom:   25,
    priceLabel:  'À partir de 25$ (+ taxes)',
    category:    'coupe',
    deposit:     false,
    duration:    30,
  },
  {
    id:          'coupe-femme',
    icon:        '💇‍♀️',
    name:        'Coupe Femme',
    description: 'Coupe, mise en forme, définition des boucles',
    priceFrom:   45,
    priceLabel:  'À partir de 45$ (+ taxes)',
    category:    'coupe',
    deposit:     true,
    duration:    45,
  },
  {
    id:          'coupe-enfant',
    icon:        '👦',
    name:        'Coupe Enfant',
    description: 'Coupes pour enfants dans une ambiance douce',
    priceFrom:   20,
    priceLabel:  'À partir de 20$ (+ taxes)',
    category:    'coupe',
    deposit:     false,
    duration:    30,
  },
  {
    id:          'tresses',
    icon:        '🪢',
    name:        'Tresses',
    description: 'Box braids, cornrows, goddess braids — toutes techniques',
    priceFrom:   120,
    priceLabel:  'À partir de 120$ (+ taxes)',
    category:    'tresses',
    deposit:     true,
    duration:    180,
  },
  {
    id:          'extensions',
    icon:        '✨',
    name:        'Extensions',
    description: 'Pose d\'extensions naturelles ou synthétiques',
    priceFrom:   180,
    priceLabel:  'À partir de 180$ (+ taxes)',
    category:    'extensions',
    deposit:     true,
    duration:    240,
  },
  {
    id:          'dreadlocks',
    icon:        '🌀',
    name:        'Dreadlocks',
    description: 'Création, entretien et retouche de dreadlocks',
    priceFrom:   200,
    priceLabel:  'À partir de 200$ (+ taxes)',
    category:    'dreadlocks',
    deposit:     true,
    duration:    240,
  },
  {
    id:          'tissage',
    icon:        '💫',
    name:        'Tissage',
    description: 'Tissage naturel et synthétique, cousu ou collé',
    priceFrom:   150,
    priceLabel:  'À partir de 150$ (+ taxes)',
    category:    'tissage',
    deposit:     true,
    duration:    180,
  },
  {
    id:          'perruque',
    icon:        '👑',
    name:        'Perruque',
    description: 'Pose et personnalisation de perruques full lace',
    priceFrom:   130,
    priceLabel:  'À partir de 130$ (+ taxes)',
    category:    'perruque',
    deposit:     true,
    duration:    90,
  },
  {
    id:          'barbier',
    icon:        '💈',
    name:        'Barbier',
    description: 'Dégradé rasé, beard trim, liner — sans dépôt',
    priceFrom:   25,
    priceLabel:  'À partir de 25$ (+ taxes)',
    category:    'barbier',
    deposit:     false,
    duration:    30,
  },
  {
    id:          'traitements',
    icon:        '🌿',
    name:        'Traitements Capillaires',
    description: 'Soins hydratants, kératine, deep conditioning',
    priceFrom:   55,
    priceLabel:  'À partir de 55$ (+ taxes)',
    category:    'soin',
    deposit:     true,
    duration:    60,
  },
];

// ─── CATALOGUE PAR CATÉGORIE ─────────────────────────────────────────────────

function getServicesByCategory() {
  const categories = {};
  for (const svc of SERVICES) {
    if (!categories[svc.category]) categories[svc.category] = [];
    categories[svc.category].push(svc);
  }
  return categories;
}

function getServiceById(id) {
  return SERVICES.find(s => s.id === id) || null;
}

/**
 * Retourne un service enrichi avec calcul des taxes.
 * @param {string} id
 */
function getServiceWithTaxes(id) {
  const svc = getServiceById(id);
  if (!svc) return null;
  return { ...svc, taxes: calculateTaxes(svc.priceFrom) };
}

/**
 * Retourne tous les services avec leur total TTC calculé.
 */
function getAllServicesWithTaxes() {
  return SERVICES.map(svc => ({
    ...svc,
    taxes: calculateTaxes(svc.priceFrom),
  }));
}

module.exports = {
  SALON_INFO,
  SERVICES,
  calculateTaxes,
  getServicesByCategory,
  getServiceById,
  getServiceWithTaxes,
  getAllServicesWithTaxes,
};
