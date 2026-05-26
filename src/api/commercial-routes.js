/**
 * DALEBA V43 — Routes Agent Commercial
 * GET    /api/commercial/status          → état connexion Gmail
 * GET    /api/commercial/inbox           → emails non-lus
 * POST   /api/commercial/analyze/:id     → analyser email avec IA
 * POST   /api/commercial/reply/:id       → envoyer réponse (draft ou direct)
 * PUT    /api/commercial/emails/:id/read → marquer comme lu
 * POST   /api/commercial/create-task     → créer tâche Production depuis accord
 * GET    /api/commercial/emails          → historique DB
 */
'use strict';

const express = require('express');
const router  = express.Router();

let pool;
try { const db = require('../memory/db'); pool = db.pool; } catch (e) {}
if (!pool) pool = { query: async () => ({ rows: [], rowCount: 0 }) }; // fallback démo

const emailOAuth = require('../services/email-reader-oauth');
const { fetchUnreadEmails, sendEmail, markAsRead, checkConnection, GMAIL_USER } = emailOAuth;
const { analyzeEmail } = require('../services/commercial-agent');

// ── Migration DB ──────────────────────────────────────────────────────────────
async function initTables() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS daleba_emails (
      id              SERIAL PRIMARY KEY,
      uid             INT,
      message_id      TEXT UNIQUE,
      from_email      TEXT,
      from_name       TEXT,
      subject         TEXT,
      body_text       TEXT,
      received_at     TIMESTAMPTZ DEFAULT NOW(),
      status          VARCHAR(20) DEFAULT 'unread',
      intent          VARCHAR(30),
      intent_fr       TEXT,
      urgency         VARCHAR(10) DEFAULT 'medium',
      summary         TEXT,
      reply_draft     TEXT,
      reply_html      TEXT,
      reply_sent_at   TIMESTAMPTZ,
      engine_used     VARCHAR(30),
      task_id         INT,
      should_create_task BOOLEAN DEFAULT FALSE,
      task_description TEXT
    )
  `);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_daleba_emails_status ON daleba_emails(status)`);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_daleba_emails_received ON daleba_emails(received_at DESC)`);
  // Table settings (stockage refresh_token OAuth2)
  await pool.query(`
    CREATE TABLE IF NOT EXISTS daleba_settings (
      key        TEXT PRIMARY KEY,
      value      TEXT,
      updated_at TIMESTAMPTZ DEFAULT NOW()
    )
  `);
  console.log('[commercial] Tables daleba_emails + daleba_settings OK');
}
initTables().then(() => { emailOAuth.setPool(pool); }).catch(console.error);


// ── GET /oauth/start — Lancer le flow OAuth2 Gmail ───────────────────────────
router.get('/oauth/start', (req, res) => {
  if (!process.env.GOOGLE_CLIENT_ID || !process.env.GOOGLE_CLIENT_SECRET) {
    return res.status(503).json({
      error: 'GOOGLE_CLIENT_ID et GOOGLE_CLIENT_SECRET requis dans Railway',
      setup: true,
    });
  }
  const authUrl = emailOAuth.buildAuthUrl();
  // Redirection directe ou retour JSON selon le paramètre
  if (req.query.redirect === 'false') return res.json({ authUrl });
  res.redirect(authUrl);
});

// ── GET /oauth/callback — Capturer le code Google ────────────────────────────
router.get('/oauth/callback', async (req, res) => {
  const { code, error } = req.query;

  if (error) {
    return res.send(`<h2>❌ Autorisation refusée : ${error}</h2><p><a href="/admin-commercial.html">Retour</a></p>`);
  }
  if (!code) {
    return res.send('<h2>❌ Code manquant</h2>');
  }

  try {
    const tokenData = await emailOAuth.exchangeCode(code);
    await emailOAuth.saveTokens({
      access_token:  tokenData.access_token,
      refresh_token: tokenData.refresh_token,
      expiry_date:   Date.now() + (tokenData.expires_in || 3600) * 1000,
    });

    // Vérifier la connexion
    const status = await emailOAuth.checkConnection();

    res.send(`<!DOCTYPE html><html><head><meta charset="UTF-8"><title>DALEBA — Gmail Connecté</title>
    <style>body{background:#0d1117;color:#e6edf3;font-family:sans-serif;display:flex;align-items:center;justify-content:center;height:100vh;margin:0}
    .box{background:#161b22;border:1px solid #30363d;border-radius:12px;padding:2rem 2.5rem;max-width:420px;text-align:center}
    h2{color:#3fb950;font-size:1.3rem;margin-bottom:0.75rem}p{color:#8b949e;font-size:0.85rem;margin:0.4rem 0}
    a{display:inline-block;margin-top:1.25rem;background:linear-gradient(135deg,#2ea043,#3fb950);color:#fff;padding:0.65rem 1.5rem;border-radius:7px;text-decoration:none;font-weight:800}</style></head>
    <body><div class="box">
      <h2>✅ Gmail connecté !</h2>
      <p><strong>${status.user || 'Daleba2024@gmail.com'}</strong></p>
      <p>L'Agent Commercial peut maintenant lire et envoyer des emails.</p>
      <a href="/admin-commercial.html">→ Ouvrir l'Agent Commercial</a>
    </div></body></html>`);
  } catch (err) {
    res.status(500).send(`<h2>❌ Erreur : ${err.message}</h2><p><a href="/admin-commercial.html">Retour</a></p>`);
  }
});

// ── GET /status ───────────────────────────────────────────────────────────────
router.get('/status', async (req, res) => {
  try {
    const status = await checkConnection();
    res.json(status);
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

// ── GET /inbox — fetch + sync depuis Gmail ─────────────────────────────────────
router.get('/inbox', async (req, res) => {
  try {
    const limit  = parseInt(req.query.limit) || 20;
    const result = await fetchUnreadEmails(limit);

    if (result.error) {
      return res.status(503).json({ ok: false, error: result.error, emails: [] });
    }

    // Synchroniser dans DB (upsert)
    for (const email of result.emails) {
      await pool.query(`
        INSERT INTO daleba_emails
          (uid, message_id, from_email, from_name, subject, body_text, received_at)
        VALUES ($1,$2,$3,$4,$5,$6,$7)
        ON CONFLICT (message_id) DO NOTHING
      `, [
        email.uid,
        email.messageId || `uid-${email.uid}`,
        email.fromEmail,
        email.from,
        email.subject,
        email.text,
        email.date,
      ]);
    }

    res.json({ ok: true, emails: result.emails, total: result.total });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

// ── GET /emails — historique depuis DB ───────────────────────────────────────
router.get('/emails', async (req, res) => {
  try {
    const limit  = parseInt(req.query.limit)  || 50;
    const offset = parseInt(req.query.offset) || 0;
    const status = req.query.status; // filtre optionnel

    let query  = 'SELECT * FROM daleba_emails';
    const params = [];
    if (status) { query += ' WHERE status = $1'; params.push(status); }
    query += ` ORDER BY received_at DESC LIMIT ${limit} OFFSET ${offset}`;

    const { rows } = await pool.query(query, params);
    const { rows: [{ count }] } = await pool.query('SELECT COUNT(*) FROM daleba_emails' + (status ? ' WHERE status = $1' : ''), status ? [status] : []);

    res.json({ emails: rows, total: parseInt(count), limit, offset });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── POST /analyze/:id — Analyser un email avec l'IA ──────────────────────────
router.post('/analyze/:id', async (req, res) => {
  try {
    const { rows } = await pool.query('SELECT * FROM daleba_emails WHERE id = $1', [req.params.id]);
    if (!rows.length) return res.status(404).json({ error: 'Email non trouvé' });
    const email = rows[0];

    const analysis = await analyzeEmail({
      from:    email.from_email,
      subject: email.subject,
      text:    email.body_text || '',
    });

    await pool.query(`
      UPDATE daleba_emails
      SET intent             = $1,
          intent_fr          = $2,
          urgency            = $3,
          summary            = $4,
          reply_draft        = $5,
          reply_html         = $6,
          engine_used        = $7,
          should_create_task = $8,
          task_description   = $9,
          status             = CASE WHEN status = 'unread' THEN 'analyzed' ELSE status END
      WHERE id = $10
    `, [
      analysis.intent,
      analysis.intent_fr,
      analysis.urgency,
      analysis.summary,
      analysis.reply_text,
      analysis.reply_html,
      analysis.engine,
      analysis.should_create_task,
      analysis.task_description,
      email.id,
    ]);

    res.json({ ok: true, email_id: email.id, analysis });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── POST /reply/:id — Envoyer la réponse ─────────────────────────────────────
router.post('/reply/:id', async (req, res) => {
  try {
    const { rows } = await pool.query('SELECT * FROM daleba_emails WHERE id = $1', [req.params.id]);
    if (!rows.length) return res.status(404).json({ error: 'Email non trouvé' });
    const email = rows[0];

    const replyText = req.body.text    || email.reply_draft || '';
    const replyHtml = req.body.html    || email.reply_html  || '';
    const subject   = req.body.subject || `Re: ${email.subject}`;
    const mode      = req.body.mode    || 'send'; // 'send' | 'draft'

    if (mode === 'draft') {
      // Sauvegarder le brouillon sans envoyer
      await pool.query(
        `UPDATE daleba_emails SET reply_draft = $1, reply_html = $2, status = 'draft' WHERE id = $3`,
        [replyText, replyHtml, email.id]
      );
      return res.json({ ok: true, mode: 'draft', saved: true });
    }

    // Envoi réel
    const result = await sendEmail({
      to:         email.from_email,
      subject,
      text:       replyText,
      html:       replyHtml,
      inReplyTo:  email.message_id,
    });

    await pool.query(`
      UPDATE daleba_emails
      SET status = 'replied', reply_sent_at = NOW(), reply_draft = $1
      WHERE id = $2
    `, [replyText, email.id]);

    await markAsRead(email.uid).catch(() => {});

    res.json({ ok: true, mode: 'sent', messageId: result.messageId });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── POST /create-task — Créer tâche Production depuis accord ─────────────────
router.post('/create-task', async (req, res) => {
  try {
    const { email_id, client_need, budget, client_email } = req.body;
    if (!client_need) return res.status(400).json({ error: 'client_need requis' });

    // Insérer dans daleba_production_tasks
    const { rows } = await pool.query(`
      INSERT INTO daleba_production_tasks
        (client_need_raw, status, notes, created_at, updated_at)
      VALUES ($1, 'spec_pending', $2, NOW(), NOW())
      RETURNING id
    `, [
      client_need,
      `Créé depuis email commercial${client_email ? ` — ${client_email}` : ''}${budget ? ` — Budget: $${budget}` : ''}`,
    ]);

    const taskId = rows[0].id;

    // Lier l'email à la tâche si fourni
    if (email_id) {
      await pool.query(
        'UPDATE daleba_emails SET task_id = $1, status = $2 WHERE id = $3',
        [taskId, 'task_created', email_id]
      );
    }

    // Enregistrer le contrat dans daleba_contracts_revenue si budget fourni
    if (budget && parseFloat(budget) > 0) {
      await pool.query(`
        INSERT INTO daleba_contracts_revenue (task_id, project_name, amount, currency, notes)
        VALUES ($1, $2, $3, 'CAD', 'Pré-enregistré depuis accord commercial')
      `, [taskId, client_need.slice(0, 80), parseFloat(budget)]);
    }

    res.json({ ok: true, task_id: taskId, message: `Tâche #${taskId} créée — prête pour l'Usine de Production` });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── PUT /emails/:id/read ──────────────────────────────────────────────────────
router.put('/emails/:id/read', async (req, res) => {
  try {
    const { rows } = await pool.query(
      `UPDATE daleba_emails SET status = 'read' WHERE id = $1 RETURNING uid`,
      [req.params.id]
    );
    if (!rows.length) return res.status(404).json({ error: 'Not found' });
    await markAsRead(rows[0].uid).catch(() => {});
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
