'use strict';
/**
 * DALEBA — Wallet Service (V47)
 * Génère QR codes et previews HTML de cartes membres
 */

const QRCode = require('qrcode');

const FRONTEND_BASE = process.env.FRONTEND_URL || 'https://kadiocoiffure.vercel.app';
const BACKEND_BASE  = process.env.BACKEND_URL  || 'https://daleba-api-production.up.railway.app';

/**
 * Génère un QR code PNG buffer pour un client
 * L'URL pointe vers la fiche admin CRM
 */
async function generateQRCode(clientId) {
  const url = `${FRONTEND_BASE}/admin-clients.html?client=${clientId}`;
  return await QRCode.toBuffer(url, {
    width: 300,
    margin: 2,
    color: { dark: '#0a0a0a', light: '#f5f5f5' }
  });
}

/**
 * Génère un QR code en base64 data URL
 */
async function generateQRCodeDataURL(clientId) {
  const url = `${FRONTEND_BASE}/admin-clients.html?client=${clientId}`;
  return await QRCode.toDataURL(url, {
    width: 300,
    margin: 2,
    color: { dark: '#0a0a0a', light: '#f5f5f5' }
  });
}

/**
 * Génère une preview HTML premium de la carte membre
 * Design Apple Wallet inspired — fond noir, champagne
 */
async function generateWalletPreviewHTML(client, loyaltyPoints) {
  const qrDataURL = await generateQRCodeDataURL(client.id || client.customer_id || 'unknown');
  const points = loyaltyPoints || 0;
  const name = client.given_name
    ? `${client.given_name} ${client.family_name || ''}`.trim()
    : (client.name || 'Membre');
  const memberId = (client.id || client.customer_id || '').slice(0, 8).toUpperCase();
  const isVIP = points >= 500;
  const status = isVIP ? 'VIP ✦' : 'MEMBRE';
  const statusColor = isVIP ? '#ffd700' : '#c9a96e';
  const joinDate = client.created_at
    ? new Date(client.created_at).getFullYear()
    : new Date().getFullYear();

  const pkpassUrl = `${BACKEND_BASE}/api/wallet/pkpass/${client.id || client.customer_id}`;
  const cardPageUrl = `${BACKEND_BASE}/wallet-card/${client.id || client.customer_id}`;

  return `<!DOCTYPE html>
<html lang="fr">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Carte Membre — ${name}</title>
<style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body {
    background: #1a1a1a;
    display: flex;
    align-items: center;
    justify-content: center;
    min-height: 100vh;
    font-family: -apple-system, BlinkMacSystemFont, 'SF Pro Display', 'Segoe UI', sans-serif;
    padding: 20px;
  }
  .card-wrapper { text-align: center; }
  .card {
    width: 340px;
    background: linear-gradient(145deg, #0a0a0a 0%, #1c1c1c 50%, #0f0f0f 100%);
    border-radius: 20px;
    padding: 28px 24px;
    box-shadow: 0 20px 60px rgba(0,0,0,0.8), 0 0 0 1px rgba(201,169,110,0.3), inset 0 1px 0 rgba(201,169,110,0.1);
    position: relative;
    overflow: hidden;
    display: inline-block;
    margin: 0 auto;
  }
  .card::before {
    content: '';
    position: absolute;
    top: -50%;
    right: -30%;
    width: 200px;
    height: 200px;
    background: radial-gradient(circle, rgba(201,169,110,0.08) 0%, transparent 70%);
    pointer-events: none;
  }
  .card-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    margin-bottom: 24px;
  }
  .logo {
    font-size: 11px;
    font-weight: 700;
    letter-spacing: 3px;
    color: #c9a96e;
    text-transform: uppercase;
    line-height: 1.3;
  }
  .logo span { display: block; font-size: 7px; color: rgba(201,169,110,0.6); letter-spacing: 2px; }
  .status-badge {
    background: linear-gradient(135deg, rgba(201,169,110,0.2), rgba(201,169,110,0.05));
    border: 1px solid rgba(201,169,110,0.4);
    border-radius: 20px;
    padding: 4px 12px;
    font-size: 10px;
    font-weight: 700;
    color: ${statusColor};
    letter-spacing: 2px;
  }
  .member-name {
    font-size: 22px;
    font-weight: 600;
    color: #f0f0f0;
    margin-bottom: 4px;
    letter-spacing: 0.5px;
  }
  .member-id {
    font-size: 10px;
    color: rgba(201,169,110,0.5);
    letter-spacing: 3px;
    margin-bottom: 20px;
    font-family: 'SF Mono', 'Courier New', monospace;
  }
  .qr-container {
    background: #f5f5f5;
    border-radius: 12px;
    padding: 12px;
    display: inline-block;
    margin-bottom: 20px;
    box-shadow: 0 4px 15px rgba(0,0,0,0.4);
  }
  .qr-container img { display: block; width: 150px; height: 150px; border-radius: 4px; }
  .scan-hint {
    font-size: 9px;
    color: rgba(255,255,255,0.3);
    letter-spacing: 2px;
    text-transform: uppercase;
    margin-bottom: 20px;
  }
  .stats {
    display: flex;
    justify-content: space-around;
    background: rgba(255,255,255,0.04);
    border-radius: 12px;
    padding: 14px;
    margin-bottom: 20px;
    border: 1px solid rgba(201,169,110,0.1);
  }
  .stat { text-align: center; }
  .stat-value {
    font-size: 20px;
    font-weight: 700;
    color: #c9a96e;
    display: block;
    line-height: 1;
  }
  .stat-label {
    font-size: 8px;
    color: rgba(255,255,255,0.3);
    letter-spacing: 1.5px;
    text-transform: uppercase;
    margin-top: 4px;
    display: block;
  }
  .divider {
    width: 1px;
    background: rgba(201,169,110,0.15);
    align-self: stretch;
  }
  .card-footer {
    display: flex;
    justify-content: space-between;
    align-items: center;
  }
  .footer-text {
    font-size: 9px;
    color: rgba(255,255,255,0.2);
    letter-spacing: 1px;
  }
  .chip {
    width: 32px;
    height: 24px;
    background: linear-gradient(135deg, #c9a96e, #a07840);
    border-radius: 4px;
    opacity: 0.6;
  }
  .wallet-buttons {
    margin-top: 24px;
    display: flex;
    gap: 12px;
    justify-content: center;
    flex-wrap: wrap;
  }
  .wallet-btn {
    display: inline-flex;
    align-items: center;
    gap: 8px;
    background: #000;
    color: #fff;
    border: 1px solid rgba(255,255,255,0.2);
    border-radius: 10px;
    padding: 10px 18px;
    font-size: 12px;
    font-weight: 600;
    text-decoration: none;
    cursor: pointer;
    transition: all 0.2s;
  }
  .wallet-btn:hover { background: #111; border-color: rgba(255,255,255,0.4); }
  .wallet-btn.apple { background: #000; }
  .wallet-btn.google { background: #fff; color: #333; border-color: #ddd; }
  .wallet-btn img { width: 18px; height: 18px; }
</style>
</head>
<body>
<div class="card-wrapper">
  <div class="card">
    <div class="card-header">
      <div class="logo">KADIO<br>COIFFURE<span>EST. ${joinDate}</span></div>
      <div class="status-badge">${status}</div>
    </div>
    <div class="member-name">${name}</div>
    <div class="member-id">N° ${memberId}</div>
    <div class="qr-container">
      <img src="${qrDataURL}" alt="QR Code Membre" />
    </div>
    <div class="scan-hint">Scanner pour accéder au profil</div>
    <div class="stats">
      <div class="stat">
        <span class="stat-value">${points}</span>
        <span class="stat-label">Points</span>
      </div>
      <div class="divider"></div>
      <div class="stat">
        <span class="stat-value">${isVIP ? 'VIP' : 'STD'}</span>
        <span class="stat-label">Statut</span>
      </div>
      <div class="divider"></div>
      <div class="stat">
        <span class="stat-value">${joinDate}</span>
        <span class="stat-label">Membre</span>
      </div>
    </div>
    <div class="card-footer">
      <span class="footer-text">kadiocoiffure.vercel.app</span>
      <div class="chip"></div>
    </div>
  </div>
  <div class="wallet-buttons">
    <a href="${pkpassUrl}" class="wallet-btn apple">
      <svg width="18" height="18" viewBox="0 0 24 24" fill="white"><path d="M18.71 19.5c-.83 1.24-1.71 2.45-3.05 2.47-1.34.03-1.77-.79-3.29-.79-1.53 0-2 .77-3.27.82-1.31.05-2.3-1.32-3.14-2.53C4.25 17 2.94 12.45 4.7 9.39c.87-1.52 2.43-2.48 4.12-2.51 1.28-.02 2.5.87 3.29.87.78 0 2.26-1.07 3.8-.91.65.03 2.47.26 3.64 1.98-.09.06-2.17 1.28-2.15 3.81.03 3.02 2.65 4.03 2.68 4.04-.03.07-.42 1.44-1.38 2.83M13 3.5c.73-.83 1.94-1.46 2.94-1.5.13 1.17-.34 2.35-1.04 3.19-.69.85-1.83 1.51-2.95 1.42-.15-1.15.41-2.35 1.05-3.11z"/></svg>
      Apple Wallet
    </a>
    <a href="#" class="wallet-btn google" onclick="alert('Google Wallet — bientôt disponible!')">
      <svg width="18" height="18" viewBox="0 0 24 24"><path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" fill="#4285F4"/><path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853"/><path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" fill="#FBBC05"/><path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335"/></svg>
      Google Wallet
    </a>
  </div>
</div>
</body>
</html>`;
}

/**
 * Génère un .pkpass demo (sans vrai certificat Apple)
 * Retourne null si passkit-generator n'est pas dispo ou sans certs
 */
async function generatePkPass(client, loyaltyPoints) {
  try {
    const { PKPass } = require('passkit-generator');
    const path = require('path');
    const fs = require('fs');

    // Chercher les certs dans /certs ou /tmp/certs
    const certDir = process.env.PASS_CERT_DIR || path.join(__dirname, '../../certs');
    if (!fs.existsSync(certDir)) {
      return null; // Pas de certs — mode demo HTML uniquement
    }

    const name = client.given_name
      ? `${client.given_name} ${client.family_name || ''}`.trim()
      : (client.name || 'Membre');
    const points = loyaltyPoints || 0;
    const memberId = (client.id || client.customer_id || '').slice(0, 8).toUpperCase();

    const pass = await PKPass.from({
      model: path.join(certDir, 'KadioCoiffure.pass'),
      certificates: {
        wwdr: path.join(certDir, 'wwdr.pem'),
        signerCert: path.join(certDir, 'signerCert.pem'),
        signerKey: path.join(certDir, 'signerKey.pem'),
        signerKeyPassphrase: process.env.PASS_KEY_PASSPHRASE || ''
      }
    }, {
      serialNumber: client.id || client.customer_id,
      description: 'Carte Membre Kadio Coiffure',
    });

    pass.props['storeCard'] = {
      primaryFields: [{ key: 'points', label: 'Points Fidélité', value: String(points) }],
      secondaryFields: [{ key: 'name', label: 'Membre', value: name }],
      auxiliaryFields: [{ key: 'id', label: 'N° Membre', value: memberId }]
    };

    return pass.getAsBuffer();
  } catch (e) {
    console.warn('[wallet-service] pkpass non disponible:', e.message);
    return null;
  }
}

module.exports = { generateQRCode, generateQRCodeDataURL, generateWalletPreviewHTML, generatePkPass };
