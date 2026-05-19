'use strict';
/**
 * AestheticsAgent — DALEBA Metacortex Points 351-367
 * @module AestheticsAgent
 *
 * @description
 * Agent spécialisé soins esthétiques.
 * Périmètre STRICT [351]:
 *   - Gestion des fiches esthétiques clients
 *   - Analyse d'images cutanées (non-médical [358])
 *   - Validation des clés d'API d'extension [353]
 *
 * Hors périmètre (throw si tentative):
 *   - Accès tables SQL coiffure
 *   - Modification du noyau central
 *   - Diagnostic médical [358]
 */
const { BaseAgent } = require('./base-agent');
const bus = require('../services/event-bus');

/** @constant Actions autorisées [351] */
const ALLOWED_ACTIONS = new Set([
  'analyze_skin',
  'get_aesthetic_record',
  'create_aesthetic_record',
  'update_aesthetic_record',
  'mount_extension',
  'generate_prescription',
  'recommend_botanicals',
  'deduct_inventory',
]);

/** @constant Tables INTERDITES d'accès [353] */
const FORBIDDEN_TABLES = new Set([
  'tenant_appointments',
  'staff_profiles',
  'staff_payouts',
  'tenant_settings',
  'staff_skills',
  'tenant_credentials',
]);

class AestheticsAgent extends BaseAgent {
  /**
   * @param {object} [config] - Configuration optionnelle
   */
  constructor(config = {}) {
    super({
      type:       'AESTHETICS',
      name:       'AestheticsAgent',
      scope:      ['aesthetics:read', 'aesthetics:write', 'skin:analyze', 'botanical:recommend'],
      capabilities: [...ALLOWED_ACTIONS],
      config: {
        maxRetries:   3,
        timeoutMs:    45_000,   // analyse image peut être longue
        budgetUSD:    0.25,
        ...config,
      },
    });
  }

  /**
   * Vérifie que l'action est dans le périmètre [351]
   * @param {string} action
   * @throws {Error} Si hors périmètre
   */
  _assertScope(action) {
    if (!ALLOWED_ACTIONS.has(action)) {
      throw new Error(`[AestheticsAgent] Action hors périmètre: "${action}". Périmètre: ${[...ALLOWED_ACTIONS].join(', ')}`);
    }
  }

  /**
   * Vérifie qu'une table SQL n'est pas interdite [353]
   * @param {string} tableName
   * @throws {Error} Si table interdite
   */
  _assertTableAccess(tableName) {
    if (FORBIDDEN_TABLES.has(tableName)) {
      throw new Error(`[AestheticsAgent] Accès REFUSÉ à la table "${tableName}" — hors périmètre esthétique [353]`);
    }
  }

  /**
   * Point d'entrée principal
   * @param {object} payload - { action, tenantId, ...params }
   */
  async execute(payload = {}) {
    const { action, tenantId, ...params } = payload;
    this._assertScope(action);
    this.log(`AestheticsAgent.execute(${action}) tenant=${tenantId}`);

    switch (action) {
      case 'analyze_skin':
        return this._analyzeSkin(tenantId, params);
      case 'get_aesthetic_record':
        return this._getRecord(tenantId, params);
      case 'create_aesthetic_record':
        return this._createRecord(tenantId, params);
      case 'update_aesthetic_record':
        return this._updateRecord(tenantId, params);
      case 'mount_extension':
        return this._mountExtension(tenantId, params);
      case 'generate_prescription':
        return this._generatePrescription(tenantId, params);
      case 'recommend_botanicals':
        return this._recommendBotanicals(tenantId, params);
      case 'deduct_inventory':
        return this._deductInventory(tenantId, params);
      default:
        throw new Error(`Action non gérée: ${action}`);
    }
  }

  async _analyzeSkin(tenantId, { imageBase64, clientId, pool }) {
    const analyzer = require('../services/skin-analyzer');
    return analyzer.analyze({ tenantId, imageBase64, clientId, pool });
  }

  async _getRecord(tenantId, { clientId, pool }) {
    const records = require('../services/aesthetic-records');
    return records.getRecord(pool, tenantId, clientId);
  }

  async _createRecord(tenantId, { clientId, data, pool }) {
    const records = require('../services/aesthetic-records');
    return records.createRecord(pool, tenantId, clientId, data);
  }

  async _updateRecord(tenantId, { clientId, data, pool }) {
    const records = require('../services/aesthetic-records');
    return records.updateRecord(pool, tenantId, clientId, data);
  }

  async _mountExtension(tenantId, { extensionKey, config, pool }) {
    const sandbox = require('../services/extension-sandbox');
    return sandbox.mount(pool, tenantId, extensionKey, config);
  }

  async _generatePrescription(tenantId, { clientId, analysisResult, pool }) {
    const prescriber = require('../services/botanical-prescription');
    return prescriber.generate(pool, tenantId, clientId, analysisResult);
  }

  async _recommendBotanicals(tenantId, { skinProfile }) {
    const analyzer = require('../services/skin-analyzer');
    return analyzer.recommendBotanicals(skinProfile);
  }

  async _deductInventory(tenantId, { formulationId, quantitiesUsed, pool }) {
    const inventory = require('../services/aesthetic-inventory');
    return inventory.deduct(pool, tenantId, formulationId, quantitiesUsed);
  }
}

module.exports = { AestheticsAgent };
