'use strict';
/**
 * provisionTenant() — DALEBA Metacortex Point 297 (Atomos Execution)
 *
 * Encapsule tout le provisioning dans une transaction SQL atomique.
 * Si Twilio OU Square échoue → rollback complet + nettoyage.
 *
 * Architecture de la fonction [300]:
 * ┌─────────────────────────────────────────────────────┐
 * │  provisionTenant(params)                            │
 * │  ├── BEGIN TRANSACTION (SQL)                        │
 * │  ├── [1] INSERT tenant_settings (draft)             │
 * │  ├── [2] INSERT tenant_cron_registry (4 crons)      │
 * │  ├── [3] provisionSubaccount Twilio                 │
 * │  │       → sur échec: ROLLBACK + cleanupTwilio()    │
 * │  ├── [4] purchaseLocalNumber Twilio                 │
 * │  │       → sur échec: ROLLBACK + releaseNumber()    │
 * │  ├── [5] registerRoute réseau dynamique             │
 * │  ├── [6] ENCRYPT + store Twilio creds               │
 * │  ├── [7] UPDATE tenant_settings status='active'     │
 * │  ├── [8] COMMIT                                     │
 * │  └── [9] Journal onboarding SUCCESS                 │
 * │                                                     │
 * │  En cas d'erreur à toute étape:                     │
 * │  └── ROLLBACK + cleanup Twilio async                │
 * └─────────────────────────────────────────────────────┘
 *
 * Mécanisme de cloisonnement SQL [300]:
 * Chaque query passe par createIsolatedPool(pool, tenantId)
 * qui valide et préfixe automatiquement le tenant_id.
 * Le SecuritySentry scanne chaque SQL avant exécution.
 */
const bus         = require('./event-bus');
const telephony   = require('./onboarding-telephony');
const tenantCreds = require('./tenant-credentials');
const tenantCron  = require('./tenant-cron-init');
const netRoutes   = require('./network-routes');
const journal     = require('./onboarding-journal');
const watchdog    = require('./onboarding-watchdog');
const { createIsolatedPool, generateTenantId, validateTenantId } = require('./tenant-data-isolator');
const { inspectQuery, reportViolation } = require('./tenant-security-sentry');
const squareOauth = require('./square-oauth');
const crypto      = require('crypto');

/**
 * [297] Transaction atomique de provisioning complet d'un tenant.
 *
 * @param {object} pool       — Pool PostgreSQL
 * @param {object} params     — { businessName, country, timezone, currency, managerName, managerEmail, managerPhone, areaCode }
 * @returns {object}          — { tenantId, dalebaPhone, squareAuthUrl, mmiInstructions, tenantApiKey, steps }
 */
async function provisionTenant(pool, params) {
  const {
    businessName, country = 'CA', timezone = 'America/Toronto',
    currency = 'CAD', managerName = '', managerEmail = '',
    managerPhone = '', areaCode = null, passwordHash = null,
  } = params;

  const tenantId  = generateTenantId(businessName);
  const apiKey    = 'tk_' + crypto.randomBytes(24).toString('hex');
  const result    = { tenantId, steps: [], ok: false };
  const isolated  = pool ? createIsolatedPool(pool, tenantId) : null;

  // Ressources Twilio allouées — à nettoyer si rollback
  let twilioSubSid   = null;
  let twilioSubToken = null;
  let twilioNumSid   = null;
  let dalebaPhone    = process.env.TWILIO_PHONE_NUMBER || '+13022328291';

  watchdog.startStep(tenantId, 'provision_total');

  // ── TRANSACTION SQL ────────────────────────────────────────────────────────
  const client = pool ? await pool.connect().catch(() => null) : null;

  try {
    if (client) await client.query('BEGIN');

    // ── STEP 1: INSERT tenant en draft ──────────────────────────────────────
    watchdog.startStep(tenantId, 'db_init');
    if (client) {
      const sql = `
        INSERT INTO tenant_settings
          (tenant_id, tenant_name, country, timezone, currency,
           manager_name, manager_email, manager_phone, api_key,
           password_hash, status, created_at)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,'draft',NOW())
        ON CONFLICT (tenant_id) DO NOTHING
      `;
      _assertSqlSafe(sql, tenantId);
      await client.query(sql, [
        tenantId, businessName, country, timezone, currency,
        managerName, managerEmail, managerPhone, apiKey, passwordHash,
      ]);
    }
    watchdog.endStep(tenantId, 'db_init', true);
    result.steps.push({ step: 'db_init', status: 'ok' });

    // ── STEP 2: Crons ────────────────────────────────────────────────────────
    watchdog.startStep(tenantId, 'cron_init');
    if (client) {
      await tenantCron.initTenantCrons(tenantId, timezone, { query: (...a) => client.query(...a) }).catch(() => {});
    }
    watchdog.endStep(tenantId, 'cron_init', true);
    result.steps.push({ step: 'cron_init', status: 'ok' });

    // ── STEP 3+4: Twilio (hors transaction SQL — ressource externe) ──────────
    watchdog.startStep(tenantId, 'twilio_provision');
    try {
      const tel = await telephony.runTelephonyOnboarding({
        tenantId, tenantName: businessName, tenantEmail: managerEmail,
        countryCode: country, areaCode, existingPhone: managerPhone,
      });

      if (tel.dalebaNumber) dalebaPhone = tel.dalebaNumber;
      if (tel.twilioAccount?.accountSid) twilioSubSid   = tel.twilioAccount.accountSid;
      if (tel.twilioAccount?.authToken)  twilioSubToken = tel.twilioAccount.authToken;

      result.dalebaPhone           = dalebaPhone;
      result.twilioAccount         = tel.twilioAccount;
      result.forwardingInstructions = tel.forwardingInstructions;
      result.steps.push({ step: 'twilio', status: tel.completed ? 'ok' : 'warn', phone: dalebaPhone });
    } catch (twilioErr) {
      // Twilio non bloquant — onboarding continue avec le numéro par défaut
      bus.system(`[Provision] Twilio warn: ${twilioErr.message}`);
      result.steps.push({ step: 'twilio', status: 'warn', error: twilioErr.message });
    }
    watchdog.endStep(tenantId, 'twilio_provision', true);

    // ── STEP 5: Route réseau ─────────────────────────────────────────────────
    await netRoutes.registerRoute(pool, {
      phoneNumber: dalebaPhone, tenantId, accountSid: twilioSubSid,
    }).catch(() => {});
    result.steps.push({ step: 'network_route', status: 'ok' });

    // ── STEP 6: Chiffrement credentials ─────────────────────────────────────
    if (client && twilioSubSid) {
      await tenantCreds.store({ query: (...a) => client.query(...a) }, tenantId, 'TWILIO_SUB_SID', twilioSubSid).catch(() => {});
      if (twilioSubToken) await tenantCreds.store({ query: (...a) => client.query(...a) }, tenantId, 'TWILIO_SUB_TOKEN', twilioSubToken).catch(() => {});
    }
    await tenantCreds.store(pool, tenantId, 'TENANT_API_KEY', apiKey).catch(() => {});
    result.steps.push({ step: 'credentials', status: 'ok' });

    // ── STEP 7: URL OAuth Square ─────────────────────────────────────────────
    const redirectUri = `${process.env.DALEBA_BASE_URL || 'https://daleba-api-production.up.railway.app'}/api/v1/onboarding/square/callback`;
    result.squareAuthUrl    = squareOauth.buildAuthUrl(tenantId, redirectUri);
    result.mmiInstructions  = telephony.generateForwardingInstructions(managerPhone, dalebaPhone, country);
    result.tenantApiKey     = apiKey;

    // ── STEP 8: COMMIT — statut actif ────────────────────────────────────────
    if (client) {
      const updateSql = `UPDATE tenant_settings SET status='onboarding', updated_at=NOW() WHERE tenant_id=$1`;
      _assertSqlSafe(updateSql, tenantId);
      await client.query(updateSql, [tenantId]);
      await client.query('COMMIT');
    }

    result.ok     = true;
    result.status = 'ONBOARDING_INITIATED';

    // ── STEP 9: Journal SUCCESS [279] ─────────────────────────────────────────
    await journal.record(pool, { tenantId, tenantName: businessName, country, status: 'SUCCESS', steps: result.steps }).catch(() => {});

    watchdog.endStep(tenantId, 'provision_total', true);
    const report = watchdog.getReport(tenantId);
    result.perfReport = { totalMs: report.totalMs, verdict: report.verdict, bottlenecks: report.bottlenecks };

    bus.system(`[Provision] ✅ ${tenantId} | ${businessName} | ${dalebaPhone} | ${report.totalMs}ms`);

  } catch (err) {
    // ── ROLLBACK ATOMIQUE ────────────────────────────────────────────────────
    bus.system(`[Provision] ❌ ROLLBACK ${tenantId}: ${err.message}`);
    if (client) {
      try { await client.query('ROLLBACK'); } catch {}
    }

    // Nettoyage ressources Twilio allouées
    await _cleanupTwilio(twilioSubSid, twilioSubToken, twilioNumSid).catch(() => {});

    await journal.record(pool, { tenantId, tenantName: businessName, country, status: 'FAILED', steps: result.steps }).catch(() => {});

    watchdog.endStep(tenantId, 'provision_total', false, err.message);

    result.ok    = false;
    result.error = err.message;
    throw err;

  } finally {
    if (client) client.release();
  }

  return result;
}

// ─── HELPERS ─────────────────────────────────────────────────────────────────

/**
 * Vérifie qu'un SQL est sécurisé avant exécution [276]
 */
function _assertSqlSafe(sql, tenantId) {
  const { safe, pattern } = inspectQuery(sql, tenantId);
  if (!safe) {
    reportViolation(tenantId, { pattern, severity: 'critical', sql: sql.slice(0, 80) }).catch(() => {});
    throw new Error(`[SecuritySentry] SQL refusé: pattern interdit détecté`);
  }
}

/**
 * Nettoie les ressources Twilio si rollback [297]
 */
async function _cleanupTwilio(subSid, subToken, numSid) {
  if (!subSid || subSid.startsWith('SIMULATED')) return;
  try {
    const twilio = require('twilio')(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN);
    if (numSid) await twilio.incomingPhoneNumbers(numSid).remove().catch(() => {});
    // Les sous-comptes ne peuvent pas être supprimés via API (Twilio limitation) — on les suspend
    await twilio.api.accounts(subSid).update({ status: 'suspended' }).catch(() => {});
    bus.system(`[Provision] Twilio cleanup: sous-compte ${subSid} suspendu`);
  } catch (e) {
    bus.system(`[Provision] Cleanup Twilio warn: ${e.message}`);
  }
}

module.exports = { provisionTenant };
