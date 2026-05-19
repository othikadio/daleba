'use strict';
/**
 * OnboardingAgent — DALEBA Metacortex Points 251-268
 * Périmètre strict: création tenants, provision infra, génération schémas.
 */
const { BaseAgent } = require('./base-agent');
const { generateTenantId, validateTenantId } = require('../services/tenant-data-isolator');
const tenantCreds = require('../services/tenant-credentials');
const tenantCron  = require('../services/tenant-cron-init');
const squareOauth = require('../services/square-oauth');
const telephony   = require('../services/onboarding-telephony');
const bus         = require('../services/event-bus');
const crypto      = require('crypto');

class OnboardingAgent extends BaseAgent {
  constructor() {
    super({
      type: 'ONBOARDING',
      name: 'Onboarding Orchestrator',
      scope: ['tenant:create', 'infra:provision', 'schema:generate', 'twilio:subaccount', 'square:oauth', 'cron:init'],
      capabilities: ['onboard_tenant', 'provision_twilio', 'seed_square', 'generate_mmi', 'validate_forwarding'],
      config: { maxRetries: 3, timeoutMs: 120000, budgetUSD: 0.50 },
    });
  }

  // [255] Génère tenant_id slug normalisé + 4 hex
  _generateTenantId(businessName) {
    return generateTenantId(businessName);
  }

  // [285] Génère TENANT_API_KEY unique 32 bytes hex
  _generateApiKey() {
    return 'tk_' + crypto.randomBytes(24).toString('hex');
  }

  async execute(payload) {
    const { businessName, country = 'CA', timezone = 'America/Toronto', currency = 'CAD',
            managerName, managerEmail, managerPhone, areaCode } = payload;

    bus.system(`[OnboardingAgent] Démarrage onboarding: ${businessName}`);

    const tenantId  = this._generateTenantId(businessName);
    const apiKey    = this._generateApiKey();
    const result    = { tenantId, steps: [], status: 'IN_PROGRESS' };

    // Step 1: Init DB
    try {
      const { pool } = require('../memory/db');
      await pool.query(`
        INSERT INTO tenant_settings (tenant_id, tenant_name, country, timezone, currency, manager_name, manager_email, manager_phone, api_key, status, created_at)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,'onboarding',NOW())
        ON CONFLICT (tenant_id) DO UPDATE SET updated_at = NOW()
      `, [tenantId, businessName, country, timezone, currency, managerName || '', managerEmail || '', managerPhone || '', apiKey]);
      await tenantCreds.initSchema(pool);
      result.steps.push({ step: 'db_init', status: 'ok' });
    } catch (err) {
      bus.system(`[OnboardingAgent] DB init warning: ${err.message}`);
      result.steps.push({ step: 'db_init', status: 'warn', error: err.message });
    }

    // Step 2: Provision Twilio [260-263]
    let dalebaPhone = process.env.TWILIO_PHONE_NUMBER || '+13022328291';
    try {
      const tel = await telephony.runTelephonyOnboarding({ tenantId, tenantName: businessName, tenantEmail: managerEmail, countryCode: country, areaCode: areaCode || null, existingPhone: managerPhone });
      if (tel.dalebaNumber) dalebaPhone = tel.dalebaNumber;
      result.twilioAccount  = tel.twilioAccount;
      result.dalebaPhone    = dalebaPhone;
      result.forwardingInstructions = tel.forwardingInstructions;
      result.steps.push({ step: 'twilio_provision', status: tel.completed ? 'ok' : 'warn', data: dalebaPhone });
      // Store Twilio creds chiffrés [258]
      try {
        const { pool } = require('../memory/db');
        if (tel.twilioAccount?.accountSid) await tenantCreds.store(pool, tenantId, 'TWILIO_SUB_SID', tel.twilioAccount.accountSid);
        if (tel.twilioAccount?.authToken) await tenantCreds.store(pool, tenantId, 'TWILIO_SUB_TOKEN', tel.twilioAccount.authToken);
      } catch {}
    } catch (err) {
      bus.system(`[OnboardingAgent] Twilio warn: ${err.message}`);
      result.dalebaPhone = dalebaPhone;
      result.steps.push({ step: 'twilio_provision', status: 'warn', error: err.message });
    }

    // Step 3: MMI Instructions [264-266]
    try {
      result.mmiInstructions = telephony.generateForwardingInstructions(managerPhone || '', dalebaPhone, country);
      result.steps.push({ step: 'mmi_gen', status: 'ok' });
    } catch (err) {
      result.steps.push({ step: 'mmi_gen', status: 'warn', error: err.message });
    }

    // Step 4: Square OAuth URL [257]
    try {
      const redirectUri = `${process.env.DALEBA_BASE_URL || 'https://daleba-api-production.up.railway.app'}/api/v1/onboarding/square/callback`;
      result.squareAuthUrl = squareOauth.buildAuthUrl(tenantId, redirectUri);
      result.steps.push({ step: 'square_oauth_url', status: 'ok' });
    } catch (err) {
      result.steps.push({ step: 'square_oauth_url', status: 'warn', error: err.message });
    }

    // Step 5: Init crons [268]
    try {
      const { pool } = require('../memory/db');
      await tenantCron.initTenantCrons(tenantId, timezone, pool);
      result.steps.push({ step: 'cron_init', status: 'ok' });
    } catch (err) {
      result.steps.push({ step: 'cron_init', status: 'warn', error: err.message });
    }

    // Step 6: Store API key [285]
    try {
      const { pool } = require('../memory/db');
      await tenantCreds.store(pool, tenantId, 'TENANT_API_KEY', apiKey);
      result.tenantApiKey = apiKey;
      result.steps.push({ step: 'api_key', status: 'ok' });
    } catch {}

    // Step 7: Journal [279]
    bus.system(`[OnboardingAgent] ✅ Onboarding initié: ${tenantId} | ${businessName} | ${country}`);

    result.status = 'ONBOARDING_INITIATED';
    result.message = 'Onboarding initié avec succès.';
    return result;
  }

  async getOnboardingStatus(tenantId) {
    try {
      const { pool } = require('../memory/db');
      const r = await pool.query(`SELECT * FROM tenant_settings WHERE tenant_id = $1`, [tenantId]);
      return r.rows[0] || null;
    } catch { return null; }
  }

  // [286] Rapport vocal pour Ulrich
  async getVoiceSummary() {
    try {
      const { pool } = require('../memory/db');
      const today = await pool.query(`SELECT COUNT(*) FROM tenant_settings WHERE DATE(created_at) = CURRENT_DATE`);
      const total = await pool.query(`SELECT COUNT(*) FROM tenant_settings WHERE status != 'deleted'`);
      const count = today.rows[0]?.count || 0;
      const totalCount = total.rows[0]?.count || 0;
      return `${count} nouveau${count > 1 ? 'x' : ''} salon${count > 1 ? 's' : ''} aujourd'hui. ${totalCount} salons actifs au total sur la plateforme DALEBA.`;
    } catch {
      return "Données d'onboarding temporairement indisponibles.";
    }
  }
}

const agent = new OnboardingAgent();
module.exports = agent;
module.exports.OnboardingAgent = OnboardingAgent;
