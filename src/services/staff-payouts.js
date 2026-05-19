'use strict';
/**
 * Staff Payouts — DALEBA Metacortex Points 313, 315-316
 * Gestion des paiements: PENDING/PAID + rapport quinzaine.
 */
const bus = require('./event-bus');

/**
 * [316] Génère le bilan de paie quinzaine complet pour chaque employé
 */
async function generateBiweeklyReport(tenantId, pool, { startDate, endDate } = {}) {
  if (!pool) return { error: 'Pool requis' };

  // Période: si non spécifiée, quinzaine en cours
  const now   = new Date();
  const day   = now.getDate();
  const start = startDate || new Date(now.getFullYear(), now.getMonth(), day <= 15 ? 1 : 16);
  const end   = endDate   || new Date(now.getFullYear(), now.getMonth(), day <= 15 ? 15 : new Date(now.getFullYear(), now.getMonth()+1, 0).getDate(), 23, 59, 59);

  const label = `${start.toISOString().slice(0,10)} → ${end.toISOString().slice(0,10)}`;

  try {
    // [316] Ventilation par employé: commissions services + produits + pourboires + CA net
    const r = await pool.query(`
      SELECT
        sp.square_id,
        sp.name,
        sp.commission_rate,
        sp.product_commission_rate,

        -- CA net généré (toutes transactions)
        COALESCE(SUM(CASE WHEN py.payout_type IN ('service_commission','product_commission')
          THEN py.amount_net END), 0) AS ca_net,

        -- Commissions services
        COALESCE(SUM(CASE WHEN py.payout_type='service_commission'
          THEN py.payout_amount END), 0) AS commission_services,

        -- Commissions produits
        COALESCE(SUM(CASE WHEN py.payout_type='product_commission'
          THEN py.payout_amount END), 0) AS commission_produits,

        -- Pourboires (100% employé) [310]
        COALESCE(SUM(CASE WHEN py.payout_type='tip'
          THEN py.payout_amount END), 0) AS pourboires,

        -- Total à payer
        COALESCE(SUM(py.payout_amount), 0) AS total_brut,

        COUNT(DISTINCT py.tx_id) AS nb_transactions,
        COUNT(CASE WHEN py.status='PENDING' THEN 1 END) AS nb_pending,
        COUNT(CASE WHEN py.status='PAID'    THEN 1 END) AS nb_paid

      FROM staff_profiles sp
      LEFT JOIN staff_payouts py
        ON py.tenant_id = sp.tenant_id
        AND py.employee_square_id = sp.square_id
        AND py.created_at BETWEEN $2 AND $3
      WHERE sp.tenant_id = $1 AND sp.active = true
      GROUP BY sp.square_id, sp.name, sp.commission_rate, sp.product_commission_rate
      ORDER BY total_brut DESC
    `, [tenantId, start.toISOString(), end.toISOString()]);

    // Heures travaillées (depuis tenant_appointments)
    const hoursR = await pool.query(`
      SELECT
        staff_square_id,
        COALESCE(SUM(EXTRACT(EPOCH FROM (end_at - start_at)) / 3600), 0) AS hours_worked
      FROM tenant_appointments
      WHERE tenant_id=$1 AND start_at BETWEEN $2 AND $3
        AND status = 'COMPLETED'
      GROUP BY staff_square_id
    `, [tenantId, start.toISOString(), end.toISOString()]).catch(() => ({ rows: [] }));

    const hoursMap = {};
    for (const h of hoursR.rows) hoursMap[h.staff_square_id] = parseFloat(h.hours_worked || 0);

    const employees = r.rows.map(row => ({
      squareId:             row.square_id,
      name:                 row.name,
      commissionRate:       parseFloat(row.commission_rate),
      productCommRate:      parseFloat(row.product_commission_rate),
      heuresTravaillees:    parseFloat(hoursMap[row.square_id] || 0).toFixed(1),
      caNetGenere:          parseFloat(row.ca_net || 0).toFixed(2),
      commissionServices:   parseFloat(row.commission_services || 0).toFixed(2),
      commissionProduits:   parseFloat(row.commission_produits || 0).toFixed(2),
      pourboires:           parseFloat(row.pourboires || 0).toFixed(2),
      totalBrut:            parseFloat(row.total_brut || 0).toFixed(2),
      nbTransactions:       parseInt(row.nb_transactions || 0),
      nbPending:            parseInt(row.nb_pending || 0),
    }));

    const grandTotal = employees.reduce((s, e) => s + parseFloat(e.totalBrut), 0);

    bus.system(`[Payouts] Rapport quinzaine ${label}: ${employees.length} employés, total ${grandTotal.toFixed(2)} CAD`);

    return {
      tenantId, period: label, startDate: start.toISOString(), endDate: end.toISOString(),
      employees, grandTotal: grandTotal.toFixed(2), currency: 'CAD',
      generatedAt: new Date().toISOString(),
    };

  } catch (err) {
    bus.system(`[Payouts] Erreur rapport: ${err.message}`);
    return { error: err.message, tenantId, period: label };
  }
}

async function getPendingPayouts(pool, tenantId) {
  const r = await pool.query(`
    SELECT employee_square_id, employee_name, SUM(payout_amount) as total, COUNT(*) as count
    FROM staff_payouts WHERE tenant_id=$1 AND status='PENDING'
    GROUP BY employee_square_id, employee_name ORDER BY total DESC
  `, [tenantId]).catch(() => ({ rows: [] }));
  return r.rows;
}

async function markPaid(pool, tenantId, employeeSquareId) {
  const r = await pool.query(`
    UPDATE staff_payouts SET status='PAID', paid_at=NOW()
    WHERE tenant_id=$1 AND employee_square_id=$2 AND status='PENDING'
    RETURNING payout_amount
  `, [tenantId, employeeSquareId]).catch(() => ({ rows: [] }));
  const total = r.rows.reduce((s, p) => s + parseFloat(p.payout_amount), 0);
  bus.system(`[Payouts] ✅ Marqué PAID: ${employeeSquareId} | ${total.toFixed(2)} CAD`);
  return { paid: r.rowCount, total: total.toFixed(2) };
}

module.exports = { generateBiweeklyReport, getPendingPayouts, markPaid };
