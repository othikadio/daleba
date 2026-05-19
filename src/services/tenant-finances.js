/**
 * DALEBA V26 — Comptabilité Autonome par Tenant
 * Table tenant_finances: centralise Square + Stripe par business ID
 * Calcul automatisé des taxes locales (TPS/TVQ Canada, TVA France/Europe)
 */

const bus = require('./event-bus');

// ─── TAUX DE TAXES PAR PAYS/PROVINCE ─────────────────────────────────────────

const TAX_RATES = {
  // Canada — fédéral (TPS) + provincial (TVQ/TVH/PST)
  CA_QC: { label: 'TPS + TVQ',   federal: 0.05, provincial: 0.09975, total: 0.14975, currency: 'CAD' },
  CA_ON: { label: 'TVH Ontario', federal: 0.13, provincial: 0,       total: 0.13,    currency: 'CAD' },
  CA_BC: { label: 'TPS + PST',   federal: 0.05, provincial: 0.07,    total: 0.12,    currency: 'CAD' },
  CA_AB: { label: 'TPS Alberta', federal: 0.05, provincial: 0,       total: 0.05,    currency: 'CAD' },
  CA:    { label: 'TPS',         federal: 0.05, provincial: 0,       total: 0.05,    currency: 'CAD' },
  // Europe
  FR:    { label: 'TVA France',  federal: 0.20, provincial: 0,       total: 0.20,    currency: 'EUR' },
  BE:    { label: 'TVA Belgique',federal: 0.21, provincial: 0,       total: 0.21,    currency: 'EUR' },
  CH:    { label: 'TVA Suisse',  federal: 0.077,provincial: 0,       total: 0.077,   currency: 'CHF' },
  // Afrique
  SN:    { label: 'TVA Sénégal', federal: 0.18, provincial: 0,       total: 0.18,    currency: 'XOF' },
  CI:    { label: "TVA Côte d'Ivoire", federal: 0.18, provincial: 0, total: 0.18,    currency: 'XOF' },
  // USA
  US:    { label: 'Sales Tax',   federal: 0,    provincial: 0.08,    total: 0.08,    currency: 'USD' }, // moyenne estimée
};

function getTaxRate(countryCode = 'CA', province = null) {
  const key = province ? `${countryCode}_${province}` : countryCode;
  return TAX_RATES[key] || TAX_RATES[countryCode] || TAX_RATES['CA'];
}

// ─── INITIALISATION TABLE ────────────────────────────────────────────────────

async function initFinancesTable() {
  const { pool, DEMO_MODE } = require('../memory/db');
  if (DEMO_MODE || !pool) return;

  await pool.query(`
    CREATE TABLE IF NOT EXISTS tenant_finances (
      id            SERIAL PRIMARY KEY,
      tenant_id     VARCHAR(64) NOT NULL DEFAULT 'kadio',
      source        VARCHAR(32) NOT NULL,           -- 'square' | 'stripe' | 'manual'
      transaction_id VARCHAR(128),
      amount_gross  NUMERIC(10,2) NOT NULL DEFAULT 0,
      amount_net    NUMERIC(10,2) NOT NULL DEFAULT 0,
      tax_amount    NUMERIC(10,2) NOT NULL DEFAULT 0,
      tax_rate      NUMERIC(6,5)  NOT NULL DEFAULT 0,
      tax_label     VARCHAR(64),
      currency      VARCHAR(8)    NOT NULL DEFAULT 'CAD',
      country_code  VARCHAR(8)    NOT NULL DEFAULT 'CA',
      province_code VARCHAR(8),
      description   VARCHAR(256),
      category      VARCHAR(64),                    -- 'service' | 'product' | 'subscription'
      customer_id   VARCHAR(128),
      payment_date  TIMESTAMPTZ,
      created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      metadata      JSONB DEFAULT '{}'
    );

    CREATE INDEX IF NOT EXISTS idx_tenant_finances_tenant  ON tenant_finances(tenant_id);
    CREATE INDEX IF NOT EXISTS idx_tenant_finances_date    ON tenant_finances(payment_date);
    CREATE INDEX IF NOT EXISTS idx_tenant_finances_source  ON tenant_finances(source);
  `);

  bus.system('[FINANCES] Table tenant_finances initialisée ✓');
}

// ─── INGESTION SQUARE ────────────────────────────────────────────────────────

/**
 * Importe les paiements Square dans tenant_finances
 * @param {string} tenantId
 * @param {string} startAt ISO date
 * @param {string} endAt   ISO date
 * @param {string} countryCode
 * @param {string} province
 */
async function ingestSquarePayments(tenantId = 'kadio', startAt, endAt, countryCode = 'CA', province = 'QC') {
  const { pool, DEMO_MODE } = require('../memory/db');
  const taxRate = getTaxRate(countryCode, province);

  let ingested = 0;
  let totalGross = 0;

  try {
    const square = require('./square');
    const { payments = [] } = await square.getPayments(startAt, endAt);

    for (const p of payments) {
      const amountGross = (p.amount_money?.amount || 0) / 100;
      const amountNet   = +(amountGross / (1 + taxRate.total)).toFixed(2);
      const taxAmount   = +(amountGross - amountNet).toFixed(2);

      if (!DEMO_MODE && pool) {
        await pool.query(`
          INSERT INTO tenant_finances
            (tenant_id, source, transaction_id, amount_gross, amount_net, tax_amount,
             tax_rate, tax_label, currency, country_code, province_code,
             description, category, customer_id, payment_date, metadata)
          VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16)
          ON CONFLICT DO NOTHING
        `, [
          tenantId, 'square', p.id,
          amountGross, amountNet, taxAmount,
          taxRate.total, taxRate.label, taxRate.currency,
          countryCode, province || null,
          p.note || 'Paiement Square', 'service',
          p.customer_id || null,
          p.created_at || new Date().toISOString(),
          JSON.stringify({ squarePayment: p.id, status: p.status }),
        ]);
      }

      ingested++;
      totalGross += amountGross;
    }

    bus.system(`[FINANCES] Square ingest: ${ingested} paiements — ${totalGross.toFixed(2)} ${taxRate.currency} brut`);
    return { ingested, totalGross, taxRate };

  } catch (err) {
    bus.system(`[FINANCES] Erreur Square ingest: ${err.message}`);
    return { ingested: 0, totalGross: 0, error: err.message };
  }
}

// ─── RAPPORT FINANCIER TENANT ────────────────────────────────────────────────

/**
 * Génère un rapport financier complet pour un tenant
 * @param {string} tenantId
 * @param {string} period — 'day' | 'week' | 'month' | 'year'
 */
async function getTenantFinancialReport(tenantId = 'kadio', period = 'month') {
  const { pool, DEMO_MODE } = require('../memory/db');

  const intervals = { day: '1 day', week: '7 days', month: '30 days', year: '365 days' };
  const interval  = intervals[period] || intervals.month;

  if (DEMO_MODE || !pool) {
    // Données démo
    return buildDemoReport(tenantId, period);
  }

  try {
    const r = await pool.query(`
      SELECT
        COUNT(*)                          AS transaction_count,
        SUM(amount_gross)                 AS total_gross,
        SUM(amount_net)                   AS total_net,
        SUM(tax_amount)                   AS total_tax,
        AVG(amount_gross)                 AS avg_transaction,
        MAX(amount_gross)                 AS max_transaction,
        currency,
        tax_label,
        source
      FROM tenant_finances
      WHERE tenant_id = $1
        AND payment_date >= NOW() - INTERVAL '${interval}'
      GROUP BY currency, tax_label, source
      ORDER BY total_gross DESC
    `, [tenantId]);

    // Série temporelle journalière
    const ts = await pool.query(`
      SELECT
        DATE(payment_date) AS day,
        SUM(amount_gross)  AS gross,
        SUM(amount_net)    AS net,
        COUNT(*)           AS count
      FROM tenant_finances
      WHERE tenant_id = $1
        AND payment_date >= NOW() - INTERVAL '${interval}'
      GROUP BY DATE(payment_date)
      ORDER BY day ASC
    `, [tenantId]);

    const rows = r.rows;
    const totalGross = rows.reduce((s, r) => s + parseFloat(r.total_gross || 0), 0);
    const totalNet   = rows.reduce((s, r) => s + parseFloat(r.total_net   || 0), 0);
    const totalTax   = rows.reduce((s, r) => s + parseFloat(r.total_tax   || 0), 0);

    return {
      tenantId,
      period,
      summary: {
        totalGross:   +totalGross.toFixed(2),
        totalNet:     +totalNet.toFixed(2),
        totalTax:     +totalTax.toFixed(2),
        transactions: rows.reduce((s, r) => s + parseInt(r.transaction_count || 0), 0),
        currency:     rows[0]?.currency || 'CAD',
        taxLabel:     rows[0]?.tax_label || 'TPS+TVQ',
      },
      bySource:     rows,
      timeSeries:   ts.rows,
      generatedAt:  new Date().toISOString(),
    };
  } catch (err) {
    bus.system(`[FINANCES] Erreur rapport: ${err.message}`);
    return buildDemoReport(tenantId, period);
  }
}

function buildDemoReport(tenantId, period) {
  const base = period === 'day' ? 450 : period === 'week' ? 2100 : period === 'month' ? 8400 : 98000;
  const tax  = +(base * 0.14975).toFixed(2);
  return {
    tenantId,
    period,
    demo: true,
    summary: {
      totalGross:   +(base + tax).toFixed(2),
      totalNet:     base,
      totalTax:     tax,
      transactions: period === 'day' ? 6 : period === 'week' ? 28 : 112,
      currency:     'CAD',
      taxLabel:     'TPS+TVQ (Québec)',
    },
    timeSeries: [],
    generatedAt: new Date().toISOString(),
  };
}

// ─── SYNC AUTOMATIQUE ────────────────────────────────────────────────────────

async function runDailyFinanceSync(tenantId = 'kadio', countryCode = 'CA', province = 'QC') {
  bus.system('[FINANCES] Sync financière quotidienne...');
  await initFinancesTable().catch(() => {});

  const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  const now = new Date().toISOString();

  const result = await ingestSquarePayments(tenantId, yesterday, now, countryCode, province);
  bus.system(`[FINANCES] Sync terminée: ${result.ingested} tx — ${result.totalGross?.toFixed(2)} CAD`);
  return result;
}

module.exports = {
  initFinancesTable,
  ingestSquarePayments,
  getTenantFinancialReport,
  runDailyFinanceSync,
  getTaxRate,
  TAX_RATES,
};
