/**
 * DALEBA — Scanner GMB / Google Places (Point 35)
 * Extrait les données des entreprises locales via Google Places API
 * Détecte instantanément les prospects sans système automatisé
 */

const axios = require('axios');

const GOOGLE_API_KEY = process.env.GOOGLE_PLACES_API_KEY;
const PLACES_BASE = 'https://maps.googleapis.com/maps/api/place';

/**
 * Recherche des entreprises locales par type et ville
 * @param {Object} params
 * @param {string} params.query - Ex: "salon de coiffure Longueuil"
 * @param {string} params.location - Ex: "45.5317,-73.5185" (lat,lng Longueuil)
 * @param {number} params.radius - Rayon en mètres (défaut: 5000)
 * @param {string} params.type - Type Google Places (ex: "hair_care", "beauty_salon")
 */
async function searchBusinesses({ query, location, radius = 5000, type }) {
  const params = {
    key: GOOGLE_API_KEY,
    language: 'fr',
  };

  let url;

  if (query) {
    // Text Search — plus flexible
    url = `${PLACES_BASE}/textsearch/json`;
    params.query = query;
    if (location) params.location = location;
    if (radius) params.radius = radius;
    if (type) params.type = type;
  } else {
    // Nearby Search — par coordonnées + type
    url = `${PLACES_BASE}/nearbysearch/json`;
    params.location = location;
    params.radius = radius;
    if (type) params.type = type;
  }

  const response = await axios.get(url, { params });
  const results = response.data.results || [];

  return results.map(place => ({
    placeId: place.place_id,
    name: place.name,
    address: place.formatted_address || place.vicinity,
    rating: place.rating,
    reviewCount: place.user_ratings_total,
    isOpen: place.opening_hours?.open_now,
    priceLevel: place.price_level,
    types: place.types,
    location: place.geometry?.location,
    photos: place.photos?.length || 0,
  }));
}

/**
 * Récupère les détails complets d'une entreprise (fiche GMB)
 * @param {string} placeId - Google Place ID
 */
async function getBusinessDetails(placeId) {
  const fields = [
    'name', 'formatted_address', 'formatted_phone_number',
    'international_phone_number', 'website', 'rating',
    'user_ratings_total', 'reviews', 'opening_hours',
    'price_level', 'types', 'photos', 'url',
    'business_status', 'editorial_summary',
  ].join(',');

  const response = await axios.get(`${PLACES_BASE}/details/json`, {
    params: {
      place_id: placeId,
      fields,
      key: GOOGLE_API_KEY,
      language: 'fr',
    },
  });

  const p = response.data.result;
  if (!p) throw new Error('Entreprise introuvable: ' + placeId);

  return {
    placeId,
    name: p.name,
    address: p.formatted_address,
    phone: p.formatted_phone_number || p.international_phone_number,
    website: p.website,
    googleUrl: p.url,
    rating: p.rating,
    reviewCount: p.user_ratings_total,
    businessStatus: p.business_status,
    priceLevel: p.price_level,
    types: p.types,
    hours: p.opening_hours?.weekday_text,
    description: p.editorial_summary?.overview,
    recentReviews: (p.reviews || []).slice(0, 3).map(r => ({
      rating: r.rating,
      text: r.text?.slice(0, 200),
      time: r.relative_time_description,
    })),
    photoCount: p.photos?.length || 0,
  };
}

/**
 * Détecte les faiblesses d'un prospect (points d'entrée pour la vente)
 * Analyse la fiche GMB et identifie les opportunités
 * @param {Object} business - Données de getBusinessDetails()
 */
function detectWeaknesses(business) {
  const weaknesses = [];
  const opportunities = [];

  // Note faible
  if (!business.rating) {
    weaknesses.push({ type: 'no_rating', severity: 'high', label: 'Aucune note Google — Invisibilité totale' });
    opportunities.push('Stratégie d\'acquisition d\'avis clients urgente');
  } else if (business.rating < 3.5) {
    weaknesses.push({ type: 'low_rating', severity: 'high', label: `Note faible: ${business.rating}/5` });
    opportunities.push('Gestion de réputation + réponse aux avis négatifs');
  } else if (business.rating < 4.2) {
    weaknesses.push({ type: 'average_rating', severity: 'medium', label: `Note moyenne: ${business.rating}/5` });
    opportunities.push('Optimisation de l\'expérience client pour passer au-dessus de 4.5');
  }

  // Peu d'avis
  if (!business.reviewCount || business.reviewCount < 10) {
    weaknesses.push({ type: 'few_reviews', severity: 'high', label: `Très peu d'avis: ${business.reviewCount || 0}` });
    opportunities.push('Système automatisé de collecte d\'avis post-visite');
  } else if (business.reviewCount < 50) {
    weaknesses.push({ type: 'low_reviews', severity: 'medium', label: `Peu d'avis: ${business.reviewCount}` });
  }

  // Pas de site web
  if (!business.website) {
    weaknesses.push({ type: 'no_website', severity: 'high', label: 'Aucun site web — Zéro présence digitale' });
    opportunities.push('Proposition de site web clé en main avec prise de RDV en ligne');
  }

  // Pas de téléphone visible
  if (!business.phone) {
    weaknesses.push({ type: 'no_phone', severity: 'medium', label: 'Numéro non renseigné sur Google' });
    opportunities.push('Optimisation de la fiche GMB');
  }

  // Pas de photos
  if (business.photoCount < 5) {
    weaknesses.push({ type: 'few_photos', severity: 'medium', label: `Peu de photos: ${business.photoCount}` });
    opportunities.push('Shooting photo professionnel + mise à jour GMB');
  }

  // Pas de description
  if (!business.description) {
    weaknesses.push({ type: 'no_description', severity: 'low', label: 'Aucune description d\'entreprise' });
  }

  // Fermé / statut problématique
  if (business.businessStatus === 'CLOSED_TEMPORARILY') {
    weaknesses.push({ type: 'closed_temp', severity: 'high', label: 'Fermé temporairement — Opportunité de relance' });
  }

  // Score de vulnérabilité (0-100)
  const severityScore = { high: 30, medium: 15, low: 5 };
  const vulnerabilityScore = Math.min(100, weaknesses.reduce((sum, w) => sum + (severityScore[w.severity] || 0), 0));

  return { weaknesses, opportunities, vulnerabilityScore };
}

/**
 * Scan complet d'une zone — recherche + analyse de tous les prospects
 * @param {string} query - Ex: "salon de coiffure Longueuil"
 * @param {Object} options - { location, radius, type }
 */
async function scanProspects(query, options = {}) {
  const businesses = await searchBusinesses({ query, ...options });

  const prospects = [];
  for (const biz of businesses.slice(0, 20)) { // max 20 pour éviter les quotas
    try {
      const details = await getBusinessDetails(biz.placeId);
      const analysis = detectWeaknesses(details);
      prospects.push({
        ...details,
        ...analysis,
        prospectScore: analysis.vulnerabilityScore, // Plus le score est haut, plus c'est un bon prospect
      });

      // Petit délai pour respecter les quotas Google
      await new Promise(r => setTimeout(r, 200));
    } catch (err) {
      prospects.push({ ...biz, error: err.message, prospectScore: 0 });
    }
  }

  // Tri par score de prospect (meilleurs prospects en premier)
  prospects.sort((a, b) => b.prospectScore - a.prospectScore);

  return prospects;
}

module.exports = {
  searchBusinesses,
  getBusinessDetails,
  detectWeaknesses,
  scanProspects,
};
