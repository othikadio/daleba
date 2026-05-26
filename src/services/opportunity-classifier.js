/**
 * Opportunity Classifier — Radar Planétaire
 * Utilise GPT-4o-mini pour scorer, catégoriser, traduire chaque opportunité brute.
 */
'use strict';

const https = require('https');

// DeepSeek — actif et valide (OpenAI key expirée)
const AI_API_KEY  = process.env.DEEPSEEK_API_KEY || process.env.OPENAI_API_KEY || 'sk-cca2191225a9417cb589dab3c7172015';
const AI_BASE     = 'api.deepseek.com';
const AI_PATH     = '/chat/completions';
const AI_MODEL    = 'deepseek-chat';

const SYSTEM_PROMPT = `Tu es un classificateur d'opportunités business pour DALEBA OS, une agence tech spécialisée en :
- Automatisation de workflows, bots, agents IA
- Intégrations API (WhatsApp, Meta, Square, Stripe, CRM, ERP)
- Chatbots / agents conversationnels / LLM
- Applications SaaS et dashboards
- Systèmes de réservation en ligne
- Services numériques pour PME

STRATÉGIE STRICTE : DALEBA ne prend QUE des missions freelance/forfait/short-term, 100% à distance.

Critères D'EXCLUSION ABSOLUE (relevant=false, score=0) :
- CDI, CDD, emploi temps plein, poste permanent, à pourvoir
- "Manager", "Directeur", "VP", "Lead" avec gestion d'équipe
- Présentiel obligatoire / on-site / hybrid obligé
- "Full-time employee", "W2", "staff", "hire"
- Recrutement RH, offre d'emploi classique
- TARIF HORAIRE : toute mission avec tarif à l'heure ("/hr", "per hour", "hourly rate", "$/h", "taux horaire", "par heure")
  Exception : si le budget TOTAL du projet est mentionné en plus du tarif horaire ET que le total est un forfait fixe

Critères REQUIS pour être relevant=true :
- Freelance, contrat, mission, projet, forfait, short-term, part-time
- Remote, télétravail, à distance, distributed, anywhere
- Livrable clair (app, bot, API, intégration, automatisation)
- Budget FIXE global (ex: "$2000 fixed", "budget: 1500€", "forfait 3000$") — PAS un tarif horaire

Analyse chaque opportunité et retourne UNIQUEMENT un JSON valide (pas de texte autour).`;

const USER_PROMPT_TPL = (opp) => `Analyse cette opportunité :

Plateforme : ${opp.platform}
Titre : ${opp.title}
Description : ${opp.description?.slice(0, 1500) || '(vide)'}
Budget brut : ${opp.budget_raw || 'non précisé'}
Pays : ${opp.country || 'inconnu'}
Langue détectée : ${opp.language || 'en'}

Réponds avec ce JSON exact :
{
  "score": <0-100>,
  "category": "<automation|api-integration|chatbot-ia|saas|web-app|autre>",
  "work_type": "<freelance|contract|full-time|unknown>",
  "is_remote": <true|false|null>,
  "budget_type": "<fixed|hourly|unknown>",
  "keywords_matched": "<mots clés pertinents séparés par virgule>",
  "budget_estimated": <nombre USD ou null>,
  "budget_currency": "<USD|EUR|CAD|GBP>",
  "country": "<pays ou null>",
  "language_original": "<code ISO 2 lettres>",
  "description_fr": "<traduction/résumé en français, 2-4 phrases max>",
  "relevant": <true|false>,
  "exclusion_reason": "<raison si relevant=false, sinon null>"
}

Règles de scoring (s'appliquent SEULEMENT si relevant=true) :
- Score > 80 : mission remote confirmée + budget > 2000 USD + livrable tech clair
- Score 60-80 : mission freelance/contrat, scope défini, budget estimable
- Score 40-60 : potentiellement intéressant mais vague sur remote ou budget
- Score < 40 : vague, pas de budget, incertain
- Si relevant=false : score = 0 OBLIGATOIRE
- Mots positifs : automation, automate, workflow, API, integration, chatbot, AI agent, LLM, SaaS, dashboard, booking, CRM, WhatsApp bot, remote, freelance, contract, short-term`;

function callOpenAI(messages) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify({
      model: AI_MODEL,
      messages,
      temperature: 0.2,
      max_tokens: 500,
    });

    const req = https.request({
      hostname: AI_BASE,
      path: AI_PATH,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${AI_API_KEY}`,
        'Content-Length': Buffer.byteLength(body),
      },
      timeout: 25000,
    }, (res) => {
      let data = '';
      res.on('data', (c) => { data += c; });
      res.on('end', () => {
        try {
          const json = JSON.parse(data);
          resolve(json);
        } catch {
          reject(new Error('OpenAI parse error: ' + data.slice(0, 200)));
        }
      });
    });

    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error('OpenAI timeout')); });
    req.write(body);
    req.end();
  });
}

async function classifyOpportunity(rawOpportunity) {
  try {
    const messages = [
      { role: 'system', content: SYSTEM_PROMPT },
      { role: 'user',   content: USER_PROMPT_TPL(rawOpportunity) },
    ];

    const res = await callOpenAI(messages);
    const content = res.choices?.[0]?.message?.content || '';

    // Extraire le JSON de la réponse (peut avoir des backticks)
    const jsonMatch = content.match(/\{[\s\S]*\}/);
    if (!jsonMatch) throw new Error('No JSON in response: ' + content.slice(0, 200));

    const classification = JSON.parse(jsonMatch[0]);

    const isRelevant = classification.relevant !== false
                       && classification.budget_type !== 'hourly'; // forfait uniquement
    return {
      ...rawOpportunity,
      score:              isRelevant ? Math.max(0, Math.min(100, parseInt(classification.score) || 0)) : 0,
      category:           classification.category || 'autre',
      work_type:          classification.work_type || 'unknown',
      is_remote:          classification.is_remote ?? null,
      budget_type:        classification.budget_type || 'unknown',
      keywords_matched:   classification.keywords_matched || '',
      budget_estimated:   classification.budget_estimated ? parseFloat(classification.budget_estimated) : null,
      budget_currency:    classification.budget_currency || 'USD',
      country:            classification.country || rawOpportunity.country || null,
      language_original:  classification.language_original || rawOpportunity.language || 'en',
      description_fr:     classification.description_fr || '',
      relevant:           isRelevant,
      exclusion_reason:   classification.exclusion_reason || null,
    };
  } catch (err) {
    console.warn(`[classifier] Erreur pour "${rawOpportunity.title?.slice(0, 60)}": ${err.message}`);
    // Fallback : scoring basique par keywords
    const text = `${rawOpportunity.title} ${rawOpportunity.description}`.toLowerCase();
    const keywords = ['automation', 'api', 'chatbot', 'integration', 'saas', 'bot', 'workflow', 'llm'];
    const matched  = keywords.filter(k => text.includes(k));
    return {
      ...rawOpportunity,
      score:             matched.length * 12,
      category:          'autre',
      keywords_matched:  matched.join(', '),
      budget_estimated:  null,
      budget_currency:   'USD',
      language_original: rawOpportunity.language || 'en',
      description_fr:    rawOpportunity.description?.slice(0, 300) || '',
      relevant:          matched.length >= 2,
    };
  }
}

/**
 * Classifie un tableau d'opportunités brutes, en série pour éviter rate limit.
 * @param {Array} rawOpportunities
 * @param {number} [concurrency=3]
 */
async function classifyBatch(rawOpportunities, concurrency = 3) {
  const results = [];
  for (let i = 0; i < rawOpportunities.length; i += concurrency) {
    const chunk = rawOpportunities.slice(i, i + concurrency);
    const classified = await Promise.allSettled(chunk.map(classifyOpportunity));
    for (const r of classified) {
      if (r.status === 'fulfilled') results.push(r.value);
    }
    // Petite pause pour éviter rate-limit
    if (i + concurrency < rawOpportunities.length) {
      await new Promise(r => setTimeout(r, 500));
    }
  }
  return results;
}

module.exports = { classifyOpportunity, classifyBatch };
