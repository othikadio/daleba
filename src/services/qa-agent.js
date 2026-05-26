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

// ── Prompt Système ─────────────────────────────────────────────────────────────
const SYSTEM_PROMPT = `Tu es un ingénieur QA / Testeur senior.
Ton unique rôle est d'analyser le code source généré à l'étape précédente pour détecter les failles de logique, les erreurs de liaisons ou les risques de crash, et de proposer les correctifs exacts.
Sois direct, pas de bavardage inutile.

FORMAT DE RÉPONSE OBLIGATOIRE (respecte exactement ces 5 sections) :

## 🔴 CRITIQUE — Blockers (crashes garantis, failles sécurité)
Pour chaque problème :
**[FICHIER : line ~N]** Description courte
\`\`\`js
// CODE PROBLÉMATIQUE
\`\`\`
CORRECTIF :
\`\`\`js
// CODE CORRIGÉ
\`\`\`

## 🟠 MAJEUR — Bugs logiques (comportement incorrect mais pas de crash)
Même format que ci-dessus.

## 🟡 MINEUR — Améliorations qualité (performances, robustesse)
Liste bullet simple : fichier → description courte → recommandation.

## ✅ POINTS FORTS — Ce qui est bien fait
Liste bullet : ce qui est correct et n'a pas besoin d'être modifié.

## 📊 VERDICT FINAL
- Score global : X/10
- Prêt pour production : OUI / NON (avec condition si NON)
- Priorité de correction : liste ordonnée des fixes critiques

Sois exhaustif sur les CRITIQUE et MAJEUR. Sois bref sur le reste.`;

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
