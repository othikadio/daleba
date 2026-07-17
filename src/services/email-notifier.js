/**
 * DALEBA — Email Notifier (Étape 3)
 * Envoie un courriel de notification à Ulrich dès qu'une proposition
 * est générée par l'Agent Rédacteur.
 *
 * Priorité des providers :
 *  1. Resend REST API (RESEND_API_KEY env var)
 *  2. SMTP custom  (SMTP_HOST + SMTP_USER + SMTP_PASS env vars)
 *  3. Ethereal     (auto-généré, prévisualisation URL dans les logs — dev only)
 */
'use strict';

const https       = require('https');
const nodemailer  = require('nodemailer');
const { normalizeBudget } = require('./pricing-guard');

const RESEND_KEY   = process.env.RESEND_API_KEY;
const ULRICH_EMAIL = process.env.NOTIFICATION_EMAIL || 'kadioothniel@yahoo.fr';
const FROM_NAME    = 'DALEBA Radar';
const FROM_ADDR    = process.env.EMAIL_FROM || 'onboarding@resend.dev';
const GMAIL_USER   = process.env.GMAIL_USER;
const GMAIL_PASS   = process.env.GMAIL_APP_PASSWORD;

// ── Provider 1 : Resend REST API ──────────────────────────────────────────────
async function sendViaResend(subject, html, text) {
  const key = RESEND_KEY;
  if (!key) throw new Error('RESEND_API_KEY non configuré');

  const body = JSON.stringify({
    from:    `${FROM_NAME} <${FROM_ADDR}>`,
    to:      [ULRICH_EMAIL],
    subject,
    html,
    text,
  });

  return new Promise((resolve, reject) => {
    const req = https.request({
      hostname: 'api.resend.com',
      path:     '/emails',
      method:   'POST',
      headers: {
        'Authorization':  `Bearer ${key}`,
        'Content-Type':   'application/json',
        'Content-Length': Buffer.byteLength(body),
      },
      timeout: 15000,
    }, (res) => {
      let data = '';
      res.on('data', c => { data += c; });
      res.on('end', () => {
        const json = JSON.parse(data);
        if (res.statusCode === 429) { console.warn('[email-notifier] Resend quota dépassé — bascule Gmail'); return resolve({ provider: 'resend', skipped: true, reason: 'quota_exceeded' }); }
        if (res.statusCode >= 400) { console.warn(`[email-notifier] Resend ${res.statusCode}: ${data} — email ignoré`); return resolve({ provider: 'resend', skipped: true, reason: data }); }
        resolve({ provider: 'resend', id: json.id });
      });
    });
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error('Resend timeout')); });
    req.write(body);
    req.end();
  });
}

// ── Provider 2 : SMTP custom (Gmail, Yahoo, Brevo, etc.) ─────────────────────
async function sendViaSMTP(subject, html, text) {
  const host = process.env.SMTP_HOST;
  const user = process.env.SMTP_USER;
  const pass = process.env.SMTP_PASS;
  const port = parseInt(process.env.SMTP_PORT || '587');

  if (!host || !user || !pass) throw new Error('SMTP_HOST / SMTP_USER / SMTP_PASS non configurés');

  const transporter = nodemailer.createTransport({
    host,
    port,
    secure: port === 465,
    auth: { user, pass },
    tls: { rejectUnauthorized: false },
  });

  const info = await transporter.sendMail({
    from:    `"${FROM_NAME}" <${user}>`,
    to:      ULRICH_EMAIL,
    subject,
    html,
    text,
  });

  return { provider: 'smtp', messageId: info.messageId };
}

// ── Provider Gmail direct (GMAIL_USER + GMAIL_APP_PASSWORD) ──────────────────
async function sendViaGmail(subject, html, text) {
  if (!GMAIL_USER || !GMAIL_PASS) throw new Error('GMAIL_USER / GMAIL_APP_PASSWORD non configurés');

  const transporter = nodemailer.createTransport({
    service: 'gmail',
    auth: { user: GMAIL_USER, pass: GMAIL_PASS },
  });

  const info = await transporter.sendMail({
    from:    `"${FROM_NAME}" <${GMAIL_USER}>`,
    to:      ULRICH_EMAIL,
    replyTo: ULRICH_EMAIL,
    subject,
    html,
    text,
  });

  console.log(`[email-notifier] ✅ Gmail OK — ${info.messageId}`);
  return { provider: 'gmail', messageId: info.messageId };
}

// ── Provider 3 : Ethereal (test/dev uniquement) ───────────────────────────────
async function sendViaEthereal(subject, html, text) {
  const testAccount = await nodemailer.createTestAccount();
  const transporter = nodemailer.createTransport({
    host:   'smtp.ethereal.email',
    port:   587,
    secure: false,
    auth: { user: testAccount.user, pass: testAccount.pass },
  });

  const info = await transporter.sendMail({
    from:    `"${FROM_NAME}" <${testAccount.user}>`,
    to:      ULRICH_EMAIL,
    subject,
    html,
    text,
  });

  const previewUrl = nodemailer.getTestMessageUrl(info);
  console.log(`[email-notifier] ⚠️  MODE ETHEREAL (test) — prévisualisation : ${previewUrl}`);
  return { provider: 'ethereal', previewUrl, messageId: info.messageId };
}

// ── Constructeur HTML du courriel ─────────────────────────────────────────────
function buildEmailContent(opportunity, proposalText, pricing = null, paymentUrl = null) {
  const score        = opportunity.score || '—';
  const title        = opportunity.title || '(sans titre)';
  // Package catalogue recommandé selon budget
  const budgetUSD    = opportunity.budget_usd || opportunity.budget || 0;
  const pkg          = recommendPackage(budgetUSD);
  const platform     = opportunity.source_platform || '—';
  const country      = opportunity.country || 'International';
  const category     = opportunity.category || '—';

  // ── Prix plancher : jamais afficher 0$ dans les notifications ─────────────
  const budgetNorm   = normalizeBudget(opportunity);
  const budget       = budgetNorm.was_floored
    ? `⚠️ ${budgetNorm.budget_display}`
    : budgetNorm.budget_display;
  const sourceUrl    = opportunity.source_url || null;
  const detectedAt   = opportunity.detected_at
    ? new Date(opportunity.detected_at).toLocaleDateString('fr-CA', { dateStyle: 'long' })
    : '—';

  // Texte plat
  const plainText = [
    `[DALEBA USINE] Nouvelle opportunité — Score ${score}/100`,
    ``,
    `Titre     : ${title}`,
    `Plateforme: ${platform} · ${country}`,
    `Catégorie : ${category}`,
    `Budget    : ${budget}`,
    `Détectée  : ${detectedAt}`,
    sourceUrl ? `Lien source: ${sourceUrl}` : '',
    pricing ? `` : '',
    pricing ? `Prix DALEBA calculé : ${pricing.finalPrice} CAD (${pricing.strategy?.label || '?'}) | Marché: ${pricing.marketRateUSD} USD | -${pricing.discountPct}%` : '',
    paymentUrl ? `Lien de paiement Stripe : ${paymentUrl}` : '',
    ``,
    `━━ PROPOSITION DALEBA ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`,
    ``,
    proposalText,
    ``,
    `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`,
    ``,
    `Dashboard : https://daleba.vercel.app/admin-usine.html`,
  ].filter(l => l !== null).join('\n');

  // HTML
  const scoreColor = score >= 80 ? '#2da44e' : score >= 60 ? '#c9a84c' : '#c4622d';
  const proposalHtml = proposalText
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/\n/g, '<br>');

  const html = `<!DOCTYPE html>
<html lang="fr">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>DALEBA Radar — Nouvelle opportunité</title>
</head>
<body style="margin:0;padding:0;background:#0d1117;font-family:'Segoe UI',Arial,sans-serif;color:#e6edf3;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#0d1117;padding:32px 16px;">
    <tr><td align="center">
      <table width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;">

        <!-- Header -->
        <tr><td style="background:#161b22;border-radius:12px 12px 0 0;padding:28px 32px;border-bottom:2px solid #c9a84c;">
          <table width="100%" cellpadding="0" cellspacing="0">
            <tr>
              <td>
                <div style="font-size:11px;font-weight:700;letter-spacing:0.12em;text-transform:uppercase;color:#c9a84c;margin-bottom:6px;">Radar Planétaire DALEBA</div>
                <div style="font-size:22px;font-weight:700;color:#e6edf3;line-height:1.3;">${title.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')}</div>
              </td>
              <td align="right" valign="top" style="padding-left:16px;">
                <div style="background:${scoreColor};color:#fff;font-size:20px;font-weight:800;border-radius:50%;width:52px;height:52px;display:inline-flex;align-items:center;justify-content:center;text-align:center;line-height:52px;vertical-align:middle;">${score}</div>
                <div style="font-size:10px;color:#8b949e;text-align:center;margin-top:3px;">/100</div>
              </td>
            </tr>
          </table>
        </td></tr>

        <!-- Meta -->
        <tr><td style="background:#161b22;padding:20px 32px;border-bottom:1px solid #21262d;">
          <table width="100%" cellpadding="0" cellspacing="0">
            <tr>
              <td style="padding:6px 0;width:50%;">
                <span style="font-size:11px;color:#8b949e;text-transform:uppercase;letter-spacing:0.06em;">Plateforme</span><br>
                <span style="font-size:14px;font-weight:600;color:#e6edf3;">${platform}</span>
              </td>
              <td style="padding:6px 0;width:50%;">
                <span style="font-size:11px;color:#8b949e;text-transform:uppercase;letter-spacing:0.06em;">Pays</span><br>
                <span style="font-size:14px;font-weight:600;color:#e6edf3;">${country}</span>
              </td>
            </tr>
            <tr>
              <td style="padding:6px 0;">
                <span style="font-size:11px;color:#8b949e;text-transform:uppercase;letter-spacing:0.06em;">Catégorie</span><br>
                <span style="font-size:14px;font-weight:600;color:#c9a84c;">${category}</span>
              </td>
              <td style="padding:6px 0;">
                <span style="font-size:11px;color:#8b949e;text-transform:uppercase;letter-spacing:0.06em;">Budget estimé</span><br>
                <span style="font-size:14px;font-weight:600;color:#2da44e;">${budget}</span>
              </td>
            </tr>
            ${sourceUrl ? `<tr><td colspan="2" style="padding:10px 0 0;">
              <a href="${sourceUrl}" style="display:inline-block;background:#21262d;color:#58a6ff;text-decoration:none;font-size:13px;font-weight:600;padding:8px 16px;border-radius:6px;border:1px solid #30363d;">Voir l'annonce originale</a>
            </td></tr>` : ''}
          </table>
        </td></tr>

        <!-- Pricing Squad Block -->
        ${pricing ? `
        <tr><td style="background:#0d1117;padding:16px 32px;border-bottom:1px solid #21262d;">
          <table width="100%" cellpadding="0" cellspacing="0">
            <tr>
              <td style="padding:6px 0;width:33%;">
                <span style="font-size:11px;color:#8b949e;text-transform:uppercase;letter-spacing:0.06em;">📈 Prix DALEBA Calculé</span><br>
                <span style="font-size:20px;font-weight:800;color:#c9a84c;">${pricing.finalPrice.toLocaleString('fr-CA')} $CAD</span>
              </td>
              <td style="padding:6px 0;width:33%;">
                <span style="font-size:11px;color:#8b949e;text-transform:uppercase;letter-spacing:0.06em;">Marché Détecté</span><br>
                <span style="font-size:14px;font-weight:600;color:#58a6ff;">${pricing.marketRateUSD} USD</span>
                <span style="font-size:11px;color:#8b949e;"> (${pricing.confidence || '?'})</span>
              </td>
              <td style="padding:6px 0;width:33%;">
                <span style="font-size:11px;color:#8b949e;text-transform:uppercase;letter-spacing:0.06em;">Stratégie</span><br>
                <span style="font-size:14px;font-weight:700;color:#2da44e;">${pricing.strategy?.emoji || ''} ${pricing.strategy?.label || '?'} (-${pricing.discountPct}%)</span>
              </td>
            </tr>
            ${paymentUrl ? `<tr><td colspan="3" style="padding:12px 0 4px;">
              <a href="${paymentUrl}" style="display:inline-block;background:linear-gradient(135deg,#c9a84c,#e8c86d);color:#0d1117;text-decoration:none;font-size:13px;font-weight:700;padding:10px 24px;border-radius:6px;letter-spacing:0.04em;">
                💳 Lien Stripe Calculé — ${pricing.finalPrice} $CAD
              </a>
              <span style="font-size:10px;color:#484f58;margin-left:8px;">${paymentUrl}</span>
            </td></tr>` : ''}
          </table>
        </td></tr>` : ''}

        <!-- Proposal -->
        <tr><td style="background:#0d1117;padding:0;">
          <div style="background:#161b22;border-left:3px solid #c9a84c;margin:0;padding:20px 32px;">
            <div style="font-size:11px;font-weight:700;letter-spacing:0.1em;text-transform:uppercase;color:#c9a84c;margin-bottom:14px;">Proposition générée par l'Agent Rédacteur</div>
            <div style="font-size:14px;line-height:1.75;color:#c9d1d9;">${proposalHtml}</div>
          </div>
        </td></tr>

        <!-- DALEBA Package Recommandé -->
        <tr><td style="background:#0d1117;padding:20px 32px;border-top:1px solid #21262d;">
          <div style="background:linear-gradient(135deg,rgba(124,58,237,0.12),rgba(79,70,229,0.06));border:1px solid rgba(124,58,237,0.3);border-radius:12px;padding:18px 22px;margin-bottom:14px;">
            <div style="font-size:10px;color:#8b949e;text-transform:uppercase;letter-spacing:0.1em;margin-bottom:8px;">RECOMMANDATION DALEBA</div>
            <div style="font-size:17px;font-weight:700;color:#e6edf3;margin-bottom:5px;">${pkg.name} — ${pkg.cad} CAD</div>
            <div style="font-size:12px;color:#8b949e;margin-bottom:14px;">${pkg.reason}</div>
            <a href="${pkg.url}" style="display:inline-block;background:#7c3aed;color:#fff;text-decoration:none;font-size:13px;font-weight:700;padding:10px 22px;border-radius:8px;">💳 Payer maintenant — ${pkg.cad} CAD</a>
            &nbsp;
            <a href="${paymentUrl || pkg.url}" style="display:inline-block;background:#21262d;color:#c9a84c;border:1px solid #c9a84c;text-decoration:none;font-size:13px;font-weight:700;padding:10px 22px;border-radius:8px;">📋 Lien proposition client</a>
          </div>
          <div style="background:#161b22;border:1px solid #21262d;border-radius:10px;padding:14px 18px;">
            <div style="font-size:11px;font-weight:700;color:#c9a84c;margin-bottom:8px;">🤖 CE QUE DALEBA OFFRE</div>
            <div style="font-size:11px;color:#8b949e;line-height:1.8;">
              ✓ Agents IA autonomes 24/7 &nbsp;·&nbsp; ✓ Prise de RDV automatisée &nbsp;·&nbsp; ✓ Marketing IA (Meta/Google)<br>
              ✓ Fidélisation clients &nbsp;·&nbsp; ✓ Tableau de bord temps réel &nbsp;·&nbsp; ✓ Comptabilité automatisée
            </div>
            <div style="margin-top:10px;padding-top:10px;border-top:1px solid #21262d;font-size:11px;color:#484f58;">
              📧 <a href="mailto:kadioothniel@yahoo.fr" style="color:#7c3aed;text-decoration:none;">kadioothniel@yahoo.fr</a>
              &nbsp;·&nbsp; 🌐 <a href="https://daleba-api-production.up.railway.app/vente" style="color:#7c3aed;text-decoration:none;">Page de vente DALEBA</a>
              &nbsp;·&nbsp; <a href="https://daleba-api-production.up.railway.app/admin/radar" style="color:#c9a84c;text-decoration:none;">🤖 Dashboard Usine</a>
            </div>
          </div>
        </td></tr>

      </table>
    </td></tr>
  </table>
</body>
</html>`;

  const subject = `⚡ DALEBA Usine — Opportunité Score ${score}/100 : ${title.slice(0, 55)}${title.length > 55 ? '…' : ''}`;

  return { subject, html, plainText };
}

// ── Recommander le bon package DALEBA selon le budget ────────────────────────
function recommendPackage(budgetUSD) {
  const b = parseFloat(budgetUSD) || 0;
  if (b <= 0 || b < 300)  return { name: '🔍 Audit IA Express', cad: '150$', url: 'https://buy.stripe.com/00w00i50N1TAbo2e7B6wE1X', reason: 'Idéal pour démarrer : diagnostic complet livré en 48h.' };
  if (b < 2000)           return { name: '🚀 Pack Starter',     cad: '750$', url: 'https://buy.stripe.com/7sY8wOal7gOu4ZE6F96wE1Y', reason: 'Site IA + réservations + automatisations de base.' };
  if (b < 8000)           return { name: '⚡ Pack Business',    cad: '2 500$', url: 'https://buy.stripe.com/6oUeVcgJv55Mcs61kP6wE1Z', reason: 'Solution complète : agents IA + marketing + fidélisation.' };
  return                         { name: '👑 Pack Enterprise',  cad: '5 000$', url: 'https://buy.stripe.com/9B6cN41OBfKqbo2aVp6wE20', reason: 'Sur mesure + accompagnement 3 mois + formation équipe.' };
}

// ── Fonction principale exportée ──────────────────────────────────────────────
/**
 * Envoie la notification email à Ulrich.
 * @param {Object} opportunity   - Ligne daleba_opportunities
 * @param {string} proposalText  - Texte brut de la proposition
 * @returns {Promise<Object>}    - { provider, ... }
 */
async function notifyProposal(opportunity, proposalText, pricingContext = {}) {
  // ⛔ USINE ARRÊTÉE — emails désactivés par Ulrich le 2026-06-03
  console.log('[email-notifier] ⛔ KILL SWITCH ACTIF — email bloqué:', opportunity?.title?.slice(0,50));
  return { provider: 'disabled', skipped: true, reason: 'kill_switch' };
  // eslint-disable-next-line no-unreachable
  // ── Sécurité prix : alerte si budget toujours 0 après normalisation ───────
  const { normalizeBudget: norm } = require('./pricing-guard');
  const budgetCheck = norm(opportunity);
  if (budgetCheck.was_floored) {
    console.warn(
      `[email-notifier] ⚠️  ALERTE MAINTENANCE : budget à 0 sur "${(opportunity.title || '').slice(0, 60)}" ` +
      `— plancher appliqué, notification envoyée avec tarif DALEBA.`
    );
  }

  // ── Extraire les données de pricing du Squad #801-850 ───────────────────
  const pricing    = pricingContext.pricing    || null;
  const paymentUrl = pricingContext.paymentUrl || null;

  const { subject, html, plainText } = buildEmailContent(opportunity, proposalText, pricing, paymentUrl);

  console.log(`[email-notifier] Envoi à ${ULRICH_EMAIL} — "${subject.slice(0, 80)}"`);

  // Ordre : Resend → Gmail → SMTP → Ethereal
  if (RESEND_KEY) {
    const r = await sendViaResend(subject, html, plainText);
    if (!r.skipped) return r;
    console.warn('[email-notifier] Resend skip — bascule Gmail');
  }
  if (GMAIL_USER && GMAIL_PASS) {
    return sendViaGmail(subject, html, plainText);
  }
  if (process.env.SMTP_HOST && process.env.SMTP_USER && process.env.SMTP_PASS) {
    return sendViaSMTP(subject, html, plainText);
  }
  return sendViaEthereal(subject, html, plainText);
}

module.exports = { notifyProposal, buildEmailContent };
