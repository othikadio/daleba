'use strict';
/**
 * Aesthetic Marketing — DALEBA Metacortex Point 384
 * Campagnes email ultra-ciblées basées sur les types de peau.
 */
const bus = require('./event-bus');

const CAMPAIGNS_BY_SKIN_TYPE = {
  sec:      { subject: '💧 Spécial Hydratation — Offre exclusive pour vous', tag: 'hydratation' },
  gras:     { subject: '🌿 Équilibre & Pureté — Votre soin sur mesure',      tag: 'purification' },
  mixte:    { subject: '⚖️ La formule parfaite pour votre peau mixte',       tag: 'equilibre' },
  sensible: { subject: '🌸 Douceur & Apaisement — Pensé pour vous',          tag: 'apaisement' },
  normal:   { subject: '✨ Sublimez votre éclat naturel',                     tag: 'eclat' },
};

/**
 * [384] Génère les segments de campagne par type de peau
 */
async function buildSkinTypeCampaign(pool, tenantId, targetSkinType) {
  // [373] Index composite sur (tenant_id, customer_id, created_at DESC)
  const r = await pool.query(`
    SELECT client_id, client_name, client_email, skin_type, botanical_prefs, melanin_level
    FROM tenant_aesthetic_records
    WHERE tenant_id=$1 AND skin_type=$2
    ORDER BY updated_at DESC
  `, [tenantId, targetSkinType]).catch(() => ({ rows: [] }));

  const campaign = CAMPAIGNS_BY_SKIN_TYPE[targetSkinType] || CAMPAIGNS_BY_SKIN_TYPE.normal;

  bus.system(`[AestheticMarketing] Campagne "${campaign.tag}": ${r.rows.length} clients ciblés (type: ${targetSkinType})`);
  return {
    skinType:   targetSkinType,
    targetCount: r.rows.length,
    campaign,
    recipients: r.rows.filter(c => c.client_email).map(c => ({
      email:     c.client_email,
      name:      c.client_name,
      skinType:  c.skin_type,
      botanicals: c.botanical_prefs,
    })),
  };
}

/**
 * [384] Génère le corps HTML d'un email de campagne
 */
function buildCampaignEmail({ clientName, skinType, salonName = 'Kadio Coiffure', botanicals = [] }) {
  const campaign = CAMPAIGNS_BY_SKIN_TYPE[skinType] || CAMPAIGNS_BY_SKIN_TYPE.normal;
  const botList  = botanicals.slice(0, 3).map(b => `<li>🌿 ${b}</li>`).join('');

  return {
    subject: campaign.subject,
    html: `<!DOCTYPE html><html><head><meta charset="UTF-8"></head>
<body style="font-family:Inter,sans-serif;background:#fafaf8;padding:32px;color:#1a1a2e">
<div style="max-width:520px;margin:0 auto;background:#fff;border-radius:12px;overflow:hidden;box-shadow:0 4px 24px rgba(0,0,0,0.08)">
  <div style="background:linear-gradient(135deg,#0a0a0f,#1a0a2e);color:#fff;padding:32px;text-align:center">
    <div style="font-size:28px;color:#7c3aed;font-weight:700;letter-spacing:2px">DALEBA</div>
    <div style="color:rgba(255,255,255,0.6);font-size:12px;margin-top:4px">${salonName}</div>
  </div>
  <div style="padding:28px">
    <p>Bonjour <strong>${clientName || 'chère cliente'}</strong> 🌸</p>
    <p>Basé sur votre profil cutané (<strong>${skinType}</strong>), nous avons sélectionné pour vous:</p>
    <ul style="margin:16px 0;padding-left:20px">${botList || '<li>🌿 Soin personnalisé disponible sur demande</li>'}</ul>
    <div style="background:rgba(124,58,237,0.05);border:1px solid rgba(124,58,237,0.15);border-radius:8px;padding:16px;margin:16px 0;text-align:center">
      <a href="https://kadiocoiffure.vercel.app/hub" style="background:#7c3aed;color:#fff;text-decoration:none;padding:12px 28px;border-radius:8px;font-weight:600;display:inline-block">
        Réserver mon soin ✨
      </a>
    </div>
    <p style="font-size:12px;color:#94a3b8">Ces recommandations sont des conseils cosmétiques non médicaux.</p>
  </div>
  <div style="background:#f8fafc;padding:16px;text-align:center;font-size:11px;color:#94a3b8">${salonName} · Propulsé par DALEBA</div>
</div>
</body></html>`,
  };
}

module.exports = { buildSkinTypeCampaign, buildCampaignEmail, CAMPAIGNS_BY_SKIN_TYPE };
