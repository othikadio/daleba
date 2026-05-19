'use strict';

/**
 * DALEBA — Tenant Seed Worker [259]
 * Metacortex: Clone asynchrone des données Square d'un tenant (lecture seule).
 *
 * Étapes:
 *  1. _seedCatalog  — services/produits Square → tenant_catalog
 *  2. _seedStaff    — équipe Square → tenant_staff
 *  3. _seedCustomers — comptage clients → tenant_settings
 *
 * Ne lève jamais d'exception — retourne { seeded: false, reason } si Square indisponible.
 */

const https = require('https');
const bus   = require('./event-bus');

const SQUARE_API_BASE = 'https://connect.squareup.com/v2';

// ─── SCHEMA ───────────────────────────────────────────────────────────────────

/**
 * Crée les tables tenant_catalog et tenant_staff si elles n'existent pas.
 * @param {object} pool
 */
async function initSchema(pool) {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS tenant_catalog (
      id          SERIAL PRIMARY KEY,
      tenant_id   TEXT NOT NULL,
      square_id   TEXT NOT NULL,
      name        TEXT,
      price_cents INT,
      currency    TEXT NOT NULL DEFAULT 'CAD',
      category    TEXT,
      active      BOOL NOT NULL DEFAULT TRUE,
      UNIQUE(tenant_id, square_id)
    )
  `);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS tenant_staff (
      id        SERIAL PRIMARY KEY,
      tenant_id TEXT NOT NULL,
      square_id TEXT NOT NULL,
      name      TEXT,
      email     TEXT,
      role      TEXT,
      active    BOOL NOT NULL DEFAULT TRUE,
      UNIQUE(tenant_id, square_id)
    )
  `);
  bus.emit('system', '[SeedWorker] schema ready (tenant_catalog, tenant_staff)');
}

// ─── HELPERS HTTP ─────────────────────────────────────────────────────────────

function _squareGet(path, accessToken) {
  return new Promise((resolve, reject) => {
    const url    = new URL(`${SQUARE_API_BASE}${path}`);
    const options = {
      hostname: url.hostname,
      path:     url.pathname + url.search,
      method:   'GET',
      headers: {
        Authorization:    `Bearer ${accessToken}`,
        'Square-Version': '2024-01-17',
        'Content-Type':   'application/json',
      },
    };
    const req = https.request(options, res => {
      let data = '';
      res.on('data', chunk => { data += chunk; });
      res.on('end', () => {
        try {
          const parsed = JSON.parse(data);
          if (res.statusCode >= 400) {
            reject(Object.assign(new Error(`Square ${res.statusCode}: ${path}`), { body: parsed }));
          } else {
            resolve(parsed);
          }
        } catch (e) { reject(e); }
      });
    });
    req.on('error', reject);
    req.end();
  });
}

function _squarePost(path, accessToken, body) {
  return new Promise((resolve, reject) => {
    const payload = JSON.stringify(body);
    const url     = new URL(`${SQUARE_API_BASE}${path}`);
    const options = {
      hostname: url.hostname,
      path:     url.pathname + url.search,
      method:   'POST',
      headers: {
        Authorization:    `Bearer ${accessToken}`,
        'Square-Version': '2024-01-17',
        'Content-Type':   'application/json',
        'Content-Length': Buffer.byteLength(payload),
      },
    };
    const req = https.request(options, res => {
      let data = '';
      res.on('data', chunk => { data += chunk; });
      res.on('end', () => {
        try {
          const parsed = JSON.parse(data);
          if (res.statusCode >= 400) {
            reject(Object.assign(new Error(`Square ${res.statusCode}: ${path}`), { body: parsed }));
          } else {
            resolve(parsed);
          }
        } catch (e) { reject(e); }
      });
    });
    req.on('error', reject);
    req.write(payload);
    req.end();
  });
}

// ─── SEED STEPS ───────────────────────────────────────────────────────────────

/**
 * Clone le catalogue Square (ITEM) dans tenant_catalog.
 * @returns {number} nb items insérés/mis à jour
 */
async function _seedCatalog(accessToken, locationId, tenantId, pool) {
  const data = await _squarePost('/catalog/search', accessToken, {
    object_types: ['ITEM'],
    include_deleted_objects: false,
  });

  const items = data.objects || [];
  let count = 0;

  for (const item of items) {
    const variation = (item.item_data?.variations || [])[0];
    const priceMoney = variation?.item_variation_data?.price_money;

    await pool.query(
      `INSERT INTO tenant_catalog (tenant_id, square_id, name, price_cents, currency, category, active)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       ON CONFLICT (tenant_id, square_id) DO UPDATE SET
         name = EXCLUDED.name,
         price_cents = EXCLUDED.price_cents,
         currency = EXCLUDED.currency,
         category = EXCLUDED.category,
         active = EXCLUDED.active`,
      [
        tenantId,
        item.id,
        item.item_data?.name || null,
        priceMoney?.amount || null,
        priceMoney?.currency || 'CAD',
        item.item_data?.category?.name || null,
        !item.is_deleted,
      ]
    );
    count++;
  }

  return count;
}

/**
 * Clone l'équipe Square dans tenant_staff.
 * @returns {number} nb membres insérés/mis à jour
 */
async function _seedStaff(accessToken, tenantId, pool) {
  let members = [];
  let cursor   = null;

  do {
    const body = { limit: 200 };
    if (cursor) body.cursor = cursor;
    const data = await _squarePost('/team-members/search', accessToken, body);
    members = members.concat(data.team_members || []);
    cursor = data.cursor || null;
  } while (cursor);

  let count = 0;

  for (const member of members) {
    await pool.query(
      `INSERT INTO tenant_staff (tenant_id, square_id, name, email, role, active)
       VALUES ($1, $2, $3, $4, $5, $6)
       ON CONFLICT (tenant_id, square_id) DO UPDATE SET
         name = EXCLUDED.name,
         email = EXCLUDED.email,
         role = EXCLUDED.role,
         active = EXCLUDED.active`,
      [
        tenantId,
        member.id,
        [member.given_name, member.family_name].filter(Boolean).join(' ') || null,
        member.email_address || null,
        member.assigned_locations?.assignment_type || 'STAFF',
        member.status === 'ACTIVE',
      ]
    );
    count++;
  }

  return count;
}

/**
 * Compte les clients Square et stocke dans tenant_settings.
 */
async function _seedCustomers(accessToken, tenantId, pool) {
  // Récupère le total des customers via search avec limit=1 pour obtenir le count
  const data = await _squarePost('/customers/search', accessToken, { limit: 1 });
  const count = data.count || (data.customers ? data.customers.length : 0);

  await pool.query(
    `INSERT INTO tenant_settings (tenant_id, key, value)
     VALUES ($1, 'square_customer_count', $2)
     ON CONFLICT (tenant_id, key) DO UPDATE SET value = EXCLUDED.value`,
    [tenantId, String(count)]
  ).catch(() => {
    // tenant_settings peut ne pas exister encore — log et continue
    bus.emit('system', `[SeedWorker] tenant_settings not available, skipping customer count`);
  });

  return count;
}

// ─── MAIN SEED ────────────────────────────────────────────────────────────────

/**
 * Point d'entrée principal. Clone toutes les données Square d'un tenant.
 * Ne lève jamais d'exception — retourne { seeded: false, reason } si Square indisponible.
 *
 * @param {{ tenantId: string, accessToken: string, locationId: string, pool: object }} opts
 * @returns {{ seeded: boolean, catalogCount?: number, staffCount?: number, reason?: string }}
 */
async function seedTenant({ tenantId, accessToken, locationId, pool }) {
  try {
    if (!accessToken) {
      return { seeded: false, reason: 'No access token provided' };
    }

    bus.emit('system', `[SeedWorker] starting seed for tenant ${tenantId}`);

    const catalogCount = await _seedCatalog(accessToken, locationId, tenantId, pool);
    const staffCount   = await _seedStaff(accessToken, tenantId, pool);
    await _seedCustomers(accessToken, tenantId, pool);

    bus.emit('system',
      `[SeedWorker] ✅ tenant seeded: ${catalogCount} services, ${staffCount} staff`,
      { tenantId, catalogCount, staffCount }
    );

    return { seeded: true, catalogCount, staffCount };
  } catch (err) {
    const reason = err.message || 'Unknown error';
    bus.emit('system', `[SeedWorker] ⚠️ seed warning for tenant ${tenantId}: ${reason}`);
    return { seeded: false, reason };
  }
}

// ─── EXPORTS ──────────────────────────────────────────────────────────────────

module.exports = { seedTenant, initSchema };
