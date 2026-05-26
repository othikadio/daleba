/**
 * DALEBA V43 — Email Reader
 * Lecture IMAP Gmail (Daleba2024@gmail.com) + Nodemailer SMTP pour l'envoi
 * Credentials via variables Railway : GMAIL_USER, GMAIL_APP_PASSWORD
 */
'use strict';

const Imap       = require('imap');
const { simpleParser } = require('mailparser');
const nodemailer = require('nodemailer');

const GMAIL_USER = process.env.GMAIL_USER         || 'Daleba2024@gmail.com';
const GMAIL_PASS = process.env.GMAIL_APP_PASSWORD || '';

// ── IMAP config ───────────────────────────────────────────────────────────────
function createImap() {
  return new Imap({
    user:     GMAIL_USER,
    password: GMAIL_PASS,
    host:     'imap.gmail.com',
    port:     993,
    tls:      true,
    tlsOptions: { rejectUnauthorized: false },
    connTimeout: 15000,
    authTimeout: 10000,
  });
}

// ── SMTP config (envoi) ────────────────────────────────────────────────────────
function createTransport() {
  return nodemailer.createTransporter({
    service: 'gmail',
    auth: { user: GMAIL_USER, pass: GMAIL_PASS },
  });
}

// ── Fetch N derniers emails non-lus ────────────────────────────────────────────
function fetchUnreadEmails(limit = 20) {
  return new Promise((resolve, reject) => {
    if (!GMAIL_PASS) {
      return resolve({ emails: [], error: 'GMAIL_APP_PASSWORD non configuré' });
    }

    const imap    = createImap();
    const emails  = [];
    let   aborted = false;

    const abort = (err) => {
      if (aborted) return;
      aborted = true;
      try { imap.end(); } catch (e) {}
      reject(err);
    };

    imap.once('ready', () => {
      imap.openBox('INBOX', false, (err, box) => {
        if (err) return abort(err);

        // Chercher les non-lus des 30 derniers jours
        const since = new Date();
        since.setDate(since.getDate() - 30);
        const sinceStr = since.toDateString();

        imap.search(['UNSEEN', ['SINCE', sinceStr]], (err, uids) => {
          if (err) return abort(err);
          if (!uids || uids.length === 0) {
            imap.end();
            return resolve({ emails: [], total: 0 });
          }

          const toFetch = uids.slice(-limit); // Les N plus récents
          const fetch   = imap.fetch(toFetch, { bodies: '', struct: true, markSeen: false });

          fetch.on('message', (msg, seqno) => {
            const emailData = { uid: null, seqno };
            let buffer = '';

            msg.on('attributes', (attrs) => { emailData.uid = attrs.uid; });
            msg.on('body', (stream) => {
              stream.on('data', (chunk) => { buffer += chunk.toString('utf8'); });
              stream.once('end', () => {
                simpleParser(buffer, (err, parsed) => {
                  if (!err && parsed) {
                    emails.push({
                      uid:        emailData.uid,
                      messageId:  parsed.messageId,
                      from:       parsed.from?.text || '',
                      fromEmail:  parsed.from?.value?.[0]?.address || '',
                      to:         parsed.to?.text || '',
                      subject:    parsed.subject || '(sans objet)',
                      text:       (parsed.text || '').slice(0, 3000),
                      html:       null, // on n'expose pas le HTML brut
                      date:       parsed.date || new Date(),
                      inReplyTo:  parsed.inReplyTo || null,
                      references: parsed.references || [],
                    });
                  }
                });
              });
            });
          });

          fetch.once('error', abort);
          fetch.once('end', () => {
            imap.end();
            resolve({ emails: emails.sort((a, b) => new Date(b.date) - new Date(a.date)), total: uids.length });
          });
        });
      });
    });

    imap.once('error', abort);
    imap.once('end', () => {});
    imap.connect();
  });
}

// ── Envoyer un email ──────────────────────────────────────────────────────────
async function sendEmail({ to, subject, text, html, replyTo, inReplyTo, references }) {
  if (!GMAIL_PASS) throw new Error('GMAIL_APP_PASSWORD non configuré');

  const transport = createTransport();
  const mailOptions = {
    from:    `DALEBA OS <${GMAIL_USER}>`,
    to,
    subject,
    text,
    html:    html || `<p>${text.replace(/\n/g, '<br>')}</p>`,
    replyTo: replyTo || GMAIL_USER,
  };
  if (inReplyTo)  mailOptions.inReplyTo  = inReplyTo;
  if (references) mailOptions.references = references;

  const info = await transport.sendMail(mailOptions);
  return { messageId: info.messageId, accepted: info.accepted, rejected: info.rejected };
}

// ── Marquer un email comme lu ─────────────────────────────────────────────────
function markAsRead(uid) {
  return new Promise((resolve, reject) => {
    if (!GMAIL_PASS) return resolve(false);
    const imap = createImap();
    imap.once('ready', () => {
      imap.openBox('INBOX', false, (err) => {
        if (err) { imap.end(); return resolve(false); }
        imap.addFlags(uid, '\\Seen', (err) => {
          imap.end();
          resolve(!err);
        });
      });
    });
    imap.once('error', () => resolve(false));
    imap.connect();
  });
}

// ── Vérifier la connexion ─────────────────────────────────────────────────────
async function checkConnection() {
  if (!GMAIL_PASS) return { ok: false, error: 'GMAIL_APP_PASSWORD manquant dans Railway' };
  try {
    const { emails, total } = await fetchUnreadEmails(1);
    return { ok: true, user: GMAIL_USER, unread: total };
  } catch (err) {
    return { ok: false, error: err.message };
  }
}

module.exports = { fetchUnreadEmails, sendEmail, markAsRead, checkConnection, GMAIL_USER };
