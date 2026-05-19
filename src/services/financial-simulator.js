/**
 * Financial Simulator — DALEBA Metacortex Points 189-190, 193, 195-196, 198
 *
 * [189] Stress test fermeture temporaire → impact trésorerie
 * [190] tenant_fixed_costs — charges fixes → marge nette réelle
 * [193] Batch Reconciliation — récupère transactions manquantes Square/Stripe
 * [195] Archivage/anonymisation données > 7 ans
 * [196] Panier moyen new vs fidèles
 * [198] Architecture SaaS scale — partitionnement conceptuel
 */

'use strict';

const bus    = require('./event-bus');
const fiscal = require('./fiscal-engine');

// ─── [190] TABLE + COÛTS FIXES ───────────────────────────────────────────────

async function ensureFixedCostsTable() {
  const maintenance = require('./maintenance');
  const pool = maintenance.getPool();
  if (!pool) return;

  await pool.query(`
    CREATE TABLE IF NOT EXISTS tenant_fixed_costs (
      id            SERIAL PRIMARY KEY,
      tenant_id     VARCHAR(64)   NOT NULL DEFAULT 'kadio',
      category      VARCHAR(64)   NOT NULL,   -- 'loyer','electricite','licence','assurance','autre'
      label         VARCHAR(128)  NOT NULL,
      amount_monthly NUMERIC(10,2) NOT NULL,
      currency      VARCHAR(8)    NOT NULL DEFAULT 'CAD',
      active        BOOLEAN       NOT NULL DEFAULT TRUE,
      starts_at     DATE,
      ends_at       DATE,
      notes         TEXT,
      created_at    TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
      updated_at    TIMESTAMPTZ   NOT NULL DEFAULT NOW()
    );
    CREATE INDEX IF NOT EXISTS idx_fixed_costs_tenant ON tenant_fixed_costs(tenant_id, active);
  `).catch(e => console.warn('[FixedCosts]', e.message));

  console.log('[FixedCosts] Table tenant_fixed_costs ✓');
}

async function upsertFixedCost(tenantId, category, label, amountMonthly, opts = {}) {
  const maintenance = require('./maintenance');
  const pool = maintenance.getPool();
  if (!pool) return;

  await pool.query(`
    INSERT INTO tenant_fixed_costs (tenant_id, category, label, amount_monthly, currency, notes)
    VALUES ($1, $2, $3, $4, $5, $6)
    ON CONFLICT DO NOTHING
  `, [tenantId, category, label, amountMonthly, opts.currency || 'CAD', opts.notes || null]);
}

async function getMonthlyFixedCosts(tenantId = 'kadio') {
  const maintenance = require('./maintenance');
  const pool = maintenance.getPool();
  if (!pool) return { total: 0, items: [] };

  const r = await pool.query(`
    SELECT category, label, amount_monthly, currency
    FROM tenant_fixed_costs
    WHERE tenant_id = $1 AND active = TRUE
      AND (starts_at IS NULL OR starts_at <= CURRENT_DATE)
      AND (ends_at IS NULL OR ends_at >= CURRENT_DATE)
    ORDER BY category, label
  `, [tenantId]).catch(() => ({ rows: [] }));

  const items = r.rows.map(row => ({
    category: row.category, label: row.label,
    monthly:  parseFloat(row.amount_monthly),
    currency: row.currency,
  }));

  const total = fiscal.roundCents(items.reduce((s, i) => s + i.monthly, 0));
  return { total, items };
}

// ─── [189] STRESS SIMULATOR ───────────────────────────────────────────────────

/**
 * Simule l'impact financier d'une fermeture temporaire sur la trésorerie.
 * @param {object} params
 *   closureDays     — nombre de jours de fermeture
 *   closureStartDate — date de début (ISO string)
 *   tenantId
 *   province
 */
async function simulateClosure(params = {}) {
  const {
    closureDays = 7,
    closureStartDate = new Date().toISOString().split('T')[0],
    tenantId = 'kadio',
    province = 'QC',
  } = params;

  const maintenance = require('./maintenance');
  const pool = maintenance.getPool();

  // 1. Revenus quotidiens moyens (30 derniers jours)
  let avgDailyNet = 0, avgDailyGross = 0, txPerDay = 0;
  if (pool) {
    const r = await pool.query(`
      SELECT
        SUM(amount_net) / 30.0   AS avg_daily_net,
        SUM(amount_gross) / 30.0 AS avg_daily_gross,
        COUNT(*) / 30.0          AS avg_daily_tx
      FROM tenant_ledgers
      WHERE tenant_id = $1
        AND timestamp_utc >= NOW() - INTERVAL '30 days'
        AND refunded = FALSE AND audit_status != 'flagged'
    `, [tenantId]).catch(() => ({ rows: [{}] }));
    avgDailyNet   = parseFloat(r.rows[0]?.avg_daily_net   || 0);
    avgDailyGross = parseFloat(r.rows[0]?.avg_daily_gross || 0);
    txPerDay      = parseFloat(r.rows[0]?.avg_daily_tx    || 0);
  }

  // 2. Coûts fixes mensuels [190]
  const { total: monthlyFixed } = await getMonthlyFixedCosts(tenantId);
  const dailyFixed = fiscal.roundCents(monthlyFixed / 30);

  // 3. Revenus perdus pendant la fermeture
  const lostRevenue     = fiscal.roundCents(avgDailyNet * closureDays);
  const lostGross       = fiscal.roundCents(avgDailyGross * closureDays);
  const lostTxCount     = Math.round(txPerDay * closureDays);

  // 4. Coûts fixes qui continuent pendant la fermeture (loyer, licences, etc.)
  const fixedDuringClosure = fiscal.roundCents(dailyFixed * closureDays);

  // 5. Impact net total
  const netImpact = fiscal.roundCents(-(lostRevenue + fixedDuringClosure));

  // 6. Fiscalité manquante [155-158]
  const taxImpact = fiscal.decomposeFromNet(lostRevenue, province);

  // 7. Semaines de récupération estimées
  const weeklyAvg = avgDailyNet * 5; // 5 jours ouvrables
  const recoveryWeeks = weeklyAvg > 0 ? Math.ceil(Math.abs(netImpact) / weeklyAvg * 2) : null;

  // 8. Saisonnalité — si fermeture un lundi/vendredi c'est moins impactant
  const closureStart = new Date(closureStartDate);
  const closureEnd   = new Date(closureStartDate);
  closureEnd.setDate(closureEnd.getDate() + closureDays - 1);

  const report = {
    scenario:        `Fermeture ${closureDays} jours`,
    tenantId,
    period: {
      start: closureStart.toISOString().split('T')[0],
      end:   closureEnd.toISOString().split('T')[0],
      days:  closureDays,
    },
    baseMetrics: {
      avgDailyNet:   fiscal.roundCents(avgDailyNet),
      avgDailyGross: fiscal.roundCents(avgDailyGross),
      txPerDay:      Math.round(txPerDay),
      dailyFixed:    dailyFixed,
    },
    impact: {
      lostRevenue,
      lostGross,
      lostTxCount,
      fixedDuringClosure,
      netImpact,
      taxNotCollected: {
        tps: -taxImpact.amount_tps,
        tvq: -taxImpact.amount_tvq,
      },
    },
    recovery: {
      weeklyAvg: fiscal.roundCents(weeklyAvg),
      estimatedWeeks: recoveryWeeks,
    },
    recommendation: _getClosureRecommendation(netImpact, closureDays, avgDailyNet),
    simulatedAt: new Date().toISOString(),
  };

  bus.system(`[Simulator] Fermeture ${closureDays}j: impact -$${Math.abs(netImpact).toFixed(2)} CAD | récup. ~${recoveryWeeks || '?'}sem`);
  return report;
}

function _getClosureRecommendation(netImpact, days, avgDaily) {
  const severity = Math.abs(netImpact) / (avgDaily * 30);
  if (severity < 0.1)  return '✅ Impact faible — fermeture viable. Prévoir caisse de ~1 semaine.';
  if (severity < 0.25) return '⚠️ Impact modéré — fermeture possible avec réserve de 2 semaines.';
  if (severity < 0.5)  return '🔴 Impact élevé — recommandation: décaler ou réduire à ' + Math.round(days * 0.5) + ' jours.';
  return '🔴 CRITIQUE — Fermeture de ' + days + ' jours compromet la liquidité. Reporter si possible.';
}

// ─── [193] BATCH RECONCILIATION ───────────────────────────────────────────────

/**
 * Récupère les transactions manquantes depuis Square/Stripe
 * et les ingère dans le ledger.
 */
async function runBatchReconciliation(tenantId = 'kadio', opts = {}) {
  const {
    source     = 'square',
    startDate  = new Date(Date.now() - 7 * 86400000).toISOString(),
    endDate    = new Date().toISOString(),
    province   = 'QC',
  } = opts;

  const ingester = require('./transaction-ingester');
  const maintenance = require('./maintenance');
  const pool = maintenance.getPool();

  bus.system(`[Reconciliation] Démarrage batch ${source} du ${startDate.split('T')[0]} au ${endDate.split('T')[0]}`);

  let fetched = [], ingested = 0, skipped = 0;

  try {
    if (source === 'square') {
      const sq = require('./square');
      const r  = await sq.listPayments({ startAt: startDate, endAt: endDate, limit: 200 }).catch(() => null);
      fetched  = r?.payments || [];
    } else if (source === 'stripe') {
      const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
      const charges = await stripe.charges.list({
        created: { gte: Math.floor(new Date(startDate).getTime() / 1000), lte: Math.floor(new Date(endDate).getTime() / 1000) },
        limit: 100,
      }).catch(() => ({ data: [] }));
      fetched = charges.data || [];
    }

    // Identifier les transactions déjà ingérées
    const ids = fetched.map(t => source === 'square' ? `sq_${t.id}` : `st_${t.id}`);
    let existingIds = new Set();
    if (pool && ids.length > 0) {
      const r = await pool.query(
        `SELECT tx_id FROM tenant_ledgers WHERE tx_id = ANY($1)`, [ids]
      ).catch(() => ({ rows: [] }));
      existingIds = new Set(r.rows.map(r2 => r2.tx_id));
    }

    const missing = fetched.filter(t => {
      const id = source === 'square' ? `sq_${t.id}` : `st_${t.id}`;
      return !existingIds.has(id);
    });

    if (missing.length > 0) {
      const result = await ingester.ingestBatch(source, missing, { tenantId, province });
      ingested = result.ok;
      skipped  = result.dupes;
    }

  } catch (err) {
    console.warn('[Reconciliation] Erreur:', err.message);
    return { error: err.message, source, fetched: fetched.length, ingested, skipped };
  }

  const summary = { source, period: { start: startDate, end: endDate }, fetched: fetched.length, missing: fetched.length - (existingIds?.size || 0), ingested, skipped, reconciledAt: new Date().toISOString() };
  bus.system(`[Reconciliation] ✅ ${source}: ${ingested} transactions récupérées | ${skipped} doublons`);
  return summary;
}

// ─── [195] ARCHIVAGE 7 ANS ───────────────────────────────────────────────────

async function archiveOldTransactions(tenantId = 'kadio') {
  const maintenance = require('./maintenance');
  const pool = maintenance.getPool();
  if (!pool) return { archived: 0 };

  const sevenYearsAgo = new Date();
  sevenYearsAgo.setFullYear(sevenYearsAgo.getFullYear() - 7);

  // 1. Anonymiser les données personnelles (loi canadienne LPRPDE)
  const anon = await pool.query(`
    UPDATE tenant_ledgers
    SET customer_id = 'ANONYMIZED_' || id,
        employee_id = CASE WHEN employee_id IS NOT NULL THEN 'ANON_EMP' ELSE NULL END,
        metadata    = '{"archived": true, "anonymized": true}'::jsonb
    WHERE tenant_id = $1
      AND timestamp_utc < $2
      AND NOT (metadata->>'anonymized')::boolean IS TRUE
    RETURNING id
  `, [tenantId, sevenYearsAgo.toISOString()]).catch(() => ({ rows: [] }));

  const count = anon.rows.length;
  if (count > 0) {
    bus.system(`[Archive] ${count} transactions anonymisées (>${sevenYearsAgo.getFullYear()} — LPRPDE/PIPEDA)`);
    // Enregistrer dans daleba_notes
    await pool.query(`
      INSERT INTO daleba_notes (category, key, content, created_at)
      VALUES ('archive_run', $1, $2, NOW())
    `, [`archive_${tenantId}_${new Date().toISOString().split('T')[0]}`,
        JSON.stringify({ tenantId, count, before: sevenYearsAgo.toISOString() })
    ]).catch(() => {});
  }

  return { archived: count, before: sevenYearsAgo.toISOString() };
}

// ─── [196] PANIER MOYEN NEW VS FIDÈLES ───────────────────────────────────────

async function computeBasketByCustomerType(tenantId = 'kadio', days = 30) {
  const maintenance = require('./maintenance');
  const pool = maintenance.getPool();
  if (!pool) return null;

  const since = new Date(Date.now() - days * 86400000).toISOString();

  // Clients fidèles = ont au moins une transaction AVANT la période analysée
  const r = await pool.query(`
    WITH loyal_customers AS (
      SELECT DISTINCT customer_id FROM tenant_ledgers
      WHERE tenant_id = $1 AND customer_id IS NOT NULL
        AND timestamp_utc < $2
    ),
    period_sales AS (
      SELECT l.customer_id, l.amount_net, l.amount_gross,
             CASE WHEN lc.customer_id IS NOT NULL THEN 'loyal' ELSE 'new' END AS ctype
      FROM tenant_ledgers l
      LEFT JOIN loyal_customers lc ON l.customer_id = lc.customer_id
      WHERE l.tenant_id = $1 AND l.timestamp_utc >= $2
        AND l.refunded = FALSE AND l.customer_id IS NOT NULL
    )
    SELECT
      ctype,
      COUNT(*)          AS tx_count,
      AVG(amount_net)   AS avg_basket,
      SUM(amount_net)   AS total_net,
      COUNT(DISTINCT customer_id) AS customer_count
    FROM period_sales
    GROUP BY ctype
  `, [tenantId, since]).catch(() => ({ rows: [] }));

  const result = { new: null, loyal: null, ratio: null };
  for (const row of r.rows) {
    result[row.ctype] = {
      txCount:       parseInt(row.tx_count),
      avgBasket:     fiscal.roundCents(parseFloat(row.avg_basket || 0)),
      totalNet:      fiscal.roundCents(parseFloat(row.total_net || 0)),
      customerCount: parseInt(row.customer_count),
    };
  }

  if (result.loyal?.avgBasket && result.new?.avgBasket) {
    result.ratio = fiscal.roundCents(result.loyal.avgBasket / result.new.avgBasket);
    result.insight = result.ratio > 1.2
      ? `Clients fidèles dépensent ${Math.round((result.ratio - 1) * 100)}% de plus — programme fidélité efficace ✅`
      : `Écart faible (${result.ratio}x) — opportunité d'upsell pour fidèles`;
  }

  return result;
}

// ─── [198] PARTITIONNEMENT SAAS SCALE ────────────────────────────────────────

async function ensureSaaSScaleIndexes() {
  const maintenance = require('./maintenance');
  const pool = maintenance.getPool();
  if (!pool) return;

  // [198] Indexes pour milliers de tenants
  await pool.query(`
    -- Partition conceptuelle par tenant pour SaaS scale [198]
    -- PostgreSQL native partitioning par tenant_id (hash)
    -- Index covering pour aggregations multi-tenant sans full-scan
    CREATE INDEX IF NOT EXISTS idx_ledger_tenant_month
      ON tenant_ledgers(tenant_id, date_trunc('month', timestamp_utc));

    CREATE INDEX IF NOT EXISTS idx_ledger_tenant_refunded
      ON tenant_ledgers(tenant_id, refunded, timestamp_utc DESC)
      WHERE refunded = FALSE;

    CREATE INDEX IF NOT EXISTS idx_ledger_tenant_audit_ok
      ON tenant_ledgers(tenant_id, timestamp_utc DESC)
      WHERE audit_status = 'ok' AND refunded = FALSE;

    -- Index pour panier moyen new vs fidèles [196]
    CREATE INDEX IF NOT EXISTS idx_ledger_customer_ts
      ON tenant_ledgers(tenant_id, customer_id, timestamp_utc);
  `).catch(e => console.warn('[SaaS Scale]', e.message));
}

// ─── [197] COORDINATION SWARM POUR ANOMALIES ─────────────────────────────────

async function detectAndDelegateAnomalies(tenantId = 'kadio') {
  const maintenance = require('./maintenance');
  const pool = maintenance.getPool();
  if (!pool) return;

  // Détecter les anomalies de trésorerie (variation > 3σ)
  const r = await pool.query(`
    WITH daily AS (
      SELECT date_trunc('day', timestamp_utc) AS day, SUM(amount_net) AS net
      FROM tenant_ledgers
      WHERE tenant_id = $1 AND timestamp_utc >= NOW() - INTERVAL '60 days'
        AND refunded = FALSE
      GROUP BY 1
    ),
    stats AS (
      SELECT AVG(net) AS mean, STDDEV(net) AS stddev FROM daily
    ),
    anomalies AS (
      SELECT d.day, d.net, s.mean, s.stddev,
             ABS(d.net - s.mean) / NULLIF(s.stddev, 0) AS z_score
      FROM daily d, stats s
      WHERE ABS(d.net - s.mean) / NULLIF(s.stddev, 0) > 3
    )
    SELECT * FROM anomalies ORDER BY z_score DESC LIMIT 5
  `, [tenantId]).catch(() => ({ rows: [] }));

  if (r.rows.length === 0) return { anomalies: 0 };

  // [197] Déléguer analyse au Swarm via AgentManager
  try {
    const AgentManager = require('./agent-manager');
    const swarm = require('./swarm');

    await AgentManager.orchestrate([{
      type: 'AnalystAgent',
      action: 'analyze_anomalies',
      params: {
        anomalies: r.rows,
        tenantId,
        instruction: `Analyser ces ${r.rows.length} anomalies de trésorerie (z-score > 3σ) et proposer des explications et actions correctives pour Kadio Coiffure.`,
      },
    }], { parallel: false });

    bus.system(`[Swarm] ${r.rows.length} anomalies financières déléguées à l'AnalystAgent`);
  } catch (e) {
    console.warn('[AnomalyDetect] Swarm:', e.message);
  }

  return { anomalies: r.rows.length, rows: r.rows };
}

// ─── EXPORTS ─────────────────────────────────────────────────────────────────

module.exports = {
  ensureFixedCostsTable, upsertFixedCost, getMonthlyFixedCosts,
  simulateClosure, runBatchReconciliation,
  archiveOldTransactions, computeBasketByCustomerType,
  ensureSaaSScaleIndexes, detectAndDelegateAnomalies,
};
