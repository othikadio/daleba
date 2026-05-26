/**
 * DALEBA — Agent Correcteur (Usine de Production, V41)
 *
 * Lit le rapport QA, applique les correctifs exacts sur les 9 fichiers,
 * puis relance automatiquement l'Agent QA pour obtenir une nouvelle note.
 *
 * Moteur : DeepSeek-Coder (principal) → Claude (fallback)
 */
'use strict';

const https = require('https');

const DEEPSEEK_KEY  = process.env.DEEPSEEK_API_KEY || 'sk-cca2191225a9417cb589dab3c7172015';
const ANTHROPIC_KEY = process.env.ANTHROPIC_API_KEY;

console.log(`[corrector-agent] Moteur: deepseek-coder`);

// ── Prompt Système ─────────────────────────────────────────────────────────────
const SYSTEM_PROMPT = `Tu es un ingénieur backend senior spécialisé en correction de code.
Ton unique rôle : lire un rapport QA et appliquer EXACTEMENT les corrections listées sur les fichiers fournis.

RÈGLES STRICTES :
1. Applique UNIQUEMENT les corrections identifiées comme 🔴 CRITIQUE et 🟠 MAJEUR dans le rapport QA
2. Ne modifie rien d'autre — pas de refactoring, pas d'ajouts non demandés
3. Si un fichier n'a aucune correction à appliquer, retourne-le IDENTIQUE
4. Pour chaque correction appliquée, ajoute un commentaire inline court : // FIX: description

FORMAT DE RÉPONSE OBLIGATOIRE (identique à l'Étape 3) :

=== FILE: models/db.js ===
[contenu complet corrigé]

=== FILE: models/users.js ===
[contenu complet corrigé]

[etc. pour les 9 fichiers, dans le même ordre]

Ne génère aucune explication avant ou après les fichiers.`;

// ── Prompt utilisateur ─────────────────────────────────────────────────────────
function buildCorrectionPrompt(qaReport, codeFiles) {
  const fileEntries = Object.entries(codeFiles)
    .map(([path, code]) => `=== FILE: ${path} ===\n${code}`)
    .join('\n\n');

  // Extraire uniquement les sections CRITIQUE et MAJEUR du rapport
  const criticalSection = extractSection(qaReport, '🔴 CRITIQUE', '🟠 MAJEUR');
  const majorSection    = extractSection(qaReport, '🟠 MAJEUR',   '🟡 MINEUR');

  return `RAPPORT QA — CORRECTIONS À APPLIQUER :

${criticalSection ? `## 🔴 CRITIQUE (à corriger en priorité absolue)\n${criticalSection}` : ''}

${majorSection ? `## 🟠 MAJEUR (à corriger)\n${majorSection}` : ''}

---

CODE SOURCE ACTUEL (${Object.keys(codeFiles).length} fichiers) :

${fileEntries}

Applique maintenant TOUTES les corrections listées ci-dessus et retourne les ${Object.keys(codeFiles).length} fichiers complets corrigés.`;
}

function extractSection(text, startMarker, endMarker) {
  const start = text.indexOf(startMarker);
  if (start === -1) return '';
  const end = endMarker ? text.indexOf(endMarker, start + startMarker.length) : text.length;
  return text.slice(start + startMarker.length, end === -1 ? text.length : end).trim();
}

// ── Parseur de fichiers (réutilise le format Étape 3) ─────────────────────────
function parseGeneratedFiles(rawOutput) {
  const files = {};
  const regex = /=== FILE: ([^\s=]+) ===([\s\S]*?)(?==== FILE:|$)/g;
  let match;
  while ((match = regex.exec(rawOutput)) !== null) {
    const path    = match[1].trim();
    const content = match[2].trim();
    if (path && content) files[path] = content;
  }
  return files;
}

// ── Appel DeepSeek-Coder ───────────────────────────────────────────────────────
function callDeepSeek(userPrompt) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify({
      model:       'deepseek-coder',
      temperature: 0.05,   // Quasi-déterministe pour les corrections
      max_tokens:  8000,
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
    req.on('timeout', () => { req.destroy(); reject(new Error('DeepSeek corrector timeout')); });
    req.write(body);
    req.end();
  });
}

// ── Appel Claude (fallback) ────────────────────────────────────────────────────
function callClaude(userPrompt) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify({
      model:      'claude-opus-4-5',
      max_tokens: 8000,
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

// ── Extraction du score QA depuis un rapport ───────────────────────────────────
function extractQAScore(qaReport) {
  const match = qaReport.match(/Score\s+global\s*:\s*(\d+)\s*\/\s*10/i);
  return match ? parseInt(match[1]) : null;
}

// ── Fonction principale ────────────────────────────────────────────────────────
/**
 * Applique les correctifs QA sur le code source.
 * @param {string} qaReport          — Rapport QA (Étape 4)
 * @param {Object} generatedFiles    — Fichiers actuels { path: code }
 * @param {string} clientNeedRaw     — Besoin original
 * @returns {Promise<{correctedFiles: Object, rawOutput: string, engine: string, fileCount: number}>}
 */
async function applyCorrections(qaReport, generatedFiles, clientNeedRaw) {
  const userPrompt = buildCorrectionPrompt(qaReport, generatedFiles);
  const totalChars = Object.values(generatedFiles).reduce((s, c) => s + c.length, 0);

  console.log(`[corrector-agent] Correction de ${Object.keys(generatedFiles).length} fichiers (${totalChars} chars)`);

  let rawOutput, engine;
  try {
    rawOutput = await callDeepSeek(userPrompt);
    engine    = 'deepseek-coder';
  } catch (err) {
    console.warn('[corrector-agent] DeepSeek KO, fallback Claude:', err.message);
    if (!ANTHROPIC_KEY) throw new Error('DeepSeek KO et pas de ANTHROPIC_API_KEY');
    rawOutput = await callClaude(userPrompt);
    engine    = 'claude-fallback';
  }

  let correctedFiles = parseGeneratedFiles(rawOutput);

  // Si le parseur rate des fichiers, conserver les originaux non modifiés
  const missing = Object.keys(generatedFiles).filter(p => !correctedFiles[p]);
  if (missing.length > 0) {
    console.warn(`[corrector-agent] ${missing.length} fichiers non parsés, conservation originaux:`, missing);
    missing.forEach(p => { correctedFiles[p] = generatedFiles[p]; });
  }

  const fileCount = Object.keys(correctedFiles).length;
  console.log(`[corrector-agent] ${fileCount} fichiers corrigés via ${engine} (${rawOutput.length} chars raw)`);

  return { correctedFiles, rawOutput, engine, fileCount };
}

module.exports = { applyCorrections, extractQAScore };
