/**
 * Transaction Ingester — DALEBA Metacortex Points 152-163
 *
 * [152] Webhook universel Square + Stripe simultanés
 * [153-154] Unified Transaction Object (UTO)
 * [158-160] Ventilation fiscale + table tenant_ledgers (UNIQUE tx_id)
 * [161-162] Audit Shield — comparaison prix catalogue
 * [163] Tips séparés → table staff_tips
 */

'use strict';

const bus       = require('./event-bus');
const fiscal    = require('./fiscal-engine');

// ─── SCHÉMA UTO [153-154] ────────────────────────────────────────────────────

/**
 * Unified Transaction Object
 * Champs obligatoires [154]:
 *   tenant_id, tx_id, amount_gross, currency, payment_mode,
 *   timestamp_utc, sale_type
 */
function buildUTO(source, raw, tenantId = 'kadio') {
  if (source === 'square') return _buildUTOFromSquare(raw, tenantId);
  if (source === 'stripe') return _buildUTOFromStripe(raw, tenantId);
  throw new Error(`[UTO] Source inconnue: ${source}`);
}

function _buildUTOFromSquare(payment, tenantId) {
  // Square paiement: montant en CENTS
  const grossCents = payment.amount_money?.amount || payment.total_money?.amount || 0;
  const tipCents   = payment.tip_money?.amount || 0;
  const grossAmount = fiscal.roundCents(grossCents / 100);
  const tipAmount   = fiscal.roundCents(tipCents / 100);

  // Déduire le tip du montant brut (tip non soumis aux taxes de service)
  const taxableGross = fiscal.roundCents(grossAmount - tipAmount);

  return {
    tenant_id:     tenantId,
    tx_id:         `sq_${payment.id}`,
    source:        'square',
    amount_gross:  grossAmount,
    amount_taxable: taxableGross,
    amount_tip:    tipAmount,
    currency:      (payment.amount_money?.currency || 'CAD').toUpperCase(),
    payment_mode:  _squarePaymentMode(payment),
    timestamp_utc: payment.created_at
      ? new Date(payment.created_at).toISOString()
      : new Date().toISOString(),
    sale_type:     _squareSaleType(payment),
    customer_id:   payment.customer_id || null,
    employee_id:   payment.employee_id || null,
    catalog_id:    payment.catalog_object_id || null,
    order_id:      payment.order_id || null,
    location_id:   payment.location_id || null,
    raw_ref:       payment.id,
    _raw:          payment, // pour Audit Shield [161]
  };
}

function _buildUTOFromStripe(charge, tenantId) {
  const grossAmount = fiscal.roundCents((charge.amount || 0) / 100);
  const tipMeta     = charge.metadata?.tip ? parseFloat(charge.metadata.tip) : 0;
  const taxableGross = fiscal.roundCents(grossAmount - tipMeta);

  return {
    tenant_id:     tenantId,
    tx_id:         `st_${charge.id}`,
    source:        'stripe',
    amount_gross:  grossAmount,
    amount_taxable: taxableGross,
    amount_tip:    fiscal.roundCents(tipMeta),
    currency:      (charge.currency || 'cad').toUpperCase(),
    payment_mode:  _stripePaymentMode(charge),
    timestamp_utc: charge.created
      ? new Date(charge.created * 1000).toISOString()
      : new Date().toISOString(),
    sale_type:     charge.metadata?.sale_type || 'service',
    customer_id:   charge.customer || null,
    employee_id:   charge.metadata?.employee_id || null,
    catalog_id:    charge.metadata?.catalog_id || null,
    raw_ref:       charge.id,
    _raw:          charge,
  };
}

function _squarePaymentMode(p) {
  const cardBrand = p.card_details?.card?.card_brand;
  if (cardBrand) return `card:${cardBrand.toLowerCase()}`;
  if (p.cash_details) return 'cash';
  if (p.external_details?.type) return `external:${p.external_details.type.toLowerCase()}`;
  return 'card:unknown';
}

function _squareSaleType(p) {
  // Heuristique : si note contient "produit"/"product" → product, sinon service
  const note = (p.note || '').toLowerCase();
  if (note.includes('produit') || note.includes('product') || note.includes('shampoo') || note.includes('soins'))
    return 'product';
  return 'service';
}

function _stripePaymentMode(c) {
  if (c.payment_method_details?.card) return `card:${c.payment_method_details.card.brand}`;
  if (c.payment_method_details?.type) return c.payment_method_details.type;
  return 'card:unknown';
}

// ─── AUDIT SHIELD [161-162] ───────────────────────────────────────────────────

/**
 * Compare le montant de la transaction avec le prix catalogue Square.
 * Retourne { status: 'ok'|'flagged', delta, reason }
 */
async function auditShield(uto) {
  if (!uto.catalog_id) return { status: 'ok', reason: 'no_catalog_ref' };

  // Récupérer le prix catalogue depuis l'API Square
  try {
    const square = require('./square');
    const item = await square.getCatalogItem(uto.catalog_id).catch(() => null);
    if (!item) return { status: 'ok', reason: 'catalog_not_found' };

    const catalogPriceCents = item.item_data?.variations?.[0]?.item_variation_data?.price_money?.amount || 0;
    const catalogPrice = fiscal.roundCents(catalogPriceCents / 100);
    const delta = fiscal.roundCents(Math.abs(uto.amount_taxable - catalogPrice));

    // [162] Écart > 0.01$ → FLAGGED
    if (delta > 0.01) {
      const report = {
        tx_id:         uto.tx_id,
        catalog_id:    uto.catalog_id,
        catalog_price: catalogPrice,
        charged_price: uto.amount_taxable,
        delta,
        direction:     uto.amount_taxable > catalogPrice ? 'OVERCHARGE' : 'DISCOUNT_NON_AUTORISE',
        tenant_id:     uto.tenant_id,
        flagged_at:    new Date().toISOString(),
      };

      // [162] Rapport sur le HUD
      bus.system(`⚠️ AUDIT_SHIELD FLAGGED — Écart $${delta.toFixed(2)} sur ${uto.tx_id} (catalogue: $${catalogPrice} | facturé: $${uto.amount_taxable})`);

      return { status: 'flagged', delta, report, reason: report.direction };
    }

    return { status: 'ok', delta, reason: 'price_match' };
  } catch (err) {
    return { status: 'ok', reason: `audit_error: ${err.message}` };
  }
}

// ─── DB — INITIALISATION TABLES [158-160, 163] ───────────────────────────────

async function ensureTables() {
  const maintenance = require('./maintenance');
  const pool = maintenance.getPool();
  if (!pool) return;

  // [158, 160] tenant_ledgers — ventilation fiscale + UNIQUE tx_id
  await pool.query(`
    CREATE TABLE IF NOT EXISTS tenant_ledgers (
      id             SERIAL PRIMARY KEY,
      tenant_id      VARCHAR(64)   NOT NULL DEFAULT 'kadio',
      tx_id          VARCHAR(128)  NOT NULL,
      source         VARCHAR(32)   NOT NULL,

      -- [154] Champs UTO obligatoires
      amount_gross   NUMERIC(10,2) NOT NULL,
      currency       VARCHAR(8)    NOT NULL DEFAULT 'CAD',
      payment_mode   VARCHAR(64),
      timestamp_utc  TIMESTAMPTZ   NOT NULL,
      sale_type      VARCHAR(32)   NOT NULL DEFAULT 'service',

      -- [158] Ventilation fiscale
      amount_net     NUMERIC(10,2) NOT NULL,
      amount_tps     NUMERIC(10,2) NOT NULL DEFAULT 0,
      amount_tvq     NUMERIC(10,2) NOT NULL DEFAULT 0,
      province_code  VARCHAR(8)    NOT NULL DEFAULT 'QC',
      tax_label      VARCHAR(32),

      -- Extras
      amount_tip     NUMERIC(10,2) NOT NULL DEFAULT 0,
      customer_id    VARCHAR(128),
      employee_id    VARCHAR(128),
      catalog_id     VARCHAR(128),
      order_id       VARCHAR(128),
      audit_status   VARCHAR(16)   NOT NULL DEFAULT 'ok',
      audit_delta    NUMERIC(8,2),
      audit_reason   VARCHAR(64),
      metadata       JSONB         NOT NULL DEFAULT '{}',
      created_at     TIMESTAMPTZ   NOT NULL DEFAULT NOW(),

      -- [160] Anti double-comptage
      CONSTRAINT uq_tenant_ledger_tx UNIQUE(tx_id)
    );

    CREATE INDEX IF NOT EXISTS idx_ledger_tenant    ON tenant_ledgers(tenant_id);
    CREATE INDEX IF NOT EXISTS idx_ledger_ts        ON tenant_ledgers(timestamp_utc DESC);
    CREATE INDEX IF NOT EXISTS idx_ledger_source    ON tenant_ledgers(source);
    CREATE INDEX IF NOT EXISTS idx_ledger_audit     ON tenant_ledgers(audit_status);
    CREATE INDEX IF NOT EXISTS idx_ledger_sale_type ON tenant_ledgers(sale_type);
  `);

  // [163] staff_tips — pourboires par employé
  await pool.query(`
    CREATE TABLE IF NOT EXISTS staff_tips (
      id            SERIAL PRIMARY KEY,
      tenant_id     VARCHAR(64)   NOT NULL DEFAULT 'kadio',
      tx_id         VARCHAR(128)  NOT NULL,
      employee_id   VARCHAR(128)  NOT NULL,
      tip_amount    NUMERIC(10,2) NOT NULL,
      currency      VARCHAR(8)    NOT NULL DEFAULT 'CAD',
      timestamp_utc TIMESTAMPTZ   NOT NULL,
      created_at    TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
      CONSTRAINT uq_staff_tips_tx UNIQUE(tx_id, employee_id)
    );

    CREATE INDEX IF NOT EXISTS idx_tips_employee ON staff_tips(employee_id);
    CREATE INDEX IF NOT EXISTS idx_tips_tenant   ON staff_tips(tenant_id);
    CREATE INDEX IF NOT EXISTS idx_tips_ts       ON staff_tips(timestamp_utc DESC);
  `);

  console.log('[TransactionIngester] Tables tenant_ledgers + staff_tips ✓');
}

// ─── INGESTION PRINCIPALE [152-163] ───────────────────────────────────────────

/**
 * Ingère une transaction brute (Square ou Stripe) dans le ledger
 * @param {string} source  — 'square' | 'stripe'
 * @param {object} rawTx   — objet brut de l'API
 * @param {object} opts    — { tenantId, province }
 * @returns {object}       — { uto, fiscal, audit, ledgerId }
 */
async function ingestTransaction(source, rawTx, opts = {}) {
  const { tenantId = 'kadio', province = 'QC' } = opts;
  const maintenance = require('./maintenance');
  const pool = maintenance.getPool();

  // [153-154] Build UTO
  const uto = buildUTO(source, rawTx, tenantId);

  // [155-158] Ventilation fiscale
  const fiscalBreakdown = fiscal.decomposeFromGross(uto.amount_taxable, province);

  // [161-162] Audit Shield
  const audit = await auditShield(uto);

  // [160] INSERT avec protection UNIQUE
  let ledgerId = null;
  if (pool) {
    const insertResult = await pool.query(`
      INSERT INTO tenant_ledgers (
        tenant_id, tx_id, source,
        amount_gross, currency, payment_mode, timestamp_utc, sale_type,
        amount_net, amount_tps, amount_tvq, province_code, tax_label,
        amount_tip, customer_id, employee_id, catalog_id, order_id,
        audit_status, audit_delta, audit_reason, metadata
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22)
      ON CONFLICT (tx_id) DO NOTHING
      RETURNING id
    `, [
      uto.tenant_id, uto.tx_id, uto.source,
      uto.amount_gross, uto.currency, uto.payment_mode,
      uto.timestamp_utc, uto.sale_type,
      fiscalBreakdown.amount_net,
      fiscalBreakdown.amount_tps,
      fiscalBreakdown.amount_tvq,
      province, fiscalBreakdown.taxProfile.label,
      uto.amount_tip,
      uto.customer_id, uto.employee_id, uto.catalog_id, uto.order_id,
      audit.status,
      audit.delta || null,
      audit.reason || null,
      JSON.stringify({ raw_ref: uto.raw_ref, location: uto.location_id }),
    ]).catch(e => { console.warn('[Ingester] INSERT:', e.message); return { rows: [] }; });

    ledgerId = insertResult.rows[0]?.id || null;
    const isDuplicate = insertResult.rows.length === 0;

    if (isDuplicate) {
      // [160] Double-comptage bloqué silencieusement
      bus.system(`[Ledger] Double-tx bloqué: ${uto.tx_id}`);
      return { uto, fiscal: fiscalBreakdown, audit, ledgerId: null, duplicate: true };
    }

    // [163] Enregistrer le pourboire
    if (uto.amount_tip > 0 && uto.employee_id) {
      await pool.query(`
        INSERT INTO staff_tips (tenant_id, tx_id, employee_id, tip_amount, currency, timestamp_utc)
        VALUES ($1, $2, $3, $4, $5, $6)
        ON CONFLICT (tx_id, employee_id) DO NOTHING
      `, [uto.tenant_id, uto.tx_id, uto.employee_id, uto.amount_tip, uto.currency, uto.timestamp_utc])
        .catch(() => {});
    }
  }

  // Broadcast sur le bus
  bus.system(`💳 Tx ingérée: ${uto.tx_id} | ${uto.amount_gross} ${uto.currency} | Net: ${fiscalBreakdown.amount_net} | TPS: ${fiscalBreakdown.amount_tps} | TVQ: ${fiscalBreakdown.amount_tvq}${audit.status === 'flagged' ? ' ⚠️ FLAGGED' : ''}`);

  return {
    uto, fiscal: fiscalBreakdown, audit, ledgerId, duplicate: false,
  };
}

/**
 * Ingestion en lot (batch) — webhook Square/Stripe peut envoyer plusieurs events
 */
async function ingestBatch(source, rawTransactions, opts = {}) {
  const results = [];
  for (const tx of rawTransactions) {
    const r = await ingestTransaction(source, tx, opts).catch(e => ({ error: e.message }));
    results.push(r);
  }
  const ok      = results.filter(r => !r.error && !r.duplicate).length;
  const dupes   = results.filter(r => r.duplicate).length;
  const flagged = results.filter(r => r.audit?.status === 'flagged').length;
  const errors  = results.filter(r => r.error).length;
  return { total: results.length, ok, dupes, flagged, errors, results };
}

// ─── EXPORTS ─────────────────────────────────────────────────────────────────

module.exports = {
  buildUTO, ingestTransaction, ingestBatch, auditShield, ensureTables,
};
