'use strict';
/**
 * Payroll Worker — DALEBA Metacortex Point 342
 * Processus séparé pour calculs financiers complexes.
 * Ne bloque jamais le thread principal de l'API.
 */
process.on('message', async (msg) => {
  const { action, payload, requestId } = msg;
  try {
    let result;
    switch (action) {
      case 'payout_report': {
        const payouts = require('../services/staff-payouts');
        const { pool } = require('../memory/db');
        result = await payouts.generateBiweeklyReport(payload.tenantId, pool, payload.opts || {});
        break;
      }
      case 'team_retention': {
        const perf = require('../services/performance-monitor');
        const { pool } = require('../memory/db');
        result = await perf.computeTeamRetention(pool, payload.tenantId);
        break;
      }
      case 'commission_batch': {
        const engine = require('../services/commission-engine');
        const { pool } = require('../memory/db');
        const results = [];
        for (const tx of (payload.transactions || [])) {
          results.push(await engine.processTransaction(tx, pool).catch(e => ({ error: e.message })));
        }
        result = { processed: results.length, results };
        break;
      }
      default: throw new Error(`Action inconnue: ${action}`);
    }
    process.send({ requestId, result });
  } catch (e) {
    process.send({ requestId, error: e.message });
  }
});
