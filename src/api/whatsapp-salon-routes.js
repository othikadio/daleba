'use strict';
/**
 * DALEBA WhatsApp Salon — Routes
 * - GET  /api/whatsapp/status    — statut connexion
 * - GET  /api/whatsapp/qr        — QR code (image PNG base64)
 * - POST /api/whatsapp/start     — démarrer la connexion Baileys
 * - POST /api/whatsapp/send      — envoi manuel (test)
 * - POST /api/stripe/deposit-paid — webhook Stripe (paiement dépôt reçu)
 * - GET  /api/whatsapp/audit     — résultats Agent Auditeur
 */
const express = require('express');
const router  = express.Router();
const QRCode  = require('qrcode');

const baileysClient = require('../services/whatsapp/baileys-client');
const salonRouter   = require('../services/whatsapp/salon-router');
const sessionStore  = require('../services/whatsapp/session-store');
const squareBooking = require('../services/whatsapp/square-booking');
const stripeDeposit = require('../services/whatsapp/stripe-deposit');
const audioHandler  = require('../services/whatsapp/audio-handler');
const auditorAgent  = require('../services/whatsapp/auditor-agent');
const bus           = require('../services/event-bus');

let waStarted = false;

// ─── INITIALISATION BAILEYS ────────────────────────────────────────────────────
async function startWhatsApp() {
  if (waStarted) return;
  waStarted = true;
  console.log('[WhatsApp-Salon] 🚀 Démarrage Baileys...');

  await baileysClient.connect(async ({ phone, displayName, text, mediaUrl, mediaType }) => {
    try {
      // Marquer "en train de taper"
      await baileysClient.sendText(phone, '').catch(() => {});

      let finalText = text;

      // Transcription vocaux
      if (mediaType === 'audio' && mediaUrl) {
        try {
          console.log(`[WA] 🎤 Transcription vocal de ${phone}...`);
          finalText = await audioHandler.transcribeAudio(mediaUrl);
          if (!finalText) finalText = '[message vocal non transcrit]';
          bus.system(`[WA-STT] 🎤 ${phone}: "${finalText.slice(0, 60)}"`);
        } catch(e) {
          finalText = '[vocal]';
          console.error('[WA-STT]', e.message);
        }
      }

      // Traiter via Agent Central
      const result = await salonRouter.handleMessage({
        phone, displayName, text: finalText, mediaUrl, mediaType,
      });

      if (!result?.reply) return;

      // Tenter TTS si réponse vocale demandée (vocal entrant → réponse vocale)
      if (mediaType === 'audio') {
        try {
          const audioPath = await audioHandler.synthesizeSpeech(result.reply);
          if (audioPath) {
            await baileysClient.sendAudio(phone, audioPath);
            bus.system(`[WA-TTS] 🔊 Réponse vocale envoyée à ${phone}`);
          } else {
            await baileysClient.sendText(phone, result.reply);
          }
        } catch(_) {
          await baileysClient.sendText(phone, result.reply);
        }
      } else {
        await baileysClient.sendText(phone, result.reply);
      }

      bus.system(`[WA] 💬 ${phone} → ${result.reply.slice(0, 60)}…`);

    } catch(e) {
      console.error('[WhatsApp-Salon] handler:', e.message);
      try {
        await baileysClient.sendText(phone, 'Désolé, une erreur est survenue. Notre équipe vous contacte rapidement. 🙏');
      } catch(_) {}
    }
  });

  // Démarrer Agent Auditeur en arrière-plan
  auditorAgent.startAuditorDaemon(async (limit) => {
    const { pool } = require('../memory/db');
    try {
      const r = await pool.query(
        `SELECT phone, history FROM daleba_wa_sessions
         WHERE updated_at > NOW() - INTERVAL '2 hours'
         ORDER BY updated_at DESC LIMIT $1`,
        [limit]
      );
      return r.rows;
    } catch(_) { return []; }
  });

  baileysClient.emitter.on('connected', (user) => {
    bus.system(`[WA] ✅ WhatsApp connecté — ${user?.id || 'salon'}`);
  });
  baileysClient.emitter.on('qr', () => {
    bus.system('[WA] 📱 QR Code disponible — GET /api/whatsapp/qr');
  });
}

// ─── ROUTES ───────────────────────────────────────────────────────────────────

// Status
router.get('/status', (req, res) => {
  const s = baileysClient.getStatus();
  res.json({
    connected:   s.connected,
    hasQR:       s.hasQR,
    phoneNumber: s.phoneNumber,
    waStarted,
  });
});

// QR Code (image base64 PNG)
router.get('/qr', async (req, res) => {
  const s = baileysClient.getStatus();
  if (s.connected) return res.json({ connected: true, message: 'WhatsApp déjà connecté, pas de QR nécessaire.' });
  if (!s.qr) return res.json({ connected: false, qr: null, message: 'QR pas encore généré. Attendez ~5s après /start.' });
  if (req.query.format === 'png') {
    const png = await QRCode.toBuffer(s.qr, { width: 300 });
    res.setHeader('Content-Type', 'image/png');
    return res.send(png);
  }
  const svg = await QRCode.toString(s.qr, { type: 'svg' });
  res.json({ connected: false, qr: s.qr, svg });
});

// Démarrer WhatsApp
router.post('/start', async (req, res) => {
  if (!waStarted) {
    startWhatsApp().catch(e => console.error('[WA-Start]', e.message));
    res.json({ started: true, message: 'Baileys démarré — GET /api/whatsapp/qr dans 5 secondes' });
  } else {
    res.json({ started: true, message: 'Déjà démarré', status: baileysClient.getStatus() });
  }
});

// POST /api/whatsapp/reset — purge session + génère nouveau QR
router.post('/reset', async (req, res) => {
  try {
    const { pool } = require('../../memory/db');
    const fs = require('fs');
    const path = require('path');

    // 1. Supprimer la session en DB
    await pool.query(`DELETE FROM daleba_wa_auth`).catch(() => {});
    console.log('[WA-Reset] ✅ daleba_wa_auth purgée');

    // 2. Supprimer les fichiers temporaires /tmp
    const SESSION_DIR = '/tmp/daleba-wa-session';
    if (fs.existsSync(SESSION_DIR)) {
      fs.readdirSync(SESSION_DIR).forEach(f => {
        try { fs.unlinkSync(path.join(SESSION_DIR, f)); } catch(_) {}
      });
    }
    console.log('[WA-Reset] ✅ /tmp/daleba-wa-session nettoyé');

    // 3. Réinitialiser l'état
    waStarted = false;

    // 4. Redémarrer Baileys (génère un nouveau QR)
    setTimeout(() => {
      startWhatsApp().catch(e => console.error('[WA-Reset-Start]', e.message));
    }, 1000);

    res.json({ ok: true, message: 'Session purgée, Baileys redémarre — GET /api/whatsapp/qr dans 6 secondes' });
  } catch(e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

// Test envoi manuel
router.post('/send', async (req, res) => {
  const { phone, message } = req.body;
  if (!phone || !message) return res.status(400).json({ error: 'phone + message requis' });
  try {
    await baileysClient.sendText(phone, message);
    res.json({ sent: true });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// Sessions actives
router.get('/sessions', async (req, res) => {
  try {
    const { pool } = require('../memory/db');
    const r = await pool.query(
      `SELECT phone, display_name, state, updated_at
       FROM daleba_wa_sessions ORDER BY updated_at DESC LIMIT 20`
    );
    res.json(r.rows);
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// Audit résultats
router.get('/audit', async (req, res) => {
  try {
    const stats = await auditorAgent.getAuditStats(parseInt(req.query.limit || '20'));
    res.json({ audits: stats });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// ─── WEBHOOK STRIPE — DÉPÔT PAYÉ ─────────────────────────────────────────────
// Monté sur /api/stripe/deposit-paid dans index.js
async function handleStripeDepositWebhook(req, res) {
  const sig     = req.headers['stripe-signature'];
  const payload = req.body; // raw buffer

  let event;
  try {
    const Stripe = require('stripe');
    const strp   = new Stripe(process.env.STRIPE_SECRET_KEY);
    const secret = process.env.STRIPE_DEPOSIT_WEBHOOK_SECRET || process.env.STRIPE_WEBHOOK_SECRET;
    event = strp.webhooks.constructEvent(payload, sig, secret);
  } catch(e) {
    console.error('[WA-Stripe-Webhook]', e.message);
    return res.status(400).send(`Webhook Error: ${e.message}`);
  }

  if (event.type === 'payment_intent.succeeded') {
    const pi   = event.data.object;
    const meta = stripeDeposit.extractDepositMeta(pi);

    if (!meta.phone) return res.json({ received: true }); // pas un dépôt salon

    console.log(`[WA-Stripe] 💰 Dépôt reçu pour ${meta.phone} — ref ${meta.bookingRef}`);
    bus.system(`[WA-Stripe] 💰 Dépôt payé — ${meta.clientName} (${meta.phone})`);

    // Récupérer la session pour retrouver le slot sélectionné
    const session = await sessionStore.get(meta.phone);
    const ctx     = session.context || {};

    if (ctx.selectedSlot && ctx.selectedService) {
      try {
        // Créer le RDV Square maintenant que le paiement est confirmé
        const booking = await squareBooking.createBooking({
          serviceVariationId: ctx.selectedService.id,
          teamMemberId:       ctx.selectedSlot.appointment_segments?.[0]?.team_member_id,
          startAt:            ctx.selectedSlot.start_at,
          customerName:       meta.clientName || session.display_name || 'Client',
          customerPhone:      meta.phone,
        });

        ctx.bookingId = booking.id;
        await sessionStore.set(meta.phone, 'booking_confirmed', ctx, session.display_name);

        // Envoyer confirmation WhatsApp
        const dt      = new Date(ctx.selectedSlot.start_at);
        const dateStr = dt.toLocaleDateString('fr-CA', { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'America/Toronto' });
        const hourStr = dt.toLocaleTimeString('fr-CA', { hour: '2-digit', minute: '2-digit', timeZone: 'America/Toronto' });
        const confirmMsg = `🎉 Paiement reçu ! Votre rendez-vous est confirmé :\n\n💇‍♀️ *${ctx.selectedService.name}*\n📅 ${dateStr} à ${hourStr}\n📍 615 Antoinette Robidoux, Local 100, Longueuil\n💳 Dépôt payé : $${(meta.phone && ctx.depositCents ? ctx.depositCents / 100 : 0).toFixed(2)} CAD\n\nÀ très bientôt ! 🌺`;

        await baileysClient.sendText(meta.phone, confirmMsg);
        bus.system(`[WA] ✅ RDV Square créé + confirmation envoyée à ${meta.phone} (${booking.id})`);

      } catch(e) {
        console.error('[WA-Stripe-Webhook] createBooking:', e.message);
        bus.system(`[WA-Stripe] ⚠️ Paiement OK mais erreur Square: ${e.message}`);
        // Notifier quand même le client
        await baileysClient.sendText(meta.phone,
          `🎉 Votre paiement est bien reçu ! Notre équipe confirme votre RDV dans 30 min. Merci ! 🙏`
        ).catch(() => {});
      }
    }
  }

  if (event.type === 'checkout.session.expired') {
    const cs   = event.data.object;
    const meta = stripeDeposit.extractDepositMeta({ metadata: cs.metadata });
    if (meta.phone) {
      await baileysClient.sendText(meta.phone,
        `⏰ Le lien de paiement pour votre RDV a expiré. Souhaitez-vous un nouveau créneau ?`
      ).catch(() => {});
      await sessionStore.set(meta.phone, 'idle', {});
    }
  }

  res.json({ received: true });
}

// Auto-démarrage si env WHATSAPP_AUTOSTART=true
if (process.env.WHATSAPP_AUTOSTART === 'true') {
  setTimeout(() => startWhatsApp().catch(e => console.error('[WA-AutoStart]', e.message)), 12000);
}

module.exports = router;
module.exports.handleStripeDepositWebhook = handleStripeDepositWebhook;
module.exports.startWhatsApp = startWhatsApp;
