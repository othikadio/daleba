/**
 * DALEBA — Market Pricer (Squad #801-#850)
 * ==========================================
 * Analyse le prix du marché mondial en temps réel pour chaque type
 * de mission avant génération de la proposition commerciale.
 *
 * Sources :
 *  1. Lookup table interne (taux moyens Upwork/Freelancer/Toptal 2024-2025)
 *  2. Analyse historique daleba_opportunities (budget_estimated median par catégorie)
 *  3. LLM DeepSeek fallback pour catégories inconnues
 */
'use strict';

const https = require('https');

const DEEPSEEK_KEY = process.env.DEEPSEEK_API_KEY || 'sk-cca2191225a9417cb589dab3c7172015';

// ── Barème marché mondial (USD, par projet / mission freelance typique) ────────
// Source : Upwork Talent Marketplace 2024, Freelancer.com Global Index, Toptal rates
const MARKET_RATES = {
  // Développement Web & SaaS
  'web_dev':           { min: 800,  max: 6000,  avg: 2200, currency: 'USD' },
  'frontend':          { min: 600,  max: 4000,  avg: 1500, currency: 'USD' },
  'backend':           { min: 800,  max: 5000,  avg: 1800, currency: 'USD' },
  'fullstack':         { min: 1000, max: 7000,  avg: 2500, currency: 'USD' },
  'mobile':            { min: 2000, max: 12000, avg: 5000, currency: 'USD' },
  'saas':              { min: 3000, max: 15000, avg: 6000, currency: 'USD' },
  'wordpress':         { min: 400,  max: 2500,  avg: 900,  currency: 'USD' },
  'ecommerce':         { min: 800,  max: 6000,  avg: 2200, currency: 'USD' },

  // Automatisation & IA
  'automation':        { min: 600,  max: 4000,  avg: 1400, currency: 'USD' },
  'ai_agent':          { min: 800,  max: 6000,  avg: 2000, currency: 'USD' },
  'chatbot':           { min: 500,  max: 3500,  avg: 1300, currency: 'USD' },
  'machine_learning':  { min: 1500, max: 10000, avg: 3500, currency: 'USD' },
  'llm':               { min: 1000, max: 8000,  avg: 2800, currency: 'USD' },
  'workflow':          { min: 500,  max: 3000,  avg: 1100, currency: 'USD' },

  // Intégrations & API
  'api_integration':   { min: 500,  max: 4000,  avg: 1400, currency: 'USD' },
  'crm':               { min: 800,  max: 5000,  avg: 1800, currency: 'USD' },
  'erp':               { min: 1500, max: 8000,  avg: 3000, currency: 'USD' },
  'zapier':            { min: 300,  max: 2000,  avg: 700,  currency: 'USD' },
  'make':              { min: 300,  max: 2000,  avg: 750,  currency: 'USD' },
  'n8n':               { min: 400,  max: 2500,  avg: 900,  currency: 'USD' },

  // Marketing Digital
  'seo':               { min: 400,  max: 3000,  avg: 900,  currency: 'USD' },
  'google_ads':        { min: 300,  max: 2500,  avg: 800,  currency: 'USD' },
  'social_media':      { min: 200,  max: 1500,  avg: 550,  currency: 'USD' },
  'email_marketing':   { min: 200,  max: 1500,  avg: 600,  currency: 'USD' },
  'content':           { min: 100,  max: 800,   avg: 300,  currency: 'USD' },

  // Design
  'design':            { min: 200,  max: 2000,  avg: 700,  currency: 'USD' },
  'ui_ux':             { min: 500,  max: 4000,  avg: 1500, currency: 'USD' },
  'logo':              { min: 150,  max: 1000,  avg: 400,  currency: 'USD' },

  // Data & Analyse
  'data_analysis':     { min: 500,  max: 4000,  avg: 1400, currency: 'USD' },
  'database':          { min: 500,  max: 3500,  avg: 1300, currency: 'USD' },
  'bi':                { min: 800,  max: 5000,  avg: 1800, currency: 'USD' },
  'scraping':          { min: 300,  max: 2000,  avg: 700,  currency: 'USD' },

  // DevOps & Cloud
  'devops':            { min: 800,  max: 5000,  avg: 2000, currency: 'USD' },
  'aws':               { min: 600,  max: 4000,  avg: 1600, currency: 'USD' },
  'docker':            { min: 500,  max: 3000,  avg: 1200, currency: 'USD' },

  // Autre
  'translation':       { min: 80,   max: 500,   avg: 200,  currency: 'USD' },
  'autre':             { min: 200,  max: 2000,  avg: 600,  currency: 'USD' },
};

// ── Mots-clés → catégorie interne ──────────────────────────────────────────────
const KEYWORD_MAP = [
  [['saas', 'platform', 'subscription', 'multi-tenant'], 'saas'],
  [['wordpress', 'wp ', 'woocommerce', 'elementor'], 'wordpress'],
  [['shopify', 'woocommerce', 'e-commerce', 'ecommerce', 'boutique en ligne'], 'ecommerce'],
  [['mobile', 'ios', 'android', 'react native', 'flutter', 'swift', 'kotlin'], 'mobile'],
  [['machine learning', 'deep learning', 'neural', 'tensorflow', 'pytorch'], 'machine_learning'],
  [['llm', 'gpt', 'openai', 'claude', 'deepseek', 'mistral', 'gemini'], 'llm'],
  [['chatbot', 'virtual assistant', 'assistant virtuel', 'nlu', 'rasa'], 'chatbot'],
  [['ai agent', 'agent ia', 'ai automation', 'autonomous', 'autonome'], 'ai_agent'],
  [['workflow', 'zapier', 'make.com', 'n8n', 'automat'], 'workflow'],
  [['gohighlevel', 'highlevel', 'crm', 'hubspot', 'salesforce', 'zoho', 'pipedrive'], 'crm'],
  [['erp', 'sap', 'odoo', 'netsuite'], 'erp'],
  [['api', 'rest', 'graphql', 'webhook', 'integration', 'intégration'], 'api_integration'],
  [['seo', 'search engine', 'référencement', 'keyword', 'backlink'], 'seo'],
  [['google ads', 'facebook ads', 'meta ads', 'ppc', 'paid media'], 'google_ads'],
  [['social media', 'instagram', 'tiktok', 'linkedin', 'réseaux sociaux'], 'social_media'],
  [['email marketing', 'newsletter', 'mailchimp', 'klaviyo', 'sendgrid'], 'email_marketing'],
  [['ui', 'ux', 'figma', 'wireframe', 'prototype', 'design system'], 'ui_ux'],
  [['logo', 'branding', 'identity', 'identité visuelle'], 'logo'],
  [['data', 'analyse', 'analysis', 'power bi', 'tableau', 'looker'], 'data_analysis'],
  [['database', 'postgresql', 'mysql', 'mongodb', 'sql', 'base de données'], 'database'],
  [['scraping', 'crawling', 'spider', 'beautifsoup', 'selenium', 'playwright'], 'scraping'],
  [['devops', 'ci/cd', 'pipeline', 'kubernetes', 'helm', 'terraform'], 'devops'],
  [['aws', 'azure', 'gcp', 'cloud', 'lambda', 'serverless'], 'aws'],
  [['docker', 'container', 'compose'], 'docker'],
  [['translation', 'traduction', 'translate', 'localization'], 'translation'],
  [['react', 'vue', 'angular', 'next.js', 'nuxt', 'svelte'], 'frontend'],
  [['node.js', 'django', 'laravel', 'rails', 'fastapi', 'express'], 'backend'],
  [['fullstack', 'full-stack', 'full stack'], 'fullstack'],
];

// ── Détecte la catégorie depuis titre + description ────────────────────────────
function detectCategory(title = '', description = '') {
  const text = `${title} ${description}`.toLowerCase();
  for (const [keywords, category] of KEYWORD_MAP) {
    if (keywords.some(kw => text.includes(kw))) return category;
  }
  return null;
}

// ── Estimation LLM pour catégories non couvertes ───────────────────────────────
async function estimateViaLLM(title, category, budget_raw) {
  const prompt = `You are a freelance market pricing expert with access to Upwork, Freelancer.com, and Toptal 2024-2025 rate data.

Task: "${title}"
Category: "${category}"
Posted budget: "${budget_raw || 'not specified'}"

Estimate the REALISTIC market rate for this type of project/task (in USD, for a competent freelancer).
Reply ONLY with a JSON object:
{
  "market_rate_usd": <integer, typical project value>,
  "confidence": "high|medium|low",
  "reasoning": "<1 sentence>"
}`;

  return new Promise((resolve) => {
    const body = JSON.stringify({
      model: 'deepseek-chat',
      messages: [{ role: 'user', content: prompt }],
      temperature: 0.2,
      max_tokens: 200,
      response_format: { type: 'json_object' },
    });

    const req = https.request({
      hostname: 'api.deepseek.com',
      path: '/chat/completions',
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${DEEPSEEK_KEY}`,
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(body),
      },
      timeout: 20000,
    }, (res) => {
      let data = '';
      res.on('data', c => { data += c; });
      res.on('end', () => {
        try {
          const json  = JSON.parse(data);
          const inner = JSON.parse(json.choices?.[0]?.message?.content || '{}');
          resolve({
            marketRate:  inner.market_rate_usd || 600,
            confidence:  inner.confidence || 'low',
            reasoning:   inner.reasoning || '',
            method:      'llm_estimation',
          });
        } catch {
          resolve({ marketRate: 600, confidence: 'low', method: 'llm_fallback' });
        }
      });
    });

    req.on('error', () => resolve({ marketRate: 600, confidence: 'low', method: 'error_fallback' }));
    req.on('timeout', () => {
      req.destroy();
      resolve({ marketRate: 600, confidence: 'low', method: 'timeout_fallback' });
    });
    req.write(body);
    req.end();
  });
}

// ── Analyse historique DB (median budgets par catégorie) ───────────────────────
async function getHistoricalRate(pool, category) {
  if (!pool) return null;
  try {
    const { rows } = await pool.query(`
      SELECT
        PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY budget_estimated) AS median,
        AVG(budget_estimated) AS avg,
        COUNT(*) AS count
      FROM daleba_opportunities
      WHERE category = $1
        AND budget_estimated > 0
        AND status IN ('approved', 'sent', 'sent_to_client')
    `, [category]);
    const row = rows[0];
    if (row && parseFloat(row.count) >= 3) {
      return {
        marketRate: Math.round(parseFloat(row.median || row.avg)),
        confidence: parseFloat(row.count) >= 10 ? 'high' : 'medium',
        method:     'db_historical',
        sampleSize: parseInt(row.count),
      };
    }
  } catch { /* silencieux */ }
  return null;
}

// ── Fonction principale exportée ───────────────────────────────────────────────
/**
 * Analyse le prix du marché pour une opportunité.
 * @param {Object} opp  - Ligne daleba_opportunities
 * @param {Object} pool - Pool PostgreSQL (optionnel)
 * @returns {Promise<{marketRate: number, currency: string, confidence: string, category: string, method: string}>}
 */
async function analyzeMarketRate(opp, pool = null) {
  const category = opp.category || detectCategory(opp.title, opp.description_fr || opp.description_orig) || 'autre';

  // 1. Lookup table interne (source la plus fiable et la plus rapide)
  const tableRate = MARKET_RATES[category] || MARKET_RATES['autre'];

  // 2. Historique DB (si assez de données)
  const historical = await getHistoricalRate(pool, category);

  // 3. Si le budget_raw est lisible, essayer d'en extraire un montant
  let rawExtracted = null;
  if (opp.budget_raw) {
    const match = opp.budget_raw.match(/\$?\s*([0-9][0-9 ,.]*)/);
    if (match) {
      const val = parseFloat(match[1].replace(/[ ,]/g, ''));
      if (val > 0) rawExtracted = val;
    }
  }

  // ── Fusion des sources — priorité : DB historical > budget_raw > lookup table
  let marketRate, confidence, method;

  if (historical && historical.marketRate > 0) {
    marketRate = historical.marketRate;
    confidence = historical.confidence;
    method     = historical.method;
  } else if (rawExtracted && rawExtracted > tableRate.min) {
    // Budget annoncé lisible → signal de marché le plus direct
    marketRate = rawExtracted;
    confidence = 'high';
    method     = 'budget_raw_parsed';
  } else {
    // Fallback : lookup table (valeur moyenne)
    marketRate = tableRate.avg;
    confidence = 'medium';
    method     = 'lookup_table';
  }

  // 4. Si confiance basse et catégorie non standard → LLM estimation
  if (confidence === 'low' && !MARKET_RATES[category]) {
    const llm = await estimateViaLLM(opp.title, category, opp.budget_raw);
    if (llm.marketRate > 0) {
      marketRate = llm.marketRate;
      confidence = llm.confidence;
      method     = llm.method;
    }
  }

  console.log(`[market-pricer] #801 — "${(opp.title || '').slice(0, 50)}" | cat:${category} | taux marché: ${marketRate} USD | méthode: ${method}`);

  return {
    marketRate,
    currency:   'USD',
    confidence,
    category,
    method,
    tableRange: tableRate ? { min: tableRate.min, max: tableRate.max } : null,
  };
}

module.exports = { analyzeMarketRate, detectCategory, MARKET_RATES };
