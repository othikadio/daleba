/**
 * DALEBA — Connecteur CodeGen [045, 048]
 * DeepSeek Coder · Claude (fallback) · Llama local (air-gap)
 *
 * Cas d'usage :
 * - [021] Génération automatique de connecteurs DARE
 * - [048] Auto-correction si format API change
 * - [023] Génération tests unitaires connecteurs
 */

'use strict';

const CODEGEN_SYSTEM = `Tu es un expert Node.js spécialisé dans la génération de connecteurs API pour DALEBA.
Structure obligatoire de chaque connecteur :
1. async query(message, systemPrompt, history, options) — interface DARE standard
2. Gestion d'erreurs explicite (throw avec message clair)
3. Retour : { model: string, content: string, usage: { input_tokens, output_tokens } }
4. Export: module.exports = { query, ...fonctions_spécialisées }
Génère uniquement du code Node.js propre, sans markdown, prêt à être écrit dans un fichier .js`;

/**
 * Génère un connecteur DARE pour une nouvelle API
 * @param {object} spec — { name, baseUrl, authScheme, endpoints[], responseFormat }
 * @returns {string} code Node.js du connecteur
 */
async function generateConnector(spec) {
  const prompt = `Génère un connecteur DARE Node.js pour cette API :

Nom: ${spec.name}
Base URL: ${spec.baseUrl || 'À configurer'}
Auth: ${spec.authScheme || 'Bearer token via env var'}
Endpoints disponibles: ${JSON.stringify(spec.endpoints || [], null, 2)}
Format réponse attendu: ${JSON.stringify(spec.responseFormat || {}, null, 2)}
Variable d'environnement clé: ${spec.envKey || `${spec.name.toUpperCase().replace(/\s+/g, '_')}_API_KEY`}

Produis le fichier complet src/agents/connectors/${spec.id || spec.name.toLowerCase()}.js`;

  const agent = getCodeAgent();
  const result = await agent.query(prompt, CODEGEN_SYSTEM, []);
  return result.content;
}

/**
 * [048] Auto-correction si le format de réponse d'une API change
 * @param {string} connectorCode — Code actuel du connecteur
 * @param {string} errorDescription — Description de l'erreur observée
 * @param {object} newResponseSample — Exemple de la nouvelle réponse reçue
 * @returns {string} Code corrigé
 */
async function autoCorrectConnector(connectorCode, errorDescription, newResponseSample) {
  const prompt = `Ce connecteur DARE produit une erreur. Corrige-le.

ERREUR OBSERVÉE :
${errorDescription}

EXEMPLE DE RÉPONSE API REÇUE (nouveau format) :
${JSON.stringify(newResponseSample, null, 2)}

CODE ACTUEL DU CONNECTEUR :
${connectorCode}

Retourne UNIQUEMENT le code corrigé, sans explication ni markdown.`;

  const agent = getCodeAgent();
  const result = await agent.query(prompt, CODEGEN_SYSTEM, []);
  return result.content;
}

/**
 * [023] Génère un test unitaire pour un connecteur
 */
async function generateTest(connectorId, connectorCode) {
  const prompt = `Génère un test unitaire Node.js (Jest/built-in) pour ce connecteur DARE.
Connecteur: ${connectorId}
Code: ${connectorCode.slice(0, 2000)}

Le test doit :
1. Mocker les appels HTTP (pas de vrais appels API)
2. Vérifier que query() retourne { model, content, usage }
3. Vérifier la gestion d'erreur si la clé API manque
4. Retourner uniquement le code de test .test.js`;

  const agent = getCodeAgent();
  const result = await agent.query(prompt, CODEGEN_SYSTEM, []);
  return result.content;
}

/**
 * Interface DARE standardisée
 */
async function query(message, systemPrompt = '', history = []) {
  const agent = getCodeAgent();
  return agent.query(message, systemPrompt || CODEGEN_SYSTEM, history);
}

function getCodeAgent() {
  // Priorité : DeepSeek Coder (spécialisé) → Claude → Llama local
  if (process.env.DEEPSEEK_API_KEY) return require('../deepseek');
  if (process.env.ANTHROPIC_API_KEY) return require('../claude');
  if (process.env.OLLAMA_BASE_URL)   return require('./llama-local');
  throw new Error('[CodeGen] Aucun provider de code disponible');
}

module.exports = { query, generateConnector, autoCorrectConnector, generateTest };
