'use strict';
/**
 * Staff Sync Worker — DALEBA Metacortex Points 302-303
 * Sync Square Team Members → staff_profiles toutes les 15 minutes.
 * Clé de correspondance: square_team_member_id [303]
 */
const bus = require('./event-bus');

const SYNC_INTERVAL_MS = 15 * 60 * 1000; // 15 minutes [302]
const _workers = new Map(); // tenantId → intervalId

async function initSchema(pool) {
  if (!pool) return;
  await pool.query(`
    CREATE TABLE IF NOT EXISTS staff_profiles (
      id              SERIAL PRIMARY KEY,
      tenant_id       TEXT NOT NULL,
      square_id       TEXT NOT NULL,  -- square_team_member_id [303]
      name            TEXT NOT NULL,
      email           TEXT,
      phone           TEXT,
      role            TEXT DEFAULT 'stylist',
      status          TEXT DEFAULT 'ACTIVE',  -- ACTIVE | ON_LEAVE | TERMINATED [302]
      hourly_rate     NUMERIC(10,2) DEFAULT 0,
      commission_rate NUMERIC(5,2)  DEFAULT 40.00,  -- % sur services [311]
      product_commission_rate NUMERIC(5,2) DEFAULT 10.00, -- % sur produits [311]
      active          BOOL DEFAULT true,
      avatar_url      TEXT,
      specialties     TEXT[],
      weekly_hours    NUMERIC(5,1) DEFAULT 40.0,
      created_at      TIMESTAMPTZ DEFAULT NOW(),
      updated_at      TIMESTAMPTZ DEFAULT NOW(),
      UNIQUE(tenant_id, square_id)
    )
  `).catch(() => {});
}

/**
 * [302-303] Synchronise les statuts des employés depuis Square Team API
 */
async function syncNow(tenantId, accessToken, pool) {
  if (!accessToken || !pool) return { synced: 0, reason: 'missing deps' };
  await initSchema(pool);

  try {
    // Appel Square Team Members API v2
    const resp = await fetch(`https://connect.squareup.com/v2/team-members?limit=200`, {
      headers: {
        'Authorization': `Bearer ${accessToken}`,
        'Square-Version': '2024-01-18',
        'Content-Type': 'application/json',
      },
    });

    if (!resp.ok) throw new Error(`Square Team API ${resp.status}`);
    const data = await resp.json();
    const members = data.team_members || [];

    let synced = 0, updated = 0;
    for (const m of members) {
      // [302] Mapper les statuts Square → statuts DALEBA
      const squareStatus = m.status || 'ACTIVE';
      const dalebaStatus = squareStatus === 'ACTIVE' ? 'ACTIVE'
                         : squareStatus === 'INACTIVE' ? 'TERMINATED'
                         : 'ON_LEAVE';

      const name  = [m.given_name, m.family_name].filter(Boolean).join(' ') || 'Employé';
      const email = m.email_address || null;
      const phone = m.phone_number  || null;

      const r = await pool.query(`
        INSERT INTO staff_profiles (tenant_id, square_id, name, email, phone, status, active, updated_at)
        VALUES ($1, $2, $3, $4, $5, $6, $7, NOW())
        ON CONFLICT (tenant_id, square_id) DO UPDATE
          SET name=$3, email=$4, phone=$5, status=$6, active=$7, updated_at=NOW()
        RETURNING (xmax = 0) AS inserted
      `, [tenantId, m.id, name, email, phone, dalebaStatus, dalebaStatus === 'ACTIVE']);

      if (r.rows[0]?.inserted) synced++; else updated++;
    }

    bus.system(`[StaffSync] ${tenantId}: ${synced} créés, ${updated} mis à jour (${members.length} total)`);
    return { tenantId, synced, updated, total: members.length };

  } catch (err) {
    bus.system(`[StaffSync] Erreur ${tenantId}: ${err.message}`);
    return { tenantId, synced: 0, error: err.message };
  }
}

/**
 * [302] Démarre le worker 15min pour un tenant
 */
function startWorker(tenantId, accessToken, pool) {
  if (_workers.has(tenantId)) return; // déjà actif

  const run = () => syncNow(tenantId, accessToken, pool).catch(() => {});
  run(); // premier run immédiat

  const id = setInterval(run, SYNC_INTERVAL_MS);
  _workers.set(tenantId, id);
  bus.system(`[StaffSync] Worker démarré: ${tenantId} (toutes les 15min)`);
}

function stopWorker(tenantId) {
  const id = _workers.get(tenantId);
  if (id) { clearInterval(id); _workers.delete(tenantId); }
}

function getActiveWorkers() { return [..._workers.keys()]; }

module.exports = { syncNow, startWorker, stopWorker, getActiveWorkers, initSchema };
