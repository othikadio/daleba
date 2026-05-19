'use strict';
/**
 * Skin Progress Tracker — DALEBA Metacortex Point 380
 * Compare deux analyses cutanées (J0 et J+30) et calcule % d'amélioration.
 */
const bus = require('./event-bus');

async function initSchema(pool) {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS skin_progress_snapshots (
      id              SERIAL PRIMARY KEY,
      tenant_id       TEXT NOT NULL,
      client_id       TEXT NOT NULL,
      snapshot_date   TIMESTAMPTZ DEFAULT NOW(),
      analysis_data   JSONB,
      scores          JSONB,  -- { hydration, irritation, texture, overall }
      signed_by       TEXT,   -- [383] ID esthéticienne responsable
      signature_hash  TEXT,   -- [383] signature numérique
      created_at      TIMESTAMPTZ DEFAULT NOW()
    )
  `).catch(() => {});
  await pool.query('CREATE INDEX IF NOT EXISTS idx_snapshots_client ON skin_progress_snapshots(tenant_id, client_id, snapshot_date DESC)').catch(() => {});
}

/**
 * Convertit les qualificatifs en score numérique (0-100)
 */
function qualitativeToScore(field, value) {
  const scales = {
    hydration_index: { sec:20, normal:60, mixte:55, gras:65, sensible:40 },
    irritation_zones: { modérée:20, légère:55, aucune:100 },
    texture: { rugueuse:20, granuleuse:45, mixte:60, lisse:90 },
    scalp_density: { faible:30, normale:70, dense:90 },
  };
  const scale = scales[field];
  if (!scale) return 50;
  return scale[value?.toLowerCase()] ?? 50;
}

/**
 * Convertit une analyse IA en scores numériques
 */
function analysisToScores(analysis) {
  return {
    hydration:  qualitativeToScore('hydration_index',  analysis.hydration_index),
    irritation: qualitativeToScore('irritation_zones', analysis.irritation_zones),
    texture:    qualitativeToScore('texture',           analysis.texture),
    density:    qualitativeToScore('scalp_density',     analysis.scalp_density),
    overall:    Math.round((
      qualitativeToScore('hydration_index',  analysis.hydration_index) +
      qualitativeToScore('irritation_zones', analysis.irritation_zones) +
      qualitativeToScore('texture',          analysis.texture)
    ) / 3),
  };
}

/**
 * [383] Signe numériquement un snapshot
 */
function signSnapshot(snapshotId, aestheticianId) {
  const crypto = require('crypto');
  const payload = `${snapshotId}:${aestheticianId}:${Date.now()}`;
  return {
    signedBy:      aestheticianId,
    signatureHash: crypto.createHash('sha256').update(payload).digest('hex').slice(0, 16),
    signedAt:      new Date().toISOString(),
  };
}

/**
 * [380] Enregistre un snapshot d'analyse pour comparaison future
 */
async function saveSnapshot(pool, { tenantId, clientId, analysisData, aestheticianId }) {
  await initSchema(pool);
  const scores = analysisToScores(analysisData);
  const sig    = aestheticianId ? signSnapshot(null, aestheticianId) : {};

  const r = await pool.query(`
    INSERT INTO skin_progress_snapshots (tenant_id, client_id, analysis_data, scores, signed_by, signature_hash)
    VALUES ($1,$2,$3,$4,$5,$6) RETURNING *
  `, [tenantId, clientId, JSON.stringify(analysisData), JSON.stringify(scores), sig.signedBy||null, sig.signatureHash||null]);

  bus.system(`[SkinProgress] 📸 Snapshot enregistré: ${clientId} — score global ${scores.overall}/100`);
  return r.rows[0];
}

/**
 * [380] Compare les 2 derniers snapshots et calcule % d'amélioration
 */
async function compareProgress(pool, tenantId, clientId) {
  await initSchema(pool);
  const r = await pool.query(`
    SELECT * FROM skin_progress_snapshots
    WHERE tenant_id=$1 AND client_id=$2
    ORDER BY snapshot_date DESC LIMIT 2
  `, [tenantId, clientId]);

  if (r.rows.length < 2) return { insufficient_data: true, message: 'Minimum 2 analyses requises pour comparer' };

  const [recent, older] = r.rows; // DESC → recent est [0]
  const recentScores = typeof recent.scores === 'string' ? JSON.parse(recent.scores) : recent.scores;
  const olderScores  = typeof older.scores  === 'string' ? JSON.parse(older.scores)  : older.scores;

  const daysDiff = Math.round((new Date(recent.snapshot_date) - new Date(older.snapshot_date)) / 86400000);

  const improvements = {};
  for (const key of ['hydration', 'irritation', 'texture', 'overall']) {
    const delta = recentScores[key] - olderScores[key];
    improvements[key] = {
      before:       olderScores[key],
      after:        recentScores[key],
      delta,
      improvement:  Math.round(delta / (olderScores[key] || 1) * 100),
    };
  }

  const overallImprovement = improvements.overall?.improvement || 0;
  bus.system(`[SkinProgress] 📊 Comparaison ${clientId}: ${overallImprovement > 0 ? '+' : ''}${overallImprovement}% amélioration (${daysDiff}j)`);

  return {
    clientId,
    daysBetween:    daysDiff,
    improvements,
    overallDelta:   improvements.overall?.delta,
    overallPercent: overallImprovement,
    verdict:        overallImprovement >= 20 ? 'Excellente progression 🌟'
                  : overallImprovement >= 5  ? 'Bonne évolution 📈'
                  : overallImprovement >= 0  ? 'Légère amélioration 🌱'
                  :                            'Révision protocole recommandée ⚠️',
  };
}

module.exports = { saveSnapshot, compareProgress, analysisToScores, signSnapshot, initSchema };
