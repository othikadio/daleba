/**
 * DALEBA — Agent Testeur QA (Usine de Production, Étape 4)
 *
 * Analyse le code généré à l'Étape 3 pour détecter :
 *   - Failles de logique métier
 *   - Erreurs de liaisons (imports, références, types)
 *   - Risques de crash (null pointer, async sans catch, etc.)
 *   - Failles de sécurité (injection, auth manquante, exposition données)
 *   - Correctifs exacts pour chaque problème détecté
 *
 * Moteur : DeepSeek (principal) → Claude (fallback)
 */
'use strict';

const https = require('https');

const DEEPSEEK_KEY  = process.env.DEEPSEEK_API_KEY || 'sk-cca2191225a9417cb589dab3c7172015';
const ANTHROPIC_KEY = process.env.ANTHROPIC_API_KEY;

console.log(`[qa-agent] Moteur: deepseek → fallback: ${ANTHROPIC_KEY ? 'claude' : 'none'}`);

// ── Prompt Système V42 — Grille immuable ─────────────────────────────────────
const SYSTEM_PROMPT = `Tu es un ingénieur QA senior spécialisé Node.js/Express/PostgreSQL.
Ton rôle est d'évaluer le code selon une GRILLE FIXE et IMMUABLE. Tu n'inventes pas de nouveaux critères entre deux rounds sur la même tâche.

GRILLE D'ÉVALUATION (5 axes, 2 points chacun) :
1. SYNTAXE NODE.JS — Pas d'erreurs de syntaxe, requires valides, async/await cohérent (0/2)
2. CHEMINS REQUIRE — Chaque require() pointe vers un fichier qui existe dans la liste des fichiers fournis (0/2)
3. SIGNATURES DE FONCTIONS — Les appels de fonctions correspondent aux signatures définies dans les models (0/2)
4. COHÉRENCE SQL/POSTGIS — Noms de colonnes exacts, ordre paramètres ST_MakePoint(lng, lat), paramètres bindés ($1,$2...) (0/2)
5. SÉCURITÉ BASIQUE — Pas d'injections directes, validation des inputs, JWT vérifié avant usage (0/2)

RÈGLES STRICTES :
- Tu NE PEUX PAS signaler un bug sans citer la LIGNE EXACTE de code qui pose problème
- Tu NE PEUX PAS inventer des critères hors de la grille ci-dessus
- Tu NE PEUX PAS signaler comme CRITIQUE quelque chose qui ne cause pas un crash ou une faille de sécurité prouvable
- Si un correctif dit "Aucun problème ici, faux positif" → ne pas le signaler
- Le score est la SOMME des points par axe : un axe = 2pts si aucun problème, 1pt si problème mineur, 0pt si problème bloquant

FORMAT DE RÉPONSE OBLIGATOIRE :

## GRILLE DE SCORING
| Axe | Points | Problèmes |
|-----|--------|-----------|
| 1. Syntaxe Node.js | X/2 | description ou "Aucun" |
| 2. Chemins require | X/2 | description ou "Aucun" |
| 3. Signatures fonctions | X/2 | description ou "Aucun" |
| 4. SQL/PostGIS | X/2 | description ou "Aucun" |
| 5. Sécurité basique | X/2 | description ou "Aucun" |

## 🔴 CRITIQUE — Crashes garantis
SEULEMENT les problèmes qui causent un crash immédiat ou une faille de sécurité exploitable.
Pour chaque problème (OBLIGATOIRE : citer la ligne exacte) :
**[fichier.js : ligne EXACTE]** Description
\`\`\`js
// CODE PROBLÉMATIQUE (copié exact depuis le fichier)
\`\`\`
CORRECTIF :\n\`\`\`js
// CODE CORRIGÉ
\`\`\`

## 🟠 MAJEUR — Bugs logiques
SEULEMENT comportements incorrects prouvables. Même format.

## 🟡 MINEUR
Liste bullet, 5 max.

## ✅ POINTS FORTS
Liste bullet, 3 min.

## 📊 VERDICT FINAL
- Score global : X/10 (somme de la grille)
- Prêt pour production : OUI si score ≥ 7, NON sinon
- Corrections restantes : liste ordonnée (CRITIQUE seulement si score < 7)`;

// ── Construction du prompt utilisateur ────────────────────────────────────────
function buildUserPrompt(files, clientNeed) {
  const fileEntries = Object.entries(files)
    .map(([path, code]) => `=== ${path} ===\n${code}`)
    .join('\n\n');

  return `PROJET : ${clientNeed.slice(0, 150)}

CODE SOURCE À ANALYSER (${Object.keys(files).length} fichiers) :

${fileEntries}

Analyse maintenant ce code source complet et produis le rapport QA selon le format imposé.`;
}

// ── Appel DeepSeek ─────────────────────────────────────────────────────────────
function callDeepSeek(userPrompt) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify({
      model:       'deepseek-chat',
      temperature: 0.2,
      max_tokens:  6000,
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
      timeout: 120000,
    }, (res) => {
      let data = '';
      res.on('data', c => { data += c; });
      res.on('end', () => {
        try {
          const json = JSON.parse(data);
          if (json.error) throw new Error(json.error.message);
          resolve(json.choices?.[0]?.message?.content || '');
        } catch (e) { reject(new Error('DeepSeek: ' + e.message)); }
      });
    });
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error('DeepSeek QA timeout 120s')); });
    req.write(body);
    req.end();
  });
}

// ── Appel Claude (fallback) ────────────────────────────────────────────────────
function callClaude(userPrompt) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify({
      model:      'claude-opus-4-5',
      max_tokens: 6000,
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
      timeout: 120000,
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

// ── Fonction principale ────────────────────────────────────────────────────────
/**
 * Lance l'inspection QA sur le code généré.
 * @param {Object} generatedFiles  — Map { path: code } des fichiers générés (Étape 3)
 * @param {string} clientNeedRaw   — Besoin original pour contexte
 * @returns {Promise<{report: string, engine: string}>}
 */
async function runQAInspection(generatedFiles, clientNeedRaw) {
  const userPrompt = buildUserPrompt(generatedFiles, clientNeedRaw);
  const totalChars = Object.values(generatedFiles).reduce((s, c) => s + c.length, 0);

  console.log(`[qa-agent] Inspection QA — ${Object.keys(generatedFiles).length} fichiers (${totalChars} chars)`);

  let report, engine;
  try {
    report = await callDeepSeek(userPrompt);
    engine = 'deepseek';
  } catch (err) {
    console.warn('[qa-agent] DeepSeek KO, fallback Claude:', err.message);
    if (!ANTHROPIC_KEY) throw new Error('DeepSeek KO et pas de ANTHROPIC_API_KEY');
    report = await callClaude(userPrompt);
    engine = 'claude-fallback';
  }

  console.log(`[qa-agent] Rapport QA généré (${report.length} chars) via ${engine}`);
  return { report, engine };
}

module.exports = { runQAInspection };
