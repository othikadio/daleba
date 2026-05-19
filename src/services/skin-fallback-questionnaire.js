'use strict';
/**
 * Skin Fallback Questionnaire — DALEBA Metacortex Point 382
 * Questionnaire textuel intelligent si l'API vision est indisponible.
 * Retourne un profil cutané structuré compatible avec skin-analyzer.js.
 */

const QUESTIONS = [
  { id: 'feel_after_wash', text: 'Après le nettoyage, votre peau se sent:', options: { 'tiraillée et sèche': 'sec', 'confortable': 'normal', 'encore grasse': 'gras', 'inconfortable et réactive': 'sensible' } },
  { id: 'shine_by_noon',   text: 'À midi, votre peau brille:', options: { 'sur tout le visage': 'gras', 'sur le nez et le front seulement': 'mixte', 'pas du tout': 'sec', 'jamais, elle semble toujours terne': 'sec' } },
  { id: 'sensitivity',     text: 'Ma peau réagit aux changements de température ou aux nouveaux produits:', options: { 'souvent et avec rougeurs': 'sensible', 'parfois légèrement': 'mixte', 'rarement': 'normal', 'jamais': 'gras' } },
  { id: 'pores',           text: 'Mes pores sont:', options: { 'visibles et dilatés': 'gras', 'fins et peu visibles': 'normal', 'visibles uniquement sur le nez': 'mixte', 'pratiquement invisibles': 'sec' } },
];

/**
 * [382] Détermine le profil cutané à partir des réponses au questionnaire
 */
function determineSkinType(answers = {}) {
  const votes = { sec: 0, gras: 0, mixte: 0, normal: 0, sensible: 0 };

  for (const [qId, answer] of Object.entries(answers)) {
    const q = QUESTIONS.find(q => q.id === qId);
    if (!q) continue;
    const skinType = q.options[answer];
    if (skinType) votes[skinType]++;
  }

  const dominant = Object.entries(votes).sort((a, b) => b[1] - a[1])[0];
  const skinType = dominant[1] > 0 ? dominant[0] : 'mixte';

  const botanical = {
    sec:      [{ ingredient:'Aloe Vera', benefit:'Hydratation profonde', usage:'Matin et soir' }, { ingredient:'Karité', benefit:'Nutrition intense', usage:'Soir' }],
    gras:     [{ ingredient:'Thé Vert', benefit:'Régulation sébacée', usage:'Tonique matin' }, { ingredient:'Argile Blanche', benefit:'Purification', usage:'Masque 2×/semaine' }],
    mixte:    [{ ingredient:'Huile de Jojoba', benefit:'Équilibre sebum', usage:'Sérum soir' }, { ingredient:'Camomille', benefit:'Apaisement', usage:'Brume tonique' }],
    normal:   [{ ingredient:'Rose Musquée', benefit:'Éclat et protection', usage:'Sérum matin' }, { ingredient:'Niacinamide botanique', benefit:'Prévention', usage:'Quotidien' }],
    sensible: [{ ingredient:'Calendula', benefit:'Anti-irritant', usage:'Crème 2×/jour' }, { ingredient:'Avoine Colloïdale', benefit:'Apaisement', usage:'Bain ou masque' }],
  };

  return {
    hydration_index:        skinType,
    texture:                skinType === 'sec' ? 'rugueuse' : skinType === 'gras' ? 'granuleuse' : 'lisse',
    irritation_zones:       skinType === 'sensible' ? 'légère' : 'aucune',
    recommended_botanicals: botanical[skinType] || botanical.mixte,
    care_routine: {
      morning: skinType === 'sec' ? 'Nettoyage doux + sérum hydratant riche + SPF' : 'Nettoyage + tonique régulateur + crème légère',
      evening: skinType === 'gras' ? 'Double nettoyage + argile 2×/sem + hydratation gel' : 'Démaquillage + sérum actif + crème nuit',
    },
    wellness_note: `Profil déterminé par questionnaire (mode hors-ligne). Type de peau: ${skinType}. Consultation visuelle recommandée à votre prochaine visite.`,
    confidence_score: 0.55,
    source:           'questionnaire_fallback',
    disclaimer:       '⚠️ Profil basé sur questionnaire — analyse visuelle par IA recommandée pour un résultat plus précis.',
    votes,
  };
}

function getQuestions() { return QUESTIONS; }

module.exports = { QUESTIONS, determineSkinType, getQuestions };
