/**
 * Vercel Serverless Function - OTP Verify
 * Vérifie un code OTP via un JWT signé
 */

const crypto = require('crypto');

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

function verifyOTPToken(otpToken) {
  try {
    const [header, body, signature] = otpToken.split('.');
    const expectedSig = crypto.createHmac('sha256', JWT_SECRET).update(`${header}.${body}`).digest('base64url');
    if (signature !== expectedSig) return null;
    
    const payload = JSON.parse(Buffer.from(body, 'base64url').toString());
    if (payload.exp < Date.now()) return null;
    return payload;
  } catch (e) {
    return null;
  }
}

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  
  const { phone, code, otp_token } = req.body || {};
  
  if (!phone || !code) {
    return res.status(400).json({ success: false, error: 'Numéro et code requis' });
  }
  
  const normalizedPhone = normalizePhone(phone);
  
  // Vérifier le token OTP
  if (!otp_token) {
    return res.status(401).json({ success: false, error: 'Session OTP manquante. Redemandez un code.' });
  }
  
  const payload = verifyOTPToken(otp_token);
  
  if (!payload) {
    return res.status(401).json({ success: false, error: 'Session OTP invalide ou expirée' });
  }
  
  if (payload.phone !== normalizedPhone) {
    return res.status(401).json({ success: false, error: 'Numéro de téléphone incorrect' });
  }
  
  if (payload.code !== code) {
    return res.status(401).json({ success: false, error: 'Code incorrect' });
  }
  
  // Code valide - générer token d'authentification
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
