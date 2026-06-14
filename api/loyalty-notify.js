const Twilio = require('twilio');

const TWILIO_SID = process.env.TWILIO_SID;
const TWILIO_AUTH = process.env.TWILIO_AUTH;
const TWILIO_NUMBER = process.env.TWILIO_NUMBER || '+13022328291';

const client = new Twilio(TWILIO_SID, TWILIO_AUTH);

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  
  const { phone, type, points, total, remaining } = req.body;
  if (!phone || !type) return res.status(400).json({ error: 'Missing phone or type' });
  
  let to = phone.startsWith('+') ? phone : '+1' + phone.replace(/\D/g, '');
  
  let message = '';
  switch (type) {
    case 'points_added':
      message = `🎉 *Kadio Coiffure — Points Fidélité*\n\n+${points} points ajoutés !\nTu as maintenant *${total} points*.\n\n`;
      if (total >= 450) {
        message += '🎁 *RÉCOMPENSE DÉBLOQUÉE !*\n450 points = 20$ de réduction sur ta prochaine visite !';
      } else if (remaining && remaining > 0) {
        message += `🔥 Plus que ${remaining} points pour ta réduction de 20$ !`;
      } else {
        message += 'Continue, tu avances bien ! 💪';
      }
      break;
    case 'near_reward':
      message = `🔥 *Kadio Coiffure — Points Fidélité*\n\nTu as ${total} points.\n\nPlus que *${remaining} points* pour débloquer ta réduction de *20$* !\n\nEncore un petit effort ! 💪`;
      break;
    case 'reward_unlocked':
      message = `🎁 *Félicitations — Kadio Coiffure !*\n\nTu as atteint *450 points* !\n\n*20$ de réduction* sont disponibles sur ta prochaine visite.\n\nMontre ce message au salon et profite de ta récompense ! 🎉`;
      break;
    case 'reward_used':
      message = `✅ *Kadio Coiffure — Récompense utilisée*\n\nTu as utilisé 450 points pour 20$ de réduction.\nIl te reste *${total} points*.\n\nMerci pour ta fidélité ! 🖤`;
      break;
    default:
      message = `🎉 *Kadio Coiffure*\nMise à jour de tes points : ${total} points.`;
  }
  
  try {
    const result = await client.messages.create({
      from: 'whatsapp:' + TWILIO_NUMBER,
      to: 'whatsapp:' + to,
      body: message
    });
    return res.status(200).json({ success: true, messageSid: result.sid, status: result.status });
  } catch (err) {
    console.error('Twilio error:', err.message);
    return res.status(500).json({ error: err.message });
  }
};
