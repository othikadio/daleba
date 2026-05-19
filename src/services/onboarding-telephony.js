/**
 * DALEBA V26 — Onboarding Téléphonique Universel
 * - Génère les codes MMI de transfert d'appel par pays
 * - Crée des sous-comptes Twilio isolés par tenant
 * - Achète des numéros locaux à la volée
 */

const bus = require('./event-bus');
const twilio = require('twilio');

const MASTER_SID   = process.env.TWILIO_ACCOUNT_SID;
const MASTER_TOKEN = process.env.TWILIO_AUTH_TOKEN;
const DALEBA_BASE  = process.env.DALEBA_BASE_URL || 'https://daleba-api-production.up.railway.app';

// ─── MMI CODES PAR PAYS ──────────────────────────────────────────────────────

/**
 * Codes MMI standards de transfert d'appel inconditionnel
 * Format: *21*<numéro># (GSM universel)
 * Certains opérateurs utilisent des variantes
 */
const MMI_PROFILES = {
  CA: {
    country: 'Canada',
    unconditional:  (num) => `*21*${num}#`,
    busyForward:    (num) => `*67*${num}#`,
    noAnswerForward:(num) => `*61*${num}#`,
    cancel:         () => `#21#`,
    carrierNote: 'Fonctionne sur Bell, Rogers, Telus, Vidéotron. Pour certains forfaits, contacter le support opérateur.',
    prefix: '+1',
  },
  US: {
    country: 'États-Unis',
    unconditional:  (num) => `*72${num}`,
    busyForward:    (num) => `*71${num}`,
    noAnswerForward:(num) => `*73${num}`,
    cancel:         () => `*73`,
    carrierNote: 'AT&T, T-Mobile, Verizon. Composer sans # sur la plupart des réseaux.',
    prefix: '+1',
  },
  FR: {
    country: 'France',
    unconditional:  (num) => `*21*${num}#`,
    busyForward:    (num) => `*67*${num}#`,
    noAnswerForward:(num) => `*61*${num}#`,
    cancel:         () => `##21#`,
    carrierNote: 'Orange, SFR, Bouygues, Free. Standard GSM européen.',
    prefix: '+33',
  },
  BE: {
    country: 'Belgique',
    unconditional:  (num) => `*21*${num}#`,
    busyForward:    (num) => `*67*${num}#`,
    noAnswerForward:(num) => `*61*${num}#`,
    cancel:         () => `##21#`,
    carrierNote: 'Proximus, Orange, Base.',
    prefix: '+32',
  },
  CH: {
    country: 'Suisse',
    unconditional:  (num) => `*21*${num}#`,
    busyForward:    (num) => `*67*${num}#`,
    noAnswerForward:(num) => `*61*${num}#`,
    cancel:         () => `##21#`,
    carrierNote: 'Swisscom, Sunrise, Salt.',
    prefix: '+41',
  },
  SN: {
    country: 'Sénégal',
    unconditional:  (num) => `*21*${num}#`,
    busyForward:    (num) => `*67*${num}#`,
    noAnswerForward:(num) => `*61*${num}#`,
    cancel:         () => `##21#`,
    carrierNote: 'Orange, Free, Expresso.',
    prefix: '+221',
  },
  CI: {
    country: "Côte d'Ivoire",
    unconditional:  (num) => `*21*${num}#`,
    busyForward:    (num) => `*67*${num}#`,
    noAnswerForward:(num) => `*61*${num}#`,
    cancel:         () => `##21#`,
    carrierNote: 'MTN, Orange, Moov.',
    prefix: '+225',
  },
  DEFAULT: {
    country: 'International',
    unconditional:  (num) => `*21*${num}#`,
    busyForward:    (num) => `*67*${num}#`,
    noAnswerForward:(num) => `*61*${num}#`,
    cancel:         () => `##21#`,
    carrierNote: 'Code MMI GSM universel (3GPP TS 22.030). Vérifier avec votre opérateur.',
    prefix: '',
  },
};

/**
 * Génère les instructions de transfert d'appel pour un tenant
 * @param {string} tenantPhone   — numéro actuel de l'entreprise
 * @param {string} dalebaNumber  — numéro Twilio DALEBA attribué
 * @param {string} countryCode   — code pays ISO 2 (CA, FR, US…)
 */
function generateForwardingInstructions(tenantPhone, dalebaNumber, countryCode = 'CA') {
  const profile = MMI_PROFILES[countryCode.toUpperCase()] || MMI_PROFILES.DEFAULT;
  const daleba  = dalebaNumber.replace(/\s/g, '');

  return {
    country:    profile.country,
    countryCode,
    tenantPhone,
    dalebaNumber: daleba,
    instructions: {
      unconditional: {
        label:   'Transfert inconditionnel (recommandé)',
        code:    profile.unconditional(daleba),
        description: 'Tous les appels sont redirigés vers DALEBA immédiatement.',
      },
      busyLine: {
        label:   'Transfert si occupé',
        code:    profile.busyForward(daleba),
        description: 'DALEBA prend le relais quand la ligne est occupée.',
      },
      noAnswer: {
        label:   'Transfert si pas de réponse',
        code:    profile.noAnswerForward(daleba),
        description: 'DALEBA répond si vous ne décrochez pas après 20 secondes.',
      },
      cancel: {
        label:   'Annuler le transfert',
        code:    profile.cancel(),
        description: 'Désactive le transfert et revient au mode normal.',
      },
    },
    carrierNote: profile.carrierNote,
    steps: [
      `1. Ouvrez l'application téléphone de votre smartphone`,
      `2. Composez le code : ${profile.unconditional(daleba)}`,
      `3. Appuyez sur le bouton d'appel (📞)`,
      `4. Vous entendrez une confirmation — le transfert est actif`,
      `5. Testez en appelant votre numéro depuis un autre téléphone`,
    ],
    generatedAt: new Date().toISOString(),
  };
}

// ─── SOUS-COMPTES TWILIO PAR TENANT ─────────────────────────────────────────

/**
 * Crée un sous-compte Twilio isolé pour un nouveau tenant
 * @param {object} tenant — { id, name, email }
 */
async function createTenantSubAccount(tenant) {
  if (!MASTER_SID || !MASTER_TOKEN) {
    bus.system(`[ONBOARDING] Twilio master non configuré — sous-compte simulé pour ${tenant.name}`);
    return {
      simulated: true,
      tenantId:  tenant.id,
      accountSid: `SIMULATED_${tenant.id}`,
      authToken:  'simulated_token',
      friendlyName: `DALEBA — ${tenant.name}`,
    };
  }

  try {
    const client = twilio(MASTER_SID, MASTER_TOKEN);
    const account = await client.api.accounts.create({
      friendlyName: `DALEBA — ${tenant.name}`,
    });

    bus.system(`[ONBOARDING] Sous-compte Twilio créé pour ${tenant.name}: ${account.sid}`);
    return {
      simulated:    false,
      tenantId:     tenant.id,
      accountSid:   account.sid,
      authToken:    account.authToken,
      friendlyName: account.friendlyName,
      status:       account.status,
      createdAt:    account.dateCreated,
    };
  } catch (err) {
    bus.system(`[ONBOARDING] Erreur création sous-compte: ${err.message}`);
    throw err;
  }
}

/**
 * Achète un numéro local pour un tenant selon son pays
 * @param {string} accountSid   — SID du sous-compte tenant
 * @param {string} authToken    — token du sous-compte
 * @param {string} countryCode  — ISO 2 (CA, US, FR…)
 * @param {string} areaCode     — indicatif local optionnel (ex: 514)
 */
async function purchaseLocalNumber(accountSid, authToken, countryCode = 'CA', areaCode = null) {
  if (!MASTER_SID || accountSid.startsWith('SIMULATED')) {
    return {
      simulated:   true,
      phoneNumber: `+1${areaCode || '514'}0000000`,
      countryCode,
      sid:         'SIMULATED_PN',
    };
  }

  try {
    const client = twilio(accountSid, authToken);

    // Chercher numéros disponibles
    const searchParams = { limit: 5 };
    if (areaCode) searchParams.areaCode = areaCode;

    const available = await client.availablePhoneNumbers(countryCode)
      .local
      .list(searchParams);

    if (!available.length) throw new Error(`Aucun numéro disponible en ${countryCode}`);

    // Acheter le premier disponible
    const purchased = await client.incomingPhoneNumbers.create({
      phoneNumber: available[0].phoneNumber,
      voiceUrl:    `${DALEBA_BASE}/api/webhook/voice`,
      voiceMethod: 'POST',
      smsUrl:      `${DALEBA_BASE}/api/webhook/sms`,
      smsMethod:   'POST',
      statusCallback: `${DALEBA_BASE}/api/webhook/voice/status`,
    });

    bus.system(`[ONBOARDING] Numéro acheté: ${purchased.phoneNumber} pour compte ${accountSid}`);
    return {
      simulated:   false,
      phoneNumber: purchased.phoneNumber,
      sid:         purchased.sid,
      countryCode,
      voiceUrl:    purchased.voiceUrl,
      smsUrl:      purchased.smsUrl,
    };
  } catch (err) {
    bus.system(`[ONBOARDING] Erreur achat numéro: ${err.message}`);
    throw err;
  }
}

/**
 * Flux complet d'onboarding téléphonique pour un nouveau tenant
 * @param {object} params — { tenantId, tenantName, tenantEmail, countryCode, areaCode, existingPhone }
 */
async function runTelephonyOnboarding(params) {
  const {
    tenantId, tenantName, tenantEmail,
    countryCode = 'CA', areaCode = null, existingPhone = null,
  } = params;

  bus.system(`[ONBOARDING] Démarrage onboarding télépho pour ${tenantName}`);

  const result = {
    tenantId,
    tenantName,
    countryCode,
    steps: [],
    completed: false,
  };

  try {
    // Étape 1: Créer sous-compte Twilio
    const subAccount = await createTenantSubAccount({ id: tenantId, name: tenantName, email: tenantEmail });
    result.twilioAccount = subAccount;
    result.steps.push({ step: 'subaccount', status: 'ok', data: subAccount.accountSid });

    // Étape 2: Acheter numéro local
    const number = await purchaseLocalNumber(
      subAccount.accountSid, subAccount.authToken, countryCode, areaCode
    );
    result.dalebaNumber = number.phoneNumber;
    result.steps.push({ step: 'number_purchase', status: 'ok', data: number.phoneNumber });

    // Étape 3: Générer instructions de transfert si numéro existant
    if (existingPhone) {
      result.forwardingInstructions = generateForwardingInstructions(
        existingPhone, number.phoneNumber, countryCode
      );
      result.steps.push({ step: 'forwarding_instructions', status: 'ok' });
    }

    result.completed = true;
    bus.system(`[ONBOARDING] ✅ Onboarding ${tenantName} terminé — ${number.phoneNumber}`);
  } catch (err) {
    result.error = err.message;
    result.steps.push({ step: 'error', status: 'failed', error: err.message });
    bus.system(`[ONBOARDING] ❌ Erreur: ${err.message}`);
  }

  return result;
}

module.exports = {
  generateForwardingInstructions,
  createTenantSubAccount,
  purchaseLocalNumber,
  runTelephonyOnboarding,
  MMI_PROFILES,
};
