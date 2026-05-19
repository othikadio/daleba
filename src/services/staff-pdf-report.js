'use strict';
/**
 * Staff PDF Report — DALEBA Metacortex Point 344
 * Génère un rapport de paie quinzaine en HTML premium (rendu PDF via puppeteer ou print).
 * Charte graphique DALEBA: fond sombre, glassmorphism, violet #7c3aed.
 */

function generatePayrollHTML(report) {
  const { period, employees = [], grandTotal, currency = 'CAD', tenantId, generatedAt } = report;

  const rows = employees.map(e => `
    <tr>
      <td><strong>${e.name}</strong></td>
      <td>${e.heuresTravaillees}h</td>
      <td>${e.caNetGenere} ${currency}</td>
      <td><span class="highlight">${e.commissionServices} ${currency}</span></td>
      <td><span class="highlight">${e.commissionProduits} ${currency}</span></td>
      <td><span class="tip">${e.pourboires} ${currency}</span></td>
      <td><strong>${e.totalBrut} ${currency}</strong></td>
      <td><span class="badge ${e.nbPending > 0 ? 'pending' : 'paid'}">${e.nbPending > 0 ? 'EN ATTENTE' : 'PAYÉ'}</span></td>
    </tr>
  `).join('');

  return `<!DOCTYPE html>
<html lang="fr">
<head>
<meta charset="UTF-8">
<title>DALEBA — Rapport de Paie ${period}</title>
<style>
  @import url('https://fonts.googleapis.com/css2?family=Inter:wght@300;400;600;700&display=swap');
  *{margin:0;padding:0;box-sizing:border-box}
  body{font-family:Inter,sans-serif;background:#0a0a0f;color:#e2e8f0;padding:40px;min-height:100vh}
  .header{border-bottom:2px solid rgba(124,58,237,0.4);padding-bottom:24px;margin-bottom:32px;display:flex;justify-content:space-between;align-items:flex-end}
  .logo{font-size:28px;font-weight:700;color:#7c3aed;letter-spacing:-1px}
  .logo span{color:#e2e8f0}
  .meta{text-align:right;font-size:12px;color:#64748b;line-height:1.6}
  .period{font-size:16px;font-weight:600;color:#e2e8f0;margin-bottom:4px}
  .summary{display:grid;grid-template-columns:repeat(3,1fr);gap:16px;margin-bottom:32px}
  .card{background:rgba(124,58,237,0.08);border:1px solid rgba(124,58,237,0.2);border-radius:12px;padding:20px}
  .card-val{font-size:24px;font-weight:700;color:#7c3aed}
  .card-lbl{font-size:11px;color:#64748b;margin-top:4px;text-transform:uppercase;letter-spacing:0.5px}
  table{width:100%;border-collapse:collapse;background:rgba(255,255,255,0.02);border-radius:12px;overflow:hidden}
  th{padding:12px 16px;text-align:left;font-size:11px;color:#64748b;text-transform:uppercase;letter-spacing:0.5px;border-bottom:1px solid rgba(255,255,255,0.06)}
  td{padding:14px 16px;font-size:13px;border-bottom:1px solid rgba(255,255,255,0.04)}
  tr:last-child td{border:none}
  tr:hover td{background:rgba(124,58,237,0.04)}
  .highlight{color:#7c3aed;font-weight:500}
  .tip{color:#10b981;font-weight:500}
  .badge{border-radius:20px;padding:3px 10px;font-size:10px;font-weight:600}
  .pending{background:rgba(245,158,11,0.15);color:#f59e0b}
  .paid{background:rgba(16,185,129,0.15);color:#10b981}
  .total-row{background:rgba(124,58,237,0.1);font-weight:700}
  .footer{margin-top:32px;padding-top:16px;border-top:1px solid rgba(255,255,255,0.06);font-size:11px;color:#64748b;text-align:center}
  @media print{body{background:#fff;color:#1a1a1a}.card{background:#f8f8ff;border:1px solid #ddd}.highlight{color:#5b21b6}.tip{color:#059669}.logo{color:#5b21b6}}
</style>
</head>
<body>
  <div class="header">
    <div>
      <div class="logo">DALE<span>BA</span></div>
      <div style="font-size:13px;color:#64748b;margin-top:4px">Système de Gestion Salonique</div>
    </div>
    <div class="meta">
      <div class="period">📋 Rapport de Paie Quinzaine</div>
      <div>Période : ${period}</div>
      <div>Tenant : ${tenantId}</div>
      <div>Généré le : ${new Date(generatedAt).toLocaleString('fr-CA', { timeZone: 'America/Toronto' })}</div>
    </div>
  </div>

  <div class="summary">
    <div class="card">
      <div class="card-val">${employees.length}</div>
      <div class="card-lbl">Employés</div>
    </div>
    <div class="card">
      <div class="card-val">${grandTotal} ${currency}</div>
      <div class="card-lbl">Total à verser</div>
    </div>
    <div class="card">
      <div class="card-val">${employees.filter(e => e.nbPending > 0).length}</div>
      <div class="card-lbl">Paiements en attente</div>
    </div>
  </div>

  <table>
    <thead>
      <tr>
        <th>Employé</th><th>Heures</th><th>CA Net</th>
        <th>Comm. Services</th><th>Comm. Produits</th>
        <th>Pourboires</th><th>Total</th><th>Statut</th>
      </tr>
    </thead>
    <tbody>
      ${rows}
      <tr class="total-row">
        <td colspan="6" style="text-align:right;padding-right:16px">TOTAL QUINZAINE</td>
        <td>${grandTotal} ${currency}</td>
        <td></td>
      </tr>
    </tbody>
  </table>

  <div class="footer">
    DALEBA Payroll System · Confidentiel · ${new Date().getFullYear()} Kadio Coiffure
    · Ce document est protégé par les lois québécoises sur la vie privée (Loi 25)
  </div>
</body>
</html>`;
}

module.exports = { generatePayrollHTML };
