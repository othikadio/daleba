'use strict';
/**
 * Attribution Engine — DALEBA Metacortex Point 472
 * Pixels de conversion uniques par client + par campagne
 */
const bus    = require('./event-bus');
const crypto = require('crypto');

async function initSchema(pool) {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS tenant_attribution_pixels (
      id            SERIAL PRIMARY KEY,
      tenant_id     TEXT NOT NULL,
      pixel_id      TEXT UNIQUE NOT NULL,
      campaign_id   TEXT,
      customer_id   TEXT,
      source        TEXT,  -- meta | google | organic | sms
      converted     BOOL DEFAULT false,
      revenue       NUMERIC(10,2) DEFAULT 0,
      clicked_at    TIMESTAMPTZ,
      converted_at  TIMESTAMPTZ,
      created_at    TIMESTAMPTZ DEFAULT NOW()
    )
  `).catch(() => {});
  await pool.query('CREATE INDEX IF NOT EXISTS idx_pixels_campaign ON tenant_attribution_pixels(tenant_id, campaign_id, converted)').catch(() => {});
}

function generatePixelId(tenantId, campaignId, source) {
  const payload = `${tenantId}:${campaignId}:${source}:${Date.now()}`;
  return `px_${crypto.createHash('md5').update(payload).digest('hex').slice(0, 12)}`;
}

async function createPixel(pool, tenantId, { campaignId, source = 'meta' }) {
  await initSchema(pool);
  const pixelId = generatePixelId(tenantId, campaignId, source);
  await pool.query(`
    INSERT INTO tenant_attribution_pixels (tenant_id, pixel_id, campaign_id, source)
    VALUES ($1,$2,$3,$4)
  `, [tenantId, pixelId, campaignId, source]).catch(() => {});
  const trackingUrl = `${process.env.DALEBA_BASE_URL || 'https://daleba-api-production.up.railway.app'}/api/v1/campaigns/track/${pixelId}`;
  return { pixelId, trackingUrl, campaignId, source };
}

async function registerConversion(pool, tenantId, pixelId, { customerId, revenue }) {
  await initSchema(pool);
  const r = await pool.query(`
    UPDATE tenant_attribution_pixels SET converted=true, customer_id=$3, revenue=$4, converted_at=NOW()
    WHERE pixel_id=$1 AND tenant_id=$2 RETURNING *
  `, [pixelId, tenantId, customerId, revenue]).catch(() => ({ rows: [] }));
  if (!r.rows[0]) return { registered: false };
  // Met à jour les revenus de la campagne
  await pool.query(`
    UPDATE tenant_campaigns SET conversions=conversions+1, revenue_attr=revenue_attr+$3
    WHERE tenant_id=$1 AND campaign_id=$2
  `, [tenantId, r.rows[0].campaign_id, revenue]).catch(() => {});
  bus.system(`[Attribution] 💰 Conversion: ${pixelId} → ${customerId} | ${revenue}$`);
  return { registered: true, pixelId, revenue };
}

module.exports = { createPixel, registerConversion, generatePixelId, initSchema };
