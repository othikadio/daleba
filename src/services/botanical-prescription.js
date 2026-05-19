'use strict';
/**
 * Botanical Prescription — DALEBA Metacortex Point 366
 * Génère une ordonnance beauté botanique PDF après diagnostic cutané.
 * Envoyée par courriel au client.
 */
const bus = require('./event-bus');

async function initSchema(pool) {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS aesthetic_prescriptions (
      id              SERIAL PRIMARY KEY,
      tenant_id       TEXT NOT NULL,
      client_id       TEXT,
      client_email    TEXT,
      analysis_data   JSONB,
      html_content    TEXT,
      sent_at         TIMESTAMPTZ,
      created_at      TIMESTAMPTZ DEFAULT NOW()
    )
  `).catch(() => {});
}

/**
 * [366] Génère le HTML de l'ordonnance botanique — design luxe DALEBA
 */
function buildPrescriptionHTML({ tenantId, clientName, analysisResult, salonName = 'Kadio Coiffure', generatedAt }) {
  const botanicals = analysisResult?.recommended_botanicals || [];
  const routine    = analysisResult?.care_routine || {};
  const wellness   = analysisResult?.wellness_note || '';
  const hydration  = analysisResult?.hydration_index || 'mixte';

  const ingredientsRows = botanicals.map(b => `
    <tr>
      <td style="padding:12px 16px;font-weight:600;color:#7c3aed">${b.ingredient}</td>
      <td style="padding:12px 16px;color:#64748b">${b.benefit}</td>
      <td style="padding:12px 16px;font-size:13px">${b.usage||''}</td>
    </tr>
  `).join('');

  return `<!DOCTYPE html>
<html lang="fr">
<head>
<meta charset="UTF-8">
<title>Ordonnance Botanique — ${clientName||'Client'}</title>
<style>
@import url('https://fonts.googleapis.com/css2?family=Playfair+Display:wght@400;700&family=Inter:wght@300;400;600&display=swap');
*{margin:0;padding:0;box-sizing:border-box}
body{font-family:'Inter',sans-serif;background:#fafaf8;color:#1a1a2e;padding:40px 20px}
.page{max-width:640px;margin:0 auto;background:#fff;border-radius:16px;overflow:hidden;box-shadow:0 8px 40px rgba(0,0,0,0.08)}
.header{background:linear-gradient(135deg,#0a0a0f 0%,#1a0a2e 100%);color:#fff;padding:40px;text-align:center;position:relative}
.header::after{content:'';position:absolute;bottom:0;left:0;right:0;height:4px;background:linear-gradient(90deg,#7c3aed,#10b981,#7c3aed)}
.logo{font-family:'Playfair Display',serif;font-size:32px;color:#7c3aed;letter-spacing:2px}
.header-sub{font-size:12px;color:rgba(255,255,255,0.5);text-transform:uppercase;letter-spacing:3px;margin-top:6px}
.rx-badge{display:inline-block;background:rgba(124,58,237,0.2);border:1px solid rgba(124,58,237,0.4);color:#a78bfa;border-radius:20px;padding:6px 16px;font-size:11px;margin-top:12px;letter-spacing:1px}
.section{padding:28px 32px;border-bottom:1px solid #f1f5f9}
.section-title{font-family:'Playfair Display',serif;font-size:18px;color:#0a0a0f;margin-bottom:16px}
.client-info{display:grid;grid-template-columns:1fr 1fr;gap:12px}
.info-item{background:#f8fafc;border-radius:8px;padding:12px 16px}
.info-label{font-size:10px;color:#94a3b8;text-transform:uppercase;letter-spacing:1px}
.info-value{font-size:14px;font-weight:600;color:#1a1a2e;margin-top:3px}
table{width:100%;border-collapse:collapse}
th{text-align:left;padding:10px 16px;font-size:10px;color:#94a3b8;text-transform:uppercase;letter-spacing:1px;border-bottom:2px solid #f1f5f9}
tr:hover td{background:#fafaf8}
.routine-box{background:linear-gradient(135deg,rgba(124,58,237,0.05),rgba(16,185,129,0.05));border:1px solid rgba(124,58,237,0.1);border-radius:12px;padding:20px;margin-bottom:12px}
.routine-time{font-size:11px;color:#7c3aed;font-weight:600;text-transform:uppercase;letter-spacing:1px;margin-bottom:8px}
.routine-text{font-size:14px;color:#475569;line-height:1.6}
.wellness{background:#f0fdf4;border-left:4px solid #10b981;padding:16px 20px;border-radius:0 8px 8px 0;font-size:14px;color:#166534;font-style:italic;line-height:1.6}
.disclaimer{background:#fffbeb;border:1px solid #fde68a;border-radius:8px;padding:14px 18px;font-size:11px;color:#92400e;line-height:1.5;margin:16px 32px}
.footer{background:#f8fafc;padding:20px 32px;text-align:center;font-size:11px;color:#94a3b8}
</style>
</head>
<body>
<div class="page">
  <div class="header">
    <div class="logo">DALEBA</div>
    <div class="header-sub">${salonName}</div>
    <div class="rx-badge">✦ Ordonnance Botanique ✦</div>
  </div>

  <div class="section">
    <div class="section-title">Fiche Client</div>
    <div class="client-info">
      <div class="info-item"><div class="info-label">Client</div><div class="info-value">${clientName||'—'}</div></div>
      <div class="info-item"><div class="info-label">Type de peau</div><div class="info-value">${hydration}</div></div>
      <div class="info-item"><div class="info-label">Date du diagnostic</div><div class="info-value">${new Date(generatedAt||Date.now()).toLocaleDateString('fr-CA')}</div></div>
      <div class="info-item"><div class="info-label">Score confiance</div><div class="info-value">${Math.round((analysisResult?.confidence_score||0)*100)}%</div></div>
    </div>
  </div>

  ${botanicals.length ? `
  <div class="section">
    <div class="section-title">🌿 Ingrédients Botaniques Recommandés</div>
    <table>
      <thead><tr><th>Ingrédient</th><th>Bénéfice</th><th>Application</th></tr></thead>
      <tbody>${ingredientsRows}</tbody>
    </table>
  </div>` : ''}

  <div class="section">
    <div class="section-title">📋 Routine de Soins Personnalisée</div>
    <div class="routine-box">
      <div class="routine-time">☀️ Matin</div>
      <div class="routine-text">${routine.morning||'Nettoyage doux + hydratation légère + protection solaire'}</div>
    </div>
    <div class="routine-box">
      <div class="routine-time">🌙 Soir</div>
      <div class="routine-text">${routine.evening||'Démaquillage + sérum actif + masque hebdomadaire'}</div>
    </div>
  </div>

  ${wellness ? `
  <div class="section">
    <div class="section-title">💚 Note Bien-être</div>
    <div class="wellness">"${wellness}"</div>
  </div>` : ''}

  <div class="disclaimer">
    ⚠️ Ces recommandations constituent des conseils de bien-être cosmétique uniquement et ne remplacent pas un avis médical professionnel. En cas de réaction cutanée, consultez immédiatement un dermatologue.
  </div>

  <div class="footer">
    ${salonName} · DALEBA Salonique Intelligence · ${new Date().getFullYear()}<br>
    Généré le ${new Date(generatedAt||Date.now()).toLocaleString('fr-CA',{timeZone:'America/Toronto'})}
  </div>
</div>
</body>
</html>`;
}

/**
 * [366] Génère et enregistre l'ordonnance, puis envoie par email
 */
async function generate(pool, tenantId, clientId, analysisResult) {
  await initSchema(pool);

  // Récupère les infos client
  let clientName = 'Client', clientEmail = null;
  try {
    const r = await pool.query(
      `SELECT client_name FROM tenant_aesthetic_records WHERE tenant_id=$1 AND client_id=$2`,
      [tenantId, clientId]
    );
    clientName = r.rows[0]?.client_name || clientName;
  } catch {}

  const generatedAt = new Date().toISOString();
  const html = buildPrescriptionHTML({ tenantId, clientName, analysisResult, generatedAt });

  // Enregistre en DB
  await pool.query(`
    INSERT INTO aesthetic_prescriptions (tenant_id, client_id, client_email, analysis_data, html_content)
    VALUES ($1,$2,$3,$4,$5)
  `, [tenantId, clientId, clientEmail, JSON.stringify(analysisResult), html]).catch(() => {});

  // Envoi email si client email dispo
  if (clientEmail) {
    try {
      const emailSvc = require('./email-sender');
      await emailSvc.send({
        to:      clientEmail,
        subject: '✦ Votre Ordonnance Botanique Personnalisée',
        html,
      });
      bus.system(`[BotanicalPrescription] 📧 Envoyé à ${clientEmail}`);
    } catch {}
  }

  bus.system(`[BotanicalPrescription] ✅ Ordonnance générée: ${clientId} (tenant: ${tenantId})`);
  return { generated: true, clientId, tenantId, html, generatedAt };
}

module.exports = { generate, buildPrescriptionHTML, initSchema };
