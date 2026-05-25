/**
 * DALEBA — Agent Product Owner (Usine de Production, Étape 1)
 *
 * Traduit un besoin client brut en cahier des charges fonctionnel structuré.
 *
 * Moteur : Claude (ANTHROPIC_API_KEY) → DeepSeek (fallback)
 */
'use strict';

const https = require('https');

// ── Sélection du moteur LLM ───────────────────────────────────────────────────
const ANTHROPIC_KEY = process.env.ANTHROPIC_API_KEY;
const DEEPSEEK_KEY  = process.env.DEEPSEEK_API_KEY || 'sk-cca2191225a9417cb589dab3c7172015';

const ENGINE = ANTHROPIC_KEY ? 'claude' : 'deepseek';
console.log(`[product-owner] Moteur: ${ENGINE}`);

// ── Prompt système ────────────────────────────────────────────────────────────
const SYSTEM_PROMPT = `Tu es un Agent Product Owner senior chez DALEBA, une agence tech spécialisée en automatisation, agents IA, intégrations API et SaaS.

Ton unique rôle : transformer un besoin client brut en un cahier des charges fonctionnel complet, structuré et exploitable par une équipe de développement.

STRUCTURE OBLIGATOIRE de ta réponse (respecte exactement ces sections dans cet ordre) :

## 1. Résumé Exécutif
(2-3 phrases — ce que le système fait, pour qui, quel problème il résout)

## 2. Objectifs & Critères de Succès
(liste bullet — objectifs mesurables, KPIs)

## 3. Fonctionnalités Principales
(liste numérotée — features core, organisées par priorité MoSCoW : Must/Should/Could)

## 4. Architecture Technique Proposée
(stack recommandé, intégrations API requises, base de données, hébergement)

## 5. Flux Utilisateur Principal
(étapes numérotées du parcours principal — de l'action initiale à la confirmation)

## 6. Cas Limites & Contraintes
(edge cases à anticiper, contraintes légales/techniques)

## 7. Estimation & Découpage Sprint
(estimation en jours/sprints, découpage en phases livrables)

## 8. Questions Ouvertes
(points à clarifier avec le client avant de commencer)

Ton style : précis, technique, actionnable. Pas de fluff. Chaque section doit être utilisable directement par un développeur.`;

// ── Appel Claude ──────────────────────────────────────────────────────────────
function callClaude(userPrompt) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify({
      model:      'claude-opus-4-5',
      max_tokens: 2000,
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
      timeout: 45000,
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

// ── Appel DeepSeek ────────────────────────────────────────────────────────────
function callDeepSeek(userPrompt) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify({
      model:       'deepseek-chat',
      temperature: 0.4,
      max_tokens:  2000,
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
      timeout: 45000,
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

// ── Fonction principale ───────────────────────────────────────────────────────
/**
 * Génère un cahier des charges fonctionnel à partir d'un besoin client brut.
 * @param {string} clientNeedRaw   — Besoin exprimé en langage naturel
 * @param {string} [context]       — Contexte optionnel (industrie, stack existant...)
 * @returns {Promise<{spec: string, engine: string}>}
 */
async function generateSpec(clientNeedRaw, context = '') {
  const userPrompt = context
    ? `BESOIN CLIENT :\n${clientNeedRaw}\n\nCONTEXTE ADDITIONNEL :\n${context}`
    : `BESOIN CLIENT :\n${clientNeedRaw}`;

  console.log(`[product-owner] Génération spec pour: "${clientNeedRaw.slice(0, 80)}"`);

  let spec, engine;
  if (ANTHROPIC_KEY) {
    try {
      spec   = await callClaude(userPrompt);
      engine = 'claude';
    } catch (err) {
      console.warn('[product-owner] Claude échoué, fallback DeepSeek:', err.message);
      spec   = await callDeepSeek(userPrompt);
      engine = 'deepseek-fallback';
    }
  } else {
    spec   = await callDeepSeek(userPrompt);
    engine = 'deepseek';
  }

  console.log(`[product-owner] Spec générée (${spec.length} chars) via ${engine}`);
  return { spec, engine };
}

module.exports = { generateSpec };
