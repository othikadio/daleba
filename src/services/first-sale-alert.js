'use strict';
/**
 * First Sale Alert — DALEBA Metacortex Point 288
 * SMS de félicitations au gérant lors de la première vente via DALEBA.
 */
const bus = require('./event-bus');
const _celebrated = new Set();
async function checkFirstSale(tenantId, saleAmount, managerPhone) {
  if (_celebrated.has(tenantId)) return { alreadyCelebrated: true };
  try {
    const { pool } = require('../memory/db');
    const r = await pool.query(`SELECT COUNT(*) FROM tenant_ledgers WHERE tenant_id=$1`, [tenantId]);
    if (parseInt(r.rows[0]?.count||0) !== 1) return { firstSale: false };
  } catch {}
  _celebrated.add(tenantId);
  const message = `🎉 Félicitations! Votre première vente via DALEBA: ${saleAmount} CAD. Votre salon est opérationnel sur la plateforme! — L'équipe DALEBA`;
  bus.system(`[FirstSale] 🎉 ${tenantId} | ${saleAmount} CAD`);
  if (managerPhone) {
    try {
      const twilio = require('twilio')(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN);
      await twilio.messages.create({ body: message, from: process.env.TWILIO_PHONE_NUMBER, to: managerPhone });
      return { sent: true, message };
    } catch(e) { bus.system(`[FirstSale] SMS fail: ${e.message}`); }
  }
  return { sent: false, message };
}
module.exports = { checkFirstSale };
