/**
 * Vercel Serverless Function - OTP Request
 * Génère un code OTP, le stocke dans un JWT signé et le retourne
 */

const crypto = require('crypto');

const JWT_SECRET = process.env.JWT_SECRET || 'kadio-daleba-2026-secret-key';
const OTP_TTL_MS = 10 * 60 * 1000; // 10 minutes

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

function generateCode() {
  return String(crypto.randomInt(1000, 9999)).padStart(4, '0');
}

function generateOTPToken(phone, code) {
  const expires = Date.now() + OTP_TTL_MS;
  const payload = { phone, code, exp: expires };
  const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const signature = crypto.createHmac('sha256', JWT_SECRET).update(`${header}.${body}`).digest('base64url');
  return `${header}.${body}.${signature}`;
}

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  
  const { phone } = req.body || {};
  if (!phone) return res.status(400).json({ success: false, error: 'Numéro de téléphone requis' });
  
  const normalizedPhone = normalizePhone(phone);
  const code = generateCode();
  const otpToken = generateOTPToken(normalizedPhone, code);
  
  return res.status(200).json({
    success: true,
    message: 'Code généré',
    sms_sent: false,
    code: code,
    otp_token: otpToken
  });
};
