/**
 * DALEBA — Agent Envoyeur (Étape 5)
 *
 * Stratégies par plateforme :
 *  1. Email direct  — si un email de contact est extrait de la description
 *  2. Manuel assisté — si pas d'email : URL source + proposition prête à coller
 *
 * Aucune soumission automatique sur Upwork/HN/Remotive (pas d'API publique,
 * risque de bannissement). L'humain valide toujours via le bouton Propulser.
 */
'use strict';

const https = require('https');

const RESEND_KEY   = process.env.RESEND_API_KEY || 're_hVMJtA4G_5BydQQv4noQx767KpL4xowMk';
const DALEBA_FROM  = 'onboarding@resend.dev';
const DALEBA_NAME  = 'DALEBA — Services Tech';

// ── Extraction email de contact depuis le texte ───────────────────────────────
function extractContactEmail(text = '') {
  const emailRx = /\b([a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,})\b/g;
  const matches = [...text.matchAll(emailRx)]
    .map(m => m[1].toLowerCase())
    .filter(e =>
      !e.includes('noreply') &&
      !e.includes('no-reply') &&
      !e.includes('example.com') &&
      !e.includes('ethereal') &&
      !e.includes('resend') &&
      !e.includes('daleba')
    );
  return matches[0] || null;
}

// ── Construire l'objet du courriel de candidature ─────────────────────────────
function buildApplicationEmail(opportunity, proposalText, contactEmail) {
  const lang   = (opportunity.language_original || 'en') === 'fr' ? 'fr' : 'en';
  const isFr   = lang === 'fr';
  const title  = opportunity.title || '(sans titre)';
  const source = opportunity.source_platform || '';

  const subject = isFr
    ? `Proposition de services — ${title.slice(0, 80)}`
    : `Service Proposal — ${title.slice(0, 80)}`;

  // Formater le texte de la proposition en HTML propre
  const proposalHtml = proposalText
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/\n\n/g, '</p><p>')
    .replace(/\n/g, '<br>');

  const footer = isFr
    ? `<hr style="border:none;border-top:1px solid #e2e8f0;margin:24px 0"><p style="font-size:12px;color:#94a3b8">Ce message a été envoyé via DALEBA · Agence Tech · Automatisation & IA<br>En réponse à l'annonce : <a href="${opportunity.source_url || '#'}">${source}</a></p>`
    : `<hr style="border:none;border-top:1px solid #e2e8f0;margin:24px 0"><p style="font-size:12px;color:#94a3b8">This message was sent via DALEBA · Tech Agency · Automation & AI<br>In response to listing: <a href="${opportunity.source_url || '#'}">${source}</a></p>`;

  const html = `<!DOCTYPE html><html><head><meta charset="UTF-8"></head>
<body style="font-family:'Segoe UI',Arial,sans-serif;max-width:640px;margin:0 auto;padding:24px;color:#1e293b;line-height:1.7">
<p>${proposalHtml}</p>${footer}</body></html>`;

  return { subject, html, text: proposalText };
}

// ── Envoi via Resend ──────────────────────────────────────────────────────────
function sendEmail(to, subject, html, text) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify({
      from:    `${DALEBA_NAME} <${DALEBA_FROM}>`,
      to:      [to],
      subject,
      html,
      text,
    });
    const req = https.request({
      hostname: 'api.resend.com',
      path:     '/emails',
      method:   'POST',
      headers: {
        'Authorization':  `Bearer ${RESEND_KEY}`,
        'Content-Type':   'application/json',
        'Content-Length': Buffer.byteLength(body),
      },
      timeout: 15000,
    }, (res) => {
      let data = '';
      res.on('data', c => { data += c; });
      res.on('end', () => {
        try {
          const json = JSON.parse(data);
          if (res.statusCode >= 400) reject(new Error(`Resend ${res.statusCode}: ${data.slice(0,200)}`));
          else resolve(json);
        } catch (e) { reject(new Error('Parse: ' + data.slice(0, 100))); }
      });
    });
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error('Resend timeout')); });
    req.write(body);
    req.end();
  });
}

// ── Stratégie par plateforme ──────────────────────────────────────────────────
function getPlatformStrategy(platform = '', sourceUrl = '', description = '') {
  const p = platform.toLowerCase();

  // Email extrait de la description (universel — toutes plateformes)
  const emailInDesc = extractContactEmail(description);
  if (emailInDesc) return { method: 'email_direct', contactEmail: emailInDesc };

  // Stratégies spécifiques
  if (p.includes('upwork'))          return { method: 'manual', reason: 'Upwork requiert une session OAuth — postule via le lien direct' };
  if (p.includes('hacker'))          return { method: 'manual', reason: 'HackerNews — poste un commentaire sur le fil ou contacte directement' };
  if (p.includes('remotive'))        return { method: 'manual', reason: 'Remotive redirige vers le site employeur — clique le lien source' };
  if (p.includes('weworkremotely'))  return { method: 'manual', reason: 'WeWorkRemotely redirige vers le site employeur — clique le lien source' };
  if (p.includes('freelancer'))      return { method: 'manual', reason: 'Freelancer requiert une session de compte — postule via le lien direct' };

  return { method: 'manual', reason: 'Aucun email détecté — soumission manuelle via le lien source' };
}

// ── Fonction principale ───────────────────────────────────────────────────────
/**
 * Envoie la proposition au contact identifié (email ou méthode manuelle).
 * @param {Object} opportunity  - Ligne daleba_opportunities
 * @param {Object} proposal     - Ligne daleba_proposals
 * @returns {Promise<Object>}   - { method, success, contactEmail?, resendId?, reason? }
 */
async function sendProposal(opportunity, proposal) {
  const descText = [
    opportunity.description_orig || '',
    opportunity.description_fr   || '',
  ].join(' ');

  const strategy = getPlatformStrategy(
    opportunity.source_platform,
    opportunity.source_url || '',
    descText
  );

  if (strategy.method === 'email_direct') {
    const { subject, html, text } = buildApplicationEmail(
      opportunity,
      proposal.generated_text,
      strategy.contactEmail
    );
    const result = await sendEmail(strategy.contactEmail, subject, html, text);
    console.log(`[sender] Email envoyé à ${strategy.contactEmail} — Resend ID: ${result.id}`);
    return {
      method:       'email_direct',
      success:      true,
      contactEmail: strategy.contactEmail,
      resendId:     result.id,
    };
  }

  // Méthode manuelle : pas d'envoi automatique
  console.log(`[sender] Méthode manuelle — ${strategy.reason}`);
  return {
    method:   'manual',
    success:  false,
    reason:   strategy.reason,
    sourceUrl: opportunity.source_url,
  };
}

module.exports = { sendProposal, extractContactEmail, getPlatformStrategy };
