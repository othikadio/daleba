/**
 * DALEBA — Agent Correcteur (Usine de Production, V41)
 *
 * Stratégie fichier-par-fichier :
 *   1. Identifie les fichiers mentionnés dans les sections CRITIQUE + MAJEUR du rapport QA
 *   2. Corrige chaque fichier SÉPARÉMENT (évite la troncature DeepSeek)
 *   3. Relance automatiquement l'Agent QA pour obtenir une nouvelle note
 *
 * Moteur : DeepSeek-Coder (principal) → Claude (fallback)
 */
'use strict';

const https = require('https');

const DEEPSEEK_KEY  = process.env.DEEPSEEK_API_KEY || 'sk-cca2191225a9417cb589dab3c7172015';
const ANTHROPIC_KEY = process.env.ANTHROPIC_API_KEY;

console.log(`[corrector-agent] Moteur: deepseek-coder (fichier-par-fichier)`);

// ── Prompt Système V42 — Blocs ciblés ───────────────────────────────────────────
const SYSTEM_PROMPT = `Tu es un ingénieur backend senior spécialisé en correction de code Node.js.

STRATÉGIE BLOCS CIBLÉS (V42) :
- Tu reçois UN fichier et UNE liste de corrections à appliquer
- Retourne UNIQUEMENT les blocs modifiés au format PATCH
- NE RETOURNE PAS tout le fichier — seulement les différences
- Format de réponse OBLIGATOIRE pour chaque correction :

=== PATCH: description courte ===
OLD:
[code original exact, 1 à 5 lignes maximum]
NEW:
[code corrigé exact]

RÈGLES :
- OLD doit être une copie exacte du code original (copié-collé tel quel)
- NEW ne contient que les lignes modifiées
- Pas de commentaire // FIX: dans le code corrigé (code propre)
- Si rien à corriger dans ce fichier, réponds exactement : NO_CHANGES_NEEDED`;

// ── Extraire une section du rapport QA ────────────────────────────────────────
function extractSection(text, startMarker, endMarker) {
  const start = text.indexOf(startMarker);
  if (start === -1) return '';
  const end = endMarker ? text.indexOf(endMarker, start + startMarker.length) : text.length;
  return text.slice(start + startMarker.length, end === -1 ? text.length : end).trim();
}

// ── Identifier les fichiers à corriger depuis le rapport ─────────────────────
function getFilesToFix(qaReport) {
  const filesToFix = new Set();
  const critBlock = extractSection(qaReport, 'CRITIQUE', 'MAJEUR');
  const majBlock  = extractSection(qaReport, 'MAJEUR',   'MINEUR');
  const combined  = critBlock + '\n' + majBlock;

  const knownFiles = [
    'models/db.js', 'models/users.js', 'models/orders.js',
    'models/gps_logs.js', 'models/deliveries.js',
    'controllers/auth.controller.js', 'controllers/delivery.controller.js',
    'controllers/schedule.controller.js', 'sockets/location.socket.js',
  ];

  knownFiles.forEach(filepath => {
    const filename = filepath.split('/').pop();
    if (combined.includes(filename)) filesToFix.add(filepath);
  });

  // Fallback si rien détecté : cibler les 3 fichiers les plus problématiques
  if (filesToFix.size === 0) {
    ['controllers/delivery.controller.js', 'models/gps_logs.js', 'sockets/location.socket.js']
      .forEach(f => filesToFix.add(f));
  }

  return filesToFix;
}


// ── Parseur de patches V42 (format OLD:/NEW:) ────────────────────────────────
/**
 * Parse la réponse PATCH de l'agent et l'applique sur le code source.
 * Chaque patch est un remplacement exact de bloc OLD par bloc NEW.
 */
function applyPatchResponse(rawResponse, originalCode) {
  if (!rawResponse || rawResponse.trim() === 'NO_CHANGES_NEEDED') {
    return { code: originalCode, patchCount: 0 };
  }

  const patchRegex = /=== PATCH:[^=\n]*===\s*OLD:\s*([\s\S]*?)\s*NEW:\s*([\s\S]*?)(?==== PATCH:|$)/g;
  let code = originalCode;
  let patchCount = 0;
  let match;

  while ((match = patchRegex.exec(rawResponse)) !== null) {
    const oldBlock = match[1].trim();
    const newBlock = match[2].trim();
    if (!oldBlock || oldBlock === newBlock) continue;
    if (code.includes(oldBlock)) {
      code = code.replace(oldBlock, newBlock);
      patchCount++;
      console.log(`[corrector-agent] Patch appliqué: ${oldBlock.slice(0, 50).replace(/\n/g, '↲')}`);
    } else {
      console.warn(`[corrector-agent] Patch OLD non trouvé: ${oldBlock.slice(0, 60).replace(/\n/g, '↲')}`);
    }
  }

  return { code, patchCount };
}

// ── Corriger un seul fichier (appel ciblé) ────────────────────────────────────
function buildSingleFilePrompt(filePath, fileCode, qaReport) {
  const critBlock = extractSection(qaReport, 'CRITIQUE', 'MAJEUR');
  const majBlock  = extractSection(qaReport, 'MAJEUR',   'MINEUR');
  const fileName  = filePath.split('/').pop();

  // Extraire uniquement les corrections pertinentes pour ce fichier
  const relevant = [critBlock, majBlock].join('\n')
    .split('\n\n')
    .filter(block => block.includes(fileName))
    .join('\n\n') || 'Voir rapport complet — corrige les problèmes évidents dans ce fichier.';

  return `CORRECTIONS À APPLIQUER sur ${filePath} :

${relevant}

---

CODE ACTUEL DE ${filePath} :

${fileCode}

Retourne le fichier COMPLET corrigé. Commence directement par le code.`;
}

// ── Appel DeepSeek-Coder ───────────────────────────────────────────────────────
function callDeepSeek(userPrompt) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify({
      model:       'deepseek-coder',
      temperature: 0.05,
      max_tokens:  4000,
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
      max_tokens: 4000,
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

// ── Corriger un seul fichier ───────────────────────────────────────────────────
async function correctSingleFile(filePath, fileCode, qaReport) {
  const prompt = buildSingleFilePrompt(filePath, fileCode, qaReport);
  let out, engine;

  try {
    out    = await callDeepSeek(prompt);
    engine = 'deepseek-coder';
  } catch (err) {
    console.warn(`[corrector-agent] DeepSeek KO sur ${filePath}, fallback Claude:`, err.message);
    if (!ANTHROPIC_KEY) throw err;
    out    = await callClaude(prompt);
    engine = 'claude-fallback';
  }

  // V42 : appliquer via parseur de patches (blocs ciblés)
  const { code: patchedCode, patchCount } = applyPatchResponse(out, fileCode);

  if (patchCount > 0) {
    console.log(`[corrector-agent] ${patchCount} patch(es) appliqués sur ${filePath}`);
    return { code: patchedCode, engine };
  }

  // Fallback : réponse pleine (si l'agent a ignoré le format PATCH)
  const cleaned = out
    .replace(/^```(?:js|javascript|typescript)?\n?/gm, '')
    .replace(/^```$/gm, '')
    .trim();
  if (cleaned.length > 100 && cleaned !== 'NO_CHANGES_NEEDED') {
    console.log(`[corrector-agent] Fallback plein fichier ${filePath} (${cleaned.length} chars)`);
    return { code: cleaned, engine };
  }

  console.log(`[corrector-agent] Aucun changement sur ${filePath}`);
  return { code: fileCode, engine }; // rien à corriger
}

// ── Extraction du score QA depuis un rapport ───────────────────────────────────
function extractQAScore(qaReport) {
  const match = qaReport.match(/Score\s+global\s*:\s*\**(\d+)\**\s*\/\s*10/i);
  return match ? parseInt(match[1]) : null;
}

// ── Fonction principale ────────────────────────────────────────────────────────
/**
 * Applique les correctifs QA fichier-par-fichier.
 * @param {string} qaReport          — Rapport QA
 * @param {Object} generatedFiles    — Fichiers actuels { path: code }
 * @param {string} clientNeedRaw     — Besoin original
 * @returns {Promise<{correctedFiles, rawOutput, engine, fileCount}>}
 */
async function applyCorrections(qaReport, generatedFiles, clientNeedRaw) {
  const filesToFix = getFilesToFix(qaReport);
  const totalChars = Object.values(generatedFiles).reduce((s, c) => s + c.length, 0);

  console.log(`[corrector-agent] ${filesToFix.size} fichiers ciblés / ${Object.keys(generatedFiles).length} total (${totalChars} chars)`);
  console.log('[corrector-agent] Fichiers:', [...filesToFix].join(', '));

  // Copier tous les fichiers originaux
  const correctedFiles = { ...generatedFiles };
  const rawParts       = [];
  let   lastEngine     = 'deepseek-coder';

  for (const filePath of filesToFix) {
    if (!generatedFiles[filePath]) {
      console.warn(`[corrector-agent] Fichier introuvable: ${filePath}`);
      continue;
    }
    try {
      const { code, engine } = await correctSingleFile(filePath, generatedFiles[filePath], qaReport);

      if (code && code.length > 100) {
        correctedFiles[filePath] = code;
        lastEngine = engine;
        rawParts.push(`=== FILE: ${filePath} ===\n${code}`);
        console.log(`[corrector-agent] ✓ ${filePath} corrigé (${code.length} chars, ${engine})`);
      } else {
        console.warn(`[corrector-agent] ⚠ ${filePath} — réponse trop courte (${code?.length} chars), original conservé`);
      }
    } catch (err) {
      console.error(`[corrector-agent] Erreur ${filePath}:`, err.message);
    }
  }

  const fileCount = Object.keys(correctedFiles).length;
  const rawOutput = rawParts.join('\n\n');

  console.log(`[corrector-agent] Terminé — ${filesToFix.size} fichiers traités, ${fileCount} au total`);
  return { correctedFiles, rawOutput, engine: lastEngine, fileCount };
}

module.exports = { applyCorrections, extractQAScore };
