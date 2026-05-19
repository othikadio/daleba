'use strict';
/**
 * Campaign Voice Anchor — DALEBA Metacortex Point 474
 * Intent vocal: ROAS + stock Moringa via téléphone
 */
const bus = require('./event-bus');

const ROAS_PATTERNS = [
  /quel.*ROAS/i, /ROAS.*campagne/i, /retour.*invest/i, /perform.*campagne/i,
  /how.*campaign.*perform/i, /return.*ad.*spend/i,
];
const STOCK_PATTERNS = [
  /assez.*moringa/i, /stock.*moringa/i, /moringa.*stock/i, /niveau.*inventaire/i,
  /combien.*(\w+).*stock/i, /how.*much.*(moringa|chebe|argan)/i, /inventaire/i,
];

function detectCampaignIntent(utterance) {
  const u = utterance || '';
  if (ROAS_PATTERNS.some(p => p.test(u))) return { type: 'roas_query' };
  if (STOCK_PATTERNS.some(p => p.test(u))) {
    const m = u.match(/(\w+(?:\s+\w+)?)\s*(?:stock|inventaire|moringa|chebe|argan|fakoye)/i);
    return { type: 'stock_query', ingredient: m ? m[1] : 'moringa' };
  }
  return null;
}

async function handleCampaignVoiceQuery(pool, tenantId, utterance) {
  const intent = detectCampaignIntent(utterance);
  if (!intent) return null;

  if (intent.type === 'roas_query') {
    try {
      const adsOrch = require('./autonomous-ads-orchestrator');
      const perf    = await adsOrch.getCampaignPerformance(pool, tenantId);
      const best    = perf.campaigns?.[0];
      if (!best) return { spoken: 'Aucune campagne active pour le moment, Commandant.' };
      const spoken = best.roas > 0
        ? `Le ROAS de votre campagne "${best.name || best.campaign_id}" est de ${best.roas} pour un. ${best.roas >= 1.5 ? 'Performance excellente !' : 'Sous le seuil optimal de 1.5 — je surveille.'}`
        : `Pas encore de données de retour sur votre campagne. Revenez dans 48 heures.`;
      bus.system(`[CampaignVoice] ROAS vocal: ${best.campaign_id} → ${best.roas}`);
      return { spoken, roas: best.roas };
    } catch { return { spoken: 'Je ne peux pas accéder aux données de campagne en ce moment.' }; }
  }

  if (intent.type === 'stock_query') {
    try {
      const r = await pool.query(
        `SELECT name, quantity, unit, status FROM tenant_inventory WHERE tenant_id=$1 AND name ILIKE $2 LIMIT 1`,
        [tenantId, `%${intent.ingredient}%`]
      ).catch(() => ({ rows: [] }));
      const item = r.rows[0];
      if (!item) return { spoken: `Je n'ai pas trouvé d'ingrédient "${intent.ingredient}" dans l'inventaire.` };
      const spoken = `Nous avons ${item.quantity} ${item.unit} de ${item.name}. ${item.status === 'REORDER_REQUIRED' ? '⚠️ Réapprovisionnement requis !' : item.status === 'low' ? 'Stock bas.' : 'Stock suffisant.'}`;
      bus.system(`[CampaignVoice] Stock vocal: ${item.name} → ${item.quantity}${item.unit}`);
      return { spoken, stock: item };
    } catch { return { spoken: 'Je ne peux pas consulter l\'inventaire en ce moment.' }; }
  }
  return null;
}

module.exports = { detectCampaignIntent, handleCampaignVoiceQuery, ROAS_PATTERNS, STOCK_PATTERNS };
