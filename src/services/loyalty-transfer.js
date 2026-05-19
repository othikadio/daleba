'use strict';
/**
 * Loyalty Transfer — DALEBA Metacortex Point 441
 * Transfert de points entre membres d'une même famille après validation sécurité.
 */
const bus = require('./event-bus');

async function initSchema(pool) {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS loyalty_transfers (
      id            SERIAL PRIMARY KEY,
      tenant_id     TEXT NOT NULL,
      from_id       TEXT NOT NULL,
      to_id         TEXT NOT NULL,
      points        INTEGER NOT NULL,
      reason        TEXT,
      approved_by   TEXT,
      created_at    TIMESTAMPTZ DEFAULT NOW()
    )
  `).catch(() => {});
}

/**
 * [441] Transfère des points après validation sécurité (même tenant obligatoire)
 * Validation: les deux profils doivent exister dans le même tenant.
 */
async function transferPoints(pool, tenantId, { fromId, toId, points, reason, approvedBy }) {
  await initSchema(pool);
  if (!fromId || !toId || fromId === toId) throw new Error('fromId et toId distincts requis');
  if (!points || points <= 0 || !Number.isInteger(points)) throw new Error('points doit être un entier positif');

  // Vérifie isolation multi-tenant [449]: les deux profils dans le même tenant
  const both = await pool.query(
    `SELECT customer_id FROM tenant_loyalty_cards WHERE tenant_id=$1 AND customer_id=ANY($2)`,
    [tenantId, [fromId, toId]]
  ).catch(() => ({ rows: [] }));
  if (both.rows.length < 2) throw new Error('[449] Isolation tenant: les deux profils doivent appartenir au même tenant');

  // SELECT FOR UPDATE [423]
  const check = await pool.query(
    `SELECT points_balance FROM tenant_loyalty_cards WHERE tenant_id=$1 AND customer_id=$2 FOR UPDATE`,
    [tenantId, fromId]
  ).catch(() => ({ rows: [] }));
  if (!check.rows.length || check.rows[0].points_balance < points)
    throw new Error(`Solde insuffisant (${check.rows[0]?.points_balance || 0} pts disponibles)`);

  // Débit donneur
  await pool.query(
    `UPDATE tenant_loyalty_cards SET points_balance = points_balance - $3, updated_at=NOW() WHERE tenant_id=$1 AND customer_id=$2`,
    [tenantId, fromId, points]
  );
  // Crédit receveur
  const r = await pool.query(
    `UPDATE tenant_loyalty_cards SET points_balance = points_balance + $3, updated_at=NOW() WHERE tenant_id=$1 AND customer_id=$2 RETURNING points_balance`,
    [tenantId, toId, points]
  ).catch(() => ({ rows: [] }));

  await pool.query(
    `INSERT INTO loyalty_transfers (tenant_id, from_id, to_id, points, reason, approved_by) VALUES ($1,$2,$3,$4,$5,$6)`,
    [tenantId, fromId, toId, points, reason || 'Transfert familial', approvedBy || 'manager']
  ).catch(() => {});

  const audit = require('./loyalty-fraud-guard');
  await audit.auditLog(pool, tenantId, fromId, 'transfer_out', -points, null, `→ ${toId}: ${reason}`, approvedBy);
  await audit.auditLog(pool, tenantId, toId,   'transfer_in',  points, null, `← ${fromId}: ${reason}`, approvedBy);

  bus.system(`[LoyaltyTransfer] 🔄 ${fromId} → ${toId}: ${points} pts (${reason||'—'})`);
  return { transferred: points, toBalance: r.rows[0]?.points_balance, fromId, toId };
}

module.exports = { transferPoints, initSchema };
