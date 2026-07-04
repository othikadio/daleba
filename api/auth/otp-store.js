/**
 * Module de stockage OTP partagé pour Vercel serverless
 */

const otpStore = new Map();
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

module.exports = { otpStore, OTP_TTL_MS, normalizePhone };
