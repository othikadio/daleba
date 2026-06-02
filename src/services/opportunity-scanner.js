/**
 * Opportunity Scanner — Radar Planétaire v2
 * Sources actives (testées juin 2026) :
 *   ✅ HackerNews Algolia, Remotive, WeWorkRemotely, Freelancer
 *   ✅ RemoteOK API (remplace Upwork 410 + Guru Cloudflare)
 *   ✅ Jobicy API (remplace PeoplePerHour Cloudflare)
 *   ✅ HN Who-is-Hiring thread (remplace Reddit 403)
 *   ✅ GitHub Issues + token (5000 req/h, remplace 60/h)
 *   ✅ Toptal blog HTML scrape (RSS 403 → HTML 200)
 */
'use strict';

const https = require('https');
const http  = require('http');

const GITHUB_TOKEN = process.env.GITHUB_TOKEN || '';

// ── Helpers ────────────────────────────────────────────────────────────────

function fetchUrl(url, opts = {}) {
  return new Promise((resolve, reject) => {
    const mod = url.startsWith('https') ? https : http;
    const options = {
      headers: {
        'User-Agent': 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
        'Accept': 'application/json, text/html, */*',
        ...(opts.headers || {}),
      },
      timeout: 14000,
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

const RELEVANT_TAGS = ['api','automation','bot','chatbot','integration','saas','llm','ai','workflow','crm','erp','consultant'];

// ── Source 1 : Hacker News Algolia ─────────────────────────────────────────

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

// ── Source 2 : HN Who-Is-Hiring — thread mensuel ───────────────────────────
// Remplace Reddit (403 depuis 2024)

async function scanHNWhoIsHiring() {
  const results = [];
  try {
    // Récupérer le thread mensuel "Who is hiring?" le plus récent
    const searchUrl = 'https://hn.algolia.com/api/v1/search?query=Ask+HN%3A+Who+is+hiring&tags=ask_hn&hitsPerPage=3';
    const { status, body } = await fetchUrl(searchUrl);
    if (status !== 200) return results;
    const json = safeJSON(body);
    const thread = json?.hits?.[0];
    if (!thread) return results;

    const threadId = thread.objectID;
    console.log(`[scanner] HN Who-is-Hiring thread: ${thread.title} (${threadId})`);

    // Récupérer les commentaires du thread (top-level = offres d'emploi)
    const commUrl = `https://hn.algolia.com/api/v1/search?tags=comment,story_${threadId}&hitsPerPage=50&page=0`;
    const { status: s2, body: b2 } = await fetchUrl(commUrl);
    if (s2 !== 200) return results;
    const json2 = safeJSON(b2);

    for (const hit of (json2?.hits || [])) {
      const text = (hit.comment_text || hit.story_text || '').replace(/<[^>]+>/g, '');
      if (text.length < 50) continue;
      // Extraire la première ligne comme titre
      const firstLine = text.split('\n').find(l => l.trim().length > 10) || text.slice(0, 100);
      const relevant = RELEVANT_TAGS.some(k => text.toLowerCase().includes(k));
      if (!relevant && text.length < 200) continue;
      results.push({
        platform:    'HN Who-is-Hiring',
        url:         `https://news.ycombinator.com/item?id=${hit.objectID}`,
        title:       firstLine.slice(0, 150),
        description: text.slice(0, 2000),
        budget_raw:  extractBudget(text),
        country:     null,
        language:    'en',
        detected_at: new Date(),
      });
    }
    console.log(`[scanner] HN Who-is-Hiring: ${results.length} offres extraites`);
  } catch (err) {
    console.warn(`[scanner] HN Who-is-Hiring: ${err.message}`);
  }
  return results;
}

// ── Source 3 : Remotive.io ─────────────────────────────────────────────────

const REMOTIVE_CATS = ['software-dev', 'devops-sysadmin', 'data'];

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

// ── Source 4 : WeWorkRemotely RSS ──────────────────────────────────────────

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

// ── Source 5 : RemoteOK API — remplace Upwork (410) + Guru (Cloudflare) ────
// API publique JSON, pas d'auth, données riches

const REMOTEOK_TAG_SETS = [
  'saas,ai',
  'backend,api',
  'automation,python',
  'javascript,api',
];

async function scanRemoteOK() {
  const results = [];
  const seen = new Set();
  for (const tags of REMOTEOK_TAG_SETS) {
    try {
      const url = `https://remoteok.com/api?tags=${tags}`;
      const { status, body } = await fetchUrl(url, {
        headers: { 'Accept': 'application/json' },
      });
      if (status !== 200) continue;
      const json = safeJSON(body);
      if (!Array.isArray(json)) continue;
      const jobs = json.filter(x => x && x.position && x.url);
      for (const job of jobs) {
        if (seen.has(job.id || job.url)) continue;
        seen.add(job.id || job.url);
        const text = `${job.position} ${job.description || ''} ${(job.tags||[]).join(' ')}`.toLowerCase();
        const matched = RELEVANT_TAGS.filter(k => text.includes(k));
        if (matched.length === 0 && !text.includes('engineer') && !text.includes('develop')) continue;
        results.push({
          platform:    'RemoteOK',
          url:         job.url || `https://remoteok.com/remote-jobs/${job.id}`,
          title:       job.position,
          description: (job.description || '').replace(/<[^>]+>/g,'').slice(0, 2000),
          budget_raw:  job.salary || extractBudget(job.position + ' ' + (job.description||'')),
          country:     job.location || 'Worldwide',
          language:    'en',
          detected_at: new Date(),
        });
      }
    } catch (err) {
      console.warn(`[scanner] RemoteOK [${tags}]: ${err.message}`);
    }
  }
  console.log(`[scanner] RemoteOK: ${results.length} offres (4 tag-sets)`);
  return results;
}

// ── Source 6 : Jobicy API — remplace PeoplePerHour (Cloudflare) ────────────
// API REST publique, gratuite, structurée

const JOBICY_TAGS = ['api', 'automation', 'saas', 'ai'];

async function scanJobicy() {
  const results = [];
  const seen = new Set();
  for (const tag of JOBICY_TAGS) {
    try {
      const url = `https://jobicy.com/api/v2/remote-jobs?count=15&tag=${tag}`;
      const { status, body } = await fetchUrl(url);
      if (status !== 200) continue;
      const json = safeJSON(body);
      for (const job of (json?.jobs || [])) {
        const key = job.jobSlug || job.url;
        if (seen.has(key)) continue;
        seen.add(key);
        results.push({
          platform:    'Jobicy',
          url:         job.jobGeo ? `https://jobicy.com/jobs/${job.jobSlug}` : (job.url || ''),
          title:       job.jobTitle || '',
          description: (job.jobDescription || '').replace(/<[^>]+>/g,'').slice(0, 2000),
          budget_raw:  extractBudget(job.jobSalary || job.jobTitle || ''),
          country:     job.jobGeo || 'Worldwide',
          language:    'en',
          detected_at: new Date(),
        });
      }
    } catch (err) {
      console.warn(`[scanner] Jobicy [${tag}]: ${err.message}`);
    }
  }
  console.log(`[scanner] Jobicy: ${results.length} offres (4 tags)`);
  return results;
}

// ── Source 7 : Freelancer.com API ─────────────────────────────────────────

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

// ── Source 8 : GitHub Issues — avec token (5000 req/h) ────────────────────
// Remplace la version sans auth (60 req/h, souvent bloquée)

const GITHUB_QUERIES = [
  'automation saas api is:open label:help-wanted',
  'chatbot integration freelance is:open label:good-first-issue',
  'api consulting developer is:open label:help-wanted',
];

async function scanGitHub() {
  const results = [];
  const headers = {
    'Authorization': `token ${GITHUB_TOKEN}`,
    'Accept': 'application/vnd.github.v3+json',
    'User-Agent': 'DALEBA-Scanner/2.0',
  };
  for (const q of GITHUB_QUERIES) {
    try {
      const url = `https://api.github.com/search/issues?q=${encodeURIComponent(q)}&sort=created&per_page=12`;
      const { status, body } = await fetchUrl(url, { headers });
      if (status !== 200) continue;
      const json = safeJSON(body);
      for (const issue of (json?.items || [])) {
        results.push({
          platform:    'GitHub',
          url:         issue.html_url,
          title:       issue.title,
          description: (issue.body || '').slice(0, 1500),
          budget_raw:  extractBudget(issue.body || ''),
          country:     null,
          language:    'en',
          detected_at: new Date(),
        });
      }
    } catch (err) {
      console.warn(`[scanner] GitHub: ${err.message}`);
    }
  }
  return results;
}

// ── Source 9 : Toptal blog — scrape HTML (RSS 403, HTML 200) ──────────────
// Extrait les articles sur automation/AI/freelance

async function scanToptal() {
  const results = [];
  try {
    const { status, body } = await fetchUrl('https://www.toptal.com/blog', {
      headers: { 'Accept': 'text/html' },
    });
    if (status !== 200) return results;

    // Extraire liens + titres d'articles
    const linkRx = /href="(\/[a-z][a-z0-9\-\/]+)"[^>]*>\s*<[^>]+>\s*([^<]{15,200})/gi;
    const seen = new Set();
    let m;
    const TOPTAL_KW = ['automat', 'api', 'freelan', 'saas', 'chatbot', 'integration', 'ai ', 'llm', 'workflow'];
    while ((m = linkRx.exec(body)) !== null) {
      const path  = m[1];
      const title = m[2].trim().replace(/\s+/g, ' ');
      if (seen.has(path) || title.length < 15) continue;
      const relevant = TOPTAL_KW.some(k => title.toLowerCase().includes(k) || path.includes(k));
      if (!relevant) continue;
      seen.add(path);
      results.push({
        platform:    'Toptal',
        url:         `https://www.toptal.com${path}`,
        title,
        description: '',
        budget_raw:  null,
        country:     'Worldwide',
        language:    'en',
        detected_at: new Date(),
      });
    }
    console.log(`[scanner] Toptal blog: ${results.length} articles pertinents`);
  } catch (err) {
    console.warn(`[scanner] Toptal: ${err.message}`);
  }
  return results;
}

// ── Source 10 : Ask HN / YC Freelance ─────────────────────────────────────

async function scanYCFreelance() {
  const results = [];
  try {
    const queries = ['consulting automation', 'hire freelance ai'];
    for (const q of queries) {
      const url = `https://hn.algolia.com/api/v1/search?query=${encodeURIComponent(q)}&tags=ask_hn&hitsPerPage=10`;
      const { status, body } = await fetchUrl(url);
      if (status !== 200) continue;
      const json = safeJSON(body);
      for (const hit of (json?.hits || [])) {
        if (!hit.title || hit.title.length < 10) continue;
        results.push({
          platform:    'Ask HN',
          url:         hit.url || `https://news.ycombinator.com/item?id=${hit.objectID}`,
          title:       hit.title,
          description: (hit.story_text || hit.comment_text || '').slice(0, 800),
          budget_raw:  null,
          country:     null,
          language:    'en',
          detected_at: new Date(),
        });
      }
    }
  } catch (err) { console.warn(`[scanner] YCFreelance: ${err.message}`); }
  return results;
}

// ── scanAll : 10 sources actives ────────────────────────────────────────────

async function scanAll() {
  console.log('[scanner] 🌍 Démarrage scan v2 — 10 sources mondiales...');
  const settled = await Promise.allSettled([
    scanHackerNews(),      // HN Algolia
    scanHNWhoIsHiring(),   // HN Who-is-Hiring (remplace Reddit)
    scanRemotive(),        // Remotive API
    scanWeWorkRemotely(),  // WeWorkRemotely RSS
    scanRemoteOK(),        // RemoteOK API (remplace Upwork + Guru)
    scanJobicy(),          // Jobicy API (remplace PeoplePerHour)
    scanFreelancer(),      // Freelancer.com API
    scanGitHub(),          // GitHub Issues + token
    scanYCFreelance(),     // Ask HN
    scanToptal(),          // Toptal blog HTML
  ]);

  const names = ['HackerNews','HN-WhoIsHiring','Remotive','WeWorkRemotely','RemoteOK','Jobicy','Freelancer','GitHub','AskHN','Toptal'];
  const all = [];
  settled.forEach((result, i) => {
    if (result.status === 'fulfilled') {
      console.log(`[scanner] ✅ ${names[i]}: ${result.value.length} résultats`);
      all.push(...result.value);
    } else {
      console.warn(`[scanner] ❌ ${names[i]} échoué:`, result.reason?.message);
    }
  });

  console.log(`[scanner] 📊 Total brut: ${all.length} opportunités`);
  return all;
}

// Scan segmenté par escouade
async function scanBySquad(squadId) {
  const squads = {
    americas:   [scanHackerNews, scanHNWhoIsHiring, scanRemotive, scanRemoteOK],
    europe:     [scanWeWorkRemotely, scanFreelancer, scanJobicy, scanToptal],
    global:     [scanGitHub, scanYCFreelance, scanRemoteOK, scanJobicy],
    freelance:  [scanFreelancer, scanJobicy, scanRemoteOK, scanHNWhoIsHiring],
  };
  const fns = squads[squadId] || squads.global;
  const settled = await Promise.allSettled(fns.map(f => f()));
  const results = [];
  settled.forEach(r => { if(r.status === 'fulfilled') results.push(...r.value); });
  return results;
}

module.exports = {
  scanAll, scanBySquad,
  scanHackerNews, scanHNWhoIsHiring, scanRemotive, scanWeWorkRemotely,
  scanRemoteOK, scanJobicy, scanFreelancer, scanGitHub, scanYCFreelance, scanToptal,
  // Aliases pour compatibilité
  scanUpwork: scanRemoteOK,
  scanReddit: scanHNWhoIsHiring,
  scanPeoplePerHour: scanJobicy,
  scanGuru: scanRemoteOK,
};
