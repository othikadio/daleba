'use strict';
/**
 * Tax Formulator — DALEBA [552]
 * Calcul TPS/TVQ Québec à la précision du cent.
 * Toutes les opérations en centimes entiers pour éviter la dérive flottante.
 */
const bus = require('./event-bus');

// Taux officiels Canada/Québec 2024
const GST_RATE  = 0.05;        // TPS fédérale 5%
const QST_RATE  = 0.09975;     // TVQ Québec 9.975%
const COMBINED  = 1 + GST_RATE + QST_RATE; // 1.14975

/**
 * [552] Extrait le montant net HT depuis un montant TTC
 * Calcul en cents pour précision absolue
 */
function extractNetFromTTC(amountTTC_CAD) {
  const ttcCents    = Math.round(amountTTC_CAD * 100);
  const netCents    = Math.round(ttcCents / COMBINED);
  const gstCents    = Math.round(netCents * GST_RATE);
  const qstCents    = Math.round(netCents * QST_RATE);
  return {
    ttcCAD:   ttcCents / 100,
    netCAD:   netCents / 100,
    gstCAD:   gstCents / 100,
    qstCAD:   qstCents / 100,
    totalTaxCAD: (gstCents + qstCents) / 100,
    // Vérification d'intégrité
    checkTTC: (netCents + gstCents + qstCents) / 100,
  };
}

/**
 * [552] Calcul trimestriel TPS/TVQ
 * Entrée: ventes TTC + achats ITC (TTC)
 */
async function computeQuarterlyTaxes(pool, tenantId, { grossSalesTTC, suppliesPurchasesTTC, quarterStart, quarterEnd } = {}) {
  // Récupère depuis tenant_ledgers si pas de valeurs explicites
  if (!grossSalesTTC) {
    const r = await pool.query(`
      SELECT SUM(amount_net * 1.14975) AS total_ttc
      FROM tenant_ledgers WHERE tenant_id=$1
      ${quarterStart ? 'AND created_at >= $2 AND created_at <= $3' : ''}
    `, quarterStart ? [tenantId, quarterStart, quarterEnd] : [tenantId]).catch(() => ({ rows:[{}] }));
    grossSalesTTC = parseFloat(r.rows[0]?.total_ttc || 0);
  }
  if (!suppliesPurchasesTTC) {
    const r = await pool.query(`
      SELECT SUM(amount * 1.14975) AS total_ttc
      FROM tenant_expenses WHERE tenant_id=$1 AND category='botanical_supplies'
      ${quarterStart ? 'AND created_at >= $2 AND created_at <= $3' : ''}
    `, quarterStart ? [tenantId, quarterStart, quarterEnd] : [tenantId]).catch(() => ({ rows:[{}] }));
    suppliesPurchasesTTC = parseFloat(r.rows[0]?.total_ttc || 0);
  }

  // VENTES: extraction TTC → net + taxes collectées
  const sales = extractNetFromTTC(grossSalesTTC);

  // ACHATS (ITC/ITR): extraction TTC → taxes récupérables
  const supplies = extractNetFromTTC(suppliesPurchasesTTC);

  // REMISES NETTES (en cents pour précision)
  const gstRemittanceCents = Math.round(sales.gstCAD * 100) - Math.round(supplies.gstCAD * 100);
  const qstRemittanceCents = Math.round(sales.qstCAD * 100) - Math.round(supplies.qstCAD * 100);
  const totalRemittanceCents = gstRemittanceCents + qstRemittanceCents;

  const result = {
    tenantId,
    period: { start: quarterStart || 'all_time', end: quarterEnd || 'now' },
    sales: {
      grossTTC:  sales.ttcCAD,
      netHT:     sales.netCAD,
      gstCollected: sales.gstCAD,
      qstCollected: sales.qstCAD,
    },
    supplies: {
      grossTTC:   supplies.ttcCAD,
      netHT:      supplies.netCAD,
      gstClaimable: supplies.gstCAD,
      qstClaimable: supplies.qstCAD,
    },
    remittance: {
      gstNet:   gstRemittanceCents / 100,
      qstNet:   qstRemittanceCents / 100,
      totalDue: totalRemittanceCents / 100,
    },
    computedAt: new Date().toISOString(),
    precision: 'integer_cents',
  };
  bus.system(`[TaxFormulator] 🧾 Trimestre: ventes ${sales.netCAD}$ net | TPS due ${result.remittance.gstNet}$ | TVQ due ${result.remittance.qstNet}$`);
  return result;
}

async function getTaxSummary(pool, tenantId, params) {
  return computeQuarterlyTaxes(pool, tenantId, params);
}

async function getITCITR(pool, tenantId, { quarterStart, quarterEnd } = {}) {
  const r = await pool.query(`
    SELECT category, SUM(amount) AS total_ht, SUM(amount * 1.14975) AS total_ttc
    FROM tenant_expenses WHERE tenant_id=$1
    ${quarterStart ? 'AND created_at >= $2 AND created_at <= $3' : ''}
    GROUP BY category
  `, quarterStart ? [tenantId, quarterStart, quarterEnd] : [tenantId]).catch(() => ({ rows:[] }));

  const itcs = r.rows.map(row => {
    const net = parseFloat(row.total_ht || 0);
    return {
      category: row.category,
      netHT:    net,
      gstClaimable: Math.round(net * GST_RATE * 100) / 100,
      qstClaimable: Math.round(net * QST_RATE * 100) / 100,
    };
  });
  const totalGSTClaimable = itcs.reduce((s,i) => s + i.gstClaimable, 0);
  const totalQSTClaimable = itcs.reduce((s,i) => s + i.qstClaimable, 0);
  return { itcs, totalGSTClaimable: Math.round(totalGSTClaimable*100)/100, totalQSTClaimable: Math.round(totalQSTClaimable*100)/100 };
}

async function categorizeExpenses(pool, tenantId, { entries = [] }) {
  const CATEGORIES = {
    'chebe|moringa|argan|fakoye|baobab|aloe|hibiscus|jojoba': 'botanical_supplies',
    'loyer|local|bail':       'rent',
    'électricité|eau|gaz':   'utilities',
    'salaire|paie|payroll':  'payroll',
    'équipement|matériel':   'equipment',
    'logiciel|abonnement':   'software',
    'publicité|ads|marketing': 'marketing',
  };
  return entries.map(e => {
    const desc = (e.description || '').toLowerCase();
    for (const [pattern, cat] of Object.entries(CATEGORIES)) {
      if (new RegExp(pattern).test(desc)) return { ...e, category: cat };
    }
    return { ...e, category: 'other' };
  });
}

module.exports = { computeQuarterlyTaxes, getTaxSummary, getITCITR, categorizeExpenses, extractNetFromTTC, GST_RATE, QST_RATE, COMBINED };
