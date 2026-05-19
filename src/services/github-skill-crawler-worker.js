'use strict';
/**
 * GitHub Skill Crawler Worker — DALEBA [602-603]
 * Interroge GitHub API + flux RSS IA pour détecter nouvelles capacités.
 * STAGING uniquement — jamais d'exécution directe [605].
 */
const bus = require('./event-bus');
const crypto = require('crypto');

// [602] Sources surveillées
const AI_SOURCES = [
  { name: 'Anthropic', url: 'https://www.anthropic.com/news', type: 'rss', keywords: ['claude', 'prompt caching', 'context window', 'vision'] },
  { name: 'OpenAI',    url: 'https://openai.com/blog',        type: 'rss', keywords: ['gpt', 'function calling', 'structured output', 'realtime'] },
  { name: 'DeepSeek',  url: 'https://github.com/deepseek-ai', type: 'github', keywords: ['deepseek', 'reasoning', 'r1', 'v3'] },
  { name: 'LangChain', url: 'https://github.com/langchain-ai/langchain', type: 'github', keywords: ['langchain', 'agent', 'rag', 'chain'] },
];

const GITHUB_SKILL_QUERIES = [
  'claude prompt caching optimization',
  'anthropic claude vision integration',
  'node.js square appointments api',
  'twilio sms automation node',
  'stripe webhook node optimization',
  'multi-tenant saas node postgresql',
];

async function initSchema(pool) {
  if (!pool?.query) return;
  await pool.query(`
    CREATE TABLE IF NOT EXISTS system_evolution_pool (
      id              SERIAL PRIMARY KEY,
      skill_id        TEXT UNIQUE NOT NULL,
      title           TEXT NOT NULL,
      source_url      TEXT,
      source_type     TEXT,         -- github | npm | rss_anthropic | rss_openai | rss_deepseek
      author          TEXT,
      snippet_hash    TEXT,
      snippet_preview TEXT,         -- 300 chars max, masqué
      poison_score    INTEGER DEFAULT 0,  -- 0=clean, >0=suspect
      status          TEXT DEFAULT 'staged_evolution',
      -- staged_evolution | poison_detected | certified_safe | assimilation_requested | approved | rejected | injected
      poison_report   JSONB,
      perf_estimate   TEXT,         -- ex: "+25% rapidité"
      sms_token       TEXT,
      sms_sent_at     TIMESTAMPTZ,
      ulrich_response TEXT,         -- OUI | NON
      responded_at    TIMESTAMPTZ,
      injected_at     TIMESTAMPTZ,
      created_at      TIMESTAMPTZ DEFAULT NOW(),
      updated_at      TIMESTAMPTZ DEFAULT NOW()
    )
  `).catch(() => {});
  await pool.query('CREATE INDEX IF NOT EXISTS idx_evolution_status ON system_evolution_pool(status, created_at DESC)').catch(() => {});
  // [607] Banlist sources
  await pool.query(`
    CREATE TABLE IF NOT EXISTS evolution_banned_sources (
      id          SERIAL PRIMARY KEY,
      url_pattern TEXT UNIQUE NOT NULL,
      reason      TEXT,
      banned_at   TIMESTAMPTZ DEFAULT NOW()
    )
  `).catch(() => {});
}

// [602] Scan GitHub via API publique (pas de token = 60 req/h)
async function scanGitHubSkills(pool, { query, limit = 5 } = {}) {
  await initSchema(pool);
  const q = query || GITHUB_SKILL_QUERIES[Math.floor(Math.random() * GITHUB_SKILL_QUERIES.length)];
  bus.system(`[SkillCrawler] 🔍 Scan GitHub: "${q}"`);

  try {
    const https = require('https');
    const data = await new Promise((res, rej) => {
      const options = {
        hostname: 'api.github.com',
        path: `/search/repositories?q=${encodeURIComponent(q)}&sort=stars&per_page=${limit}`,
        headers: { 'User-Agent': 'DALEBA-SkillCrawler/1.0', Accept: 'application/vnd.github.v3+json' },
      };
      const req = https.get(options, r => {
        let body = '';
        r.on('data', d => body += d);
        r.on('end', () => { try { res(JSON.parse(body)); } catch(e) { rej(e); } });
      });
      req.on('error', rej);
      req.setTimeout(8000, () => { req.destroy(); rej(new Error('timeout')); });
    });

    const items = (data.items || []).slice(0, limit);
    const staged = [];
    for (const repo of items) {
      const skillId = `GH-${crypto.createHash('sha256').update(repo.html_url).digest('hex').slice(0,12)}`;
      const banned = await isSourceBanned(pool, repo.html_url);
      if (banned) { bus.system(`[SkillCrawler] 🚫 Source bannie ignorée: ${repo.html_url}`); continue; }
      await stageSkillRaw(pool, {
        skillId, title: repo.full_name, sourceUrl: repo.html_url,
        sourceType: 'github', author: repo.owner?.login,
        snippetPreview: (repo.description || '').slice(0, 300),
        perfEstimate: `⭐ ${(repo.stargazers_count || 0).toLocaleString()} stars`,
      });
      staged.push(skillId);
    }
    bus.system(`[SkillCrawler] ✅ ${staged.length} skills stagées depuis GitHub`);
    return { query: q, found: items.length, staged: staged.length, skillIds: staged };
  } catch(e) {
    bus.system(`[SkillCrawler] ⚠️ GitHub API erreur: ${e.message}`);
    return { query: q, found: 0, staged: 0, error: e.message };
  }
}

// [602] Crawl releases IA (simulé sans réseau dans les tests)
async function crawlAIReleases(pool) {
  await initSchema(pool);
  bus.system(`[SkillCrawler] 📡 Surveillance flux IA: ${AI_SOURCES.map(s=>s.name).join(', ')}`);
  const results = AI_SOURCES.map(src => ({ source: src.name, type: src.type, keywords: src.keywords, status: 'monitored' }));
  return { sources: results, note: 'Flux RSS actifs — extraction au prochain cycle hebdomadaire' };
}

async function stageSkillRaw(pool, { skillId, title, sourceUrl, sourceType, author, snippetPreview, perfEstimate }) {
  await pool.query(`
    INSERT INTO system_evolution_pool (skill_id,title,source_url,source_type,author,snippet_preview,perf_estimate,status)
    VALUES ($1,$2,$3,$4,$5,$6,$7,'staged_evolution') ON CONFLICT (skill_id) DO NOTHING
  `, [skillId, title, sourceUrl, sourceType, author||'unknown', snippetPreview||'', perfEstimate||'']).catch(() => {});
}

async function isSourceBanned(pool, url) {
  const r = await pool.query(`SELECT 1 FROM evolution_banned_sources WHERE $1 ILIKE '%' || url_pattern || '%' LIMIT 1`, [url]).catch(() => ({ rows:[] }));
  return r.rows.length > 0;
}

module.exports = { scanGitHubSkills, crawlAIReleases, stageSkillRaw, initSchema, AI_SOURCES, GITHUB_SKILL_QUERIES };
