/**
 * DALEBA — Email Queue Service
 * Système de queue d'envoi intelligent avec multi-provider + fallback DB
 * 
 * Providers (dans l'ordre) :
 *  1. Resend (via onboarding@resend.dev)
 *  2. Nodemailer SMTP (ethereal auto-généré pour test)
 *  3. Fallback DB (status='pending_manual', stocke JSON dans metadata_json)
 */

const https = require('https');
const nodemailer = require('nodemailer');

const RESEND_API_KEY = process.env.RESEND_API_KEY;
const MAX_EMAILS_PER_HOUR = 90;

// ============== Table Setup ==============

async function ensureTableExists(pool) {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS daleba_email_queue (
      id SERIAL PRIMARY KEY,
      to_address TEXT NOT NULL,
      from_address TEXT NOT NULL,
      subject TEXT NOT NULL,
      html TEXT,
      text TEXT,
      attachments_json JSONB,
      provider TEXT,
      status TEXT DEFAULT 'pending',
      attempts INTEGER DEFAULT 0,
      scheduled_at TIMESTAMPTZ DEFAULT NOW(),
      sent_at TIMESTAMPTZ,
      error_msg TEXT,
      metadata_json JSONB,
      created_at TIMESTAMPTZ DEFAULT NOW()
    )
  `);
  
  // Index pour performance
  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_email_queue_status ON daleba_email_queue(status);
    CREATE INDEX IF NOT EXISTS idx_email_queue_scheduled ON daleba_email_queue(scheduled_at);
  `).catch(() => {});
  
  console.log('[email-queue] ✅ Table daleba_email_queue ready');
}

// ============== Provider 1: Resend ==============

async function sendViaResend(to, from, subject, html, text, attachments) {
  // Sans clé, on échoue tout de suite (le fallback SMTP/Ethereal prend le
  // relais) plutôt que d'envoyer "Bearer undefined" à Resend pour un 401.
  if (!RESEND_API_KEY) throw new Error('RESEND_API_KEY non configuré');
  return new Promise((resolve, reject) => {
    const payload = {
      from: from || 'DALEBA <onboarding@resend.dev>',
      to: Array.isArray(to) ? to : [to],
      subject,
      html: html || text,
      text: text || html?.replace(/<[^>]*>/g, '')
    };

    if (attachments && attachments.length > 0) {
      payload.attachments = attachments;
    }

    const body = JSON.stringify(payload);
    
    const req = https.request({
      hostname: 'api.resend.com',
      path: '/emails',
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${RESEND_API_KEY}`,
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(body)
      },
      timeout: 20000
    }, (res) => {
      let data = '';
      res.on('data', chunk => { data += chunk; });
      res.on('end', () => {
        if (res.statusCode >= 400) {
          return reject(new Error(`Resend ${res.statusCode}: ${data}`));
        }
        try {
          const json = JSON.parse(data);
          resolve({ provider: 'resend', messageId: json.id, response: json });
        } catch (e) {
          reject(new Error(`Resend parse error: ${e.message}`));
        }
      });
    });

    req.on('error', reject);
    req.on('timeout', () => {
      req.destroy();
      reject(new Error('Resend timeout (20s)'));
    });
    
    req.write(body);
    req.end();
  });
}

// ============== Provider 2: Nodemailer SMTP (Ethereal fallback) ==============

let etherealTransporter = null;
let etherealInitPromise = null;

async function getEtherealTransporter() {
  if (etherealTransporter) return etherealTransporter;
  if (etherealInitPromise) return etherealInitPromise;
  
  etherealInitPromise = (async () => {
    try {
      // Timeout 10s pour l'init Ethereal
      const testAccount = await Promise.race([
        nodemailer.createTestAccount(),
        new Promise((_, reject) => 
          setTimeout(() => reject(new Error('Ethereal init timeout')), 10000)
        )
      ]);
      
      etherealTransporter = nodemailer.createTransport({
        host: 'smtp.ethereal.email',
        port: 587,
        secure: false,
        auth: {
          user: testAccount.user,
          pass: testAccount.pass
        }
      });
      
      console.log('[email-queue] ℹ️  Ethereal SMTP configuré (fallback test)');
      return etherealTransporter;
    } catch (error) {
      console.warn('[email-queue] Ethereal init failed:', error.message);
      etherealInitPromise = null;
      throw error;
    }
  })();
  
  return etherealInitPromise;
}

async function sendViaSMTP(to, from, subject, html, text, attachments) {
  const transporter = await getEtherealTransporter();
  
  const mailOptions = {
    from: from || 'DALEBA <noreply@ethereal.email>',
    to: Array.isArray(to) ? to.join(', ') : to,
    subject,
    html: html || text,
    text: text || html?.replace(/<[^>]*>/g, ''),
    attachments: attachments || []
  };

  const info = await transporter.sendMail(mailOptions);
  const previewUrl = nodemailer.getTestMessageUrl(info);
  
  if (previewUrl) {
    console.log(`[email-queue] 📧 Ethereal preview: ${previewUrl}`);
  }
  
  return {
    provider: 'smtp-ethereal',
    messageId: info.messageId,
    previewUrl
  };
}

// ============== Provider 3: Fallback DB (pending_manual) ==============

async function saveToPendingManual(pool, emailId, error, emailData) {
  const report = {
    failureReason: error.message,
    timestamp: new Date().toISOString(),
    emailData,
    providersAttempted: ['resend', 'smtp']
  };
  
  await pool.query(
    `UPDATE daleba_email_queue 
     SET status = 'pending_manual', 
         error_msg = $1, 
         metadata_json = $2 
     WHERE id = $3`,
    [error.message, JSON.stringify(report), emailId]
  );
  
  console.log(`[email-queue] ⚠️  Email ${emailId} → pending_manual (fallback DB)`);
}

// ============== Core Functions ==============

/**
 * Enqueue un email dans la queue
 */
async function enqueueEmail(pool, opts) {
  const {
    to,
    from = 'DALEBA <onboarding@resend.dev>',
    subject,
    html,
    text,
    attachments = null,
    scheduledAt = null,
    metadata = null
  } = opts;

  if (!to || !subject) {
    throw new Error('Email enqueue requires "to" and "subject"');
  }

  const result = await pool.query(
    `INSERT INTO daleba_email_queue 
     (to_address, from_address, subject, html, text, attachments_json, scheduled_at, metadata_json)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
     RETURNING id`,
    [
      Array.isArray(to) ? to[0] : to,
      from,
      subject,
      html,
      text,
      attachments ? JSON.stringify(attachments) : null,
      scheduledAt || new Date(),
      metadata ? JSON.stringify(metadata) : null
    ]
  );

  const emailId = result.rows[0].id;
  console.log(`[email-queue] ✅ Email enqueued: id=${emailId}, to=${to}`);
  return emailId;
}

/**
 * Process la queue d'emails (max limit par exécution)
 */
async function processQueue(pool, limit = MAX_EMAILS_PER_HOUR) {
  await ensureTableExists(pool);
  
  // Récupérer emails pending prêts à être envoyés
  const emails = await pool.query(
    `SELECT * FROM daleba_email_queue
     WHERE status IN ('pending', 'retry') 
       AND scheduled_at <= NOW()
       AND attempts < 5
     ORDER BY scheduled_at ASC
     LIMIT $1
     FOR UPDATE SKIP LOCKED`,
    [limit]
  );

  let sent = 0;
  let failed = 0;

  for (const email of emails.rows) {
    try {
      // Marquer comme en traitement
      await pool.query(
        'UPDATE daleba_email_queue SET attempts = attempts + 1 WHERE id = $1',
        [email.id]
      );

      let result;
      let attachments = null;
      
      if (email.attachments_json) {
        try {
          attachments = typeof email.attachments_json === 'string' 
            ? JSON.parse(email.attachments_json) 
            : email.attachments_json;
        } catch (e) {
          console.warn(`[email-queue] Attachments parse error for email ${email.id}`);
        }
      }

      // Tenter Resend d'abord
      try {
        result = await sendViaResend(
          email.to_address,
          email.from_address,
          email.subject,
          email.html,
          email.text,
          attachments
        );
      } catch (resendError) {
        console.warn(`[email-queue] Resend failed for email ${email.id}: ${resendError.message}`);
        
        // Fallback sur SMTP avec timeout
        try {
          result = await Promise.race([
            sendViaSMTP(
              email.to_address,
              email.from_address,
              email.subject,
              email.html,
              email.text,
              attachments
            ),
            new Promise((_, reject) => 
              setTimeout(() => reject(new Error('SMTP timeout (30s)')), 30000)
            )
          ]);
        } catch (smtpError) {
          console.warn(`[email-queue] SMTP failed for email ${email.id}: ${smtpError.message}`);
          
          // Dernier fallback: pending_manual
          await saveToPendingManual(pool, email.id, smtpError, {
            to: email.to_address,
            from: email.from_address,
            subject: email.subject,
            html: email.html,
            text: email.text
          });
          
          failed++;
          continue;
        }
      }

      // Succès
      await pool.query(
        `UPDATE daleba_email_queue 
         SET status = 'sent', 
             provider = $1, 
             sent_at = NOW(), 
             metadata_json = $2
         WHERE id = $3`,
        [result.provider, JSON.stringify(result), email.id]
      );

      sent++;
      console.log(`[email-queue] ✅ Email ${email.id} sent via ${result.provider}`);

    } catch (error) {
      failed++;
      console.error(`[email-queue] ❌ Email ${email.id} failed:`, error.message);
      
      await pool.query(
        `UPDATE daleba_email_queue 
         SET status = CASE WHEN attempts >= 5 THEN 'failed' ELSE 'retry' END,
             error_msg = $1
         WHERE id = $2`,
        [error.message, email.id]
      );
    }
  }

  console.log(`[email-queue] Batch complete: ${sent} sent, ${failed} failed, ${emails.rows.length} total`);
  return { sent, failed, total: emails.rows.length };
}

/**
 * Stats du jour
 */
async function getDailyStats(pool) {
  await ensureTableExists(pool);
  
  const stats = await pool.query(`
    SELECT 
      COUNT(*) FILTER (WHERE status = 'sent') as sent,
      COUNT(*) FILTER (WHERE status = 'pending') as pending,
      COUNT(*) FILTER (WHERE status = 'failed') as failed,
      COUNT(*) FILTER (WHERE status = 'pending_manual') as pending_manual,
      COUNT(*) FILTER (WHERE status = 'retry') as retry,
      COUNT(*) FILTER (WHERE DATE(sent_at) = CURRENT_DATE) as sent_today,
      COUNT(*) as total
    FROM daleba_email_queue
  `);

  return stats.rows[0];
}

/**
 * Retry un email failed
 */
async function retryEmail(pool, emailId) {
  await pool.query(
    `UPDATE daleba_email_queue 
     SET status = 'retry', 
         attempts = 0, 
         scheduled_at = NOW(),
         error_msg = NULL
     WHERE id = $1`,
    [emailId]
  );
  
  console.log(`[email-queue] 🔄 Email ${emailId} marked for retry`);
  return { success: true };
}

/**
 * Get email details pour download rapport
 */
async function getEmailDetails(pool, emailId) {
  const result = await pool.query(
    'SELECT * FROM daleba_email_queue WHERE id = $1',
    [emailId]
  );
  
  return result.rows[0] || null;
}

module.exports = {
  ensureTableExists,
  enqueueEmail,
  processQueue,
  getDailyStats,
  retryEmail,
  getEmailDetails
};
