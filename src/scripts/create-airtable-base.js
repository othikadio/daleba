#!/usr/bin/env node
/**
 * DALEBA — Création automatique de la base Airtable + 6 tables
 * Usage: WORKSPACE_ID=wspXXXXX node src/scripts/create-airtable-base.js
 */

const API_KEY = process.env.AIRTABLE_API_KEY; // Set AIRTABLE_API_KEY in Railway env vars
const WORKSPACE_ID = process.argv[2] || process.env.WORKSPACE_ID;
const RAILWAY_TOKEN = '5a272eb8-f2bf-4395-93be-9371fe8728f3';
const RAILWAY_PROJECT_ID = 'f1df7fef-4a4c-457e-83c7-2e1d7c6560ec';
const RAILWAY_SERVICE_ID = '8f874b43-5efb-4723-8810-a6068bf87fbf';
const RAILWAY_ENV_ID = 'fe65feeb-9462-4924-88fb-fa44e4ab6cb3';

if (!WORKSPACE_ID) {
  console.error('❌ Usage: node src/scripts/create-airtable-base.js wspXXXXXXXXXXXXXX');
  process.exit(1);
}

const BASE_SCHEMA = {
  name: 'DALEBA — Kadio Coiffure',
  workspaceId: WORKSPACE_ID,
  tables: [
    {
      name: 'Abonnés',
      description: 'Clients abonnés Stripe — forfaits mensuels',
      fields: [
        { name: 'Nom', type: 'singleLineText' },
        { name: 'Email', type: 'email' },
        { name: 'Téléphone', type: 'phoneNumber' },
        { name: 'Stripe Customer ID', type: 'singleLineText' },
        { name: 'Subscription ID', type: 'singleLineText' },
        { name: 'Plan', type: 'singleLineText' },
        {
          name: 'Statut',
          type: 'singleSelect',
          options: {
            choices: [
              { name: 'actif', color: 'greenBright' },
              { name: 'annulé', color: 'redBright' },
              { name: 'en_retard', color: 'orangeBright' },
              { name: 'incomplet', color: 'yellowBright' },
              { name: 'essai', color: 'blueBright' },
            ],
          },
        },
        { name: 'Montant', type: 'currency', options: { symbol: '$', precision: 2 } },
        { name: 'Date début', type: 'date', options: { dateFormat: { name: 'iso' } } },
        { name: 'Prochain renouvellement', type: 'date', options: { dateFormat: { name: 'iso' } } },
        { name: 'Dernière visite', type: 'date', options: { dateFormat: { name: 'iso' } } },
        { name: 'Rappels envoyés', type: 'number', options: { precision: 0 } },
        { name: 'Notes', type: 'multilineText' },
      ],
    },
    {
      name: 'Paiements',
      description: 'Historique paiements Stripe + Square',
      fields: [
        { name: 'Payment ID', type: 'singleLineText' },
        { name: 'Client', type: 'singleLineText' },
        { name: 'Email', type: 'email' },
        { name: 'Téléphone', type: 'phoneNumber' },
        { name: 'Montant', type: 'currency', options: { symbol: '$', precision: 2 } },
        {
          name: 'Source',
          type: 'singleSelect',
          options: {
            choices: [
              { name: 'Stripe', color: 'purpleBright' },
              { name: 'Square', color: 'blueBright' },
              { name: 'Cash', color: 'greenBright' },
            ],
          },
        },
        {
          name: 'Statut',
          type: 'singleSelect',
          options: {
            choices: [
              { name: 'complété', color: 'greenBright' },
              { name: 'remboursé', color: 'orangeBright' },
              { name: 'échoué', color: 'redBright' },
              { name: 'en_attente', color: 'yellowBright' },
            ],
          },
        },
        { name: 'Service', type: 'singleLineText' },
        { name: 'Date paiement', type: 'dateTime', options: { dateFormat: { name: 'iso' }, timeFormat: { name: '24hour' }, timeZone: 'America/Toronto' } },
        { name: 'Stripe Customer ID', type: 'singleLineText' },
        { name: 'Square Payment ID', type: 'singleLineText' },
        { name: 'Notes', type: 'multilineText' },
      ],
    },
    {
      name: 'Rendez-vous',
      description: 'RDV Square — sync temps réel',
      fields: [
        { name: 'Square Appointment ID', type: 'singleLineText' },
        { name: 'Client', type: 'singleLineText' },
        { name: 'Email', type: 'email' },
        { name: 'Téléphone', type: 'phoneNumber' },
        { name: 'Service', type: 'singleLineText' },
        { name: 'Coiffeur', type: 'singleLineText' },
        { name: 'Date RDV', type: 'dateTime', options: { dateFormat: { name: 'iso' }, timeFormat: { name: '24hour' }, timeZone: 'America/Toronto' } },
        { name: 'Durée (min)', type: 'number', options: { precision: 0 } },
        { name: 'Prix', type: 'currency', options: { symbol: '$', precision: 2 } },
        {
          name: 'Statut',
          type: 'singleSelect',
          options: {
            choices: [
              { name: 'confirmé', color: 'blueBright' },
              { name: 'complété', color: 'greenBright' },
              { name: 'annulé', color: 'redBright' },
              { name: 'no_show', color: 'orangeBright' },
              { name: 'en_attente', color: 'yellowBright' },
            ],
          },
        },
        { name: 'Rappel 24h', type: 'checkbox', options: { color: 'greenBright', icon: 'check' } },
        { name: 'Rappel 1h', type: 'checkbox', options: { color: 'blueBright', icon: 'check' } },
        { name: 'SMS envoyé', type: 'checkbox', options: { color: 'tealBright', icon: 'check' } },
        { name: 'Notes', type: 'multilineText' },
      ],
    },
    {
      name: 'Fiches Capillaires',
      description: 'Profil capillaire de chaque client',
      fields: [
        { name: 'Client', type: 'singleLineText' },
        { name: 'Email', type: 'email' },
        { name: 'Téléphone', type: 'phoneNumber' },
        {
          name: 'Type de cheveux',
          type: 'singleSelect',
          options: {
            choices: [
              { name: 'lisse', color: 'yellowBright' },
              { name: 'ondulé', color: 'orangeBright' },
              { name: 'bouclé', color: 'pinkBright' },
              { name: 'crépu', color: 'purpleBright' },
              { name: 'coily', color: 'blueBright' },
            ],
          },
        },
        {
          name: 'Texture',
          type: 'singleSelect',
          options: {
            choices: [
              { name: 'fin', color: 'grayBright' },
              { name: 'moyen', color: 'blueBright' },
              { name: 'épais', color: 'greenBright' },
            ],
          },
        },
        { name: 'Problèmes', type: 'multilineText' },
        { name: 'Traitements actuels', type: 'multilineText' },
        { name: 'Allergies', type: 'multilineText' },
        { name: 'Couleur actuelle', type: 'singleLineText' },
        { name: 'Dernière couleur', type: 'date', options: { dateFormat: { name: 'iso' } } },
        {
          name: 'Fréquence visite',
          type: 'singleSelect',
          options: {
            choices: [
              { name: 'hebdo', color: 'greenBright' },
              { name: 'bi-mensuel', color: 'blueBright' },
              { name: 'mensuel', color: 'tealBright' },
              { name: 'trimestriel', color: 'yellowBright' },
              { name: 'occasionnel', color: 'grayBright' },
            ],
          },
        },
        { name: 'Objectifs', type: 'multilineText' },
        { name: 'Notes coiffeur', type: 'multilineText' },
        { name: 'Créé le', type: 'date', options: { dateFormat: { name: 'iso' } } },
        { name: 'Mis à jour', type: 'date', options: { dateFormat: { name: 'iso' } } },
      ],
    },
    {
      name: 'Historique Visites',
      description: 'Chaque visite au salon — log immuable',
      fields: [
        { name: 'Visit ID', type: 'singleLineText' },
        { name: 'Client', type: 'singleLineText' },
        { name: 'Email', type: 'email' },
        { name: 'Date visite', type: 'dateTime', options: { dateFormat: { name: 'iso' }, timeFormat: { name: '24hour' }, timeZone: 'America/Toronto' } },
        { name: 'Services', type: 'multilineText' },
        { name: 'Coiffeur', type: 'singleLineText' },
        { name: 'Total', type: 'currency', options: { symbol: '$', precision: 2 } },
        {
          name: 'Moyen paiement',
          type: 'singleSelect',
          options: {
            choices: [
              { name: 'carte', color: 'blueBright' },
              { name: 'cash', color: 'greenBright' },
              { name: 'stripe', color: 'purpleBright' },
              { name: 'square', color: 'tealBright' },
            ],
          },
        },
        { name: 'Rating', type: 'number', options: { precision: 0 } },
        { name: 'Commentaire', type: 'multilineText' },
        { name: 'Square Appointment ID', type: 'singleLineText' },
        { name: 'Produits utilisés', type: 'multilineText' },
      ],
    },
    {
      name: 'Rappels SMS',
      description: 'File SMS Twilio pilotée par Airtable',
      fields: [
        { name: 'Client', type: 'singleLineText' },
        { name: 'Téléphone', type: 'phoneNumber' },
        { name: 'Email', type: 'email' },
        { name: 'Date RDV', type: 'dateTime', options: { dateFormat: { name: 'iso' }, timeFormat: { name: '24hour' }, timeZone: 'America/Toronto' } },
        {
          name: 'Type rappel',
          type: 'singleSelect',
          options: {
            choices: [
              { name: '24h', color: 'blueBright' },
              { name: '1h', color: 'tealBright' },
              { name: 'confirmation', color: 'greenBright' },
              { name: 'anniversaire', color: 'pinkBright' },
              { name: 'réengagement', color: 'orangeBright' },
            ],
          },
        },
        { name: 'Message', type: 'multilineText' },
        {
          name: 'Statut',
          type: 'singleSelect',
          options: {
            choices: [
              { name: 'en_attente', color: 'yellowBright' },
              { name: 'envoyé', color: 'greenBright' },
              { name: 'échoué', color: 'redBright' },
              { name: 'annulé', color: 'grayBright' },
            ],
          },
        },
        { name: 'Envoyé le', type: 'dateTime', options: { dateFormat: { name: 'iso' }, timeFormat: { name: '24hour' }, timeZone: 'America/Toronto' } },
        { name: 'Square Appointment ID', type: 'singleLineText' },
        { name: 'Tentatives', type: 'number', options: { precision: 0 } },
        { name: 'Twilio SID', type: 'singleLineText' },
      ],
    },
  ],
};

async function createBase() {
  console.log(`\n🚀 Création de la base DALEBA dans workspace: ${WORKSPACE_ID}\n`);

  const res = await fetch('https://api.airtable.com/v0/meta/bases', {
    method: 'POST',
    headers: { Authorization: `Bearer ${API_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(BASE_SCHEMA),
  });

  const data = await res.json();

  if (!res.ok) {
    console.error('❌ Erreur création base:', JSON.stringify(data, null, 2));
    process.exit(1);
  }

  const baseId = data.id;
  console.log(`✅ Base créée ! ID: ${baseId}`);
  console.log(`📋 Tables créées: ${data.tables.map(t => t.name).join(', ')}\n`);

  return baseId;
}

async function injectRailway(baseId) {
  console.log('⚙️  Injection AIRTABLE_BASE_ID dans Railway...');

  const mutation = `
    mutation {
      variableCollectionUpsert(input: {
        projectId: "${RAILWAY_PROJECT_ID}",
        serviceId: "${RAILWAY_SERVICE_ID}",
        environmentId: "${RAILWAY_ENV_ID}",
        variables: { AIRTABLE_BASE_ID: "${baseId}" }
      })
    }
  `;

  const res = await fetch('https://backboard.railway.app/graphql/v2', {
    method: 'POST',
    headers: { Authorization: `Bearer ${RAILWAY_TOKEN}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ query: mutation }),
  });

  const data = await res.json();
  if (data.data?.variableCollectionUpsert) {
    console.log('✅ AIRTABLE_BASE_ID injecté dans Railway !');
  } else {
    console.error('❌ Erreur Railway:', JSON.stringify(data));
  }
}

async function main() {
  try {
    const baseId = await createBase();
    await injectRailway(baseId);
    console.log(`\n🎉 DALEBA Airtable opérationnel !`);
    console.log(`   Base ID : ${baseId}`);
    console.log(`   URL : https://airtable.com/${baseId}`);
    console.log(`\n🔄 Migration Stripe → Airtable : node src/scripts/migrate-to-airtable.js`);
  } catch (e) {
    console.error('Fatal:', e.message);
    process.exit(1);
  }
}

main();
