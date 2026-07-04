/**
 * Vercel Serverless Function - OTP Request
 * Génère un code OTP et le retourne dans la réponse
 */

const crypto = require('crypto');

// Stockage en mémoire (simple, persiste pendant la durée de vie de la fonction)
const otpStore = new Map();
const OTP_TTL_MS = 10 * 60 * 1000; // 10 minutes

function generateCode() {
  return String(crypto.randomInt(1000, 9999)).padStart(4, '0');
}

function normalizePhone(phone) {
  phone = phone.trim();
  if (!phone.startsWith('+')) {
    if (phone.startsWith('1') && phone.length === 11) {
      phone = '+' + phone;
    } else {
      phone = '+1' + phone.lstrip('0');
    }
  }
  return phone;
}

module.exports = async (req, res) => {
  // CORS
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  
  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }
  
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }
  
  const { phone } = req.body || {};
  
  if (!phone) {
    return res.status(400).json({ success: false, error: 'Numéro de téléphone requis' });
  }
  
  const normalizedPhone = normalizePhone(phone);
  const code = generateCode();
  const expires = Date.now() + OTP_TTL_MS;
  
  otpStore.set(normalizedPhone, { code, expires, attempts: 0 });
  
  // Nettoyage auto
  setTimeout(() => {
    otpStore.delete(normalizedPhone);
  }, OTP_TTL_MS);
  
  return res.status(200).json({
    success: true,
    message: 'Code généré',
    sms_sent: false,
    code: code // Retourne le code pour test
  });
};
