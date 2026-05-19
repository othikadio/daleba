'use strict';
/**
 * Extension Module Registry — DALEBA Metacortex Point 387
 * Supporte l'ajout de nouveaux modules esthétiques tiers (maquillage permanent,
 * onglerie avancée, etc.) par simple injection de fiches JSON de configuration.
 */
const bus  = require('./event-bus');
const fs   = require('fs');
const path = require('path');

// Registre en mémoire
const _registry = new Map();

// Schéma minimal obligatoire pour une fiche JSON de module
const REQUIRED_FIELDS = ['moduleId', 'name', 'category', 'version', 'endpoints'];

/**
 * [387] Valide une fiche JSON de configuration de module
 */
function validateModuleConfig(config) {
  const missing = REQUIRED_FIELDS.filter(f => !config[f]);
  if (missing.length) throw new Error(`Fiche module invalide — champs manquants: ${missing.join(', ')}`);
  if (!config.moduleId.match(/^[a-z0-9_-]{3,64}$/)) throw new Error('moduleId: format invalide (a-z0-9_- requis, 3-64 chars)');
  return true;
}

/**
 * [387] Enregistre un module tiers depuis une fiche JSON
 */
function registerModule(configJSON) {
  const config = typeof configJSON === 'string' ? JSON.parse(configJSON) : configJSON;
  validateModuleConfig(config);

  _registry.set(config.moduleId, {
    ...config,
    registeredAt: new Date().toISOString(),
    status:       'active',
  });

  bus.system(`[ExtensionRegistry] ✅ Module enregistré: ${config.name} (${config.moduleId}) v${config.version}`);
  return { registered: true, moduleId: config.moduleId };
}

/**
 * [387] Charge tous les modules depuis un répertoire de fiches JSON
 */
function loadModulesFromDir(dir) {
  if (!fs.existsSync(dir)) return { loaded: 0 };
  let loaded = 0;
  for (const file of fs.readdirSync(dir).filter(f => f.endsWith('.json'))) {
    try {
      const raw = fs.readFileSync(path.join(dir, file), 'utf8');
      registerModule(JSON.parse(raw));
      loaded++;
    } catch (e) {
      bus.system(`[ExtensionRegistry] ⚠️ Erreur chargement ${file}: ${e.message}`);
    }
  }
  return { loaded };
}

function getModule(moduleId)    { return _registry.get(moduleId) || null; }
function listModules()          { return [..._registry.values()]; }
function deactivateModule(id)   { if (_registry.has(id)) _registry.get(id).status = 'inactive'; }

// Exemples intégrés [387]
const BUILTIN_MODULES = [
  {
    moduleId:   'onglerie-avancee',
    name:       'Onglerie Avancée',
    category:   'nail_care',
    version:    '1.0.0',
    endpoints:  ['/api/v1/aesthetics/nails/book', '/api/v1/aesthetics/nails/catalog'],
    services:   ['Gel UV', 'Pose acrylique', 'Nail art', 'Manucure spa'],
    duration:   { min: 45, max: 120 },
    resources:  ['station-ongles-1', 'station-ongles-2'],
  },
  {
    moduleId:   'maquillage-permanent',
    name:       'Maquillage Permanent',
    category:   'permanent_makeup',
    version:    '1.0.0',
    endpoints:  ['/api/v1/aesthetics/pmu/book', '/api/v1/aesthetics/pmu/aftercare'],
    services:   ['Sourcils microblading', 'Eye-liner permanent', 'Lèvres'],
    duration:   { min: 90, max: 180 },
    resources:  ['cabine-pmu'],
    requiresCertification: true,
  },
];

// Chargement auto des modules intégrés
BUILTIN_MODULES.forEach(m => _registry.set(m.moduleId, { ...m, registeredAt: new Date().toISOString(), status: 'active' }));

module.exports = { registerModule, loadModulesFromDir, getModule, listModules, deactivateModule, validateModuleConfig };
