'use strict';
/**
 * DALEBA — Service OTP par numéro de téléphone
 * V31-AUTH: génération, envoi Twilio, vérification
 */

const crypto = require('crypto');

// Map en mémoire: phone → { code, expires, attempts }
const otpStore = new Map();

const OTP_TTL_MS   = 10 * 60 * 1000; // 10 minutes
const MAX_ATTEMPTS = 3;

// ── Twilio client ────────────────────────────────────────────────────────────
function getTwilioClient() {
  const sid   = process.env.TWILIO_ACCOUNT_SID;
  const token = process.env.TWILIO_AUTH_TOKEN;
  if (!sid || !token) return null;
  const twilio = require('twilio');
  return twilio(sid, token);
}

// ── Génère un code OTP à 4 chiffres ─────────────────────────────────────────
function generateCode() {
  // Utilise crypto pour plus d'entropie
  return String(crypto.randomInt(1000, 9999)).padStart(4, '0');
}

// ── Nettoyage périodique des sessions expirées ───────────────────────────────
setInterval(() => {
  const now = Date.now();
  for (const [phone, session] of otpStore.entries()) {
    if (session.expires < now) otpStore.delete(phone);
  }
}, 5 * 60 * 1000); // toutes les 5 min

/**
 * Envoie un OTP par SMS au numéro donné.
 * @param {string} phone - Format E.164 ex: +15141234567
 * @returns {{ sent: boolean, demo?: boolean }}
 */
async function sendOTP(phone) {
  const code    = generateCode();
  const expires = Date.now() + OTP_TTL_MS;

  otpStore.set(phone, { code, expires, attempts: 0 });

  const body = `Votre code Kadio: ${code} (valide 10 min)`;

  const client = getTwilioClient();
  const from   = process.env.TWILIO_PHONE_NUMBER;

  if (!client || !from) {
    // Mode démo — log uniquement
    console.log(`[OTP-AUTH] DEMO → ${phone}: ${body}`);
    return { sent: true, demo: true };
  }

  await client.messages.create({ body, from, to: phone });
  console.log(`[OTP-AUTH] OTP envoyé → ${phone}`);
  return { sent: true };
}

/**
 * Vérifie le code OTP.
 * @param {string} phone
 * @param {string} code
 * @returns {{ valid: boolean, reason?: string }}
 */
function verifyOTP(phone, code) {
  const session = otpStore.get(phone);

  if (!session) {
    return { valid: false, reason: 'Aucun code en attente pour ce numéro' };
  }

  if (Date.now() > session.expires) {
    otpStore.delete(phone);
    return { valid: false, reason: 'Code expiré' };
  }

  if (session.attempts >= MAX_ATTEMPTS) {
    otpStore.delete(phone);
    return { valid: false, reason: 'Trop de tentatives' };
  }

  session.attempts += 1;

  if (String(code).trim() !== String(session.code)) {
    return { valid: false, reason: 'Code incorrect' };
  }

  // Succès — nettoyer
  otpStore.delete(phone);
  return { valid: true };
}

module.exports = { sendOTP, verifyOTP };
