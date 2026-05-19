'use strict';
/**
 * Gov Filing Connector — DALEBA [553-554]
 * Mock connecteurs ClicSÉQUR (Revenu Québec) + TED (ARC)
 * TOUT reste en STAGED_DRAFT jusqu'à confirmation humaine [556]
 */
const bus    = require('./event-bus');
const crypto = require('crypto');

async function initSchema(pool) {
  if (!pool?.query) return;
  await pool.query(`
    CREATE TABLE IF NOT EXISTS tenant_tax_filings (
      id              SERIAL PRIMARY KEY,
      tenant_id       TEXT NOT NULL,
      filing_id       TEXT UNIQUE NOT NULL,
      filing_type     TEXT NOT NULL,  -- gst_return | qst_return | pad_payment
      status          TEXT DEFAULT 'staged_draft',  -- staged_draft | confirmed | transmitted | rejected
      xml_payload     TEXT,
      json_payload    JSONB,
      amount_due      NUMERIC(10,2),
      period_start    DATE,
      period_end      DATE,
      confirmation_token TEXT,
      confirmed_by    TEXT,
      confirmed_at    TIMESTAMPTZ,
      transmitted_at  TIMESTAMPTZ,
      created_at      TIMESTAMPTZ DEFAULT NOW()
    )
  `).catch(() => {});
  await pool.query('CREATE INDEX IF NOT EXISTS idx_filings ON tenant_tax_filings(tenant_id, status, filing_type)').catch(() => {});
}

function buildGSTXML(data) {
  return `<?xml version="1.0" encoding="UTF-8"?>
<!-- DALEBA — GST/HST Return Staging (CRA TED Format Mock) -->
<!-- STATUS: STAGED_DRAFT — NOT TRANSMITTED -->
<GSTReturn xmlns="urn:cra:gst:return:1.0">
  <FilingId>${data.filingId}</FilingId>
  <BusinessNumber>${data.businessNumber || 'PENDING'}</BusinessNumber>
  <ReportingPeriod>
    <Start>${data.periodStart}</Start>
    <End>${data.periodEnd}</End>
  </ReportingPeriod>
  <Line101_GrossSalesNet>${data.grossSalesNet}</Line101_GrossSalesNet>
  <Line105_GSTCollected>${data.gstCollected}</Line105_GSTCollected>
  <Line106_ITCClaimable>${data.itcClaimable}</Line106_ITCClaimable>
  <Line109_NetRemittance>${data.gstNet}</Line109_NetRemittance>
  <Status>STAGED_DRAFT</Status>
  <DALEBANote>Requires admin_confirmation_token before transmission [556]</DALEBANote>
</GSTReturn>`.trim();
}

function buildQSTXML(data) {
  return `<?xml version="1.0" encoding="UTF-8"?>
<!-- DALEBA — QST Return Staging (ClicSÉQUR Format Mock) -->
<!-- STATUS: STAGED_DRAFT — NOT TRANSMITTED -->
<QSTReturn xmlns="urn:revenuquebec:qst:return:1.0">
  <FilingId>${data.filingId}</FilingId>
  <NEQ>${data.neq || 'PENDING'}</NEQ>
  <ReportingPeriod>
    <Start>${data.periodStart}</Start>
    <End>${data.periodEnd}</End>
  </ReportingPeriod>
  <Ligne201_VentesNettes>${data.grossSalesNet}</Ligne201_VentesNettes>
  <Ligne205_TVQPercue>${data.qstCollected}</Ligne205_TVQPercue>
  <Ligne206_RTIClaimable>${data.itrClaimable}</Ligne206_RTIClaimable>
  <Ligne210_RemiseNette>${data.qstNet}</Ligne210_RemiseNette>
  <Status>STAGED_DRAFT</Status>
  <DALEBANote>Confirmation humaine obligatoire avant transmission [556]</DALEBANote>
</QSTReturn>`.trim();
}

async function stageGSTReturn(pool, tenantId, params) {
  await initSchema(pool);
  const filingId = `GST-${Date.now()}-${crypto.randomBytes(3).toString('hex').toUpperCase()}`;
  const xml      = buildGSTXML({ ...params, filingId });
  const hash     = crypto.createHash('sha256').update(xml).digest('hex').slice(0,16);
  await pool.query(`
    INSERT INTO tenant_tax_filings (tenant_id,filing_id,filing_type,xml_payload,json_payload,amount_due,period_start,period_end)
    VALUES ($1,$2,'gst_return',$3,$4,$5,$6,$7)
  `,[tenantId,filingId,xml,JSON.stringify(params),params.gstNet||0,params.periodStart||null,params.periodEnd||null]).catch(()=>{});
  bus.system(`[GovFiling] 📄 GST Return stagé: ${filingId} | Due: ${params.gstNet||0}$ | Hash: ${hash}`);
  return { filingId, status:'staged_draft', xml, hash, amountDue: params.gstNet||0 };
}

async function stageQSTReturn(pool, tenantId, params) {
  await initSchema(pool);
  const filingId = `QST-${Date.now()}-${crypto.randomBytes(3).toString('hex').toUpperCase()}`;
  const xml      = buildQSTXML({ ...params, filingId });
  const hash     = crypto.createHash('sha256').update(xml).digest('hex').slice(0,16);
  await pool.query(`
    INSERT INTO tenant_tax_filings (tenant_id,filing_id,filing_type,xml_payload,json_payload,amount_due,period_start,period_end)
    VALUES ($1,$2,'qst_return',$3,$4,$5,$6,$7)
  `,[tenantId,filingId,xml,JSON.stringify(params),params.qstNet||0,params.periodStart||null,params.periodEnd||null]).catch(()=>{});
  bus.system(`[GovFiling] 📄 QST Return stagé: ${filingId} | Due: ${params.qstNet||0}$ | Hash: ${hash}`);
  return { filingId, status:'staged_draft', xml, hash, amountDue: params.qstNet||0 };
}

async function stagePADPayment(pool, tenantId, { filingId, amount, bankAccount }) {
  // [554] PAD staging — jamais exécuté sans confirmation [556]
  await initSchema(pool);
  const padId    = `PAD-${Date.now()}-${crypto.randomBytes(3).toString('hex').toUpperCase()}`;
  const maskedAccount = bankAccount ? `****${String(bankAccount).slice(-4)}` : 'COMMERCIAL_ACCOUNT';
  bus.system(`[GovFiling] 💳 PAD stagé: ${padId} | ${amount}$ | Compte: ${maskedAccount} [STAGED_DRAFT — confirmation requise]`);
  // [556] Reste en STAGED_DRAFT — ne jamais auto-exécuter
  return { padId, status:'staged_draft', amount, maskedAccount, requires:'admin_confirmation_token' };
}

async function confirmAndTransmit(pool, tenantId, { filingId, confirmationToken }) {
  // [556] Seule voie légale de transmission
  if (!confirmationToken) throw new Error('[556] admin_confirmation_token obligatoire pour transmission');
  const r = await pool.query(`UPDATE tenant_tax_filings SET status='confirmed',confirmation_token=$2,confirmed_at=NOW() WHERE tenant_id=$1 AND filing_id=$3 RETURNING *`,[tenantId,confirmationToken,filingId]).catch(()=>({rows:[]}));
  if (!r.rows[0]) throw new Error('Filing introuvable');
  bus.system(`[GovFiling] ✅ Filing ${filingId} confirmé par ${tenantId} — prêt pour transmission`);
  return { confirmed:true, filingId, status:'confirmed' };
}

async function listFilings(pool, tenantId) {
  await initSchema(pool);
  const r = await pool.query(`SELECT filing_id,filing_type,status,amount_due,period_start,period_end,created_at FROM tenant_tax_filings WHERE tenant_id=$1 ORDER BY created_at DESC`,[tenantId]).catch(()=>({rows:[]}));
  return r.rows;
}

async function getFiling(pool, tenantId, filingId) {
  await initSchema(pool);
  const r = await pool.query(`SELECT * FROM tenant_tax_filings WHERE tenant_id=$1 AND filing_id=$2`,[tenantId,filingId]).catch(()=>({rows:[]}));
  return r.rows[0] || null;
}

module.exports = { stageGSTReturn, stageQSTReturn, stagePADPayment, confirmAndTransmit, listFilings, getFiling, initSchema, buildGSTXML, buildQSTXML };
