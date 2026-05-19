'use strict';
/**
 * Email Sender — DALEBA Metacortex Point 272
 * Intégration SendGrid / Mailgun pour envoi du Welcome Pack.
 */
const bus = require('./event-bus');

const SENDGRID_KEY  = process.env.SENDGRID_API_KEY;
const MAILGUN_KEY   = process.env.MAILGUN_API_KEY;
const MAILGUN_DOMAIN = process.env.MAILGUN_DOMAIN || 'mg.daleba.ai';
const FROM_EMAIL    = process.env.FROM_EMAIL || 'noreply@daleba.ai';
const FROM_NAME     = process.env.FROM_NAME  || 'DALEBA Platform';

async function sendViaSendGrid(to, subject, html) {
  const response = await fetch('https://api.sendgrid.com/v3/mail/send', {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${SENDGRID_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      personalizations: [{ to: [{ email: to }] }],
      from: { email: FROM_EMAIL, name: FROM_NAME },
      subject,
      content: [{ type: 'text/html', value: html }],
    }),
  });
  if (!response.ok) throw new Error(`SendGrid ${response.status}: ${await response.text()}`);
  return { provider: 'sendgrid', status: 'sent' };
}

async function sendViaMailgun(to, subject, html) {
  const form = new URLSearchParams({ from: `${FROM_NAME} <${FROM_EMAIL}>`, to, subject, html });
  const response = await fetch(`https://api.mailgun.net/v3/${MAILGUN_DOMAIN}/messages`, {
    method: 'POST',
    headers: { 'Authorization': 'Basic ' + Buffer.from(`api:${MAILGUN_KEY}`).toString('base64'), 'Content-Type': 'application/x-www-form-urlencoded' },
    body: form.toString(),
  });
  if (!response.ok) throw new Error(`Mailgun ${response.status}: ${await response.text()}`);
  return { provider: 'mailgun', status: 'sent' };
}

async function sendWelcomePack(to, tenantData) {
  const { generateWelcomePack } = require('./welcome-pack-generator');
  const html    = generateWelcomePack(tenantData);
  const subject = `🎉 Bienvenue sur DALEBA — Vos accès ${tenantData.tenantName}`;

  bus.system(`[Email] Envoi welcome pack → ${to}`);

  // Essayer SendGrid d'abord, puis Mailgun, puis log simulé
  if (SENDGRID_KEY) {
    try { return await sendViaSendGrid(to, subject, html); } catch (e) { bus.system(`[Email] SendGrid fail: ${e.message}`); }
  }
  if (MAILGUN_KEY) {
    try { return await sendViaMailgun(to, subject, html); } catch (e) { bus.system(`[Email] Mailgun fail: ${e.message}`); }
  }

  // Mode simulé — log sans erreur
  bus.system(`[Email] 📧 SIMULÉ → ${to} | ${subject.slice(0, 50)}`);
  return { provider: 'simulated', status: 'logged', note: 'Configurez SENDGRID_API_KEY ou MAILGUN_API_KEY pour l\'envoi réel.' };
}

async function sendSMS(to, message) {
  try {
    const twilio = require('twilio')(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN);
    await twilio.messages.create({ body: message, from: process.env.TWILIO_PHONE_NUMBER, to });
    return { sent: true };
  } catch (e) {
    bus.system(`[Email] SMS fail: ${e.message}`);
    return { sent: false, error: e.message };
  }
}

module.exports = { sendWelcomePack, sendViaSendGrid, sendViaMailgun, sendSMS };
