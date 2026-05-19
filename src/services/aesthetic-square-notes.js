'use strict';
/**
 * Aesthetic Square Notes — DALEBA Metacortex Point 396
 * Synchronise les mémos esthétiques dans les notes de fiches clients Square.
 * Appel asynchrone non-bloquant [392].
 */
const bus = require('./event-bus');

/**
 * [396] Envoie un mémo esthétique vers les notes client Square (async, non-bloquant)
 */
async function syncMemoToSquare(clientId, analysisResult) {
  const token    = process.env.SQUARE_ACCESS_TOKEN;
  if (!token || !clientId) return;

  const memo = buildSquareMemo(analysisResult);

  // [392] Non-bloquant — setImmediate pour ne pas ralentir l'API
  setImmediate(async () => {
    try {
      const resp = await fetch(`https://connect.squareup.com/v2/customers/${clientId}`, {
        method:  'PUT',
        headers: { 'Authorization':`Bearer ${token}`, 'Content-Type':'application/json', 'Square-Version':'2024-01-18' },
        body:    JSON.stringify({ note: memo }),
      });
      if (resp.ok) bus.system(`[AestheticSquareNotes] ✅ Mémo syncé: ${clientId}`);
      else bus.system(`[AestheticSquareNotes] ⚠️ Sync échec: ${resp.status}`);
    } catch (e) {
      bus.system(`[AestheticSquareNotes] ⚠️ Erreur réseau: ${e.message}`);
    }
  });

  return { queued: true, clientId };
}

function buildSquareMemo(analysis) {
  if (!analysis) return 'Analyse esthétique DALEBA effectuée.';
  const bots = (analysis.recommended_botanicals||[]).slice(0,3).map(b=>b.ingredient).join(', ');
  return [
    `[DALEBA Skin Analysis — ${new Date().toLocaleDateString('fr-CA')}]`,
    `Type de peau: ${analysis.hydration_index||'—'}`,
    `Botaniques: ${bots||'—'}`,
    `Note: ${analysis.wellness_note?.slice(0,80)||'—'}`,
  ].join(' | ');
}

module.exports = { syncMemoToSquare, buildSquareMemo };
