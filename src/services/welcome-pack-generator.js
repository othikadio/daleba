'use strict';
/**
 * Welcome Pack Generator — DALEBA Metacortex Point 271
 * Génère le document d'accueil SaaS en HTML haute qualité (imprimable/PDF).
 */
const bus = require('./event-bus');

function generateWelcomePack({ tenantId, tenantName, managerName, managerEmail, dalebaPhone, timezone, currency, country, mmiInstructions, tenantApiKey, dashboardUrl }) {
  const date = new Date().toLocaleDateString('fr-CA', { year: 'numeric', month: 'long', day: 'numeric' });
  const mmiCode = mmiInstructions?.instructions?.unconditional?.code || '*21*' + (dalebaPhone || '') + '#';
  const mmiSteps = mmiInstructions?.steps?.join('\n') || '';

  const html = `<!DOCTYPE html>
<html lang="fr">
<head>
<meta charset="UTF-8">
<style>
  @import url('https://fonts.googleapis.com/css2?family=Inter:wght@300;400;600;700&display=swap');
  * { margin:0; padding:0; box-sizing:border-box; }
  body { font-family: Inter, system-ui, sans-serif; background:#fff; color:#1a1a2e; padding:40px; max-width:800px; margin:0 auto; }
  .header { background: linear-gradient(135deg, #7c3aed, #4f46e5); color: white; padding: 40px; border-radius: 16px; margin-bottom: 32px; }
  .header h1 { font-size: 28px; font-weight: 700; letter-spacing: -0.5px; }
  .header p { opacity: 0.85; margin-top: 8px; font-size: 15px; }
  .badge { display: inline-block; background: rgba(255,255,255,0.2); border-radius: 20px; padding: 4px 12px; font-size: 12px; margin-top: 12px; }
  .section { background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 12px; padding: 24px; margin-bottom: 20px; }
  .section h2 { font-size: 16px; font-weight: 600; color: #7c3aed; margin-bottom: 16px; text-transform: uppercase; letter-spacing: 0.5px; }
  .row { display: flex; justify-content: space-between; padding: 8px 0; border-bottom: 1px solid #e2e8f0; }
  .row:last-child { border-bottom: none; }
  .label { color: #64748b; font-size: 14px; }
  .value { font-weight: 600; font-size: 14px; color: #1a1a2e; }
  .mmi-box { background: #0a0a0f; color: #10b981; font-family: monospace; font-size: 24px; text-align: center; padding: 20px; border-radius: 8px; letter-spacing: 2px; margin: 12px 0; }
  .steps { list-style: none; counter-reset: steps; }
  .steps li { counter-increment: steps; padding: 8px 0 8px 32px; position: relative; font-size: 14px; }
  .steps li::before { content: counter(steps); position: absolute; left: 0; background: #7c3aed; color: white; width: 22px; height: 22px; border-radius: 50%; text-align: center; line-height: 22px; font-size: 12px; font-weight: 600; }
  .api-key { font-family: monospace; background: #f1f5f9; padding: 12px; border-radius: 6px; font-size: 13px; word-break: break-all; border-left: 3px solid #7c3aed; }
  .footer { text-align: center; color: #94a3b8; font-size: 12px; margin-top: 32px; padding-top: 20px; border-top: 1px solid #e2e8f0; }
  .highlight { background: linear-gradient(135deg, #7c3aed15, #4f46e515); border: 1px solid #7c3aed40; border-radius: 8px; padding: 16px; }
  @media print { body { padding: 20px; } }
</style>
</head>
<body>
  <div class="header">
    <div style="font-size:12px;opacity:0.7;margin-bottom:8px">DALEBA PLATFORM — WELCOME PACK</div>
    <h1>Bienvenue, ${managerName || tenantName} 🎉</h1>
    <p>Votre espace DALEBA est prêt. Ce document contient toutes vos informations d'accès.</p>
    <div class="badge">Confidentiel · ${date}</div>
  </div>

  <div class="section">
    <h2>🏢 Votre Entreprise</h2>
    <div class="row"><span class="label">Nom</span><span class="value">${tenantName}</span></div>
    <div class="row"><span class="label">Identifiant Tenant</span><span class="value">${tenantId}</span></div>
    <div class="row"><span class="label">Pays / Fuseau</span><span class="value">${country} · ${timezone}</span></div>
    <div class="row"><span class="label">Devise</span><span class="value">${currency}</span></div>
  </div>

  <div class="section">
    <h2>📞 Votre Ligne DALEBA</h2>
    <div class="highlight" style="text-align:center;margin-bottom:16px">
      <div style="font-size:28px;font-weight:700;color:#7c3aed;letter-spacing:2px">${dalebaPhone || 'En cours d\'attribution'}</div>
      <div style="font-size:12px;color:#64748b;margin-top:4px">Votre numéro dédié DALEBA</div>
    </div>
    <div class="row"><span class="label">Récepteur vocal IA</span><span class="value">Actif 24/7</span></div>
    <div class="row"><span class="label">Langue</span><span class="value">Français canadien (Polly Lea-Neural)</span></div>
  </div>

  <div class="section">
    <h2>📱 Activation du Transfert d'Appel</h2>
    <p style="font-size:14px;color:#64748b;margin-bottom:12px">Composez ce code sur votre téléphone pour activer le transfert vers DALEBA :</p>
    <div class="mmi-box">${mmiCode}</div>
    <p style="font-size:12px;color:#64748b;margin-top:8px">⚠️ ${mmiInstructions?.carrierNote || 'Fonctionne sur tous les opérateurs GSM standards.'}</p>
  </div>

  <div class="section">
    <h2>🔑 Accès Cockpit</h2>
    <div class="row"><span class="label">Dashboard</span><span class="value">${dashboardUrl || 'https://daleba-api-production.up.railway.app/admin'}</span></div>
    <div class="row"><span class="label">Email</span><span class="value">${managerEmail}</span></div>
    <div class="row"><span class="label">Square</span><span class="value">À connecter via le dashboard</span></div>
    ${tenantApiKey ? `
    <div style="margin-top:12px">
      <div class="label" style="margin-bottom:6px">Clé API d'intégration :</div>
      <div class="api-key">${tenantApiKey}</div>
      <div style="font-size:11px;color:#94a3b8;margin-top:4px">⚠️ Conservez cette clé en lieu sûr. Elle ne sera plus affichée.</div>
    </div>` : ''}
  </div>

  <div class="footer">
    <p><strong>DALEBA Platform</strong> — Propulsé par l'IA · Support: support@daleba.ai</p>
    <p style="margin-top:4px">Document généré le ${date} · Tenant: ${tenantId}</p>
  </div>
</body>
</html>`;

  bus.system(`[WelcomePack] Pack généré pour ${tenantId}`);
  return html;
}

module.exports = { generateWelcomePack };
