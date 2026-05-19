'use strict';
/**
 * Privacy Compliance — DALEBA Metacortex Point 395
 * Conformité Loi 25 Québec + RGPD Europe pour les données esthétiques.
 * Données traitées: types de peau, allergies, photos, routines cosmétiques.
 */
const bus = require('./event-bus');

// [395] Catégories de données esthétiques avec niveau de sensibilité
const DATA_CATEGORIES = {
  skin_type:       { sensitivity: 'low',    retentionDays: 730,  canShare: false },
  melanin_level:   { sensitivity: 'medium', retentionDays: 730,  canShare: false },
  allergies:       { sensitivity: 'high',   retentionDays: 1825, canShare: false },
  skin_photos:     { sensitivity: 'high',   retentionDays: 365,  canShare: false },
  care_routine:    { sensitivity: 'low',    retentionDays: 730,  canShare: false },
  analysis_data:   { sensitivity: 'medium', retentionDays: 730,  canShare: false },
};

async function initSchema(pool) {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS privacy_consents (
      id              SERIAL PRIMARY KEY,
      tenant_id       TEXT NOT NULL,
      client_id       TEXT NOT NULL,
      consent_type    TEXT NOT NULL,  -- aesthetic_analysis | marketing | data_retention
      granted         BOOL DEFAULT false,
      granted_at      TIMESTAMPTZ,
      withdrawn_at    TIMESTAMPTZ,
      ip_address      TEXT,
      created_at      TIMESTAMPTZ DEFAULT NOW(),
      UNIQUE(tenant_id, client_id, consent_type)
    )
  `).catch(() => {});
}

/**
 * [395] Enregistre le consentement explicite du client (Loi 25 + RGPD art. 7)
 */
async function recordConsent(pool, { tenantId, clientId, consentType, granted, ipAddress }) {
  await initSchema(pool);
  await pool.query(`
    INSERT INTO privacy_consents (tenant_id, client_id, consent_type, granted, granted_at, ip_address)
    VALUES ($1,$2,$3,$4,$5,$6)
    ON CONFLICT (tenant_id, client_id, consent_type) DO UPDATE
      SET granted=$4, granted_at=$5, withdrawn_at=CASE WHEN $4=false THEN NOW() ELSE NULL END
  `, [tenantId, clientId, consentType, granted, granted ? new Date().toISOString() : null, ipAddress]);
  bus.system(`[Privacy] Consentement ${consentType}: ${granted?'✅ accordé':'❌ retiré'} — client ${clientId}`);
  return { recorded: true, consentType, granted };
}

/**
 * [395] Vérifie le consentement avant traitement (Loi 25 art. 12 / RGPD art. 6)
 */
async function assertConsent(pool, tenantId, clientId, consentType) {
  await initSchema(pool);
  const r = await pool.query(
    `SELECT granted FROM privacy_consents WHERE tenant_id=$1 AND client_id=$2 AND consent_type=$3`,
    [tenantId, clientId, consentType]
  ).catch(() => ({ rows: [] }));

  if (!r.rows[0]?.granted) {
    throw new Error(`[Loi 25/RGPD] Consentement requis pour "${consentType}" — client ${clientId} n'a pas accordé ce consentement.`);
  }
  return true;
}

/**
 * [395] Droit à l'effacement (RGPD art. 17 / Loi 25 art. 28)
 */
async function deleteClientData(pool, tenantId, clientId) {
  const tables = [
    'tenant_aesthetic_records',
    'aesthetic_prescriptions',
    'skin_progress_snapshots',
    'aesthetic_reminders',
    'aesthetic_ratings',
    'privacy_consents',
  ];

  const results = {};
  for (const table of tables) {
    try {
      const r = await pool.query(`DELETE FROM ${table} WHERE tenant_id=$1 AND client_id=$2`, [tenantId, clientId]);
      results[table] = r.rowCount;
    } catch { results[table] = 0; }
  }

  bus.system(`[Privacy] 🗑️ Droit à l'effacement: ${clientId} — ${Object.values(results).reduce((a,b)=>a+b,0)} enregistrements supprimés`);
  return { deleted: true, clientId, tables: results };
}

/**
 * [395] Droit d'accès aux données (RGPD art. 15 / Loi 25 art. 27)
 */
async function exportClientData(pool, tenantId, clientId) {
  const records = {};
  const queries = {
    aesthetic_record:   `SELECT * FROM tenant_aesthetic_records WHERE tenant_id=$1 AND client_id=$2`,
    prescriptions:      `SELECT id, created_at, analysis_data FROM aesthetic_prescriptions WHERE tenant_id=$1 AND client_id=$2`,
    progress_snapshots: `SELECT id, snapshot_date, scores FROM skin_progress_snapshots WHERE tenant_id=$1 AND client_id=$2`,
    consents:           `SELECT consent_type, granted, granted_at FROM privacy_consents WHERE tenant_id=$1 AND client_id=$2`,
  };

  for (const [key, sql] of Object.entries(queries)) {
    const r = await pool.query(sql, [tenantId, clientId]).catch(() => ({ rows: [] }));
    records[key] = r.rows;
  }

  bus.system(`[Privacy] 📤 Export données: ${clientId}`);
  return { clientId, tenantId, exportedAt: new Date().toISOString(), data: records };
}

module.exports = { recordConsent, assertConsent, deleteClientData, exportClientData, DATA_CATEGORIES, initSchema };
