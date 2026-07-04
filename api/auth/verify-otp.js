/**
 * Vercel Serverless Function - OTP Verify
 * Vérifie un code OTP et retourne un token JWT
 */

const crypto = require('crypto');

// Même stockage que request-otp (partagé dans le même process)
const otpStore = new Map();
const JWT_SECRET = process.env.JWT_SECRET || 'kadio-daleba-2026-secret-key';

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

function generateToken(phone) {
  const payload = { phone, iat: Date.now() };
  const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const signature = crypto.createHmac('sha256', JWT_SECRET).update(`${header}.${body}`).digest('base64url');
  return `${header}.${body}.${signature}`;
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
  
  const { phone, code } = req.body || {};
  
  if (!phone || !code) {
    return res.status(400).json({ success: false, error: 'Numéro et code requis' });
  }
  
  const normalizedPhone = normalizePhone(phone);
  const session = otpStore.get(normalizedPhone);
  
  if (!session) {
    return res.status(401).json({ success: false, error: 'Code expiré ou invalide' });
  }
  
  if (session.expires < Date.now()) {
    otpStore.delete(normalizedPhone);
    return res.status(401).json({ success: false, error: 'Code expiré' });
  }
  
  if (session.code !== code) {
    session.attempts++;
    if (session.attempts >= 3) {
      otpStore.delete(normalizedPhone);
      return res.status(401).json({ success: false, error: 'Trop de tentatives. Demandez un nouveau code.' });
    }
    return res.status(401).json({ success: false, error: 'Code incorrect' });
  }
  
  // Code valide - générer token
  otpStore.delete(normalizedPhone);
  const token = generateToken(normalizedPhone);
  
  return res.status(200).json({
    success: true,
    message: 'Connexion réussie',
    token: token,
    role: 'client',
    profile: {
      phone: normalizedPhone,
      name: 'Client'
    }
  });
};
