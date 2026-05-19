'use strict';
/**
 * Stamp Card Engine — DALEBA Metacortex Point 444
 * "Tampons Virtuels": 9 soins achetés → 10ème gratuit.
 * Config JSONB flexible dans tenant_settings.stamp_programs.
 */
const bus = require('./event-bus');

const DEFAULT_STAMP_PROGRAMS = [
  { id: 'soin10', name: '10ème soin gratuit', stampsRequired: 9, reward: 'Soin gratuit de valeur équivalente', category: 'service' },
  { id: 'produit5', name: '5ème produit offert', stampsRequired: 4, reward: 'Produit offert ≤15$', category: 'product' },
];

async function initSchema(pool) {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS tenant_stamp_cards (
      id            SERIAL PRIMARY KEY,
      tenant_id     TEXT NOT NULL,
      customer_id   TEXT NOT NULL,
      program_id    TEXT NOT NULL,
      stamps        INTEGER DEFAULT 0,
      redeemed      INTEGER DEFAULT 0,
      last_stamp_at TIMESTAMPTZ,
      UNIQUE(tenant_id, customer_id, program_id)
    )
  `).catch(() => {});
}

async function getPrograms(pool, tenantId) {
  const r = await pool.query(
    `SELECT stamp_programs FROM tenant_settings WHERE tenant_id=$1`, [tenantId]
  ).catch(() => ({ rows: [] }));
  return r.rows[0]?.stamp_programs || DEFAULT_STAMP_PROGRAMS;
}

async function addStamp(pool, tenantId, { customerId, category, txId }) {
  await initSchema(pool);
  const programs = await getPrograms(pool, tenantId);
  const prog = programs.find(p => p.category === category);
  if (!prog) return { stamped: false, reason: 'no_program_for_category' };

  const r = await pool.query(`
    INSERT INTO tenant_stamp_cards (tenant_id, customer_id, program_id, stamps, last_stamp_at)
    VALUES ($1,$2,$3,1,NOW())
    ON CONFLICT (tenant_id, customer_id, program_id) DO UPDATE
      SET stamps = tenant_stamp_cards.stamps + 1, last_stamp_at=NOW()
    RETURNING stamps, redeemed
  `, [tenantId, customerId, prog.id]);

  const { stamps, redeemed } = r.rows[0];
  const eligible = stamps > 0 && stamps % prog.stampsRequired === 0;

  if (eligible) {
    await pool.query(`UPDATE tenant_stamp_cards SET redeemed=redeemed+1 WHERE tenant_id=$1 AND customer_id=$2 AND program_id=$3`, [tenantId, customerId, prog.id]).catch(() => {});
    bus.system(`[StampCard] 🎉 ${customerId} a complété ${prog.name}! (${stamps} tampons)`);
  }

  return { stamped: true, stamps, program: prog.name, rewardUnlocked: eligible, reward: eligible ? prog.reward : null };
}

module.exports = { addStamp, getPrograms, initSchema, DEFAULT_STAMP_PROGRAMS };
