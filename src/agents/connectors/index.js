/**
 * DARE Connector Registry — Auto-discovery & hot-loading
 * DALEBA Metacortex — Points 021, 044, 046, 049
 *
 * Source de vérité pour tous les connecteurs spécialisés.
 * Les connecteurs core (claude, gpt4o, deepseek) restent dans src/agents/.
 * Ce registre gère les connecteurs spécialisés + tiers.
 */

'use strict';

const path = require('path');
const manifest = require('./manifest.json');

// ─── CACHE D'INSTANCES ────────────────────────────────────────────────────────

const _cache = {};

/**
 * Charge un connecteur par ID (avec cache)
 * @param {string} id — ID du connecteur (ex: 'gemini', 'vision', 'tts')
 * @returns {object} — Module connecteur avec au minimum { query }
 */
function load(id) {
  if (_cache[id]) return _cache[id];

  const spec = manifest.connectors[id];
  if (!spec) throw new Error(`[Connectors] Connecteur inconnu: ${id}`);
  if (spec.status === 'standby') {
    throw new Error(`[Connectors] ${spec.name} est en mode standby — activer via DARE`);
  }

  const modulePath = path.resolve(__dirname, spec.module.replace('./', ''));
  try {
    const mod = require(modulePath);
    _cache[id] = mod;
    return mod;
  } catch (err) {
    throw new Error(`[Connectors] Impossible de charger ${id} (${modulePath}): ${err.message}`);
  }
}

/**
 * Retourne tous les connecteurs disponibles (module chargeable + envKey présente)
 */
function listAvailable() {
  return Object.values(manifest.connectors).filter(spec => {
    if (spec.status === 'standby') return false;
    const envKeys = (spec.envKey || '').split('|');
    return envKeys.some(k => !!process.env[k.trim()]);
  }).map(s => s.id);
}

/**
 * Retourne les specs d'un connecteur (pour HUD / DARE status)
 */
function getSpec(id) {
  return manifest.connectors[id] || null;
}

/**
 * Retourne le manifest complet
 */
function getManifest() {
  return manifest;
}

// ─── EXPORTS ─────────────────────────────────────────────────────────────────

module.exports = { load, listAvailable, getSpec, getManifest };
