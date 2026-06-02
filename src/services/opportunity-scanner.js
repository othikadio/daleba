/**
 * Opportunity Scanner — Radar Planétaire v3
 * Sources VALIDÉES (testées juin 2026) — uniquement projets freelance/bounty réels :
 *
 *   ✅ HackerNews Algolia       — stories ask-hn hiring
 *   ✅ HN Who-is-Hiring         — thread mensuel commentaires (offres diverses)
 *   ✅ Remotive API             — remote jobs avec tags saas/api/automation
 *   ✅ WeWorkRemotely RSS       — remote jobs filtrés
 *   ✅ Freelancer.com API       — 3 queries projets freelance (chatbot, api, whatsapp)
 *   ✅ Codeur.com RSS           — projets freelance français (app, IA, web)
 *   ✅ GitHub Issues + token    — issues bounty payants ($) 212+ résultats
 *   ✅ Ask HN Freelance         — posts consulting/hire sur HN
 *   ✅ Replit Bounties HTML     — bounties codage (extraction JSON embedé)
 *   ✅ RemoteOK API             — remote jobs tech (complément volume)
 *
 * Supprimées : Upwork (410), Reddit (403), PeoplePerHour (CF), Guru (CF), Toptal (403)
 * RemoteOK/Jobicy gardés pour volume mais classifieur filtre les CDI
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

const RELEVANT_TAGS = ['api','automation','bot','chatbot','integration','saas','llm','ai','workflow','crm','erp'];

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

// ── Source 2 : HN Who-Is-Hiring thread mensuel ─────────────────────────────

async function scanHNWhoIsHiring() {
  const results = [];
  try {
    const searchUrl = 'https://hn.algolia.com/api/v1/search?query=Ask+HN%3A+Who+is+hiring&tags=ask_hn&hitsPerPage=3';
    const { status, body } = await fetchUrl(searchUrl);
    if (status !== 200) return results;
    const json = safeJSON(body);
    const thread = json?.hits?.[0];
    if (!thread) return results;

    const threadId = thread.objectID;
    const commUrl = `https://hn.algolia.com/api/v1/search?tags=comment,story_${threadId}&hitsPerPage=50&page=0`;
    const { status: s2, body: b2 } = await fetchUrl(commUrl);
    if (s2 !== 200) return results;
    const json2 = safeJSON(b2);

    for (const hit of (json2?.hits || [])) {
      const text = (hit.comment_text || hit.story_text || '').replace(/<[^>]+>/g, '');
      if (text.length < 50) continue;
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
    console.log(`[scanner] HN Who-is-Hiring: ${results.length} offres`);
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
      for (const job of (json?.jobs || [])) {
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
    items.push({ title: get('title'), link: get('link'), description: get('description').replace(/<[^>]+>/g, '').slice(0, 2000) });
  }
  return items;
}

async function scanWeWorkRemotely() {
  const results = [];
  try {
    const { status, body } = await fetchUrl('https://weworkremotely.com/remote-jobs.rss');
    if (status !== 200) return results;
    for (const item of parseRSS(body)) {
      const text = `${item.title} ${item.description}`.toLowerCase();
      if (!RELEVANT_TAGS.some(k => text.includes(k))) continue;
      results.push({
        platform: 'WeWorkRemotely', url: item.link, title: item.title,
        description: item.description, budget_raw: extractBudget(item.title + ' ' + item.description),
        country: 'Worldwide', language: 'en', detected_at: new Date(),
      });
    }
  } catch (err) { console.warn(`[scanner] WeWorkRemotely: ${err.message}`); }
  return results;
}

// ── Source 5 : Freelancer.com — 3 queries projets réels ───────────────────

const FREELANCER_QUERIES = ['chatbot+automation', 'api+integration', 'whatsapp+bot'];

async function scanFreelancer() {
  const results = [];
  const seen = new Set();
  for (const q of FREELANCER_QUERIES) {
    try {
      const url = `https://www.freelancer.com/api/projects/0.1/projects/active/?job_details=true&query=${q}&limit=15`;
      const { status, body } = await fetchUrl(url, { headers: { 'freelancer-oauth-v1': '' } });
      if (status !== 200) continue;
      const json = safeJSON(body);
      for (const p of (json?.result?.projects || [])) {
        if (seen.has(p.id)) continue;
        seen.add(p.id);
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
    } catch (err) { console.warn(`[scanner] Freelancer [${q}]: ${err.message}`); }
  }
  console.log(`[scanner] Freelancer: ${results.length} projets (3 queries)`);
  return results;
}

// ── Source 6 : Codeur.com RSS — projets freelance FR ──────────────────────
// Plateforme française de projets freelance, RSS public et structuré

async function scanCodeur() {
  const results = [];
  try {
    const { status, body } = await fetchUrl('https://www.codeur.com/projects.rss');
    if (status !== 200) return results;

    // Structure RSS Codeur : <title> sans CDATA
    const itemRx = /<item>([\s\S]*?)<\/item>/gi;
    let m;
    while ((m = itemRx.exec(body)) !== null) {
      const block = m[1];
      const getTag = (tag) => {
        const rx = new RegExp(`<${tag}>([^<]+)<\/${tag}>`, 'i');
        const r = rx.exec(block);
        return r ? r[1].trim() : '';
      };
      const title = getTag('title');
      const link  = getTag('link');
      const desc  = getTag('description').replace(/&amp;|&lt;|&gt;|&quot;|&#39;/g, ' ');
      if (!title || title.length < 10 || title === 'Tous les projets') continue;
      results.push({
        platform:    'Codeur',
        url:         link || 'https://www.codeur.com/projects',
        title,
        description: desc.slice(0, 2000),
        budget_raw:  extractBudget(title + ' ' + desc),
        country:     'France',
        language:    'fr',
        detected_at: new Date(),
      });
    }
    console.log(`[scanner] Codeur.com: ${results.length} projets FR`);
  } catch (err) { console.warn(`[scanner] Codeur: ${err.message}`); }
  return results;
}

// ── Source 7 : GitHub Issues — bounties payants ────────────────────────────
// Filtre sur issues avec label bounty ou $ dans le titre/body

const GITHUB_QUERIES = [
  'label:bounty+automation+api+is:open',
  'bounty+chatbot+saas+is:open',
  '"paid bounty"+api+is:open',
];

async function scanGitHub() {
  const results = [];
  const headers = {
    'Accept': 'application/vnd.github.v3+json',
    'User-Agent': 'DALEBA-Scanner/3.0',
    ...(GITHUB_TOKEN ? { 'Authorization': `token ${GITHUB_TOKEN}` } : {}),
  };
  for (const q of GITHUB_QUERIES) {
    try {
      const url = `https://api.github.com/search/issues?q=${encodeURIComponent(q)}&sort=created&per_page=12`;
      const { status, body } = await fetchUrl(url, { headers });
      if (status !== 200) continue;
      const json = safeJSON(body);
      for (const issue of (json?.items || [])) {
        const hasBudget = extractBudget(issue.title + ' ' + (issue.body || ''));
        const hasPayment = /\$\d|\€\d|bounty|reward|paid|payout/i.test(issue.title + ' ' + (issue.body || ''));
        results.push({
          platform:    'GitHub Bounty',
          url:         issue.html_url,
          title:       issue.title,
          description: (issue.body || '').slice(0, 1500),
          budget_raw:  hasBudget,
          country:     null,
          language:    'en',
          detected_at: new Date(),
        });
      }
    } catch (err) { console.warn(`[scanner] GitHub: ${err.message}`); }
  }
  return results;
}

// ── Source 8 : Ask HN Freelance ────────────────────────────────────────────

async function scanYCFreelance() {
  const results = [];
  try {
    for (const q of ['consulting automation api', 'hire freelance chatbot ai']) {
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
          budget_raw:  null, country: null, language: 'en', detected_at: new Date(),
        });
      }
    }
  } catch (err) { console.warn(`[scanner] YCFreelance: ${err.message}`); }
  return results;
}

// ── Source 9 : Replit Bounties — projets avec budget ──────────────────────

async function scanReplitBounties() {
  const results = [];
  try {
    const { status, body } = await fetchUrl('https://replit.com/bounties', {
      headers: { 'Accept': 'text/html' },
    });
    if (status !== 200) return results;

    // Extraire les bounties depuis le JSON embedé dans le HTML (Next.js __NEXT_DATA__)
    const jsonMatch = body.match(/<script id="__NEXT_DATA__" type="application\/json">([^<]+)<\/script>/);
    if (jsonMatch) {
      const pageData = safeJSON(jsonMatch[1]);
      const bounties = pageData?.props?.pageProps?.bounties || pageData?.props?.pageProps?.initialBounties || [];
      for (const b of bounties.slice(0, 20)) {
        const title = b.title || b.name || '';
        const amount = b.bountyAmount || b.amount || 0;
        if (!title || amount < 50) continue; // ignorer bounties < $50
        results.push({
          platform:    'Replit Bounty',
          url:         b.slug ? `https://replit.com/bounties/${b.slug}` : 'https://replit.com/bounties',
          title,
          description: (b.description || b.descriptionPreview || '').slice(0, 1000),
          budget_raw:  `$${amount}`,
          country:     'Worldwide',
          language:    'en',
          detected_at: new Date(),
        });
      }
    }

    // Fallback : extraction regex si pas de __NEXT_DATA__
    if (results.length === 0) {
      const titleRx = /"title":"([^"]{10,100})"/g;
      const amountRx = /"bountyAmount":(\d+)/g;
      const titles = []; let m;
      while ((m = titleRx.exec(body)) !== null) titles.push(m[1]);
      const amounts = []; let m2;
      while ((m2 = amountRx.exec(body)) !== null) amounts.push(parseInt(m2[1]));
      for (let i = 0; i < Math.min(titles.length, 15); i++) {
        if ((amounts[i] || 0) < 50) continue;
        results.push({
          platform: 'Replit Bounty', url: 'https://replit.com/bounties',
          title: titles[i], description: '', budget_raw: `$${amounts[i] || '?'}`,
          country: 'Worldwide', language: 'en', detected_at: new Date(),
        });
      }
    }
    console.log(`[scanner] Replit Bounties: ${results.length} bounties (≥$50)`);
  } catch (err) { console.warn(`[scanner] Replit: ${err.message}`); }
  return results;
}

// ── Source 10 : RemoteOK — volume tech jobs (classifieur filtre CDI) ───────

const REMOTEOK_TAG_SETS = ['saas,ai', 'backend,api', 'automation,python'];

async function scanRemoteOK() {
  const results = [];
  const seen = new Set();
  for (const tags of REMOTEOK_TAG_SETS) {
    try {
      const { status, body } = await fetchUrl(`https://remoteok.com/api?tags=${tags}`, {
        headers: { 'Accept': 'application/json' },
      });
      if (status !== 200) continue;
      const json = safeJSON(body);
      if (!Array.isArray(json)) continue;
      for (const job of json.filter(x => x && x.position && x.url)) {
        if (seen.has(job.id || job.url)) continue;
        seen.add(job.id || job.url);
        results.push({
          platform: 'RemoteOK', url: job.url,
          title: job.position,
          description: (job.description || '').replace(/<[^>]+>/g,'').slice(0, 2000),
          budget_raw: job.salary || null, country: job.location || 'Worldwide',
          language: 'en', detected_at: new Date(),
        });
      }
    } catch (err) { console.warn(`[scanner] RemoteOK [${tags}]: ${err.message}`); }
  }
  console.log(`[scanner] RemoteOK: ${results.length} offres`);
  return results;
}

// ── scanAll ─────────────────────────────────────────────────────────────────

async function scanAll() {
  console.log('[scanner] 🌍 Démarrage scan v3 — 10 sources validées...');
  const settled = await Promise.allSettled([
    scanHackerNews(),
    scanHNWhoIsHiring(),
    scanRemotive(),
    scanWeWorkRemotely(),
    scanFreelancer(),
    scanCodeur(),
    scanGitHub(),
    scanYCFreelance(),
    scanReplitBounties(),
    scanRemoteOK(),
  ]);

  const names = ['HackerNews','HN-WhoIsHiring','Remotive','WeWorkRemotely','Freelancer','Codeur','GitHub-Bounty','AskHN','Replit','RemoteOK'];
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

// ── scanBySquad ─────────────────────────────────────────────────────────────

async function scanBySquad(squadId) {
  const squads = {
    americas:  [scanHackerNews, scanHNWhoIsHiring, scanRemotive, scanReplitBounties],
    europe:    [scanWeWorkRemotely, scanFreelancer, scanCodeur, scanRemoteOK],
    global:    [scanGitHub, scanYCFreelance, scanFreelancer, scanReplitBounties],
    freelance: [scanFreelancer, scanCodeur, scanGitHub, scanHNWhoIsHiring],
  };
  const fns = squads[squadId] || squads.global;
  const settled = await Promise.allSettled(fns.map(f => f()));
  const results = [];
  settled.forEach(r => { if (r.status === 'fulfilled') results.push(...r.value); });
  return results;
}

module.exports = {
  scanAll, scanBySquad,
  scanHackerNews, scanHNWhoIsHiring, scanRemotive, scanWeWorkRemotely,
  scanFreelancer, scanCodeur, scanGitHub, scanYCFreelance, scanReplitBounties, scanRemoteOK,
  // Aliases compatibilité
  scanUpwork: scanFreelancer,
  scanReddit: scanHNWhoIsHiring,
  scanPeoplePerHour: scanCodeur,
  scanGuru: scanRemoteOK,
  scanToptal: scanReplitBounties,
};
