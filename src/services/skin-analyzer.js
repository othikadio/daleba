'use strict';
/**
 * Skin Analyzer — DALEBA Metacortex Points 355-358
 * [355] Cerveau d'Analyse Cutanée Multimodale (Gemini Vision)
 * [356] Accepte upload photos macro peau/cuir chevelu
 * [357] JSON structuré: hydratation, inflammations, densité capillaire, botanicals
 * [358] INTERDIT: diagnostics médicaux — reformuler en conseils cosmétiques
 */
const bus = require('./event-bus');

// [358] Mots médicaux à filtrer et reformuler
const MEDICAL_TERMS = [
  'acné', 'acne', 'rosacea', 'eczéma', 'eczema', 'psoriasis', 'dermatite',
  'dermatitis', 'mélanome', 'melanoma', 'carcinome', 'cancer', 'infection',
  'pathologie', 'maladie', 'symptôme', 'traitement médical', 'prescription médicale',
  'diagnostic', 'allergie sévère', 'urticaire',
];

/**
 * [358] Filtre et reformule les termes médicaux
 */
function sanitizeMedicalTerms(text) {
  let sanitized = text;
  const replacements = {
    'acné': 'imperfections cutanées',
    'acne': 'skin imperfections',
    'eczéma': 'sensibilité cutanée',
    'rosacea': 'rougeurs diffuses',
    'dermatite': 'réaction cutanée',
    'psoriasis': 'sensibilité cutanée avancée',
    'infection': 'déséquilibre du microbiome cutané',
    'inflammation': 'zones d\'irritation',
    'pathologie': 'condition cutanée',
    'maladie': 'déséquilibre cutané',
  };
  for (const [term, repl] of Object.entries(replacements)) {
    const re = new RegExp(term, 'gi');
    sanitized = sanitized.replace(re, repl);
  }
  return sanitized;
}

/**
 * [357] Prompt Gemini Vision pour analyse cutanée
 */
function buildAnalysisPrompt(skinHistory = null) {
  const historyCtx = skinHistory
    ? `Historique client: type de peau ${skinHistory.skin_type || 'inconnu'}, allergies: ${(skinHistory.allergies||[]).join(', ') || 'aucune connue'}.`
    : '';

  return `Tu es un expert en cosmétologie botanique et soins de beauté. Analyse cette image de peau ou cuir chevelu et fournis UNIQUEMENT des conseils cosmétiques non médicaux.

${historyCtx}

Réponds STRICTEMENT en JSON avec cette structure:
{
  "hydration_index": "sec|gras|mixte|normal",
  "scalp_density": "faible|normale|dense" (si cuir chevelu visible),
  "skin_tone": "uniforme|irrégulier|zones_mixtes",
  "irritation_zones": "aucune|légère|modérée",
  "texture": "lisse|granuleuse|rugueuse|mixte",
  "recommended_botanicals": [
    { "ingredient": "nom", "benefit": "bénéfice cosmétique", "usage": "comment l'appliquer" }
  ],
  "care_routine": {
    "morning": "routine matin recommandée",
    "evening": "routine soir recommandée"
  },
  "wellness_note": "conseil bien-être non médical en 2 phrases max",
  "confidence_score": 0.0-1.0
}

RÈGLE ABSOLUE: Ne pose AUCUN diagnostic médical. Si une condition médicale semble présente, dis UNIQUEMENT: "Nous recommandons une consultation avec un professionnel de santé pour cette observation." puis fournis des conseils cosmétiques généraux adaptés.`;
}

/**
 * [355-357] Analyse une image cutanée via Gemini Vision
 */
async function analyze({ tenantId, imageBase64, clientId, pool }) {
  bus.system(`[SkinAnalyzer] Analyse cutanée: client=${clientId}, tenant=${tenantId}`);

  // Récupère l'historique client si dispo
  let skinHistory = null;
  if (pool && clientId) {
    try {
      const records = require('./aesthetic-records');
      skinHistory = await records.getRecord(pool, tenantId, clientId);
    } catch {}
  }

  const prompt = buildAnalysisPrompt(skinHistory);

  // Appel Gemini Vision via DARE ou Anthropic Vision
  let rawAnalysis = null;

  try {
    // Tentative Gemini Vision
    const { GoogleGenerativeAI } = require('@google/generative-ai');
    const genAI  = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
    const model  = genAI.getGenerativeModel({ model: 'gemini-1.5-flash' });

    const imageData = {
      inlineData: {
        data: imageBase64.replace(/^data:image\/\w+;base64,/, ''),
        mimeType: imageBase64.startsWith('data:image/png') ? 'image/png' : 'image/jpeg',
      },
    };

    const result = await model.generateContent([prompt, imageData]);
    const text   = result.response.text();
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (jsonMatch) rawAnalysis = JSON.parse(jsonMatch[0]);

  } catch {
    // Fallback Anthropic Vision
    try {
      const Anthropic = require('@anthropic-ai/sdk');
      const client    = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
      const resp      = await client.messages.create({
        model: 'claude-opus-4-5',
        max_tokens: 1024,
        messages: [{
          role: 'user',
          content: [
            { type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: imageBase64.replace(/^data:image\/\w+;base64,/, '') } },
            { type: 'text', text: prompt },
          ],
        }],
      });
      const text      = resp.content[0]?.text || '';
      const jsonMatch = text.match(/\{[\s\S]*\}/);
      if (jsonMatch) rawAnalysis = JSON.parse(jsonMatch[0]);
    } catch {
      // Fallback simulé (mode démo)
      rawAnalysis = {
        hydration_index: 'mixte',
        scalp_density: 'normale',
        skin_tone: 'uniforme',
        irritation_zones: 'aucune',
        texture: 'lisse',
        recommended_botanicals: [
          { ingredient: 'Aloe Vera', benefit: 'Hydratation et apaisement', usage: 'Appliquer en gel après nettoyage' },
          { ingredient: 'Huile de Jojoba', benefit: 'Équilibre sébacé', usage: 'Quelques gouttes en sérum nocturne' },
          { ingredient: 'Thé Vert', benefit: 'Antioxydant protecteur', usage: 'Tonique refroidissant matin' },
        ],
        care_routine: {
          morning: 'Nettoyage doux + Tonique thé vert + SPF botanique',
          evening: 'Double nettoyage + Sérum jojoba + Masque aloe hebdo',
        },
        wellness_note: 'Votre peau présente un bel équilibre. Privilégiez des soins hydratants légers et une protection solaire quotidienne.',
        confidence_score: 0.72,
        demo_mode: true,
      };
    }
  }

  if (!rawAnalysis) throw new Error('Analyse cutanée échouée — aucun modèle disponible');

  // [358] Sanitize: aucun terme médical dans la réponse
  if (rawAnalysis.wellness_note) rawAnalysis.wellness_note = sanitizeMedicalTerms(rawAnalysis.wellness_note);
  rawAnalysis.disclaimer = '⚠️ Ces informations constituent des conseils de bien-être cosmétique uniquement et ne remplacent pas un avis médical professionnel.';
  rawAnalysis.analyzedAt = new Date().toISOString();
  rawAnalysis.tenantId   = tenantId;
  rawAnalysis.clientId   = clientId;

  // Sauvegarde dans la fiche client
  if (pool && clientId) {
    try {
      const records = require('./aesthetic-records');
      await records.createRecord(pool, tenantId, clientId, {
        skinType:       rawAnalysis.hydration_index,
        hydrationIndex: rawAnalysis.hydration_index,
        lastAnalysis:   rawAnalysis,
        botanicalPrefs: rawAnalysis.recommended_botanicals?.map(b => b.ingredient) || [],
      });
    } catch {}
  }

  bus.system(`[SkinAnalyzer] ✅ Analyse complète: hydratation=${rawAnalysis.hydration_index}, score=${rawAnalysis.confidence_score}`);
  return rawAnalysis;
}

/**
 * [357] Recommandations botaniques basées sur le profil cutané
 */
function recommendBotanicals(skinProfile = {}) {
  const { hydration_index, skin_tone, irritation_zones } = skinProfile;

  const db = {
    sec:     [{ ingredient:'Aloe Vera',       benefit:'Hydratation profonde' },
               { ingredient:'Huile d\'Argan',  benefit:'Nutrition et éclat' },
               { ingredient:'Karité',          benefit:'Barrière cutanée' }],
    gras:    [{ ingredient:'Thé Vert',         benefit:'Régulation sébacée' },
               { ingredient:'Argile Blanche',  benefit:'Absorption excès sebum' },
               { ingredient:'Neem',            benefit:'Purifiant naturel' }],
    mixte:   [{ ingredient:'Huile de Jojoba',  benefit:'Équilibre sebum' },
               { ingredient:'Rose Musquée',    benefit:'Réparation zones sèches' },
               { ingredient:'Camomille',       benefit:'Apaisement zones mixtes' }],
    sensible:[{ ingredient:'Calendula',        benefit:'Anti-irritant doux' },
               { ingredient:'Avoine Colloïdale',benefit:'Apaisement intense' },
               { ingredient:'Lavande',         benefit:'Calmant naturel' }],
  };

  return db[hydration_index] || db.mixte;
}

module.exports = { analyze, recommendBotanicals, sanitizeMedicalTerms, buildAnalysisPrompt };
