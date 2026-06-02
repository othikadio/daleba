/**
 * DALEBA — Agent Rédacteur (Étape 2)
 * Génère une proposition commerciale B2B haut de gamme
 * pour chaque opportunité approuvée par Ulrich.
 *
 * Moteur : DeepSeek-chat
 * Langue : adaptée à la langue originale de l'opportunité
 */
'use strict';

const https        = require('https');
const { budgetForPrompt } = require('./pricing-guard');

const AI_KEY   = process.env.DEEPSEEK_API_KEY || 'sk-cca2191225a9417cb589dab3c7172015';
const AI_HOST  = 'api.deepseek.com';
const AI_PATH  = '/chat/completions';
const AI_MODEL = 'deepseek-chat';

// ── Profil DALEBA injecté dans chaque proposition ─────────────────────────────
const DALEBA_PROFILE = {
  fr: `DALEBA est une agence tech spécialisée en automatisation d'entreprises, agents IA, intégrations API (WhatsApp, Meta, Square, Stripe, CRM/ERP), chatbots intelligents, SaaS et dashboards sur mesure. Nos solutions sont rapides à déployer, robustes et orientées résultats business mesurables.`,
  en: `DALEBA is a tech agency specialized in business automation, AI agents, API integrations (WhatsApp, Meta, Square, Stripe, CRM/ERP), intelligent chatbots, SaaS and custom dashboards. We deliver fast, robust, results-driven solutions.`,
};

// ── Prompt système selon la langue ────────────────────────────────────────────
function buildSystemPrompt(lang) {
  const isFr = lang === 'fr';
  return isFr
    ? `Tu es un expert en vente B2B et en closing commercial pour une agence tech haut de gamme. 
Tu rédiges des propositions de services percutantes, personnalisées, et orientées résultats.
Ton style : professionnel, confiant, empathique, sans jargon inutile.
Structure OBLIGATOIRE de chaque proposition (respecte exactement cet ordre) :

1. **Accroche personnalisée** (2-3 phrases qui montrent qu'on a compris leur problème exact)
2. **Notre solution** (description technique précise adaptée à leur besoin)
3. **Ce que vous obtenez** (3-5 bénéfices concrets et mesurables)
4. **Délai de réalisation** (estimation réaliste)
5. **Prochaine étape** (appel à l'action clair et engageant)

Ton but : décrocher un premier échange. Pas vendre immédiatement. Ouvrir la porte.`
    : `You are a B2B sales and commercial closing expert for a premium tech agency.
You write compelling, personalized, results-driven service proposals.
Your style: professional, confident, empathetic, no unnecessary jargon.
MANDATORY structure (follow this exact order):

1. **Personalized hook** (2-3 sentences showing you understood their exact problem)
2. **Our solution** (precise technical description tailored to their need)
3. **What you get** (3-5 concrete, measurable benefits)
4. **Timeline** (realistic estimate)
5. **Next step** (clear, engaging call to action)

Your goal: land a first conversation. Not close immediately. Open the door.`;
}

// ── Prompt utilisateur ────────────────────────────────────────────────────────
function buildUserPrompt(opp, lang) {
  const isFr = lang === 'fr';
  const profile = DALEBA_PROFILE[isFr ? 'fr' : 'en'];

  if (isFr) {
    return `Voici une opportunité business approuvée par notre directeur :

**Plateforme :** ${opp.source_platform}
**Titre :** ${opp.title}
**Description (FR) :** ${opp.description_fr || opp.description_orig || '(non précisée)'}
**Budget estimé :** ${budgetForPrompt(opp)}
**Pays :** ${opp.country || 'International'}
**Catégorie :** ${opp.category}
**Score de pertinence :** ${opp.score}/100
**Mots-clés :** ${opp.keywords_matched || ''}

**Notre profil :** ${profile}

Rédige une proposition de service complète et sur-mesure en FRANÇAIS. 
Sois précis sur la solution technique. Montre qu'on a compris leur contexte.
Longueur : 300-450 mots maximum. Ton : directeur technique qui parle à un décideur.`;
  } else {
    return `Here is a business opportunity approved by our director:

**Platform:** ${opp.source_platform}
**Title:** ${opp.title}
**Description:** ${opp.description_orig || opp.description_fr || '(not specified)'}
**Estimated budget:** ${budgetForPrompt(opp)}
**Country:** ${opp.country || 'International'}
**Category:** ${opp.category}
**Relevance score:** ${opp.score}/100
**Keywords:** ${opp.keywords_matched || ''}

**Our profile:** ${profile}

Write a complete, tailored service proposal in ENGLISH.
Be precise about the technical solution. Show you understood their context.
Length: 300-450 words max. Tone: technical director speaking to a decision-maker.`;
  }
}

// ── Appel DeepSeek ────────────────────────────────────────────────────────────
function callDeepSeek(systemPrompt, userPrompt) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify({
      model:       AI_MODEL,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user',   content: userPrompt   },
      ],
      temperature: 0.7,
      max_tokens:  800,
    });

    const req = https.request({
      hostname: AI_HOST,
      path:     AI_PATH,
      method:   'POST',
      headers: {
        'Content-Type':   'application/json',
        'Authorization':  `Bearer ${AI_KEY}`,
        'Content-Length': Buffer.byteLength(body),
      },
      timeout: 30000,
    }, (res) => {
      let data = '';
      res.on('data', c => { data += c; });
      res.on('end', () => {
        try {
          const json = JSON.parse(data);
          const text = json.choices?.[0]?.message?.content || '';
          if (!text) throw new Error('Empty response: ' + data.slice(0, 200));
          resolve(text.trim());
        } catch (e) {
          reject(new Error('DeepSeek parse error: ' + e.message));
        }
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
 * Génère une proposition commerciale pour une opportunité approuvée.
 * @param {Object} opportunity - Ligne complète de daleba_opportunities
 * @returns {Promise<string>} Texte de la proposition
 */
async function generateProposal(opportunity) {
  const lang         = opportunity.language_original === 'fr' ? 'fr' : 'en';
  const systemPrompt = buildSystemPrompt(lang);
  const userPrompt   = buildUserPrompt(opportunity, lang);

  console.log(`[proposal-writer] Génération pour "${opportunity.title?.slice(0, 60)}" (lang: ${lang})`);
  const text = await callDeepSeek(systemPrompt, userPrompt);
  console.log(`[proposal-writer] Proposition générée (${text.length} chars)`);
  return text;
}

module.exports = { generateProposal };
