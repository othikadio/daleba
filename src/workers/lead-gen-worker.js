/**
 * KADIO OS — Axe 3: Division 1 — Lead Generation
 * Recherche de PME via Nominatim (données publiques OpenStreetMap)
 */

const fetch = (...args) => import('node-fetch').then(({default: f}) => f(...args)).catch(() => require('https').get);
const { addSeoAuditJob, markJobActive, markJobCompleted, markJobFailed } = require('./agent-queue');

// Villes cibles par défaut
const DEFAULT_CITIES = [
  'Montréal', 'Québec', 'Laval', 'Longueuil', 'Gatineau', 'Sherbrooke',
  'Saguenay', 'Lévis', 'Terrebonne', 'Abbotsford',
  'Paris', 'Lyon', 'Marseille', 'Bordeaux', 'Toulouse',
  'Bruxelles', 'Liège', 'Charleroi',
  'Toronto', 'Ottawa', 'Calgary', 'Edmonton'
];

// Regex extraction email
const EMAIL_REGEX = /[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}/g;

// Fetch avec timeout
async function fetchWithTimeout(url, timeoutMs = 8000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const nodeFetch = require('node-fetch');
    const res = await nodeFetch(url, {
      signal: controller.signal,
      headers: { 'User-Agent': 'DALEBA-LeadGen/1.0 (contact@daleba.app)' }
    });
    return res;
  } finally {
    clearTimeout(timer);
  }
}

// Recherche de salons via Nominatim
async function searchSalons(city, query = 'salon coiffure') {
  const url = `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(query + ' ' + city)}&format=json&limit=50&addressdetails=1&extratags=1`;
  try {
    const res = await fetchWithTimeout(url, 10000);
    if (!res.ok) return [];
    const data = await res.json();
    return data.map(item => ({
      name: item.display_name?.split(',')[0] || item.name,
      address: item.display_name,
      lat: item.lat,
      lon: item.lon,
      website: item.extratags?.website || item.extratags?.url || null,
      phone: item.extratags?.phone || null,
      city: city,
      osmId: item.osm_id
    }));
  } catch (e) {
    console.warn(`[LeadGen] Nominatim error for ${city}:`, e.message);
    return [];
  }
}

// Extraction email depuis un site web
async function extractEmailFromSite(websiteUrl) {
  if (!websiteUrl || !websiteUrl.startsWith('http')) return null;
  try {
    const res = await fetchWithTimeout(websiteUrl, 6000);
    if (!res.ok) return null;
    const html = await res.text();
    const matches = html.match(EMAIL_REGEX);
    if (!matches) return null;
    // Filtrer les emails génériques/noreply
    const filtered = matches.filter(e =>
      !e.includes('noreply') && !e.includes('no-reply') &&
      !e.includes('example') && !e.includes('test@') &&
      !e.includes('w3.org') && !e.includes('schema.org')
    );
    return filtered[0] || null;
  } catch {
    return null;
  }
}

// Extraction titre + meta depuis un site web
async function enrichFromSite(websiteUrl) {
  if (!websiteUrl || !websiteUrl.startsWith('http')) return {};
  try {
    const res = await fetchWithTimeout(websiteUrl, 6000);
    if (!res.ok) return {};
    const html = await res.text();
    const cheerio = require('cheerio');
    const $ = cheerio.load(html);
    return {
      title: $('title').first().text().trim().slice(0, 200),
      metaDescription: $('meta[name="description"]').attr('content')?.trim().slice(0, 300) || null,
      hasMobileViewport: !!$('meta[name="viewport"]').length,
      email: extractEmailsFromHtml(html)
    };
  } catch {
    return {};
  }
}

function extractEmailsFromHtml(html) {
  const matches = html.match(EMAIL_REGEX);
  if (!matches) return null;
  const filtered = matches.filter(e =>
    !e.includes('noreply') && !e.includes('no-reply') &&
    !e.includes('example') && !e.includes('w3.org') && !e.includes('schema.org')
  );
  return filtered[0] || null;
}

// Sauvegarder un lead en DB
async function saveLead(pool, lead) {
  const { createTableIfNotExists } = require('../services/db-migrations');
  await createTableIfNotExists(pool, 'daleba_leads', `
    CREATE TABLE IF NOT EXISTS daleba_leads (
      id SERIAL PRIMARY KEY,
      company_name TEXT,
      email TEXT,
      website TEXT,
      phone TEXT,
      city TEXT,
      country TEXT DEFAULT 'CA',
      address TEXT,
      source TEXT DEFAULT 'nominatim',
      status TEXT DEFAULT 'new',
      audit_score INTEGER,
      revenue_generated DECIMAL DEFAULT 0,
      created_at TIMESTAMPTZ DEFAULT NOW()
    )
  `);

  // Vérifier doublons
  const existing = await pool.query(
    'SELECT id FROM daleba_leads WHERE company_name = $1 AND city = $2',
    [lead.company_name, lead.city]
  );
  if (existing.rows.length > 0) return null;

  const result = await pool.query(
    `INSERT INTO daleba_leads (company_name, email, website, phone, city, country, address, source)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING *`,
    [lead.company_name, lead.email, lead.website, lead.phone, lead.city, lead.country || 'CA', lead.address, lead.source || 'nominatim']
  );
  return result.rows[0];
}

// Job principal de scraping
async function runLeadGenJob(jobData, pool) {
  const cities = jobData.cities || DEFAULT_CITIES;
  const query = jobData.query || 'salon coiffure';
  let totalFound = 0;
  let totalSaved = 0;

  console.log(`[LeadGen] Démarrage: ${cities.length} villes, query="${query}"`);

  for (const city of cities) {
    try {
      const salons = await searchSalons(city, query);
      console.log(`[LeadGen] ${city}: ${salons.length} résultats`);

      for (const salon of salons.slice(0, 10)) { // Max 10 par ville
        totalFound++;

        // Enrichissement si site web disponible
        let enriched = {};
        if (salon.website) {
          enriched = await enrichFromSite(salon.website);
          // Petite pause pour être respectueux
          await new Promise(r => setTimeout(r, 500));
        }

        const lead = {
          company_name: salon.name,
          email: enriched.email || null,
          website: salon.website,
          phone: salon.phone,
          city: city,
          country: detectCountry(city),
          address: salon.address
        };

        const saved = await saveLead(pool, lead);
        if (saved) {
          totalSaved++;
          // Si le lead a un site web → trigger audit SEO
          if (saved.website) {
            await addSeoAuditJob({ leadId: saved.id, website: saved.website, leadName: saved.company_name });
          }
        }
      }

      // Pause entre villes pour respecter Nominatim (1 req/sec)
      await new Promise(r => setTimeout(r, 1200));
    } catch (e) {
      console.warn(`[LeadGen] Erreur ville ${city}:`, e.message);
    }
  }

  console.log(`[LeadGen] Terminé: ${totalFound} trouvés, ${totalSaved} sauvegardés`);
  return { totalFound, totalSaved, cities: cities.length };
}

function detectCountry(city) {
  const caProvinces = ['Montréal', 'Québec', 'Laval', 'Longueuil', 'Gatineau', 'Sherbrooke',
    'Saguenay', 'Lévis', 'Terrebonne', 'Toronto', 'Ottawa', 'Calgary', 'Edmonton', 'Vancouver'];
  const frCities = ['Paris', 'Lyon', 'Marseille', 'Bordeaux', 'Toulouse', 'Nice', 'Nantes', 'Strasbourg'];
  const beCities = ['Bruxelles', 'Liège', 'Charleroi', 'Namur', 'Gand', 'Anvers'];

  if (caProvinces.some(c => city.toLowerCase().includes(c.toLowerCase()))) return 'CA';
  if (frCities.some(c => city.toLowerCase().includes(c.toLowerCase()))) return 'FR';
  if (beCities.some(c => city.toLowerCase().includes(c.toLowerCase()))) return 'BE';
  return 'CA';
}

module.exports = { runLeadGenJob, DEFAULT_CITIES };
