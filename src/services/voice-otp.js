/**
 * Voice OTP — DALEBA Metacortex Point 221
 *
 * [221] Code OTP éphémère 4 chiffres pour MODIFICATION/CANCELLATION
 *       depuis numéro différent du numéro de réservation d'origine.
 *       Durée de vie: 5 minutes. Usage unique.
 */

'use strict';

const crypto = require('crypto');
const bus    = require('./event-bus');

const TWILIO_FROM = process.env.TWILIO_PHONE_NUMBER || '+13022328291';
const OTP_TTL_MS  = 5 * 60 * 1000; // 5 minutes

// ─── STORE OTP (mémoire volatile — par design [221]) ──────────────────────────

const _otpStore = new Map(); // callSid → { code, expiry, purpose, verified }

// ─── GÉNÉRATION ───────────────────────────────────────────────────────────────

/**
 * Génère un OTP 4 chiffres cryptographiquement sûr [221]
 * @param {string} callSid   — session d'appel
 * @param {string} purpose   — 'MODIFICATION' | 'CANCELLATION'
 * @param {string} targetPhone — numéro où envoyer l'OTP
 */
async function generateAndSend(callSid, purpose, targetPhone) {
  // Générer 4 chiffres [221]
  const code = String(crypto.randomInt(1000, 9999));
  const expiry = Date.now() + OTP_TTL_MS;

  _otpStore.set(callSid, { code, expiry, purpose, verified: false, attempts: 0 });

  // Envoyer le SMS au numéro de la réservation
  try {
    const twilio = require('twilio')(
      process.env.TWILIO_ACCOUNT_SID,
      process.env.TWILIO_AUTH_TOKEN
    );
    const msg = await twilio.messages.create({
      body: `DALEBA Salon — Votre code de vérification: ${code}\nValide 5 minutes.\nPour confirmer votre ${purpose === 'MODIFICATION' ? 'modification' : 'annulation'} de rendez-vous.`,
      from: TWILIO_FROM,
      to:   targetPhone,
    });
    bus.system(`[OTP] Code envoyé à ${targetPhone} | CallSid: ${callSid} | Purpose: ${purpose}`);
    return { sent: true, messageSid: msg.sid };
  } catch (err) {
    bus.system(`[OTP] ⚠️ Échec envoi SMS: ${err.message}`);
    // Si pas de Twilio configuré en dev, mode démo
    if (process.env.NODE_ENV !== 'production') {
      bus.system(`[OTP] 🔧 Mode démo — code: ${code} (non envoyé)`);
      return { sent: false, demo: true, code }; // Exposer en dev seulement
    }
    return { sent: false, error: err.message };
  }
}

// ─── VÉRIFICATION ─────────────────────────────────────────────────────────────

/**
 * Vérifie un code OTP saisi vocalement [221]
 * @param {string} callSid — session d'appel
 * @param {string} inputCode — code dit par le client
 * @returns {{ valid, reason }}
 */
function verify(callSid, inputCode) {
  const record = _otpStore.get(callSid);

  if (!record) return { valid: false, reason: 'Aucun OTP en attente' };
  if (record.verified) return { valid: false, reason: 'Code déjà utilisé' };
  if (Date.now() > record.expiry) {
    _otpStore.delete(callSid);
    return { valid: false, reason: 'Code expiré' };
  }

  record.attempts++;
  if (record.attempts > 3) {
    _otpStore.delete(callSid);
    return { valid: false, reason: 'Trop de tentatives' };
  }

  // Normaliser le code vocal (peut contenir espaces ou séparateurs)
  const normalized = String(inputCode || '').replace(/\D/g, '').slice(0, 4);
  if (normalized === record.code) {
    record.verified = true;
    bus.system(`[OTP] ✅ Code vérifié | CallSid: ${callSid} | Purpose: ${record.purpose}`);
    return { valid: true, purpose: record.purpose };
  }

  return { valid: false, reason: 'Code incorrect', attemptsLeft: 3 - record.attempts };
}

/**
 * Vérifie si une session attend un OTP [221]
 */
function isPending(callSid) {
  const r = _otpStore.get(callSid);
  return r && !r.verified && Date.now() <= r.expiry;
}

/**
 * Invalide manuellement un OTP (après succès) [221]
 */
function invalidate(callSid) {
  _otpStore.delete(callSid);
}

// ─── EXPORTS ─────────────────────────────────────────────────────────────────

module.exports = { generateAndSend, verify, isPending, invalidate, OTP_TTL_MS };
