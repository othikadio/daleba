/**
 * Meta Ads — DALEBA Metacortex Points 176-178
 *
 * [176] Pull ad spend Meta Ads toutes les 12h
 * [177] Calcul ROAS = revenus nouveaux clients / coût Meta Ads
 * [178] ROAS < 1.5 pendant 48h → proposition désactivation campagne
 *        + validation 1-clic Commandant
 */

'use strict';

const axios  = require('axios');
const bus    = require('./event-bus');
const fiscal = require('./fiscal-engine');

const META_API_BASE = 'https://graph.facebook.com/v19.0';
const ROAS_THRESHOLD = 1.5;  // [178] seuil minimum acceptable
const ROAS_WINDOW_H  = 48;   // fenêtre d'évaluation ROAS

// ─── [176] ASPIRATION DÉPENSES META ADS ──────────────────────────────────────

async function fetchAdSpend(tenantId = 'kadio') {
  const accessToken = process.env.META_ACCESS_TOKEN;
  const adAccountId = process.env.META_AD_ACCOUNT_ID;

  if (!accessToken || !adAccountId) {
    console.warn('[MetaAds] META_ACCESS_TOKEN ou META_AD_ACCOUNT_ID non configuré');
    return { error: 'META_ACCESS_TOKEN manquant', campaigns: [] };
  }

  // Fenêtre: hier + aujourd'hui
  const today    = new Date().toISOString().split('T')[0];
  const yesterday = new Date(Date.now() - 86400000).toISOString().split('T')[0];

  try {
    const r = await axios.get(`${META_API_BASE}/act_${adAccountId}/campaigns`, {
      params: {
        access_token:  accessToken,
        fields:        'id,name,status,effective_status,insights{spend,impressions,clicks,reach}',
        time_range:    JSON.stringify({ since: yesterday, until: today }),
        effective_status: '["ACTIVE","PAUSED"]',
        limit:         50,
      },
      timeout: 15000,
    });

    const campaigns = (r.data.data || []).map(c => {
      const ins = c.insights?.data?.[0] || {};
      return {
        id:          c.id,
        name:        c.name,
        status:      c.effective_status,
        spend:       parseFloat(ins.spend || 0),
        impressions: parseInt(ins.impressions || 0),
        clicks:      parseInt(ins.clicks || 0),
        reach:       parseInt(ins.reach || 0),
        fetchedAt:   new Date().toISOString(),
      };
    });

    // Persister dans daleba_notes
    const maintenance = require('./maintenance');
    const pool = maintenance.getPool();
    if (pool) {
      for (const c of campaigns) {
        await pool.query(`
          INSERT INTO daleba_notes (category, key, content, created_at)
          VALUES ('meta_ads_spend', $1, $2, NOW())
          ON CONFLICT (category, key) DO UPDATE SET content = EXCLUDED.content, created_at = NOW()
        `, [`campaign_${c.id}_${today}`, JSON.stringify({ ...c, tenantId })]).catch(() => {});
      }
    }

    const totalSpend = fiscal.roundCents(campaigns.reduce((s, c) => s + c.spend, 0));
    bus.system(`[MetaAds] ${campaigns.length} campagnes | Dépense totale: $${totalSpend} USD`);

    return { campaigns, totalSpend, fetchedAt: new Date().toISOString() };

  } catch (err) {
    const msg = err.response?.data?.error?.message || err.message;
    console.warn('[MetaAds] fetchAdSpend:', msg);
    return { error: msg, campaigns: [] };
  }
}

// ─── [177] CALCUL ROAS ────────────────────────────────────────────────────────

/**
 * ROAS = revenus générés par nouveaux clients Square acquis via pub / coût Meta Ads
 *
 * Heuristique d'attribution: clients Square créés dans les 7 derniers jours
 * ET ayant une première transaction dans la fenêtre Meta Ads.
 */
async function computeROAS(campaignId, tenantId = 'kadio') {
  const maintenance = require('./maintenance');
  const pool = maintenance.getPool();
  if (!pool) return null;

  // Récupérer les dépenses de la campagne sur 48h [178]
  const since48h = new Date(Date.now() - ROAS_WINDOW_H * 3600000).toISOString();
  const adData   = await pool.query(`
    SELECT SUM((content->>'spend')::numeric) AS total_spend,
           MAX(created_at) AS last_fetch
    FROM daleba_notes
    WHERE category = 'meta_ads_spend'
      AND key LIKE $1
      AND created_at >= $2
  `, [`campaign_${campaignId}_%`, since48h]).catch(() => ({ rows: [{}] }));

  const adSpend = parseFloat(adData.rows[0]?.total_spend || 0);
  if (adSpend === 0) return { roas: null, reason: 'no_ad_spend_data' };

  // Revenus de nouveaux clients sur la même fenêtre
  const revenueData = await pool.query(`
    SELECT COALESCE(SUM(l.amount_net), 0) AS revenue
    FROM tenant_ledgers l
    WHERE l.tenant_id = $1
      AND l.timestamp_utc >= $2
      AND l.refunded = FALSE
      AND l.customer_id IN (
        -- Nouveaux clients Square créés depuis ~7 jours (proxy attribution)
        SELECT DISTINCT customer_id FROM tenant_ledgers
        WHERE tenant_id = $1
          AND timestamp_utc >= NOW() - INTERVAL '7 days'
          AND customer_id IS NOT NULL
        GROUP BY customer_id
        HAVING MIN(timestamp_utc) >= NOW() - INTERVAL '7 days'
      )
  `, [tenantId, since48h]).catch(() => ({ rows: [{ revenue: 0 }] }));

  const revenue = parseFloat(revenueData.rows[0]?.revenue || 0);
  const roas    = adSpend > 0 ? fiscal.roundCents(revenue / adSpend) : 0;

  return {
    campaignId, tenantId,
    adSpend:    fiscal.roundCents(adSpend),
    revenue:    fiscal.roundCents(revenue),
    roas,
    window48h:  true,
    threshold:  ROAS_THRESHOLD,
    belowThreshold: roas < ROAS_THRESHOLD && roas > 0,
    computedAt: new Date().toISOString(),
  };
}

// ─── [178] DÉTECTION + PROPOSITION DÉSACTIVATION ─────────────────────────────

async function evaluateROASAndPropose(tenantId = 'kadio') {
  const { campaigns } = await fetchAdSpend(tenantId).catch(() => ({ campaigns: [] }));
  const proposals = [];

  for (const campaign of campaigns.filter(c => c.status === 'ACTIVE')) {
    const roasData = await computeROAS(campaign.id, tenantId).catch(() => null);
    if (!roasData || roasData.roas === null) continue;

    if (roasData.belowThreshold) {
      const proposal = {
        campaignId:   campaign.id,
        campaignName: campaign.name,
        roas:         roasData.roas,
        adSpend:      roasData.adSpend,
        revenue:      roasData.revenue,
        threshold:    ROAS_THRESHOLD,
        action:       'pause_campaign',
        confirmCode:  `PAUSE_${campaign.id.slice(-6)}`,
        message:      `⚠️ ROAS FAIBLE: Campagne "${campaign.name}" | ROAS: ${roasData.roas}x (seuil: ${ROAS_THRESHOLD}x)\nCoût 48h: $${roasData.adSpend} | Revenus: $${roasData.revenue}\nRépondre PAUSE_${campaign.id.slice(-6)} pour désactiver.`,
      };

      proposals.push(proposal);

      // Alerte HUD + SMS via shield
      bus.system(`⚠️ ROAS_LOW — Campagne "${campaign.name}": ${roasData.roas}x < ${ROAS_THRESHOLD}x`);

      const shield = require('./notification-shield');
      const shieldMsg = proposal.message;
      shield.shieldedSMS(
        process.env.ULRICH_PHONE_NUMBER,
        shieldMsg,
        `roas_low_${campaign.id}`,
        { priority: 'high', cooldownMs: ROAS_WINDOW_H * 3600000 }
      );
    }
  }

  return { proposals, evaluated: campaigns.length };
}

/**
 * [178] Exécute la désactivation après confirmation Commandant
 */
async function pauseCampaign(campaignId, confirmCode) {
  const expectedCode = `PAUSE_${campaignId.slice(-6)}`;
  if (confirmCode !== expectedCode) {
    return { error: `Code invalide. Attendu: ${expectedCode}` };
  }

  const accessToken = process.env.META_ACCESS_TOKEN;
  if (!accessToken) return { error: 'META_ACCESS_TOKEN manquant' };

  try {
    await axios.post(`${META_API_BASE}/${campaignId}`, {
      status:        'PAUSED',
      access_token:  accessToken,
    }, { timeout: 10000 });

    bus.system(`✅ Campagne Meta Ads ${campaignId} désactivée par le Commandant`);
    return { success: true, campaignId, status: 'PAUSED', pausedAt: new Date().toISOString() };
  } catch (err) {
    return { error: err.response?.data?.error?.message || err.message };
  }
}

// ─── SCHEDULER 12h [176] ─────────────────────────────────────────────────────

function startAdSpendScheduler(tenantId = 'kadio') {
  const intervalMs = 12 * 60 * 60 * 1000; // 12h
  setInterval(() => {
    evaluateROASAndPropose(tenantId).catch(e => console.warn('[MetaAds] Scheduler:', e.message));
  }, intervalMs);
  console.log('[MetaAds] Scheduler ad spend démarré (toutes les 12h)');
}

// ─── EXPORTS ─────────────────────────────────────────────────────────────────

module.exports = {
  fetchAdSpend, computeROAS, evaluateROASAndPropose, pauseCampaign,
  startAdSpendScheduler, ROAS_THRESHOLD,
};
