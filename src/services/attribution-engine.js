'use strict';
/**
 * Attribution Engine — DALEBA [472,498]
 * Pixels de conversion uniques, privacy-first (sans cookie tiers)
 */
const bus=require('./event-bus');
const crypto=require('crypto');

async function initSchema(pool) {
  await pool.query(`CREATE TABLE IF NOT EXISTS tenant_attribution_pixels (
    id SERIAL PRIMARY KEY, tenant_id TEXT NOT NULL, pixel_id TEXT UNIQUE NOT NULL,
    campaign_id TEXT, customer_id TEXT, source TEXT DEFAULT 'meta',
    converted BOOL DEFAULT false, revenue NUMERIC(10,2) DEFAULT 0,
    clicked_at TIMESTAMPTZ, converted_at TIMESTAMPTZ, created_at TIMESTAMPTZ DEFAULT NOW()
  )`).catch(()=>{});
  await pool.query('CREATE INDEX IF NOT EXISTS idx_pixels_camp ON tenant_attribution_pixels(tenant_id,campaign_id,converted)').catch(()=>{});
}

function generatePixelId(tenantId,campaignId,source) {
  return 'px_'+crypto.createHash('md5').update(`${tenantId}:${campaignId}:${source}:${Date.now()}`).digest('hex').slice(0,12);
}

async function createPixel(pool,tenantId,{campaignId,source='meta'}) {
  await initSchema(pool);
  const pixelId=generatePixelId(tenantId,campaignId,source);
  await pool.query(`INSERT INTO tenant_attribution_pixels (tenant_id,pixel_id,campaign_id,source) VALUES ($1,$2,$3,$4)`,[tenantId,pixelId,campaignId,source]).catch(()=>{});
  const baseUrl=process.env.DALEBA_BASE_URL||'https://daleba-api-production.up.railway.app';
  return {pixelId,trackingUrl:`${baseUrl}/api/v1/campaigns/track/${pixelId}`,campaignId,source};
}

async function registerConversion(pool,tenantId,pixelId,{customerId,revenue}) {
  await initSchema(pool);
  const r=await pool.query(`UPDATE tenant_attribution_pixels SET converted=true,customer_id=$3,revenue=$4,converted_at=NOW() WHERE pixel_id=$1 AND tenant_id=$2 RETURNING *`,[pixelId,tenantId,customerId,revenue]).catch(()=>({rows:[]}));
  if (!r.rows[0]) return {registered:false};
  await pool.query(`UPDATE tenant_campaigns SET conversions=conversions+1,revenue_attr=revenue_attr+$3 WHERE tenant_id=$1 AND campaign_id=$2`,[tenantId,r.rows[0].campaign_id,revenue]).catch(()=>{});
  bus.system(`[Attribution] 💰 Conversion: ${pixelId} → ${revenue}$`);
  return {registered:true,pixelId,revenue};
}

// [498] Privacy-first: pas de cookie, identifiant haché
function buildPrivacyFirstScript(pixelId,tenantId) {
  return `<script>(function(){var d=document,s=d.createElement('script');s.src='/api/v1/campaigns/track/${pixelId}?t='+Date.now();s.async=true;s.setAttribute('data-tenant','${tenantId}');/* No 3rd-party cookies — ATT compliant */d.head.appendChild(s);})();</script>`;
}

module.exports={createPixel,registerConversion,generatePixelId,buildPrivacyFirstScript,initSchema};
