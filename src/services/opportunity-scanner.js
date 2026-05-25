/**
 * Opportunity Scanner — Radar Planétaire
 * Sources gratuites / sans auth : Reddit JSON, HN Algolia, Upwork RSS, Freelancer API
 */
'use strict';

const https = require('https');
const http  = require('http');

// ── Helpers ────────────────────────────────────────────────────────────────

function fetchUrl(url, opts = {}) {
  return new Promise((resolve, reject) => {
    const mod = url.startsWith('https') ? https : http;
    const options = {
      headers: {
        'User-Agent': 'DalebaRadar/1.0 (opportunity-scanner; +https://daleba.io)',
        ...(opts.headers || {}),
      },
      timeout: 12000,
    };
    const req = mod.get(url, options, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        return resolve(fetchUrl(res.headers.location, opts));
      }
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => resolve({ status: res.statusCode, body: data }));
    });
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error('Timeout')); });
  });
}

function safeJSON(str) {
  try { return JSON.parse(str); } catch { return null; }
}

function extractBudget(text = '') {
  const m = text.match(/\$[\d,]+(?:\s*[-–]\s*\$[\d,]+)?|\d[\d,]*\s*(?:USD|EUR|CAD|GBP)/i);
  return m ? m[0] : null;
}

// ── Source 1 : Reddit JSON API ─────────────────────────────────────────────

const REDDIT_SUBS = [
  { sub: 'forhire',           label: 'r/forhire' },
  { sub: 'hire',              label: 'r/hire' },
  { sub: 'entrepreneur',      label: 'r/entrepreneur' },
  { sub: 'SaaS',              label: 'r/SaaS' },
  { sub: 'webdev',            label: 'r/webdev' },
  { sub: 'learnprogramming',  label: 'r/learnprogramming' },
];

const REDDIT_KEYWORDS = ['API', 'automation', 'chatbot', 'integrate', 'automate', 'bot', 'workflow', 'SaaS', 'booking'];

async function scanReddit() {
  const results = [];
  for (const { sub, label } of REDDIT_SUBS) {
    try {
      const url = `https://www.reddit.com/r/${sub}/new.json?limit=25`;
      const { status, body } = await fetchUrl(url);
      if (status !== 200) continue;
      const json = safeJSON(body);
      if (!json?.data?.children) continue;

      for (const item of json.data.children) {
        const p = item.data || {};
        const text = `${p.title || ''} ${p.selftext || ''}`.toLowerCase();
        const relevant = REDDIT_KEYWORDS.some(k => text.includes(k.toLowerCase()));
        if (!relevant && !['forhire', 'hire'].includes(sub)) continue;

        results.push({
          platform:    label,
          url:         `https://www.reddit.com${p.permalink || ''}`,
          title:       p.title || '',
          description: p.selftext ? p.selftext.slice(0, 2000) : '',
          budget_raw:  extractBudget(p.title + ' ' + p.selftext),
          country:     null,
          language:    'en',
          detected_at: new Date(),
        });
      }
    } catch (err) {
      console.warn(`[scanner] Reddit ${label}: ${err.message}`);
    }
  }
  return results;
}

// ── Source 2 : Hacker News Algolia ─────────────────────────────────────────

const HN_QUERIES = ['automation API hire', 'freelance chatbot LLM', 'API integration developer'];

async function scanHackerNews() {
  const results = [];
  for (const q of HN_QUERIES) {
    try {
      const url = `https://hn.algolia.com/api/v1/search?query=${encodeURIComponent(q)}&tags=story&hitsPerPage=20`;
      const { status, body } = await fetchUrl(url);
      if (status !== 200) continue;
      const json = safeJSON(body);
      if (!json?.hits) continue;

      for (const hit of json.hits) {
        if (!hit.title) continue;
        results.push({
          platform:    'Hacker News',
          url:         hit.url || `https://news.ycombinator.com/item?id=${hit.objectID}`,
          title:       hit.title,
          description: (hit.story_text || '').slice(0, 2000),
          budget_raw:  extractBudget(hit.title + ' ' + (hit.story_text || '')),
          country:     null,
          language:    'en',
          detected_at: new Date(),
        });
      }
    } catch (err) {
      console.warn(`[scanner] HN "${q}": ${err.message}`);
    }
  }
  return results;
}


// ── Source : Remotive.io — API JSON publique (remote tech jobs) ─────────────

const REMOTIVE_CATS = ['software-dev', 'devops-sysadmin', 'data'];
const RELEVANT_TAGS = ['api','automation','bot','chatbot','integration','saas','llm','ai','workflow','crm','erp'];

async function scanRemotive() {
  const results = [];
  for (const cat of REMOTIVE_CATS) {
    try {
      const url = `https://remotive.com/api/remote-jobs?category=${cat}&limit=30`;
      const { status, body } = await fetchUrl(url);
      if (status !== 200) continue;
      const json = safeJSON(body);
      const jobs = json?.jobs || [];
      for (const job of jobs) {
        const text = `${job.title} ${job.description || ''} ${(job.tags||[]).join(' ')}`.toLowerCase();
        const matched = RELEVANT_TAGS.filter(k => text.includes(k));
        if (matched.length === 0) continue;
        results.push({
          platform:    'Remotive',
          url:         job.url,
          title:       job.title,
          description: (job.description || '').replace(/<[^>]+>/g,'').slice(0, 2000),
          budget_raw:  extractBudget(job.salary || ''),
          country:     job.candidate_required_location || 'Worldwide',
          language:    'en',
          detected_at: new Date(),
        });
      }
    } catch (err) { console.warn(`[scanner] Remotive ${cat}: ${err.message}`); }
  }
  return results;
}

// ── Source : WeWorkRemotely RSS ─────────────────────────────────────────────

async function scanWeWorkRemotely() {
  const results = [];
  try {
    const url = 'https://weworkremotely.com/remote-jobs.rss';
    const { status, body } = await fetchUrl(url);
    if (status !== 200) return results;
    const items = parseRSS(body);
    for (const item of items) {
      const text = `${item.title} ${item.description}`.toLowerCase();
      const matched = RELEVANT_TAGS.filter(k => text.includes(k));
      if (matched.length === 0) continue;
      results.push({
        platform:    'WeWorkRemotely',
        url:         item.link,
        title:       item.title,
        description: item.description,
        budget_raw:  extractBudget(item.title + ' ' + item.description),
        country:     'Worldwide',
        language:    'en',
        detected_at: new Date(),
      });
    }
  } catch (err) { console.warn(`[scanner] WeWorkRemotely: ${err.message}`); }
  return results;
}

// ── Source 3 : Upwork RSS ──────────────────────────────────────────────────

function parseRSS(xml) {
  const items = [];
  const itemRx = /<item[^>]*>([\s\S]*?)<\/item>/gi;
  let m;
  while ((m = itemRx.exec(xml)) !== null) {
    const block = m[1];
    const get = (tag) => {
      const r = new RegExp(`<${tag}[^>]*><!\\[CDATA\\[([\\s\\S]*?)\\]\\]><\\/${tag}>|<${tag}[^>]*>([^<]*)<\\/${tag}>`, 'i');
      const x = r.exec(block);
      return x ? (x[1] || x[2] || '').trim() : '';
    };
    items.push({
      title:       get('title'),
      link:        get('link'),
      description: get('description').replace(/<[^>]+>/g, '').slice(0, 2000),
    });
  }
  return items;
}

async function scanUpwork() {
  const results = [];
  const urls = [
    'https://www.upwork.com/ab/feed/jobs/rss?q=automation+api+integration&sort=recency',
    'https://www.upwork.com/ab/feed/jobs/rss?q=chatbot+ai+automation&sort=recency',
  ];
  for (const url of urls) {
    try {
      const { status, body } = await fetchUrl(url);
      if (status !== 200) continue;
      const items = parseRSS(body);
      for (const item of items) {
        if (!item.title) continue;
        results.push({
          platform:    'Upwork',
          url:         item.link,
          title:       item.title,
          description: item.description,
          budget_raw:  extractBudget(item.title + ' ' + item.description),
          country:     null,
          language:    'en',
          detected_at: new Date(),
        });
      }
    } catch (err) {
      console.warn(`[scanner] Upwork: ${err.message}`);
    }
  }
  return results;
}

// ── Source 4 : PeoplePerHour (HTML scrape) ─────────────────────────────────

async function scanPeoplePerHour() {
  const results = [];
  try {
    const url = 'https://www.peopleperhour.com/freelance-jobs?term=automation+api';
    const { status, body } = await fetchUrl(url);
    if (status !== 200) return results;

    // Extract job title + links from HTML (basic regex scrape)
    const linkRx = /href="(\/job\/[^"]+)"[^>]*>\s*([^<]{10,200})/gi;
    let m;
    const seen = new Set();
    while ((m = linkRx.exec(body)) !== null) {
      const path   = m[1];
      const title  = m[2].trim().replace(/\s+/g, ' ');
      if (seen.has(path)) continue;
      seen.add(path);
      results.push({
        platform:    'PeoplePerHour',
        url:         `https://www.peopleperhour.com${path}`,
        title,
        description: '',
        budget_raw:  extractBudget(title),
        country:     null,
        language:    'en',
        detected_at: new Date(),
      });
    }
  } catch (err) {
    console.warn(`[scanner] PeoplePerHour: ${err.message}`);
  }
  return results;
}

// ── Source 5 : Freelancer.com API publique ─────────────────────────────────

async function scanFreelancer() {
  const results = [];
  try {
    const url = 'https://www.freelancer.com/api/projects/0.1/projects/active/?job_details=true&query=api+automation&limit=20';
    const { status, body } = await fetchUrl(url, {
      headers: { 'freelancer-oauth-v1': '' },
    });
    if (status !== 200) return results;
    const json = safeJSON(body);
    const projects = json?.result?.projects || [];
    for (const p of projects) {
      results.push({
        platform:    'Freelancer',
        url:         `https://www.freelancer.com/projects/${p.seo_url || p.id}`,
        title:       p.title || '',
        description: (p.description || '').slice(0, 2000),
        budget_raw:  p.budget ? `${p.budget.minimum}-${p.budget.maximum} ${p.currency?.code || 'USD'}` : null,
        country:     p.location?.country?.name || null,
        language:    'en',
        detected_at: new Date(),
      });
    }
  } catch (err) {
    console.warn(`[scanner] Freelancer: ${err.message}`);
  }
  return results;
}

// ── Export principal ────────────────────────────────────────────────────────

async function scanAll() {
  console.log('[scanner] Démarrage scan toutes sources...');
  const settled = await Promise.allSettled([
    scanHackerNews(),
    scanRemotive(),
    scanWeWorkRemotely(),
    scanUpwork(),
    scanFreelancer(),
  ]);

  const all = [];
  const names = ['HackerNews', 'Remotive', 'WeWorkRemotely', 'Upwork', 'Freelancer'];
  settled.forEach((result, i) => {
    if (result.status === 'fulfilled') {
      console.log(`[scanner] ${names[i]}: ${result.value.length} résultats`);
      all.push(...result.value);
    } else {
      console.warn(`[scanner] ${names[i]} échoué: ${result.reason?.message}`);
    }
  });

  console.log(`[scanner] Total brut: ${all.length} opportunités`);
  return all;
}

module.exports = { scanAll, scanHackerNews, scanRemotive, scanWeWorkRemotely, scanUpwork, scanFreelancer };
