'use strict';
/**
 * CPC Anomaly Detector — DALEBA [490]
 * Alerte Ulrich si CPC double en moins de 24h.
 */
const bus = require('./event-bus');
const _cpcHistory = new Map(); // campaignId → [{cpc, ts}]

async function checkCPCAnomaly(pool, tenantId) {
  const r = await pool.query(`
    SELECT campaign_id, total_spend, clicks, status
    FROM tenant_campaigns WHERE tenant_id=$1 AND status='active'
  `, [tenantId]).catch(() => ({ rows: [] }));

  const alerts = [];
  for (const c of r.rows) {
    if (!c.clicks || c.clicks === 0) continue;
    const currentCPC = parseFloat(c.total_spend) / parseInt(c.clicks);
    const key = `${tenantId}:${c.campaign_id}`;
    const history = _cpcHistory.get(key) || [];
    const recent  = history.filter(h => Date.now() - h.ts < 24 * 3600000);

    if (recent.length > 0) {
      const avgCPC  = recent.reduce((s, h) => s + h.cpc, 0) / recent.length;
      const doubled = currentCPC > avgCPC * 2;
      if (doubled) {
        alerts.push({ campaignId: c.campaign_id, avgCPC: avgCPC.toFixed(4), currentCPC: currentCPC.toFixed(4) });
        bus.system(`[CPCDetector] 🚨 CPC doublé: ${c.campaign_id} — ${avgCPC.toFixed(4)}$ → ${currentCPC.toFixed(4)}$`);
        try {
          const twilio = require('./twilio-sender');
          await twilio.sendSMS({ to: process.env.ULRICH_PHONE_NUMBER, body: `[DALEBA ADS] ⚠️ Anomalie enchères: le coût par clic de votre campagne a doublé en 24h (${avgCPC.toFixed(3)}$ → ${currentCPC.toFixed(3)}$). Vérifiez Meta Ads Manager.` });
        } catch {}
      }
    }
    history.push({ cpc: currentCPC, ts: Date.now() });
    _cpcHistory.set(key, history.slice(-48)); // garde 48 points max
  }
  return { checked: r.rows.length, alerts };
}

module.exports = { checkCPCAnomaly };
