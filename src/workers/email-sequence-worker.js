/**
 * KADIO OS — Axe 3: Séquences email automatiques
 * 3 étapes: J+0 (rapport PDF), J+3 (suivi), J+7 (offre Stripe)
 */

const fs = require('fs');
const axios = require('axios');

const RESEND_API_KEY = process.env.RESEND_API_KEY || 're_hVMJtA4G_5BydQQv4noQx767KpL4xowMk';

async function sendEmail(data) {
  const res = await axios.post('https://api.resend.com/emails', data, {
    headers: { 'Authorization': `Bearer ${RESEND_API_KEY}`, 'Content-Type': 'application/json' }
  });
  return res.data;
}

// =============== Templates email ===============

function getEmailStep1(lead, score, paymentLink) {
  return {
    subject: `Votre audit SEO gratuit — ${score}/100`,
    html: `
<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><style>
body { font-family: Arial, sans-serif; background: #f5f5f5; margin: 0; padding: 0; }
.container { max-width: 600px; margin: 30px auto; background: white; border-radius: 12px; overflow: hidden; }
.header { background: #0d1117; padding: 30px 40px; }
.header h1 { color: #c9a84c; margin: 0; font-size: 24px; }
.header p { color: #8b949e; margin: 8px 0 0; }
.body { padding: 35px 40px; }
.score-box { background: #f0f9ff; border-left: 4px solid #c9a84c; padding: 20px; margin: 20px 0; border-radius: 0 8px 8px 0; }
.score-number { font-size: 56px; font-weight: bold; color: ${score >= 70 ? '#22c55e' : score >= 40 ? '#f59e0b' : '#ef4444'}; display: inline; }
.cta { display: block; background: #c9a84c; color: white; text-decoration: none; padding: 16px 32px; border-radius: 8px; text-align: center; font-weight: bold; font-size: 16px; margin: 25px 0; }
.footer { background: #0d1117; padding: 20px 40px; color: #8b949e; font-size: 12px; }
</style></head>
<body>
<div class="container">
  <div class="header">
    <h1>DALEBA</h1>
    <p>Votre rapport d'audit SEO gratuit</p>
  </div>
  <div class="body">
    <p>Bonjour ${lead.company_name || 'chère équipe'},</p>
    <p>Notre système a analysé votre site web <strong>${lead.website}</strong> et voici les résultats :</p>
    <div class="score-box">
      <div class="score-number">${score}</div>
      <span style="font-size: 24px; color: #64748b;">/100</span>
      <p style="margin: 10px 0 0; color: #475569;">
        ${score >= 70 ? '✅ Bon score — quelques optimisations possibles' : score >= 40 ? '⚠️ Score moyen — des améliorations significatives sont nécessaires' : '🚨 Score critique — votre site perd des clients potentiels chaque jour'}
      </p>
    </div>
    <p>📎 <strong>Votre rapport PDF détaillé</strong> est en pièce jointe. Il contient :</p>
    <ul>
      <li>L'analyse complète des ${lead.audit_score ? 'problèmes' : 'points'} identifiés</li>
      <li>Les recommandations prioritaires</li>
      <li>Un plan d'action concret</li>
    </ul>
    <a href="https://kadiocoiffure.vercel.app" class="cta">Voir nos solutions →</a>
    <p style="color: #64748b; font-size: 14px;">Des questions ? Répondez directement à cet email ou appelez-nous.</p>
  </div>
  <div class="footer">
    <p>DALEBA — Solutions numériques pour salons de coiffure | kadiocoiffure.vercel.app</p>
    <p style="margin: 5px 0 0;">Pour vous désabonner, répondez avec "STOP".</p>
  </div>
</div>
</body>
</html>`
  };
}

function getEmailStep2(lead) {
  return {
    subject: `Avez-vous vu votre rapport SEO ? — ${lead.company_name}`,
    html: `
<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><style>
body { font-family: Arial, sans-serif; background: #f5f5f5; }
.container { max-width: 600px; margin: 30px auto; background: white; border-radius: 12px; overflow: hidden; }
.header { background: #0d1117; padding: 25px 40px; }
.header h1 { color: #c9a84c; margin: 0; font-size: 20px; }
.body { padding: 30px 40px; }
.cta { display: block; background: #c9a84c; color: white; text-decoration: none; padding: 14px 28px; border-radius: 8px; text-align: center; font-weight: bold; margin: 20px 0; }
.footer { background: #0d1117; padding: 15px 40px; color: #8b949e; font-size: 11px; }
</style></head>
<body>
<div class="container">
  <div class="header"><h1>DALEBA — Suivi de votre audit</h1></div>
  <div class="body">
    <p>Bonjour ${lead.company_name || 'chère équipe'},</p>
    <p>Il y a 3 jours, nous vous avons envoyé l'audit SEO de <strong>${lead.website}</strong>.</p>
    <p>Avez-vous eu le temps de le consulter ? 🤔</p>
    <p>Si vous n'avez pas encore pu l'analyser, voici les points essentiels :</p>
    <ul>
      <li>Votre score SEO actuel : <strong>${lead.audit_score || 'À découvrir'}/100</strong></li>
      <li>Des problèmes techniques identifiés ralentissent votre référencement</li>
      <li>Chaque jour sans correction = des clients qui vont chez la concurrence</li>
    </ul>
    <p><strong>Bonne nouvelle :</strong> Tous ces problèmes sont 100% corrigeables — et notre équipe peut s'en occuper rapidement.</p>
    <a href="https://kadiocoiffure.vercel.app" class="cta">Discutons de votre projet →</a>
  </div>
  <div class="footer"><p>DALEBA | Pour vous désabonner, répondez avec "STOP"</p></div>
</div>
</body>
</html>`
  };
}

function getEmailStep3(lead, paymentLink) {
  return {
    subject: `Offre limitée — Correction SEO complète pour ${lead.company_name}`,
    html: `
<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><style>
body { font-family: Arial, sans-serif; background: #f5f5f5; }
.container { max-width: 600px; margin: 30px auto; background: white; border-radius: 12px; overflow: hidden; }
.header { background: linear-gradient(135deg, #0d1117 0%, #1a2332 100%); padding: 30px 40px; }
.header h1 { color: #c9a84c; margin: 0; font-size: 22px; }
.body { padding: 35px 40px; }
.offer-box { background: #fffbeb; border: 2px solid #c9a84c; border-radius: 12px; padding: 25px; margin: 20px 0; text-align: center; }
.price { font-size: 48px; font-weight: bold; color: #0d1117; }
.cta { display: block; background: linear-gradient(135deg, #c9a84c, #e8c86d); color: #0d1117; text-decoration: none; padding: 18px 36px; border-radius: 8px; text-align: center; font-weight: bold; font-size: 18px; margin: 20px 0; }
.footer { background: #0d1117; padding: 15px 40px; color: #8b949e; font-size: 11px; }
</style></head>
<body>
<div class="container">
  <div class="header"><h1>🚀 DALEBA — Offre Spéciale Limitée</h1></div>
  <div class="body">
    <p>Bonjour ${lead.company_name || 'chère équipe'},</p>
    <p>Ceci est notre dernier message concernant votre audit SEO. Nous voulons vous faire une offre exceptionnelle.</p>
    <div class="offer-box">
      <p style="margin: 0 0 10px; font-size: 16px; font-weight: bold;">CORRECTION SEO COMPLÈTE</p>
      <div class="price">150$</div>
      <p style="color: #64748b;">Paiement unique — Premier mois offert</p>
      <ul style="text-align: left; margin: 15px 0; padding-left: 20px;">
        <li>✅ Correction de tous les problèmes identifiés</li>
        <li>✅ Optimisation mots-clés coiffure + ville</li>
        <li>✅ Configuration Google My Business</li>
        <li>✅ Rapport de suivi 30 jours</li>
        <li>✅ Support prioritaire par email</li>
      </ul>
    </div>
    <a href="${paymentLink || 'https://kadiocoiffure.vercel.app'}" class="cta">💳 Profiter de l'offre maintenant →</a>
    <p style="color: #ef4444; font-size: 13px; text-align: center;"><strong>⏰ Offre valable 48h uniquement</strong></p>
  </div>
  <div class="footer"><p>DALEBA | Pour vous désabonner, répondez avec "STOP"</p></div>
</div>
</body>
</html>`
  };
}

// =============== Envoi d'email avec PDF ===============

async function sendEmailWithPDF(to, subject, html, pdfPath, fromName = 'DALEBA') {
  const emailData = {
    from: `${fromName} <onboarding@resend.dev>`,
    to: [to],
    subject,
    html
  };

  // Attacher PDF si disponible
  if (pdfPath && fs.existsSync(pdfPath)) {
    const pdfBuffer = fs.readFileSync(pdfPath);
    emailData.attachments = [{
      filename: `audit-seo-${Date.now()}.pdf`,
      content: pdfBuffer
    }];
  }

  return await sendEmail(emailData);
}

// =============== Démarrer séquence pour un lead ===============

async function startEmailSequence(lead, auditResult, reportPath, paymentLink, pool) {
  // Créer table séquences
  await pool.query(`
    CREATE TABLE IF NOT EXISTS daleba_email_sequences (
      id SERIAL PRIMARY KEY,
      lead_id INTEGER REFERENCES daleba_leads(id),
      step INTEGER DEFAULT 0,
      last_sent TIMESTAMPTZ,
      next_send TIMESTAMPTZ,
      status TEXT DEFAULT 'active',
      created_at TIMESTAMPTZ DEFAULT NOW()
    )
  `).catch(() => {});

  // Vérifier si séquence déjà active
  const existing = await pool.query(
    'SELECT id FROM daleba_email_sequences WHERE lead_id = $1 AND status = $2',
    [lead.id, 'active']
  ).catch(() => ({ rows: [] }));

  if (existing.rows.length > 0) {
    console.log(`[EmailSeq] Séquence déjà active pour lead ${lead.id}`);
    return null;
  }

  if (!lead.email) {
    console.log(`[EmailSeq] Pas d'email pour lead ${lead.id} (${lead.company_name})`);
    return null;
  }

  const score = auditResult?.score || lead.audit_score || 0;

  // Étape 1: J+0 — Rapport PDF
  try {
    const { subject, html } = getEmailStep1(lead, score, paymentLink);
    await sendEmailWithPDF(lead.email, subject, html, reportPath);
    console.log(`[EmailSeq] Step 1 envoyé à ${lead.email}`);
  } catch (e) {
    console.warn(`[EmailSeq] Step 1 failed for ${lead.email}:`, e.message);
    return null;
  }

  const now = new Date();
  const nextSend = new Date(now.getTime() + 3 * 24 * 3600 * 1000); // J+3

  // Créer la séquence en DB
  const seq = await pool.query(
    `INSERT INTO daleba_email_sequences (lead_id, step, last_sent, next_send, status)
     VALUES ($1, 1, NOW(), $2, 'active') RETURNING *`,
    [lead.id, nextSend]
  ).catch(() => ({ rows: [] }));

  return seq.rows[0];
}

// =============== Avancer les séquences en attente ===============

async function processEmailSequences(pool) {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS daleba_email_sequences (
      id SERIAL PRIMARY KEY,
      lead_id INTEGER REFERENCES daleba_leads(id),
      step INTEGER DEFAULT 0,
      last_sent TIMESTAMPTZ,
      next_send TIMESTAMPTZ,
      status TEXT DEFAULT 'active',
      created_at TIMESTAMPTZ DEFAULT NOW()
    )
  `).catch(() => {});

  // Récupérer séquences à traiter
  const sequences = await pool.query(`
    SELECT es.*, l.email, l.company_name, l.website, l.audit_score
    FROM daleba_email_sequences es
    JOIN daleba_leads l ON es.lead_id = l.id
    WHERE es.status = 'active' AND es.step < 3 AND es.next_send <= NOW()
    LIMIT 50
  `).catch(() => ({ rows: [] }));

  let processed = 0;
  for (const seq of sequences.rows) {
    if (!seq.email) continue;
    const nextStep = seq.step + 1;

    try {
      let emailData;
      if (nextStep === 2) {
        emailData = getEmailStep2(seq);
      } else if (nextStep === 3) {
        // Générer payment link Stripe si possible
        let paymentLink = 'https://kadiocoiffure.vercel.app';
        try {
          const { createAuditPaymentLink } = require('./stripe-usine');
          paymentLink = await createAuditPaymentLink(seq);
        } catch {}
        emailData = getEmailStep3(seq, paymentLink);
      }

      if (emailData) {
        await sendEmail({
          from: 'DALEBA <onboarding@resend.dev>',
          to: [seq.email],
          subject: emailData.subject,
          html: emailData.html
        });

        const isLast = nextStep >= 3;
        const nextSend = isLast ? null : new Date(Date.now() + (nextStep === 2 ? 4 : 0) * 24 * 3600 * 1000);

        await pool.query(
          `UPDATE daleba_email_sequences SET step = $1, last_sent = NOW(), next_send = $2, status = $3 WHERE id = $4`,
          [nextStep, nextSend, isLast ? 'completed' : 'active', seq.id]
        );
        processed++;
        console.log(`[EmailSeq] Step ${nextStep} envoyé à ${seq.email}`);
      }
    } catch (e) {
      console.warn(`[EmailSeq] Error step ${nextStep} for ${seq.email}:`, e.message);
      await pool.query(`UPDATE daleba_email_sequences SET status = 'error' WHERE id = $1`, [seq.id]).catch(() => {});
    }
  }

  return { processed, total: sequences.rows.length };
}

module.exports = { startEmailSequence, processEmailSequences };
