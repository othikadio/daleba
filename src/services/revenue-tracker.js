/**
 * DALEBA — Revenue Tracker (Étape 4)
 * Agrège les paiements Square complétés pour afficher
 * le chiffre d'affaires encaissé en temps réel.
 */
'use strict';

const https = require('https');

const SQUARE_TOKEN   = process.env.SQUARE_ACCESS_TOKEN || 'EAAAl621sVKBGg0JYZaOIMRv7iHe8aOPxX5Ub6-Rfnrr5J9ovhf4dRC-i1WZrgC3';
const SQUARE_HOST    = 'connect.squareup.com';
const LOCATION_ID    = process.env.SQUARE_LOCATION_ID  || 'LTDE9RP9PSHX7';

// Date de démarrage officielle DALEBA — seules les transactions depuis cette date
// s'affichent dans le dashboard. Mettre à jour via REVENUE_START_DATE (ISO 8601).
const REVENUE_START_DATE = process.env.REVENUE_START_DATE || '2026-06-01T00:00:00.000Z';

function squareGET(path) {
  return new Promise((resolve, reject) => {
    const req = https.request({
      hostname: SQUARE_HOST,
      path,
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${SQUARE_TOKEN}`,
        'Content-Type':  'application/json',
        'Square-Version': '2024-01-17',
      },
      timeout: 12000,
    }, (res) => {
      let data = '';
      res.on('data', c => { data += c; });
      res.on('end', () => {
        try { resolve(JSON.parse(data)); }
        catch (e) { reject(new Error('Square parse error: ' + data.slice(0, 100))); }
      });
    });
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error('Square timeout')); });
    req.end();
  });
}

/**
 * Récupère le résumé financier Square.
 * Parcourt toutes les pages de paiements pour un total exact.
 * @returns {Promise<Object>} { total, completed, count, currency, location }
 */
async function getRevenueSummary() {
  let total     = 0;
  let completed = 0;
  let count     = 0;
  let cursor    = null;
  let currency  = 'CAD';

  do {
    const qs = [
      `limit=200`,
      `location_id=${LOCATION_ID}`,
      `begin_time=${encodeURIComponent(REVENUE_START_DATE)}`,
      cursor ? `cursor=${cursor}` : '',
    ].filter(Boolean).join('&');

    const data = await squareGET(`/v2/payments?${qs}`);
    const payments = data.payments || [];

    for (const p of payments) {
      count++;
      if (p.status === 'COMPLETED') {
        const amt = p.total_money?.amount || 0;
        currency  = p.total_money?.currency || 'CAD';
        total    += amt;
        completed++;
      }
    }
    cursor = data.cursor || null;
  } while (cursor);

  return {
    total_cents: total,
    total:       (total / 100).toFixed(2),
    currency,
    completed_count: completed,
    total_count:     count,
    location:        LOCATION_ID,
    start_date:      REVENUE_START_DATE,
    fetched_at:      new Date().toISOString(),
  };
}

module.exports = { getRevenueSummary };
