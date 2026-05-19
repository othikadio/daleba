'use strict';
/**
 * Aesthetic Records — DALEBA Metacortex Point 354
 * Table tenant_aesthetic_records: fiches suivi esthétique avancées.
 * Champs: types de peau, niveaux de mélanine, allergies, routines actives.
 */
const bus = require('./event-bus');

async function initSchema(pool) {
  if (!pool) return;
  await pool.query(`
    CREATE TABLE IF NOT EXISTS tenant_aesthetic_records (
      id              SERIAL PRIMARY KEY,
      tenant_id       TEXT NOT NULL,
      client_id       TEXT NOT NULL,
      client_name     TEXT,
      skin_type       TEXT,              -- sec | gras | mixte | normal | sensible
      melanin_level   TEXT,              -- clair | medium | foncé | très_foncé
      hydration_index TEXT,              -- sec | normal | gras | mixte
      allergies       TEXT[],            -- liste ingrédients à éviter
      sensitivities   TEXT[],
      active_routine  JSONB,             -- routine soins en cours
      last_analysis   JSONB,             -- dernier diagnostic vision
      botanical_prefs TEXT[],            -- ingrédients botaniques préférés
      notes           TEXT,
      created_at      TIMESTAMPTZ DEFAULT NOW(),
      updated_at      TIMESTAMPTZ DEFAULT NOW(),
      UNIQUE(tenant_id, client_id)
    )
  `);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_aesthetic_tenant ON tenant_aesthetic_records(tenant_id)`);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_aesthetic_client ON tenant_aesthetic_records(tenant_id, client_id)`);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_aesthetic_history ON tenant_aesthetic_records(tenant_id, client_id, updated_at DESC)`); // [373]
}

async function getRecord(pool, tenantId, clientId) {
  await initSchema(pool);
  const r = await pool.query(
    `SELECT * FROM tenant_aesthetic_records WHERE tenant_id=$1 AND client_id=$2`,
    [tenantId, clientId]
  );
  return r.rows[0] || null;
}

async function createRecord(pool, tenantId, clientId, data) {
  await initSchema(pool);
  const { clientName, skinType, melaninLevel, hydrationIndex, allergies, sensitivities, activeRoutine, botanicalPrefs, notes } = data;
  const r = await pool.query(`
    INSERT INTO tenant_aesthetic_records
      (tenant_id, client_id, client_name, skin_type, melanin_level, hydration_index,
       allergies, sensitivities, active_routine, botanical_prefs, notes)
    VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
    ON CONFLICT (tenant_id, client_id) DO UPDATE
      SET client_name=$3, skin_type=$4, melanin_level=$5, hydration_index=$6,
          allergies=$7, sensitivities=$8, active_routine=$9, botanical_prefs=$10,
          notes=$11, updated_at=NOW()
    RETURNING *
  `, [tenantId, clientId, clientName, skinType, melaninLevel, hydrationIndex,
      allergies||[], sensitivities||[], activeRoutine?JSON.stringify(activeRoutine):null,
      botanicalPrefs||[], notes]);
  bus.system(`[AestheticRecords] Fiche créée/mise à jour: ${clientId} (tenant: ${tenantId})`);
  return r.rows[0];
}

async function updateRecord(pool, tenantId, clientId, data) {
  return createRecord(pool, tenantId, clientId, data);
}

async function getAll(pool, tenantId) {
  await initSchema(pool);
  const r = await pool.query(
    `SELECT * FROM tenant_aesthetic_records WHERE tenant_id=$1 ORDER BY updated_at DESC`,
    [tenantId]
  );
  return r.rows;
}

module.exports = { initSchema, getRecord, createRecord, updateRecord, getAll };
