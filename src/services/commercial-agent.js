/**
 * DALEBA V43 — Agent Commercial IA
 *
 * Analyse les emails entrants → détecte l'intention → rédige la réponse
 * Moteur : DeepSeek (principal) → Claude (fallback)
 */
'use strict';

const https = require('https');

const DEEPSEEK_KEY  = process.env.DEEPSEEK_API_KEY || 'sk-cca2191225a9417cb589dab3c7172015';
const ANTHROPIC_KEY = process.env.ANTHROPIC_API_KEY;

// ── Intentions détectables ────────────────────────────────────────────────────
const INTENTS = {
  INTEREST:   'interest',      // Intérêt général, veut en savoir plus
  QUOTE:      'quote',         // Demande de devis ou tarif
  AGREEMENT:  'agreement',     // Accord de principe, prêt à payer
  PAYMENT:    'payment',       // Confirmation de paiement
  QUESTION:   'question',      // Question technique ou logistique
  OBJECTION:  'objection',     // Hésitation, objection prix/délai
  UNSUBSCRIBE:'unsubscribe',   // Demande de désinscription
  OTHER:      'other',         // Autre
};

// ── Prompt Système ─────────────────────────────────────────────────────────────
const SYSTEM_PROMPT = `Tu es l'Agent Commercial de DALEBA OS, une plateforme IA de développement logiciel B2B.
Tu analyses les réponses de prospects et clients pour :
1. Détecter leur intention exacte
2. Rédiger une réponse professionnelle, chaleureuse et orientée closing

RÈGLES :
- Langue : réponds dans la même langue que l'email reçu
- Ton : professionnel mais humain, jamais robotique
- Si le prospect montre un intérêt ou un accord → propose un appel de 15 min ou un devis précis
- Si demande de devis → propose 3 niveaux (Starter, Pro, Enterprise)
- Si accord/paiement confirmé → remercie, confirme les prochaines étapes, annonce le démarrage
- JAMAIS de fausses promesses sur les délais
- Signature : "L'équipe DALEBA OS | daleba.vercel.app"

FORMAT DE RÉPONSE OBLIGATOIRE (JSON strict) :
{
  "intent": "interest|quote|agreement|payment|question|objection|unsubscribe|other",
  "intent_confidence": 0.0-1.0,
  "intent_fr": "description courte en français",
  "should_create_task": true|false,
  "task_description": "description pour l'Usine de Production (si should_create_task=true)",
  "reply_subject": "sujet de réponse",
  "reply_text": "corps de la réponse (texte brut, avec sauts de ligne)",
  "reply_html": "corps de la réponse (HTML simple avec <p> et <br>)",
  "urgency": "low|medium|high",
  "summary": "résumé en 1 phrase de l'email reçu"
}`;

// ── LLM helpers ───────────────────────────────────────────────────────────────
function callDeepSeek(prompt) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify({
      model:       'deepseek-chat',
      temperature: 0.4,
      max_tokens:  2000,
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'user',   content: prompt },
      ],
      response_format: { type: 'json_object' },
    });
    const req = https.request({
      hostname: 'api.deepseek.com',
      path:     '/chat/completions',
      method:   'POST',
      headers: { 'Authorization': `Bearer ${DEEPSEEK_KEY}`, 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) },
      timeout: 60000,
    }, (res) => {
      let data = '';
      res.on('data', c => { data += c; });
      res.on('end', () => {
        try {
          const json = JSON.parse(data);
          if (json.error) throw new Error(json.error.message);
          resolve(json.choices?.[0]?.message?.content || '{}');
        } catch (e) { reject(new Error('DeepSeek: ' + e.message)); }
      });
    });
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error('DeepSeek timeout')); });
    req.write(body); req.end();
  });
}

function callClaude(prompt) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify({
      model:      'claude-opus-4-5',
      max_tokens: 2000,
      system:     SYSTEM_PROMPT,
      messages:   [{ role: 'user', content: prompt }],
    });
    const req = https.request({
      hostname: 'api.anthropic.com',
      path:     '/v1/messages',
      method:   'POST',
      headers: { 'x-api-key': ANTHROPIC_KEY, 'anthropic-version': '2023-06-01', 'content-type': 'application/json', 'Content-Length': Buffer.byteLength(body) },
      timeout: 60000,
    }, (res) => {
      let data = '';
      res.on('data', c => { data += c; });
      res.on('end', () => {
        try {
          const json = JSON.parse(data);
          if (json.error) throw new Error(json.error.message);
          resolve(json.content?.[0]?.text || '{}');
        } catch (e) { reject(new Error('Claude: ' + e.message)); }
      });
    });
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error('Claude timeout')); });
    req.write(body); req.end();
  });
}

// ── Analyse principale ────────────────────────────────────────────────────────
async function analyzeEmail({ from, subject, text, previousContext = '' }) {
  const prompt = `EMAIL REÇU :
De : ${from}
Objet : ${subject}
---
${text}
${previousContext ? `\n---\nCONTEXTE PRÉCÉDENT :\n${previousContext}` : ''}

Analyse cet email et génère la réponse JSON.`;

  let raw, engine;
  try {
    raw    = await callDeepSeek(prompt);
    engine = 'deepseek';
  } catch (err) {
    console.warn('[commercial-agent] DeepSeek KO, fallback Claude:', err.message);
    if (!ANTHROPIC_KEY) throw new Error('DeepSeek KO et pas de ANTHROPIC_API_KEY');
    raw    = await callClaude(prompt);
    engine = 'claude-fallback';
  }

  let result;
  try {
    result = JSON.parse(raw);
  } catch (e) {
    // Extraire JSON du texte si l'agent a ajouté du texte autour
    const match = raw.match(/\{[\s\S]*\}/);
    result = match ? JSON.parse(match[0]) : {};
  }

  return {
    intent:             result.intent             || 'other',
    intent_confidence:  result.intent_confidence  ?? 0.5,
    intent_fr:          result.intent_fr          || 'Intention inconnue',
    should_create_task: result.should_create_task ?? false,
    task_description:   result.task_description   || '',
    reply_subject:      result.reply_subject       || `Re: ${subject}`,
    reply_text:         result.reply_text          || '',
    reply_html:         result.reply_html          || '',
    urgency:            result.urgency             || 'medium',
    summary:            result.summary             || '',
    engine,
  };
}

module.exports = { analyzeEmail, INTENTS };
