/**
 * Opportunity Worker — Radar Planétaire
 * Scan automatique toutes les 4 heures.
 * Déduplique par URL avant insertion.
 */
'use strict';

const { pool }           = require('../memory/db');
const { scanAll }        = require('../services/opportunity-scanner');
const { classifyBatch }  = require('../services/opportunity-classifier');

const INTERVAL_MS = 4 * 60 * 60 * 1000; // 4 heures

async function runOpportunityWorker() {
  console.log('[opportunity-worker] ▶ Début du scan Radar Planétaire...');
  const startAt = Date.now();
  let inserted = 0;
  let skipped  = 0;

  try {
    const raw = await scanAll();
    console.log(`[opportunity-worker] ${raw.length} opportunités brutes collectées`);

    // Filtrage minimal avant classification (éviter les tokens inutiles)
    const filtered = raw.filter(r => r.title && r.title.length > 5);

    // Déduplique : récupère toutes les URLs déjà en DB
    const existingRes = await pool.query('SELECT source_url FROM daleba_opportunities WHERE source_url IS NOT NULL');
    const existingURLs = new Set(existingRes.rows.map(r => r.source_url));

    const toClassify = filtered.filter(r => !r.url || !existingURLs.has(r.url));
    console.log(`[opportunity-worker] ${toClassify.length} nouvelles à classifier (${filtered.length - toClassify.length} doublons ignorés)`);

    if (toClassify.length === 0) {
      console.log('[opportunity-worker] Rien de nouveau. Fin du scan.');
      return;
    }

    const classified = await classifyBatch(toClassify);

    for (const opp of classified) {
      if (!opp.relevant || opp.score < 20) { skipped++; continue; }
      // Double-check URL dédupliquée (cas course condition)
      if (opp.url && existingURLs.has(opp.url)) { skipped++; continue; }

      try {
        await pool.query(`
          INSERT INTO daleba_opportunities
            (source_platform, source_url, country, language_original, title,
             description_orig, description_fr, budget_raw, budget_estimated,
             budget_currency, category, score, keywords_matched, status)
          VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,'pending')
        `, [
          opp.platform,
          opp.url,
          opp.country,
          opp.language_original || 'en',
          (opp.title || '').slice(0, 600),
          (opp.description || '').slice(0, 10000),
          opp.description_fr || '',
          opp.budget_raw,
          opp.budget_estimated,
          opp.budget_currency || 'USD',
          opp.category || 'autre',
          opp.score || 0,
          opp.keywords_matched || '',
        ]);
        inserted++;
      } catch (err) {
        // Erreur d'insertion individuelle — logguer et continuer
        console.warn(`[opportunity-worker] Insert échoué pour "${opp.title?.slice(0, 60)}": ${err.message}`);
        skipped++;
      }
    }

    const elapsed = ((Date.now() - startAt) / 1000).toFixed(1);
    console.log(`[opportunity-worker] ✅ Terminé en ${elapsed}s — ${inserted} insérées, ${skipped} ignorées`);
  } catch (err) {
    console.error('[opportunity-worker] ❌ Erreur critique:', err.message);
  }
}

function startOpportunityWorker() {
  console.log('[opportunity-worker] Démarrage — scan toutes les 4h');
  // Premier scan après 30s de délai (laisse le serveur se stabiliser)
  setTimeout(runOpportunityWorker, 30 * 1000);
  // Puis toutes les 4 heures
  setInterval(runOpportunityWorker, INTERVAL_MS);
}

module.exports = { startOpportunityWorker, runOpportunityWorker };
