/**
 * DALEBA — Routeur Dynamique Multi-IA
 * Analyse chaque requête et sélectionne le modèle optimal
 */

const MODELS = {
  claude: {
    name: 'Claude (Anthropic)',
    strengths: ['strategy', 'reasoning', 'code', 'complex', 'analysis'],
    cost: 'medium',
  },
  gpt4o: {
    name: 'GPT-4o (OpenAI)',
    strengths: ['creative', 'writing', 'conversation', 'vision'],
    cost: 'medium',
  },
  deepseek: {
    name: 'DeepSeek-V3',
    strengths: ['data', 'math', 'optimization', 'bulk', 'cheap'],
    cost: 'low',
  },
};

/**
 * Analyse la requête et retourne le modèle le plus adapté
 */
function selectModel(message, context = {}) {
  const text = message.toLowerCase();

  // Forcer un modèle si spécifié dans le contexte
  if (context.forceModel && MODELS[context.forceModel]) {
    return context.forceModel;
  }

  // Règles de routage intelligent
  const rules = [
    // DeepSeek — données, math, volume
    {
      model: 'deepseek',
      triggers: ['calcul', 'données', 'tableau', 'statistique', 'math', 'chiffre', 'excel', 'csv', 'optimis'],
    },
    // GPT-4o — créatif, rédaction, contenu
    {
      model: 'gpt4o',
      triggers: ['écris', 'rédige', 'histoire', 'roman', 'créatif', 'slogan', 'caption', 'description', 'post'],
    },
    // Claude — défaut pour logique, code, stratégie
    {
      model: 'claude',
      triggers: ['code', 'programme', 'stratégie', 'analyse', 'pourquoi', 'explique', 'architecture'],
    },
  ];

  for (const rule of rules) {
    if (rule.triggers.some(trigger => text.includes(trigger))) {
      return rule.model;
    }
  }

  // Par défaut : Claude (le plus polyvalent)
  return 'claude';
}

/**
 * Détermine la raison du choix du modèle (pour le log DALEBA)
 */
function explainRouting(model, message) {
  const reasons = {
    claude: '🧠 Claude sélectionné — tâche logique/stratégique',
    gpt4o: '✍️ GPT-4o sélectionné — tâche créative/rédactionnelle',
    deepseek: '📊 DeepSeek sélectionné — traitement de données (coût optimisé)',
  };
  return reasons[model] || '🧠 Claude sélectionné — modèle par défaut';
}

module.exports = { selectModel, explainRouting, MODELS };
