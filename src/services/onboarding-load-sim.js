'use strict';
/**
 * Onboarding Load Simulator — DALEBA Metacortex Point 281
 * Valide que 100 onboardings simultanés ne saturent pas le pool PostgreSQL.
 */
const bus = require('./event-bus');
async function runLoadTest(pool, concurrency = 100) {
  bus.system(`[LoadSim] Test: ${concurrency} requêtes simultanées`);
  const start = Date.now(); const results = { success:0, failed:0, errors:[] };
  if (!pool) return { ...results, error:'No pool', simulated:true };
  const tasks = Array.from({length:concurrency},(_,i) => (async()=>{
    try { await pool.query('SELECT $1::text, NOW()', [`tenant-${i}`]); results.success++; }
    catch(e) { results.failed++; if(results.errors.length<5) results.errors.push(e.message); }
  })());
  await Promise.allSettled(tasks);
  results.durationMs = Date.now()-start;
  results.throughput  = Math.round(concurrency/(results.durationMs/1000));
  results.verdict     = results.failed===0 ? `✅ Pool stable: ${concurrency} req en ${results.durationMs}ms` : `⚠️ ${results.failed} échecs`;
  bus.system(`[LoadSim] ${results.verdict}`);
  return results;
}
module.exports = { runLoadTest };
