/**
 * DALEBA — Twilio Master Account
 * Gestion des sous-comptes Twilio par tenant SaaS
 * Architecture: 1 compte Master → N sous-comptes (1 par business)
 */

const twilio = require('twilio');
const { pool, DEMO_MODE } = require('../memory/db');

// Client Master
function getMasterClient() {
  return twilio(
    process.env.TWILIO_ACCOUNT_SID,
    process.env.TWILIO_AUTH_TOKEN
  );
}

/**
 * Provisionne un sous-compte Twilio pour un nouveau tenant
 * @param {number} businessId
 * @param {string} businessName
 */
async function provisionSubaccount(businessId, businessName) {
  if (DEMO_MODE) {
    console.log(`[TWILIO DEMO] Provision sous-compte pour: ${businessName}`);
    return { sid: 'ACdemo_' + businessId, status: 'demo' };
  }

  const master = getMasterClient();

  // Créer le sous-compte
  const subaccount = await master.api.accounts.create({
    friendlyName: `DALEBA — ${businessName} (#${businessId})`
  });

  console.log(`✅ Twilio sous-compte créé: ${subaccount.sid} pour ${businessName}`);

  // Enregistrer dans la DB
  await pool.query(`
    INSERT INTO tenant_twilio (business_id, subaccount_sid, twilio_account_sid, twilio_auth_token, status)
    VALUES ($1, $2, $3, $4, 'provisioned')
    ON CONFLICT (business_id) DO UPDATE
      SET subaccount_sid = EXCLUDED.subaccount_sid,
          status = 'provisioned',
          updated_at = NOW()
  `, [businessId, subaccount.sid, subaccount.sid, subaccount.authToken]);

  return subaccount;
}

/**
 * Achète et assigne un numéro de téléphone à un sous-compte tenant
 * @param {number} businessId
 * @param {string} countryCode - ex: 'CA', 'US', 'FR'
 * @param {string} areaCode - ex: '514', '450'
 */
async function purchasePhoneNumber(businessId, countryCode = 'CA', areaCode = null) {
  if (DEMO_MODE) {
    const demoNumber = '+15140000000';
    console.log(`[TWILIO DEMO] Achat numéro ${demoNumber} pour business #${businessId}`);
    return { phoneNumber: demoNumber, sid: 'PNdemo_' + businessId };
  }

  // Récupérer les infos du sous-compte
  const result = await pool.query(
    'SELECT * FROM tenant_twilio WHERE business_id = $1',
    [businessId]
  );

  if (result.rows.length === 0) {
    throw new Error(`Aucun sous-compte Twilio pour business #${businessId}`);
  }

  const tenantTwilio = result.rows[0];
  const accountSid = tenantTwilio.subaccount_sid || process.env.TWILIO_ACCOUNT_SID;
  const authToken = tenantTwilio.twilio_auth_token || process.env.TWILIO_AUTH_TOKEN;

  const client = twilio(accountSid, authToken, { accountSid });

  // Chercher un numéro disponible
  const searchParams = { voiceEnabled: true, smsEnabled: true, limit: 5 };
  if (areaCode) searchParams.areaCode = areaCode;

  const available = await client.availablePhoneNumbers(countryCode)
    .local.list(searchParams);

  if (available.length === 0) {
    throw new Error(`Aucun numéro disponible en ${countryCode}${areaCode ? ` (${areaCode})` : ''}`);
  }

  // Acheter le premier disponible
  const purchased = await client.incomingPhoneNumbers.create({
    phoneNumber: available[0].phoneNumber,
    friendlyName: `DALEBA Business #${businessId}`,
    voiceUrl: `${process.env.BASE_URL}/api/webhook/voice?business=${businessId}`,
    smsUrl: `${process.env.BASE_URL}/api/webhook/sms?business=${businessId}`,
  });

  // Mettre à jour la DB
  await pool.query(`
    UPDATE tenant_twilio
    SET phone_number = $1, phone_sid = $2, status = 'active', updated_at = NOW()
    WHERE business_id = $3
  `, [purchased.phoneNumber, purchased.sid, businessId]);

  console.log(`✅ Numéro ${purchased.phoneNumber} assigné à business #${businessId}`);
  return { phoneNumber: purchased.phoneNumber, sid: purchased.sid };
}

/**
 * Envoie un SMS via le compte du tenant (ou master si pas de sous-compte)
 * @param {number} businessId
 * @param {string} to
 * @param {string} message
 */
async function sendSMSForTenant(businessId, to, message) {
  const { getTwilioContext } = require('./tenant-integrations');
  const ctx = await getTwilioContext(businessId);

  if (DEMO_MODE || !ctx.accountSid) {
    console.log(`[SMS DEMO] Business #${businessId} → ${to}: ${message.slice(0, 50)}`);
    return { sid: 'demo', status: 'queued' };
  }

  const client = twilio(ctx.accountSid, ctx.authToken);

  const result = await client.messages.create({
    body: message,
    from: ctx.phoneNumber,
    to,
  });

  return { sid: result.sid, status: result.status, to: result.to };
}

/**
 * Status du compte Twilio d'un tenant
 */
async function getTenantTwilioStatus(businessId) {
  if (DEMO_MODE || !pool) return { status: 'demo' };
  const result = await pool.query(
    'SELECT * FROM tenant_twilio WHERE business_id = $1',
    [businessId]
  );
  return result.rows[0] || { status: 'not_provisioned' };
}

module.exports = {
  provisionSubaccount,
  purchasePhoneNumber,
  sendSMSForTenant,
  getTenantTwilioStatus,
  getMasterClient,
};
