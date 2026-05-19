'use strict';
/**
 * Staff Sync — DALEBA Metacortex Point 277
 * Synchronise les profils du personnel Square vers staff_profiles.
 */
const bus = require('./event-bus');

async function initSchema(pool) {
  if (!pool) return;
  await pool.query(`
    CREATE TABLE IF NOT EXISTS staff_profiles (
      id          SERIAL PRIMARY KEY,
      tenant_id   TEXT NOT NULL,
      square_id   TEXT,
      name        TEXT NOT NULL,
      email       TEXT,
      phone       TEXT,
      role        TEXT DEFAULT 'stylist',
      hourly_rate NUMERIC(10,2),
      active      BOOL DEFAULT true,
      avatar_url  TEXT,
      specialties TEXT[],
      created_at  TIMESTAMPTZ DEFAULT NOW(),
      updated_at  TIMESTAMPTZ DEFAULT NOW(),
      UNIQUE(tenant_id, square_id)
    )
  `);
}

async function syncFromSquare(tenantId, accessToken, pool) {
  if (!pool) return { synced: 0, error: 'No DB pool' };
  await initSchema(pool);
  
  try {
    const squareClient = require('./square');
    const teamMembers  = await squareClient.listTeamMembers(accessToken).catch(() => []);
    
    let synced = 0;
    for (const member of teamMembers) {
      await pool.query(`
        INSERT INTO staff_profiles (tenant_id, square_id, name, email, phone, role, active, updated_at)
        VALUES ($1, $2, $3, $4, $5, $6, $7, NOW())
        ON CONFLICT (tenant_id, square_id)
        DO UPDATE SET name=$3, email=$4, phone=$5, active=$7, updated_at=NOW()
      `, [
        tenantId,
        member.id,
        `${member.given_name || ''} ${member.family_name || ''}`.trim() || 'Employé',
        member.email_address || null,
        member.phone_number || null,
        member.status === 'ACTIVE' ? 'stylist' : 'inactive',
        member.status === 'ACTIVE',
      ]);
      synced++;
    }
    bus.system(`[StaffSync] ✅ ${synced} profils synchronisés pour ${tenantId}`);
    return { synced, tenantId };
  } catch (err) {
    bus.system(`[StaffSync] Erreur sync: ${err.message}`);
    return { synced: 0, error: err.message };
  }
}

async function getStaffProfiles(tenantId, pool) {
  if (!pool) return [];
  const r = await pool.query(`SELECT * FROM staff_profiles WHERE tenant_id=$1 AND active=true ORDER BY name`, [tenantId]);
  return r.rows;
}

module.exports = { initSchema, syncFromSquare, getStaffProfiles };
