/**
 * DALEBA — Agent Architecte Système (Usine de Production, Étape 2)
 *
 * Traduit un cahier des charges fonctionnel (Étape 1) en architecture
 * technique complète, prête à être codée :
 *  - Scripts de migration SQL (PostGIS inclus)
 *  - Documentation des routes API REST
 *  - Contrats d'événements WebSocket
 *
 * Moteur : Claude (ANTHROPIC_API_KEY) → DeepSeek (fallback)
 */
'use strict';

const https = require('https');

const ANTHROPIC_KEY = process.env.ANTHROPIC_API_KEY;
const DEEPSEEK_KEY  = process.env.DEEPSEEK_API_KEY || 'sk-cca2191225a9417cb589dab3c7172015';

const ENGINE = ANTHROPIC_KEY ? 'claude' : 'deepseek';
console.log(`[architect-agent] Moteur: ${ENGINE}`);

// ── Prompt système ─────────────────────────────────────────────────────────────
const SYSTEM_PROMPT = `Tu es un Agent Architecte Système senior chez DALEBA, agence spécialisée en SaaS, agents IA, APIs REST et systèmes temps réel.

Ton unique rôle : transformer un cahier des charges fonctionnel en une architecture technique complète, précise et immédiatement exploitable par un développeur senior.

STRUCTURE OBLIGATOIRE (respecte exactement ces 4 blocs dans cet ordre) :

---

## 🗄️ BLOC 1 — MIGRATION SQL COMPLÈTE

Fournis les scripts SQL complets et exécutables, prêts pour PostgreSQL.
- Inclure les extensions requises (ex: PostGIS pour géolocalisation)
- Nommer chaque table clairement (snake_case)
- Inclure : types précis, contraintes (NOT NULL, UNIQUE, FK), index de performance
- Commentaires inline sur chaque colonne importante
- Inclure les triggers utiles (updated_at auto, etc.)

Format :
\`\`\`sql
-- === MIGRATION V1 ===
-- [description courte]

[scripts complets]
\`\`\`

---

## 🔌 BLOC 2 — API REST — DOCUMENTATION DES ROUTES

Pour chaque route, fournir exactement :
\`METHOD /chemin\` — Description courte
- Auth: [Bearer JWT | Public | API Key]
- Body: \`{ champ: type — description }\`
- Réponse 200: \`{ champ: type }\`
- Erreurs: [400 | 401 | 404 | 500] + raison

Organise par groupes logiques (ex: /api/auth, /api/orders, /api/deliveries...).

---

## ⚡ BLOC 3 — WEBSOCKET — CONTRATS D'ÉVÉNEMENTS

Pour chaque événement WS :
**event-name** [CLIENT→SERVEUR | SERVEUR→CLIENT]
- Payload: \`{ champ: type }\`
- Déclencheur: [quand cet événement est émis]
- Réponse attendue: [comportement côté récepteur]

---

## 🏗️ BLOC 4 — DÉCISIONS ARCHITECTURALES

- Stack recommandé (runtime, framework, ORM, auth, infra)
- Schéma de déploiement (conteneurs, variables d'env critiques)
- Points de vigilance (sécurité, performance, scalabilité)
- Librairies clés recommandées (avec justification)

---

Ton style : ultra-précis, opinionné, sans fluff. Chaque ligne doit être directement utilisable par un développeur. Préfère la concrétude aux généralités.`;

// ── Appel Claude ───────────────────────────────────────────────────────────────
function callClaude(userPrompt) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify({
      model:      'claude-opus-4-5',
      max_tokens: 4096,
      system:     SYSTEM_PROMPT,
      messages:   [{ role: 'user', content: userPrompt }],
    });

    const req = https.request({
      hostname: 'api.anthropic.com',
      path:     '/v1/messages',
      method:   'POST',
      headers: {
        'x-api-key':         ANTHROPIC_KEY,
        'anthropic-version': '2023-06-01',
        'content-type':      'application/json',
        'Content-Length':    Buffer.byteLength(body),
      },
      timeout: 90000,
    }, (res) => {
      let data = '';
      res.on('data', c => { data += c; });
      res.on('end', () => {
        try {
          const json = JSON.parse(data);
          if (json.error) throw new Error(json.error.message);
          resolve(json.content?.[0]?.text || '');
        } catch (e) { reject(new Error('Claude: ' + e.message)); }
      });
    });
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error('Claude timeout')); });
    req.write(body);
    req.end();
  });
}

// ── Appel DeepSeek ─────────────────────────────────────────────────────────────
function callDeepSeek(userPrompt) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify({
      model:       'deepseek-chat',
      temperature: 0.3,
      max_tokens:  4096,
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'user',   content: userPrompt },
      ],
    });

    const req = https.request({
      hostname: 'api.deepseek.com',
      path:     '/chat/completions',
      method:   'POST',
      headers: {
        'Authorization':  `Bearer ${DEEPSEEK_KEY}`,
        'Content-Type':   'application/json',
        'Content-Length': Buffer.byteLength(body),
      },
      timeout: 90000,
    }, (res) => {
      let data = '';
      res.on('data', c => { data += c; });
      res.on('end', () => {
        try {
          const json = JSON.parse(data);
          resolve(json.choices?.[0]?.message?.content || '');
        } catch (e) { reject(new Error('DeepSeek: ' + e.message)); }
      });
    });
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error('DeepSeek timeout')); });
    req.write(body);
    req.end();
  });
}

// ── Fonction principale ────────────────────────────────────────────────────────
/**
 * Génère l'architecture technique à partir du cahier des charges fonctionnel.
 * @param {string} functionalSpec  — Cahier des charges généré par l'Agent PO
 * @param {string} [clientNeed]    — Besoin original (contexte supplémentaire)
 * @returns {Promise<{arch: string, engine: string}>}
 */
async function generateArchitecture(functionalSpec, clientNeed = '') {
  const userPrompt = `Tu dois concevoir l'architecture technique complète pour le projet suivant.

${clientNeed ? `BESOIN CLIENT ORIGINAL :\n${clientNeed}\n\n` : ''}CAHIER DES CHARGES FONCTIONNEL (Agent Product Owner) :
${functionalSpec}

Génère maintenant l'architecture technique complète en respectant exactement la structure imposée (4 blocs).`;

  console.log(`[architect-agent] Génération architecture — spec: ${functionalSpec.length} chars`);

  let arch, engine;
  if (ANTHROPIC_KEY) {
    try {
      arch   = await callClaude(userPrompt);
      engine = 'claude';
    } catch (err) {
      console.warn('[architect-agent] Claude échoué, fallback DeepSeek:', err.message);
      arch   = await callDeepSeek(userPrompt);
      engine = 'deepseek-fallback';
    }
  } else {
    arch   = await callDeepSeek(userPrompt);
    engine = 'deepseek';
  }

  console.log(`[architect-agent] Architecture générée (${arch.length} chars) via ${engine}`);
  return { arch, engine };
}

module.exports = { generateArchitecture };
