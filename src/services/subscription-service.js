'use strict';
/**
 * DALEBA — Subscription Service (SMS OTP Post-Stripe)
 * =====================================================
 * - Crée/met à jour la table daleba_subscriptions
 * - Génère un OTP 6 chiffres et l'envoie par SMS (Twilio)
 * - Fournit fonctions OTP verify/create-session
 */

const crypto = require('crypto');

let pool = null, DEMO_MODE = true;
try { const db = require('../memory/db'); pool = db.pool; DEMO_MODE = db.DEMO_MODE; } catch(e) {}

// ── Twilio ───────────────────────────────────────────────────────────────────
let twilioClient = null;
function getTwilio() {
  if (twilioClient) return twilioClient;
  const sid = process.env.TWILIO_ACCOUNT_SID;
  const tok = process.env.TWILIO_AUTH_TOKEN;
  if (!sid || !tok) return null;
  try { twilioClient = require('twilio')(sid, tok); } catch(e) {}
  return twilioClient;
}
const TWILIO_FROM = process.env.TWILIO_PHONE_NUMBER || '+13022328291';

// ── OTP Store (mémoire — survivre redémarrage via DB fallback) ───────────────
const otpStore = new Map(); // phone → { code, expiresAt, attempts }
const OTP_TTL  = 10 * 60 * 1000; // 10 minutes
const MAX_TRIES = 5;

setInterval(() => {
  const now = Date.now();
  for (const [k, v] of otpStore.entries()) {
    if (v.expiresAt < now) otpStore.delete(k);
  }
}, 5 * 60 * 1000);

// ── Packages DALEBA ─────────────────────────────────────────────────────────
const PACKAGES = {
  audit:      'Audit',
  starter:    'Starter',
  business:   'Business',
  enterprise: 'Enterprise',
};

function detectPackage(session) {
  // 1. Metadata explicite
  const meta = session.metadata || {};
  const raw = (meta.daleba_package || meta.package_name || '').toLowerCase().trim();
  if (PACKAGES[raw]) return PACKAGES[raw];

  // 2. Libellé description
  const desc = (session.payment_link_description || '').toLowerCase();
  for (const [key, label] of Object.entries(PACKAGES)) {
    if (desc.includes(key)) return label;
  }

  // 3. Par montant (CAD)
  const amount = (session.amount_total || 0) / 100;
  if (amount >= 3000) return 'Enterprise';
  if (amount >= 1000) return 'Business';
  if (amount >= 500)  return 'Starter';
  return 'Audit';
}

const DEFAULT_DELIVERABLES = {
  Audit:      ['Analyse marché & concurrence', "Rapport d'opportunités IA", 'Plan d\'action personnalisé'],
  Starter:    ['Audit complet', 'Configuration automatisée', 'Campagne de prospection initiale', 'Formation équipe'],
  Business:   ['Audit & Starter inclus', 'Agent commercial autonome 24/7', 'Pipeline clients automatisé', 'Tableau de bord temps réel', 'Support prioritaire'],
  Enterprise: ['Business complet inclus', 'Intégration CRM/ERP', 'Équipe DALEBA dédiée', 'SLA 99.9%', 'Onboarding personnalisé sur site'],
};

// ── Init tables ──────────────────────────────────────────────────────────────
async function initTables() {
  if (!pool) return;
  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS daleba_subscriptions (
        id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        stripe_session_id VARCHAR(255) UNIQUE,
        stripe_payment_intent VARCHAR(255),
        client_phone     VARCHAR(30),
        client_email     VARCHAR(255),
        client_name      VARCHAR(255),
        package_name     VARCHAR(100) DEFAULT 'Audit',
        amount_cad       DECIMAL(10,2) DEFAULT 0,
        started_at       TIMESTAMP NOT NULL DEFAULT NOW(),
        status           VARCHAR(50) DEFAULT 'active',
        created_at       TIMESTAMP DEFAULT NOW()
      );
    `);
    await pool.query(`
      CREATE TABLE IF NOT EXISTS daleba_deliverables (
        id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        subscription_id UUID REFERENCES daleba_subscriptions(id) ON DELETE CASCADE,
        title           VARCHAR(255) NOT NULL,
        status          VARCHAR(50) DEFAULT 'pending',
        position        INTEGER DEFAULT 0,
        updated_at      TIMESTAMP DEFAULT NOW()
      );
    `);
    await pool.query(`
      CREATE TABLE IF NOT EXISTS daleba_client_sessions (
        id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        client_phone VARCHAR(30) NOT NULL,
        token        VARCHAR(64) UNIQUE NOT NULL,
        expires_at   TIMESTAMP NOT NULL,
        created_at   TIMESTAMP DEFAULT NOW()
      );
    `);
    console.log('[SUBS] Tables daleba_subscriptions + deliverables + sessions prêtes');
  } catch(e) { console.error('[SUBS] initTables:', e.message); }
}
initTables();

// ── Crée une subscription + ses livrables en DB ─────────────────────────────
async function createSubscriptionRecord({ sessionId, paymentIntent, phone, email, name, pkg, amount }) {
  if (!pool || DEMO_MODE) return null;
  try {
    const r = await pool.query(
      `INSERT INTO daleba_subscriptions
         (stripe_session_id, stripe_payment_intent, client_phone, client_email, client_name, package_name, amount_cad, started_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,NOW())
       ON CONFLICT (stripe_session_id) DO UPDATE SET
         client_phone = COALESCE(EXCLUDED.client_phone, daleba_subscriptions.client_phone),
         status = 'active'
       RETURNING *`,
      [sessionId, paymentIntent, phone, email, name, pkg, amount]
    );
    const sub = r.rows[0];
    const existing = await pool.query('SELECT id FROM daleba_deliverables WHERE subscription_id=$1', [sub.id]);
    if (existing.rows.length === 0) {
      const items = DEFAULT_DELIVERABLES[pkg] || DEFAULT_DELIVERABLES.Audit;
      for (let i = 0; i < items.length; i++) {
        await pool.query(
          `INSERT INTO daleba_deliverables (subscription_id, title, status, position) VALUES ($1,$2,'pending',$3)`,
          [sub.id, items[i], i]
        );
      }
    }
    return sub;
  } catch(e) {
    console.error('[SUBS] createSubscriptionRecord:', e.message);
    return null;
  }
}

// ── Crée ou récupère subscription depuis webhook Stripe ─────────────────────
async function handleStripePayment(stripeSession) {
  const phone  = stripeSession.customer_details?.phone
              || stripeSession.metadata?.client_phone
              || null;
  const email  = stripeSession.customer_details?.email
              || stripeSession.customer_email
              || stripeSession.metadata?.client_email
              || null;
  const name   = stripeSession.customer_details?.name
              || stripeSession.metadata?.client_name
              || null;

  // ── Cas panier multi-abonnements ──────────────────────────────────────────
  let cartItems = null;
  try {
    if (stripeSession.metadata?.daleba_cart) {
      cartItems = JSON.parse(stripeSession.metadata.daleba_cart);
    }
  } catch(e) {}

  if (cartItems && cartItems.length > 0) {
    // Panier multi : créer une sub par item et envoyer les SMS groupés
    return await handleCartPayment(stripeSession, cartItems, phone, email, name);
  }

  // ── Achat simple (compatibilité ascendante) ───────────────────────────────
  const pkg    = detectPackage(stripeSession);
  const amount = (stripeSession.amount_total || 0) / 100;

  const sub = await createSubscriptionRecord({
    sessionId:     stripeSession.id,
    paymentIntent: stripeSession.payment_intent,
    phone, email, name, pkg, amount,
  });

  if (phone) {
    try { await sendAccessSMS(phone, pkg); }
    catch(e) { console.error('[SUBS] SMS échoué:', e.message); }
  } else {
    console.warn('[SUBS] Pas de téléphone — SMS ignoré. Email:', email);
  }

  return { sub, phone, pkg, cartMode: false };
}

// ── Gère un paiement de panier (multi-abonnements) ───────────────────────────
async function handleCartPayment(stripeSession, cartItems, phone, email, name) {
  const { PACKAGES } = require('./stripe-catalog');
  const pkgMap = Object.fromEntries(PACKAGES.map(p => [p.id, p]));

  const subs     = [];
  const pkgNames = [];
  const totalQty = cartItems.reduce((s, i) => s + (parseInt(i.quantity) || 1), 0);
  const totalAmt = (stripeSession.amount_total || 0) / 100;
  const amtEach  = totalQty > 0 ? Math.round((totalAmt / totalQty) * 100) / 100 : 0;

  for (const { id, quantity = 1 } of cartItems) {
    const pkg = pkgMap[id];
    if (!pkg) continue;
    const pkgLabel = pkg.name;
    pkgNames.push(pkgLabel);

    for (let q = 0; q < (parseInt(quantity) || 1); q++) {
      const sub = await createSubscriptionRecord({
        sessionId:     `${stripeSession.id}_${id}_${q}`,
        paymentIntent: stripeSession.payment_intent,
        phone, email, name, pkg: pkgLabel, amount: amtEach,
      });
      subs.push({ sub, pkg: pkgLabel });
    }
  }

  // Envoyer SMS multi-codes si téléphone disponible
  if (phone) {
    try {
      await sendMultiAccessSMS(phone, subs.map(s => s.pkg));
    } catch(e) {
      console.error('[SUBS] SMS multi échoué:', e.message);
    }
  }

  return { subs, phone, cartMode: true, pkgNames };
}

// ── Envoie SMS d'accès avec OTP ──────────────────────────────────────────────
async function sendAccessSMS(phone, packageName) {
  const code = String(crypto.randomInt(100000, 999999));
  otpStore.set(phone, { code, expiresAt: Date.now() + OTP_TTL, attempts: 0 });

  const BASE = process.env.API_BASE_URL || 'https://daleba-api-production.up.railway.app';
  const link = `${BASE}/client-login`;
  const msg  = `🎉 Bienvenue DALEBA !\n\nVotre package ${packageName} est activé.\n\nAccédez à votre espace :\n${link}\n\nCode d'accès : ${code}\n(Valide 10 min — ne pas partager)`;

  const client = getTwilio();
  if (!client || DEMO_MODE) {
    console.log(`[SUBS] DEMO SMS → ${phone} | Code: ${code} | Package: ${packageName}`);
    return;
  }

  await client.messages.create({ body: msg, from: TWILIO_FROM, to: phone });
  console.log(`[SUBS] SMS accès envoyé → ${phone} (${packageName})`);
}


// ── SMS multi-codes (panier famille) ─────────────────────────────────────────
async function sendMultiAccessSMS(phone, packageNames) {
  const BASE = process.env.API_BASE_URL || 'https://daleba-api-production.up.railway.app';
  const link = `${BASE}/client-login`;

  // Générer un OTP unique par abonnement
  const entries = packageNames.map((pkgName, i) => {
    const code = String(crypto.randomInt(100000, 999999));
    const key  = i === 0 ? phone : `${phone}#${i}`;
    otpStore.set(key, { code, expiresAt: Date.now() + OTP_TTL, attempts: 0, linkedPhone: phone });
    return { pkgName, code };
  });

  const codeLines = entries.map((e, i) =>
    `${i + 1}. ${e.pkgName} : ${e.code}`
  ).join('\n');

  const msg = `🎉 DALEBA — Vos ${packageNames.length} abonnements sont activés !\n\n${codeLines}\n\nChaque code donne accès à un espace indépendant :\n${link}\n\n(Valides 10 min — ne pas partager)`;

  const client = getTwilio();
  if (!client || DEMO_MODE) {
    console.log(`[SUBS] DEMO MULTI-SMS → ${phone} (${packageNames.length} codes)`);
    entries.forEach(e => console.log(`  • ${e.pkgName}: ${e.code}`));
    return;
  }

  await client.messages.create({ body: msg, from: TWILIO_FROM, to: phone });
  console.log(`[SUBS] SMS multi-accès envoyé → ${phone} (${packageNames.length} codes)`);
}

// ── Re-envoie un OTP (accès /client-login) ──────────────────────────────────
async function requestOTP(phone) {
  const code = String(crypto.randomInt(100000, 999999));
  const prev = otpStore.get(phone) || {};
  otpStore.set(phone, { code, expiresAt: Date.now() + OTP_TTL, attempts: 0, lockUntil: prev.lockUntil });

  const BASE = process.env.API_BASE_URL || 'https://daleba-api-production.up.railway.app';
  const msg  = `Votre code DALEBA : ${code}\n(Valide 10 min — ne pas partager)\n${BASE}/client-login`;

  const client = getTwilio();
  if (!client || DEMO_MODE) {
    console.log(`[SUBS] DEMO OTP → ${phone}: ${code}`);
    return { sent: true, demo: true };
  }

  await client.messages.create({ body: msg, from: TWILIO_FROM, to: phone });
  console.log(`[SUBS] OTP re-envoyé → ${phone}`);
  return { sent: true };
}

// ── Vérifie OTP et crée session ──────────────────────────────────────────────
async function verifyOTPAndLogin(phone, code) {
  const stored = otpStore.get(phone);
  if (!stored) return { valid: false, reason: 'Aucun code en attente pour ce numéro' };
  if (Date.now() > stored.expiresAt) {
    otpStore.delete(phone);
    return { valid: false, reason: 'Code expiré, demandez un nouveau code' };
  }
  if (stored.attempts >= MAX_TRIES) {
    otpStore.delete(phone);
    return { valid: false, reason: 'Trop de tentatives' };
  }
  stored.attempts++;
  if (String(code).trim() !== stored.code) {
    return { valid: false, reason: 'Code incorrect' };
  }
  otpStore.delete(phone);

  // Créer token session 7 jours
  const token = crypto.randomBytes(32).toString('hex');
  if (pool && !DEMO_MODE) {
    try {
      await pool.query(
        `INSERT INTO daleba_client_sessions (client_phone, token, expires_at)
         VALUES ($1,$2,$3)
         ON CONFLICT DO NOTHING`,
        [phone, token, new Date(Date.now() + 7 * 24 * 3600 * 1000)]
      );
    } catch(e) { console.warn('[SUBS] session insert:', e.message); }
  }

  return { valid: true, token };
}

// ── Résoudre token → phone ───────────────────────────────────────────────────
async function resolveToken(token) {
  if (!token || !pool || DEMO_MODE) return null;
  try {
    const r = await pool.query(
      `SELECT client_phone FROM daleba_client_sessions
       WHERE token=$1 AND expires_at > NOW() LIMIT 1`,
      [token]
    );
    return r.rows[0]?.client_phone || null;
  } catch(e) { return null; }
}

// ── Récupère la subscription d'un client ────────────────────────────────────
async function getClientSubscription(phone) {
  if (!pool || DEMO_MODE) {
    return {
      packageName: 'Starter',
      startedAt:   new Date().toISOString(),
      status:      'active',
      clientName:  'Client Démo',
      amountCad:   500,
      deliverables: [
        { title: 'Audit complet',                   status: 'delivered', position: 0 },
        { title: 'Configuration automatisée',       status: 'in_progress', position: 1 },
        { title: 'Campagne de prospection initiale', status: 'pending',  position: 2 },
        { title: 'Formation équipe',                status: 'pending',  position: 3 },
      ],
    };
  }

  try {
    const r = await pool.query(
      `SELECT * FROM daleba_subscriptions
       WHERE client_phone=$1 AND status='active'
       ORDER BY started_at DESC LIMIT 1`,
      [phone]
    );
    if (!r.rows[0]) return null;
    const sub = r.rows[0];

    const d = await pool.query(
      `SELECT title, status, position FROM daleba_deliverables
       WHERE subscription_id=$1 ORDER BY position`,
      [sub.id]
    );

    return {
      packageName:  sub.package_name,
      startedAt:    sub.started_at,
      status:       sub.status,
      clientName:   sub.client_name,
      amountCad:    parseFloat(sub.amount_cad),
      deliverables: d.rows,
    };
  } catch(e) {
    console.error('[SUBS] getClientSubscription:', e.message);
    return null;
  }
}

module.exports = {
  handleStripePayment,
  sendAccessSMS,
  sendMultiAccessSMS,
  requestOTP,
  verifyOTPAndLogin,
  resolveToken,
  getClientSubscription,
};
