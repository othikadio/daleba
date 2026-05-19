'use strict';
/**
 * Pooled Tips — DALEBA Metacortex Point 329
 * Distribution équitable des pourboires sur ventes Bar Botanique.
 * Si le salon active le "pooled tips mode", les tips produits sont répartis
 * équitablement entre tous les employés actifs du shift.
 */
const bus = require('./event-bus');

async function initSchema(pool) {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS pooled_tips_config (
      tenant_id   TEXT PRIMARY KEY,
      enabled     BOOL DEFAULT false,
      scope       TEXT DEFAULT 'botanical',  -- 'botanical' | 'all'
      updated_at  TIMESTAMPTZ DEFAULT NOW()
    )
  `).catch(() => {});
}

/**
 * Active/désactive le mode pooled tips pour un tenant
 */
async function setPooledMode(pool, tenantId, enabled, scope = 'botanical') {
  await initSchema(pool);
  await pool.query(`
    INSERT INTO pooled_tips_config (tenant_id, enabled, scope)
    VALUES ($1,$2,$3)
    ON CONFLICT (tenant_id) DO UPDATE SET enabled=$2, scope=$3, updated_at=NOW()
  `, [tenantId, enabled, scope]);
  bus.system(`[PooledTips] Mode ${enabled?'activé':'désactivé'} pour ${tenantId} (scope: ${scope})`);
}

/**
 * [329] Distribue un pourboire de vente produit entre tous les employés actifs du jour
 * @param {number} tipAmount - montant total du pourboire
 * @param {string} txId      - ID transaction
 * @param {string} date      - date du shift (YYYY-MM-DD)
 */
async function distributePooledTip(pool, tenantId, { tipAmount, txId, date }) {
  await initSchema(pool);

  // Vérifier que le mode pooled est actif
  const cfgR = await pool.query(`SELECT * FROM pooled_tips_config WHERE tenant_id=$1`, [tenantId]).catch(() => ({ rows: [] }));
  const cfg  = cfgR.rows[0];
  if (!cfg?.enabled) return { distributed: false, reason: 'pooled_tips_disabled' };

  // Récupérer les employés actifs du jour (ont eu des RDV aujourd'hui)
  const shiftStart = new Date(`${date}T00:00:00Z`);
  const shiftEnd   = new Date(`${date}T23:59:59Z`);

  const staffR = await pool.query(`
    SELECT DISTINCT staff_square_id, sp.name
    FROM tenant_appointments ta
    JOIN staff_profiles sp ON sp.tenant_id=ta.tenant_id AND sp.square_id=ta.staff_square_id
    WHERE ta.tenant_id=$1 AND ta.start_at BETWEEN $2 AND $3 AND ta.status='COMPLETED'
  `, [tenantId, shiftStart.toISOString(), shiftEnd.toISOString()]).catch(() => ({ rows: [] }));

  const activeStaff = staffR.rows;
  if (activeStaff.length === 0) return { distributed: false, reason: 'no_active_staff' };

  const sharePerEmployee = parseFloat((tipAmount / activeStaff.length).toFixed(2));
  const distributions = [];

  for (const s of activeStaff) {
    await pool.query(`
      INSERT INTO staff_payouts (tenant_id, employee_square_id, employee_name, tx_id, payout_type, amount_net, rate_pct, payout_amount)
      VALUES ($1,$2,$3,$4,'pooled_tip',$5,0,$6)
      ON CONFLICT (tx_id, employee_square_id, payout_type) DO NOTHING
    `, [tenantId, s.staff_square_id, s.name, `${txId}_pool`, tipAmount, sharePerEmployee]).catch(() => {});

    distributions.push({ squareId: s.staff_square_id, name: s.name, share: sharePerEmployee });
  }

  bus.system(`[PooledTips] ${tipAmount} CAD réparti entre ${activeStaff.length} employés (${sharePerEmployee} CAD/pers.)`);
  return { distributed: true, total: tipAmount, perEmployee: sharePerEmployee, distributions };
}

module.exports = { initSchema, setPooledMode, distributePooledTip };
