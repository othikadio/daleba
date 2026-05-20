// src/services/agent-hunter.js
// Chasseur de veille IA mondial — DALEBA Auto-Evolution Engine

'use strict';

const axios = require('axios');

// Sources de veille
const SOURCES = {
  github: {
    name: 'GitHub Trending',
    scan: async () => {
      const headers = process.env.GITHUB_TOKEN
        ? { Authorization: `token ${process.env.GITHUB_TOKEN}` }
        : {};
      // Trending repos IA des 7 derniers jours
      const queries = ['AI agent', 'LLM tool', 'autonomous agent', 'AI router', 'multimodal AI'];
      const results = [];
      for (const q of queries.slice(0, 2)) { // Limit API calls
        try {
          const res = await axios.get('https://api.github.com/search/repositories', {
            headers,
            params: { q: `${q} stars:>100`, sort: 'stars', order: 'desc', per_page: 5 },
            timeout: 8000,
          });
          results.push(...res.data.items.map(r => ({
            source: 'github',
            name: r.full_name,
            description: r.description || '',
            stars: r.stargazers_count,
            url: r.html_url,
            language: r.language,
            topics: r.topics || [],
            query: q,
          })));
        } catch (e) { /* skip */ }
        await new Promise(r => setTimeout(r, 500));
      }
      return results;
    }
  },
  huggingface: {
    name: 'Hugging Face Trending',
    scan: async () => {
      try {
        const res = await axios.get('https://huggingface.co/api/models', {
          params: { sort: 'trending', limit: 10, filter: 'text-generation' },
          timeout: 8000,
        });
        return res.data.map(m => ({
          source: 'huggingface',
          name: m.modelId || m.id,
          description: (m.cardData?.summary || m.pipeline_tag || ''),
          downloads: m.downloads,
          url: `https://huggingface.co/${m.id || m.modelId}`,
          task: m.pipeline_tag,
          likes: m.likes,
        }));
      } catch (e) { return []; }
    }
  },
  arxiv: {
    name: 'ArXiv AI Papers',
    scan: async () => {
      try {
        // RSS feed des derniers papiers cs.AI
        const res = await axios.get(
          'http://export.arxiv.org/api/query?search_query=cat:cs.AI+AND+ti:agent&sortBy=submittedDate&sortOrder=descending&max_results=5',
          { timeout: 8000 }
        );
        // Parse XML simple
        const entries = [];
        const regex = /<entry>([\s\S]*?)<\/entry>/g;
        let match;
        while ((match = regex.exec(res.data)) !== null) {
          const entry = match[1];
          const titleMatch = entry.match(/<title>([\s\S]*?)<\/title>/);
          const summaryMatch = entry.match(/<summary>([\s\S]*?)<\/summary>/);
          const linkMatch = entry.match(/href="([^"]*abs[^"]*)"/);
          if (titleMatch) {
            entries.push({
              source: 'arxiv',
              name: titleMatch[1].trim().replace(/\n/g, ' '),
              description: summaryMatch ? summaryMatch[1].trim().slice(0, 200) : '',
              url: linkMatch ? linkMatch[1] : '',
            });
          }
        }
        return entries;
      } catch (e) { return []; }
    }
  }
};

// Scorer la pertinence pour DALEBA (salon de coiffure + IA)
function scoreDiscovery(item) {
  const text = `${item.name} ${item.description} ${(item.topics||[]).join(' ')}`.toLowerCase();
  let score = 0;
  const HIGH = ['agent', 'autonomous', 'multi-modal', 'router', 'llm', 'voice', 'booking', 'appointment', 'customer'];
  const MED  = ['ai', 'gpt', 'claude', 'gemini', 'tool', 'api', 'automation', 'chat'];
  HIGH.forEach(k => { if (text.includes(k)) score += 3; });
  MED.forEach(k => { if (text.includes(k)) score += 1; });
  if (item.stars > 1000) score += 2;
  if (item.stars > 5000) score += 3;
  return score;
}

// Générer un stub d'intégration IA pour un discovery
async function generateIntegrationStub(discovery) {
  try {
    const Anthropic = require('@anthropic-ai/sdk');
    const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
    const res = await client.messages.create({
      model: 'claude-haiku-4-5',
      max_tokens: 600,
      messages: [{
        role: 'user',
        content: `Tu es un expert intégration API pour DALEBA (plateforme IA salon de coiffure).
Voici une découverte : "${discovery.name}" — ${discovery.description}
URL: ${discovery.url}

Génère en JSON (strictement valide) un stub d'intégration avec :
{
  "canIntegrate": true/false,
  "integrationValue": "description courte en 1 phrase de la valeur pour DALEBA",
  "providerKey": "nom_variable_env_pour_cle_api",
  "endpointExample": "exemple d'appel API minimal en Node.js (5 lignes max)",
  "category": "chat|media|code|accounting|booking|voice",
  "effort": "low|medium|high"
}
Réponds UNIQUEMENT avec le JSON, rien d'autre.`
      }]
    });
    return JSON.parse(res.content[0].text);
  } catch (e) {
    return { canIntegrate: false, integrationValue: 'Analyse indisponible', effort: 'unknown' };
  }
}

// Stockage des découvertes (en mémoire + optionnellement DB)
const discoveries = new Map();

async function saveDiscovery(item, analysis) {
  const key = `${item.source}:${item.name}`;
  if (discoveries.has(key)) return; // Déjà vu

  const discovery = {
    id: key,
    ...item,
    analysis,
    score: scoreDiscovery(item),
    status: analysis?.canIntegrate ? 'READY' : 'NOTED',
    discoveredAt: new Date().toISOString(),
  };
  discoveries.set(key, discovery);

  // Persist en DB si disponible
  try {
    const { Pool } = require('pg');
    const pool = new Pool({ connectionString: process.env.DATABASE_URL });
    await pool.query(`
      INSERT INTO daleba_discoveries (id, source, name, description, url, score, status, analysis, discovered_at)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
      ON CONFLICT (id) DO NOTHING
    `, [key, item.source, item.name, item.description||'', item.url||'', discovery.score, discovery.status, JSON.stringify(analysis), discovery.discoveredAt]);
    await pool.end();
  } catch (e) { /* DB optionnelle */ }

  return discovery;
}

async function ensureTable() {
  try {
    const { Pool } = require('pg');
    const pool = new Pool({ connectionString: process.env.DATABASE_URL });
    await pool.query(`
      CREATE TABLE IF NOT EXISTS daleba_discoveries (
        id TEXT PRIMARY KEY,
        source TEXT,
        name TEXT,
        description TEXT,
        url TEXT,
        score INTEGER DEFAULT 0,
        status TEXT DEFAULT 'NOTED',
        analysis JSONB,
        discovered_at TIMESTAMPTZ DEFAULT NOW(),
        activated_at TIMESTAMPTZ
      )
    `);
    await pool.end();
  } catch (e) { /* DB optionnelle */ }
}

async function runHuntCycle() {
  console.log('[Hunter] 🔍 Cycle de chasse démarré:', new Date().toISOString());
  const newDiscoveries = [];

  for (const [sourceKey, source] of Object.entries(SOURCES)) {
    try {
      console.log(`[Hunter] Scan ${source.name}...`);
      const items = await source.scan();
      const top = items
        .map(i => ({ ...i, score: scoreDiscovery(i) }))
        .filter(i => i.score >= 3)
        .sort((a, b) => b.score - a.score)
        .slice(0, 3);

      for (const item of top) {
        if (!discoveries.has(`${item.source}:${item.name}`)) {
          const analysis = item.score >= 5 ? await generateIntegrationStub(item) : null;
          const saved = await saveDiscovery(item, analysis);
          if (saved) newDiscoveries.push(saved);
          await new Promise(r => setTimeout(r, 300));
        }
      }
    } catch (e) {
      console.warn(`[Hunter] ${sourceKey} scan error:`, e.message);
    }
  }

  console.log(`[Hunter] ✅ Cycle terminé. ${newDiscoveries.length} nouvelles découvertes.`);
  return newDiscoveries;
}

function getDiscoveries(filters = {}) {
  let list = Array.from(discoveries.values());
  if (filters.status) list = list.filter(d => d.status === filters.status);
  if (filters.canIntegrate) list = list.filter(d => d.analysis?.canIntegrate);
  return list.sort((a, b) => b.score - a.score);
}

function getDiscoverySummary() {
  const list = Array.from(discoveries.values());
  const ready = list.filter(d => d.status === 'READY');
  const today = list.filter(d => d.discoveredAt?.startsWith(new Date().toISOString().slice(0,10)));
  return {
    total: list.length,
    ready: ready.length,
    today: today.length,
    topToday: today.sort((a,b) => b.score - a.score).slice(0,3).map(d => ({
      name: d.name, source: d.source, value: d.analysis?.integrationValue, url: d.url
    })),
    lastScan: list[0]?.discoveredAt || null,
  };
}

async function activateDiscovery(discoveryId) {
  const d = discoveries.get(discoveryId);
  if (!d) return { success: false, error: 'Découverte non trouvée' };
  if (!d.analysis?.canIntegrate) return { success: false, error: 'Cette découverte ne peut pas être intégrée automatiquement' };

  // Marquer comme activée
  d.status = 'ACTIVE';
  d.activatedAt = new Date().toISOString();
  discoveries.set(discoveryId, d);

  // Update DB si disponible
  try {
    const { Pool } = require('pg');
    const pool = new Pool({ connectionString: process.env.DATABASE_URL });
    await pool.query(
      `UPDATE daleba_discoveries SET status='ACTIVE', activated_at=$1 WHERE id=$2`,
      [d.activatedAt, discoveryId]
    );
    await pool.end();
  } catch (e) { /* DB optionnelle */ }

  return {
    success: true,
    message: `${d.name} marqué comme actif. ${d.analysis.integrationValue}`,
    nextStep: `Ajoute la variable ${d.analysis.providerKey} dans Railway pour activer complètement.`,
  };
}

// Démarrer le worker (run immédiatement puis toutes les 6h)
let hunterInterval = null;
async function startHunter() {
  console.log('[Hunter] 🚀 Agent chasseur démarré');
  await ensureTable();
  runHuntCycle(); // Premier cycle immédiat (non-bloquant)
  hunterInterval = setInterval(runHuntCycle, 6 * 60 * 60 * 1000); // Toutes les 6h
}

function stopHunter() {
  if (hunterInterval) { clearInterval(hunterInterval); hunterInterval = null; }
}

module.exports = { startHunter, stopHunter, runHuntCycle, getDiscoveries, getDiscoverySummary, activateDiscovery };
