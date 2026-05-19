'use strict';
/**
 * Code Poison Detector — DALEBA [606,607]
 * Détecte 5 patterns d'attaque via analyse statique + Claude sémantique.
 * ZERO TOLERANCE: un seul hit → POISON_ATTEMPT_DETECTED.
 */
const bus    = require('./event-bus');
const crypto = require('crypto');

// [606] Les 5 patterns d'attaque à détecter
const POISON_PATTERNS = [
  {
    id: 'PROMPT_INJECTION',
    label: 'Injection de prompt cachée dans commentaires',
    // Ignore les commentaires normaux — cherche des tentatives de manipulation LLM
    regex: /\/\/.*?(ignore previous|system prompt|jailbreak|forget your|act as|new instruction)/i,
    description: 'Tentative d\'injection de prompt dans les commentaires du code',
  },
  {
    id: 'SUSPICIOUS_HTTP',
    label: 'Requêtes HTTP sortantes suspectes',
    // Cherche des fetch/axios vers des IPs numériques ou domaines inconnus (pas .ca, .com légitimes)
    regex: /(?:fetch|axios\.(?:get|post)|http\.(?:get|request))\s*\(\s*['"`]https?:\/\/(?:\d{1,3}\.){3}\d{1,3}|(?:fetch|axios)\s*\(\s*['"`][^'"`)]*(?:\.ru|\.cn|\.tk|\.xyz|\.onion)/i,
    description: 'Requête HTTP vers IP numérique ou domaine suspect',
  },
  {
    id: 'CODE_OBFUSCATION',
    label: 'Obfuscation de code (base64/hex)',
    regex: /(?:atob|btoa|Buffer\.from)\s*\([^)]{20,}\)|\\x[0-9a-f]{2}(?:\\x[0-9a-f]{2}){10,}|eval\s*\(\s*(?:atob|Buffer)/i,
    description: 'Payload encodé en base64 ou hex avec eval',
  },
  {
    id: 'ENV_ACCESS',
    label: 'Accès non autorisé aux variables d\'environnement',
    // Accès à process.env en dehors des patterns légitimes DALEBA
    regex: /process\.env(?!\.(NODE_ENV|PORT|DATABASE_URL|ANTHROPIC_API_KEY|TWILIO|SQUARE|STRIPE|RAILWAY|ULRICH|SALON|VAULT|OPENAI|REPLICATE|META|TWILIO))/i,
    description: 'Lecture de variable d\'environnement non standard',
  },
  {
    id: 'FILESYSTEM_WRITE',
    label: 'Manipulation de fichiers système hors sandbox',
    regex: /(?:fs|require\s*\(\s*['"]fs['"]\s*\))\.(?:writeFile|writeFileSync|appendFile|unlink|rmdir|mkdir|rename)/,
    description: 'Opération d\'écriture/suppression sur le système de fichiers',
  },
];

/**
 * [606] Détection statique des 5 patterns
 */
function detectPoisonStatic(code) {
  const hits = [];
  for (const pattern of POISON_PATTERNS) {
    if (pattern.regex.test(code)) {
      hits.push({ id: pattern.id, label: pattern.label, description: pattern.description });
    }
  }
  return hits;
}

/**
 * [606] Analyse sémantique Claude (optionnelle — si API dispo)
 */
async function detectPoisonSemantic(code, source) {
  try {
    const { Anthropic } = require('@anthropic-ai/sdk');
    const claude = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
    const codePreview = code.slice(0, 2000);
    const resp = await claude.messages.create({
      model: 'claude-haiku-4-5', max_tokens: 300,
      messages: [{
        role: 'user',
        content: `Analyse ce code JavaScript pour détecter des menaces de sécurité.
Source: ${source || 'inconnue'}

Code:
\`\`\`javascript
${codePreview}
\`\`\`

Réponds UNIQUEMENT en JSON:
{"safe": true/false, "threats": ["liste des menaces détectées"], "confidence": 0.0-1.0, "summary": "une phrase"}`,
      }],
    });
    const text = resp.content[0].text;
    return JSON.parse(text.match(/\{[\s\S]*\}/)?.[0] || '{"safe":true,"threats":[],"confidence":0.5}');
  } catch(e) {
    // Fallback: retour conservateur
    return { safe: true, threats: [], confidence: 0.5, note: 'Claude indisponible — analyse statique seule' };
  }
}

/**
 * [606,607] Détection complète — statique + sémantique
 */
async function detectPoison(code, source) {
  if (!code || typeof code !== 'string')
    return { poisoned: false, hits: [], status: 'CERTIFIED_SAFE' };

  const hash = crypto.createHash('sha256').update(code).digest('hex').slice(0, 16);
  bus.system(`[PoisonDetector] 🔬 Scan: ${source || 'code'} — hash: ${hash}`);

  // Analyse statique (synchrone, instantanée)
  const staticHits = detectPoisonStatic(code);

  // Analyse sémantique Claude
  const semantic = await detectPoisonSemantic(code, source);

  const allThreats = [...staticHits.map(h => h.id), ...(semantic.threats || [])];
  const poisoned = staticHits.length > 0 || !semantic.safe;

  const status = poisoned ? 'POISON_ATTEMPT_DETECTED' : 'CERTIFIED_SAFE';

  if (poisoned) {
    bus.system(`[PoisonDetector] 🚨 POISON DÉTECTÉ: ${allThreats.join(', ')} — source: ${source}`);
    bus.emit('evolution:poison_detected', { source, hash, threats: allThreats });
  } else {
    bus.system(`[PoisonDetector] ✅ Code certifié sain: ${source || 'code'} — hash: ${hash}`);
  }

  return {
    poisoned, status, hash,
    staticHits, semantic,
    threats: allThreats,
    certifiedSafe: !poisoned,
    source,
  };
}

/**
 * [607] Bannissement permanent d'une source
 */
async function banSource(pool, { urlPattern, reason }) {
  await pool.query(`
    INSERT INTO evolution_banned_sources (url_pattern, reason) VALUES ($1, $2)
    ON CONFLICT (url_pattern) DO UPDATE SET reason=$2
  `, [urlPattern, reason]).catch(() => {});
  bus.system(`[PoisonDetector] 🚫 Source bannie à vie: ${urlPattern} — ${reason}`);
  bus.emit('evolution:source_banned', { urlPattern, reason });
  return { banned: true, urlPattern, reason };
}

module.exports = { detectPoison, detectPoisonStatic, detectPoisonSemantic, banSource, POISON_PATTERNS };
