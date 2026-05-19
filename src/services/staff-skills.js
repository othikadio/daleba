'use strict';
/**
 * Staff Skills — DALEBA Metacortex Points 307-308
 * Table staff_skills: liaison employee_id ↔ catalog_id des services autorisés.
 * [308] Bloque toute assignation si compétence absente.
 */
const bus = require('./event-bus');

async function initSchema(pool) {
  if (!pool) return;
  await pool.query(`
    CREATE TABLE IF NOT EXISTS staff_skills (
      id            SERIAL PRIMARY KEY,
      tenant_id     TEXT NOT NULL,
      employee_square_id TEXT NOT NULL,  -- square_team_member_id
      catalog_item_id    TEXT NOT NULL,  -- Square catalog item ID ou nom service
      service_name       TEXT,
      certified_at       TIMESTAMPTZ DEFAULT NOW(),
      certified_by       TEXT DEFAULT 'admin',
      active             BOOL DEFAULT true,
      UNIQUE(tenant_id, employee_square_id, catalog_item_id)
    )
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS staff_leaves (
      id             SERIAL PRIMARY KEY,
      tenant_id      TEXT NOT NULL,
      employee_square_id TEXT NOT NULL,
      leave_start    TIMESTAMPTZ NOT NULL,
      leave_end      TIMESTAMPTZ NOT NULL,
      reason         TEXT DEFAULT 'congé',
      approved_by    TEXT DEFAULT 'admin',
      created_at     TIMESTAMPTZ DEFAULT NOW()
    )
  `);
}

/**
 * [308] Vérifie qu'un employé a la compétence pour un service
 * @returns {boolean} true si autorisé
 */
async function hasSkill(pool, tenantId, employeeSquareId, catalogItemId) {
  if (!pool) return true; // mode dégradé: permissif

  // Cherche par catalog_item_id exact OU par service_name (LIKE)
  const r = await pool.query(`
    SELECT 1 FROM staff_skills
    WHERE tenant_id = $1
      AND employee_square_id = $2
      AND (catalog_item_id = $3 OR service_name ILIKE $4)
      AND active = true
    LIMIT 1
  `, [tenantId, employeeSquareId, catalogItemId, `%${catalogItemId}%`]);

  return r.rows.length > 0;
}

/**
 * [308] Valide l'assignation — throw si compétence manquante
 */
async function assertSkill(pool, tenantId, employeeSquareId, catalogItemId, employeeName = '') {
  const ok = await hasSkill(pool, tenantId, employeeSquareId, catalogItemId);
  if (!ok) {
    bus.system(`[Skills] ❌ BLOCAGE: ${employeeName || employeeSquareId} non qualifié pour ${catalogItemId}`);
    throw new Error(`Assignation bloquée: l'employé${employeeName ? ' ' + employeeName : ''} n'est pas qualifié pour le service "${catalogItemId}". Consultez la table staff_skills.`);
  }
  return true;
}

/**
 * Ajoute une compétence à un employé
 */
async function addSkill(pool, tenantId, employeeSquareId, catalogItemId, serviceName = '') {
  await initSchema(pool);
  await pool.query(`
    INSERT INTO staff_skills (tenant_id, employee_square_id, catalog_item_id, service_name)
    VALUES ($1, $2, $3, $4)
    ON CONFLICT (tenant_id, employee_square_id, catalog_item_id) DO UPDATE SET active=true
  `, [tenantId, employeeSquareId, catalogItemId, serviceName]);
  bus.system(`[Skills] ✅ Compétence ajoutée: ${employeeSquareId} → ${serviceName || catalogItemId}`);
}

async function removeSkill(pool, tenantId, employeeSquareId, catalogItemId) {
  await pool.query(`
    UPDATE staff_skills SET active=false
    WHERE tenant_id=$1 AND employee_square_id=$2 AND catalog_item_id=$3
  `, [tenantId, employeeSquareId, catalogItemId]);
}

async function getEmployeeSkills(pool, tenantId, employeeSquareId) {
  const r = await pool.query(`
    SELECT * FROM staff_skills WHERE tenant_id=$1 AND employee_square_id=$2 AND active=true
  `, [tenantId, employeeSquareId]);
  return r.rows;
}

async function getQualifiedStaff(pool, tenantId, catalogItemId) {
  const r = await pool.query(`
    SELECT ss.employee_square_id, sp.name, sp.status
    FROM staff_skills ss
    JOIN staff_profiles sp ON ss.tenant_id = sp.tenant_id AND ss.employee_square_id = sp.square_id
    WHERE ss.tenant_id=$1 AND (ss.catalog_item_id=$2 OR ss.service_name ILIKE $3)
      AND ss.active=true AND sp.active=true
  `, [tenantId, catalogItemId, `%${catalogItemId}%`]);
  return r.rows;
}

module.exports = { initSchema, hasSkill, assertSkill, addSkill, removeSkill, getEmployeeSkills, getQualifiedStaff };
