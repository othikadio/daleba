'use strict';
/**
 * Allergy Tracker — DALEBA Metacortex Point 374
 * Détecte les allergies croisées entre ingrédients recommandés et profil client.
 * Bloque la formulation + alerte si risque détecté.
 */
const bus = require('./event-bus');

// Base de données de composés croisés (allergènes)
const CROSS_ALLERGEN_MAP = {
  'noix':              ['huile de noix', 'beurre de noix', 'extrait de noisette', 'noix de macadamia', 'huile de macadamia', 'macadamia'],
  'fruits à coque':    ['huile de noix', 'beurre d\'amande', 'huile d\'argan', 'lait de coco', 'beurre de karité', 'huile de macadamia', 'macadamia', 'noisette', 'cajou', 'pistache'],
  'macadamia':         ['huile de macadamia', 'noix de macadamia', 'beurre de macadamia'],
  'gluten':            ['avoine colloïdale', 'son d\'avoine', 'orge', 'seigle'],
  'latex':             ['aloe vera', 'figuier de barbarie', 'papaye'],
  'parfum':            ['lavande', 'rose musquée', 'ylang ylang', 'néroli', 'bergamote', 'géranium'],
  'nickel':            ['thé vert', 'avoine', 'chocolat', 'figue'],
  'propolis':          ['miel', 'cire d\'abeille', 'extrait de pollen'],
  'arachide':          ['huile d\'arachide', 'beurre de cacahuète'],
  'soja':              ['huile de soja', 'lécithine de soja'],
  'lanoline':          ['lanoline', 'cire de laine'],
};

/**
 * Normalise un nom d'ingrédient pour comparaison
 */
function normalize(str) {
  return str.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim();
}

/**
 * [374] Vérifie les allergies croisées pour une liste d'ingrédients
 * @returns { safe: bool, alerts: [{allergen, ingredient, risk}] }
 */
function checkCrossAllergens(recommendedIngredients = [], clientAllergies = []) {
  const alerts = [];

  for (const clientAllergen of clientAllergies) {
    const normAllergen = normalize(clientAllergen);
    // Cherche les croisements
    const crossList = Object.entries(CROSS_ALLERGEN_MAP).find(([key]) =>
      normalize(key).includes(normAllergen) || normAllergen.includes(normalize(key))
    );

    if (crossList) {
      const [allergenGroup, crossIngredients] = crossList;
      for (const ingredient of recommendedIngredients) {
        const normIngr = normalize(ingredient);
        const isCross  = crossIngredients.some(ci => normIngr.includes(normalize(ci)) || normalize(ci).includes(normIngr));
        if (isCross) {
          alerts.push({
            allergen:   clientAllergen,
            ingredient,
            allergenGroup,
            risk:       'HIGH',
            message:    `⚠️ ALLERGIE CROISÉE: "${ingredient}" peut réagir avec l'allergie "${clientAllergen}" (groupe ${allergenGroup})`,
          });
        }
      }
    }

    // Vérification directe
    for (const ingredient of recommendedIngredients) {
      if (normalize(ingredient).includes(normAllergen) || normAllergen.includes(normalize(ingredient))) {
        if (!alerts.find(a => a.ingredient === ingredient)) {
          alerts.push({
            allergen:   clientAllergen,
            ingredient,
            risk:       'CRITICAL',
            message:    `🚨 ALLERGIE DIRECTE: "${ingredient}" contient "${clientAllergen}" — FORMULATION BLOQUÉE`,
          });
        }
      }
    }
  }

  const safe = alerts.length === 0;
  if (!safe) {
    const criticals = alerts.filter(a => a.risk === 'CRITICAL');
    bus.system(`[AllergyTracker] 🚨 ${alerts.length} alerte(s) allergie (${criticals.length} critiques)`);
  }
  return { safe, alerts, blockedIngredients: alerts.map(a => a.ingredient) };
}

/**
 * [374] Filtre une liste d'ingrédients et renvoie uniquement les sûrs
 */
function filterSafeIngredients(recommendedIngredients, clientAllergies) {
  const check   = checkCrossAllergens(recommendedIngredients, clientAllergies);
  const blocked = new Set(check.blockedIngredients.map(normalize));
  const safe    = recommendedIngredients.filter(i => !blocked.has(normalize(i)));
  return { safeIngredients: safe, allergyCheck: check };
}

module.exports = { checkCrossAllergens, filterSafeIngredients, CROSS_ALLERGEN_MAP };
