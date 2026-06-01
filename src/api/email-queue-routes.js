/**
 * DALEBA — Email Queue API Routes
 * Routes admin pour gérer la queue d'envoi d'emails
 */

const express = require('express');
const router = express.Router();
const emailQueue = require('../services/email-queue');
const { getPool } = require('../services/db');

/**
 * GET /api/email-queue/stats
 * Retourne les statistiques de la queue
 */
router.get('/stats', async (req, res) => {
  try {
    const pool = getPool();
    const stats = await emailQueue.getDailyStats(pool);
    
    res.json({
      success: true,
      stats: {
        total: parseInt(stats.total) || 0,
        sent: parseInt(stats.sent) || 0,
        pending: parseInt(stats.pending) || 0,
        failed: parseInt(stats.failed) || 0,
        pendingManual: parseInt(stats.pending_manual) || 0,
        retry: parseInt(stats.retry) || 0,
        sentToday: parseInt(stats.sent_today) || 0
      }
    });
  } catch (error) {
    console.error('[email-queue-routes] Stats error:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

/**
 * GET /api/email-queue/list
 * Liste les emails dans la queue avec filtres
 */
router.get('/list', async (req, res) => {
  try {
    const pool = getPool();
    const { status = 'pending', limit = 50 } = req.query;
    
    const validStatuses = ['pending', 'sent', 'failed', 'pending_manual', 'retry'];
    const filterStatus = validStatuses.includes(status) ? status : 'pending';
    
    const result = await pool.query(
      `SELECT 
         id, 
         to_address, 
         from_address, 
         subject, 
         provider, 
         status, 
         attempts, 
         scheduled_at, 
         sent_at, 
         error_msg,
         created_at
       FROM daleba_email_queue
       WHERE status = $1
       ORDER BY 
         CASE 
           WHEN status = 'pending' THEN scheduled_at
           WHEN status = 'sent' THEN sent_at
           ELSE created_at
         END DESC
       LIMIT $2`,
      [filterStatus, parseInt(limit)]
    );
    
    res.json({
      success: true,
      status: filterStatus,
      count: result.rows.length,
      emails: result.rows.map(email => ({
        id: email.id,
        to: email.to_address,
        from: email.from_address,
        subject: email.subject,
        provider: email.provider,
        status: email.status,
        attempts: email.attempts,
        scheduledAt: email.scheduled_at,
        sentAt: email.sent_at,
        error: email.error_msg,
        createdAt: email.created_at
      }))
    });
  } catch (error) {
    console.error('[email-queue-routes] List error:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

/**
 * POST /api/email-queue/process
 * Déclenche le traitement manuel de la queue
 */
router.post('/process', async (req, res) => {
  try {
    const pool = getPool();
    const { limit = 90 } = req.body;
    
    console.log('[email-queue-routes] Manual process triggered');
    const result = await emailQueue.processQueue(pool, parseInt(limit));
    
    res.json({
      success: true,
      processed: result.total,
      sent: result.sent,
      failed: result.failed,
      message: `Processed ${result.total} emails: ${result.sent} sent, ${result.failed} failed`
    });
  } catch (error) {
    console.error('[email-queue-routes] Process error:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

/**
 * POST /api/email-queue/retry/:id
 * Retry un email failed
 */
router.post('/retry/:id', async (req, res) => {
  try {
    const pool = getPool();
    const emailId = parseInt(req.params.id);
    
    if (isNaN(emailId)) {
      return res.status(400).json({
        success: false,
        error: 'Invalid email ID'
      });
    }
    
    await emailQueue.retryEmail(pool, emailId);
    
    res.json({
      success: true,
      message: `Email ${emailId} marked for retry`
    });
  } catch (error) {
    console.error('[email-queue-routes] Retry error:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

/**
 * GET /api/email-queue/download/:id
 * Télécharge le rapport JSON pour un email pending_manual
 */
router.get('/download/:id', async (req, res) => {
  try {
    const pool = getPool();
    const emailId = parseInt(req.params.id);
    
    if (isNaN(emailId)) {
      return res.status(400).json({
        success: false,
        error: 'Invalid email ID'
      });
    }
    
    const email = await emailQueue.getEmailDetails(pool, emailId);
    
    if (!email) {
      return res.status(404).json({
        success: false,
        error: 'Email not found'
      });
    }
    
    const report = {
      id: email.id,
      to: email.to_address,
      from: email.from_address,
      subject: email.subject,
      status: email.status,
      attempts: email.attempts,
      scheduledAt: email.scheduled_at,
      createdAt: email.created_at,
      errorMsg: email.error_msg,
      metadata: email.metadata_json,
      html: email.html,
      text: email.text,
      attachments: email.attachments_json
    };
    
    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Content-Disposition', `attachment; filename="email-${emailId}-report.json"`);
    res.json(report);
    
  } catch (error) {
    console.error('[email-queue-routes] Download error:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

/**
 * POST /api/email-queue/enqueue
 * Enqueue un nouvel email (pour testing ou usage manuel)
 */
router.post('/enqueue', async (req, res) => {
  try {
    const pool = getPool();
    const { to, from, subject, html, text, scheduledAt } = req.body;
    
    if (!to || !subject) {
      return res.status(400).json({
        success: false,
        error: 'Missing required fields: to, subject'
      });
    }
    
    const emailId = await emailQueue.enqueueEmail(pool, {
      to,
      from,
      subject,
      html,
      text,
      scheduledAt: scheduledAt ? new Date(scheduledAt) : null
    });
    
    res.json({
      success: true,
      emailId,
      message: 'Email enqueued successfully'
    });
  } catch (error) {
    console.error('[email-queue-routes] Enqueue error:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

module.exports = router;
