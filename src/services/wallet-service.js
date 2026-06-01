/**
 * wallet-service.js — Apple Wallet (.pkpass) + Google Wallet JWT
 * Mode démo : génère des structures valides sans certificat Apple réel
 */
const crypto = require('crypto');
const jwt = require('jsonwebtoken');
const QRCode = require('qrcode');
const path = require('path');
const fs = require('fs');
const os = require('os');

// ── Google Wallet config ─────────────────────────────────────────────────────
const GOOGLE_ISSUER_ID = process.env.GOOGLE_WALLET_ISSUER_ID || 'daleba-demo';
const GOOGLE_CLASS_ID = `${GOOGLE_ISSUER_ID}.kadio_coiffure_loyalty`;
const JWT_SECRET = process.env.WALLET_JWT_SECRET || crypto.randomBytes(32).toString('hex');

// ── Generate pass data for a customer ────────────────────────────────────────
async function buildPassData(customer) {
  const { id, name, phone, points = 0, nextVisit = null } = customer;
  const qrData = `KADIO-${id}-${crypto.createHash('md5').update(String(id)).digest('hex').slice(0,8).toUpperCase()}`;

  return {
    qrData,
    name: name || 'Client Kadio',
    points,
    nextVisit,
    phone,
    id,
  };
}

// ── PKPass (Apple Wallet) — structure démo ────────────────────────────────────
async function generateApplePkpass(passData) {
  const { qrData, name, points, nextVisit, id } = passData;

  // pass.json content
  const passJson = {
    formatVersion: 1,
    passTypeIdentifier: 'pass.com.daleba.kadiocoiffure',
    serialNumber: `kadio-${id}-${Date.now()}`,
    teamIdentifier: 'DALEBA',
    organizationName: 'Kadio Coiffure',
    description: 'Carte de fidélité Kadio Coiffure',
    foregroundColor: 'rgb(13, 17, 23)',
    backgroundColor: 'rgb(201, 168, 76)',
    labelColor: 'rgb(13, 17, 23)',
    logoText: 'Kadio Coiffure',
    storeCard: {
      headerFields: [
        { key: 'points', label: 'POINTS', value: String(points) }
      ],
      primaryFields: [
        { key: 'name', label: 'MEMBRE', value: name }
      ],
      secondaryFields: nextVisit ? [
        { key: 'nextVisit', label: 'PROCHAIN RDV', value: new Date(nextVisit).toLocaleDateString('fr-CA') }
      ] : [],
      auxiliaryFields: [
        { key: 'salon', label: 'SALON', value: '615 Antoinette-Robidoux, Longueuil' }
      ],
      backFields: [
        { key: 'info', label: 'À propos', value: 'Cette carte vous donne accès à vos points de fidélité Kadio Coiffure. Présentez-la à chaque visite.' },
        { key: 'phone', label: 'Téléphone', value: '(450) 000-0000' },
        { key: 'website', label: 'Site web', value: 'https://kadiocoiffure.vercel.app' }
      ]
    },
    barcode: {
      message: qrData,
      format: 'PKBarcodeFormatQR',
      messageEncoding: 'iso-8859-1',
      altText: `Membre: ${name}`
    }
  };

  // In demo mode: return the pass.json as a downloadable JSON
  // (Real PKPass requires Apple certificates + signed manifest)
  return {
    passJson,
    qrData,
    demoMode: true,
    note: 'Mode démo — certificats Apple requis pour un vrai .pkpass'
  };
}

// ── Google Wallet JWT ─────────────────────────────────────────────────────────
async function generateGoogleWalletJWT(passData) {
  const { qrData, name, points, id } = passData;

  const loyaltyObject = {
    id: `${GOOGLE_CLASS_ID}.${id}`,
    classId: GOOGLE_CLASS_ID,
    state: 'ACTIVE',
    accountId: String(id),
    accountName: name,
    loyaltyPoints: {
      balance: { int: points },
      label: 'Points'
    },
    barcode: {
      type: 'QR_CODE',
      value: qrData,
      alternateText: `Membre: ${name}`
    },
    textModulesData: [
      {
        header: 'Salon',
        body: '615 Antoinette-Robidoux, Longueuil, QC'
      }
    ]
  };

  const payload = {
    iss: 'daleba@daleba.ai',
    aud: 'google',
    typ: 'savetowallet',
    iat: Math.floor(Date.now() / 1000),
    payload: {
      loyaltyObjects: [loyaltyObject]
    }
  };

  // Sign with local key (demo mode — real Google Wallet requires service account)
  const token = jwt.sign(payload, JWT_SECRET, { algorithm: 'HS256' });

  return {
    jwt: token,
    saveUrl: `https://pay.google.com/gp/v/save/${token}`,
    demoMode: true,
    note: 'Mode démo — compte de service Google requis pour production'
  };
}

// ── Main export ───────────────────────────────────────────────────────────────
async function generateWalletCards(customer) {
  const passData = await buildPassData(customer);
  const apple = await generateApplePkpass(passData);
  const google = await generateGoogleWalletJWT(passData);
  return { apple, google, passData };
}

module.exports = { generateWalletCards, generateApplePkpass, generateGoogleWalletJWT, buildPassData };
