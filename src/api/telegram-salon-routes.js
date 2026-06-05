/**
 * DALEBA — Routes Webhook Telegram @Kadiocoiffurebot
 * POST /api/webhook/telegram/salon
 */

'use strict';

const express = require('express');
const router = express.Router();
const bot = require('../services/telegram-salon-bot');

// Webhook Telegram — reçoit les updates
router.post('/salon', async (req, res) => {
  // Répondre immédiatement à Telegram (200 OK) pour éviter les re-tentatives
  res.sendStatus(200);

  try {
    const update = req.body;
    if (update) {
      await bot.handleUpdate(update);
    }
  } catch (e) {
    console.error('[TelegramSalonRoutes] Error handling update:', e.message);
  }
});

// Status check
router.get('/salon/status', (req, res) => {
  res.json({ status: 'ok', bot: '@Kadiocoiffurebot', salon: 'Kadio Coiffure' });
});

module.exports = router;
