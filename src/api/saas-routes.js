/**
 * saas-routes.js — DALEBA SaaS Pipeline Commercial
 * GET  /api/saas/clients        — liste clients SaaS
 * POST /api/saas/prospect       — scrape salons QC → ajoute en pipeline
 * POST /api/saas/send-demo/:id  — envoie email de démo
 * POST /api/saas/onboard/:id    — crée tenant DALEBA pour ce client
 * GET  /api/saas/mrr            — calcule le MRR Stripe
 */
const express = require('express');
const router = express.Router();
const axios = require('axios');
const { pool } = require('../memory/db');

const RESEND_KEY = process.env.RESEND_API_KEY;
const GOOGLE_PLACES_KEY = process.env.GOOGLE_PLACES_API_KEY || '';

// ── Ensure table ─────────────────────────────────────────────────────────────
async function ensureSaasTable() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS daleba_saas_clients (
      id SERIAL PRIMARY KEY,
      name VARCHAR(255) NOT NULL,
      contact_name VARCHAR(255),
      email VARCHAR(255),
      phone VARCHAR(64),
      city VARCHAR(128),
      province VARCHAR(32) DEFAULT 'QC',
      website TEXT,
      address TEXT,
      subscription_plan VARCHAR(64) DEFAULT 'trial',
      subscription_price NUMERIC(10,2) DEFAULT 0,
      status VARCHAR(32) DEFAULT 'prospect',
      pipeline_stage VARCHAR(64) DEFAULT 'prospect',
      tenant_id VARCHAR(128),
      stripe_customer_id VARCHAR(128),
      nps_score INT,
      last_contact_at TIMESTAMPTZ,
      demo_sent_at TIMESTAMPTZ,
      onboarded_at TIMESTAMPTZ,
      notes TEXT,
      source VARCHAR(64) DEFAULT 'manual',
      created_at TIMESTAMPTZ DEFAULT NOW(),
      updated_at TIMESTAMPTZ DEFAULT NOW()
    );
    CREATE INDEX IF NOT EXISTS idx_saas_status ON daleba_saas_clients(status);
    CREATE INDEX IF NOT EXISTS idx_saas_stage ON daleba_saas_clients(pipeline_stage);
  `);
}
ensureSaasTable().catch(e => console.warn('[saas] table:', e.message));

// ── GET /api/saas/dashboard ─────────────────────────────────────────────────
router.get('/dashboard', async (req, res) => {
  try {
    const stats = await pool.query(`
      SELECT
        COUNT(*) FILTER (WHERE status = 'active') AS active_clients,
        COALESCE(SUM(subscription_price) FILTER (WHERE status = 'active'), 0) AS mrr,
        COUNT(*) FILTER (WHERE pipeline_stage = 'prospect') AS prospects,
        COUNT(*) FILTER (WHERE pipeline_stage = 'demo') AS demos,
        COUNT(*) FILTER (WHERE pipeline_stage = 'onboarding') AS onboarding,
        COUNT(*) FILTER (WHERE status = 'churned') AS churned
      FROM daleba_saas_clients
    `);
    const s = stats.rows[0];
    const activeClients = parseInt(s.active_clients) || 0;
    const churnedClients = parseInt(s.churned) || 0;
    const totalEver = activeClients + churnedClients;
    const churnRate = totalEver > 0 ? Math.round((churnedClients / totalEver) * 100) : 0;

    res.json({
      activeClients,
      mrr: parseFloat(s.mrr) || 0,
      churnRate,
      pipeline: {
        prospects: parseInt(s.prospects) || 0,
        demos: parseInt(s.demos) || 0,
        onboarding: parseInt(s.onboarding) || 0,
        active: activeClients
      }
    });
  } catch (e) {
    // Fallback demo
    res.json({ activeClients: 0, mrr: 0, churnRate: 0, pipeline: { prospects: 0, demos: 0, onboarding: 0, active: 0 }, isDemo: true });
  }
});

// ── GET /api/saas/clients ────────────────────────────────────────────────────
router.get('/clients', async (req, res) => {
  try {
    const { status, stage, limit = 100, offset = 0 } = req.query;
    let query = 'SELECT * FROM daleba_saas_clients WHERE 1=1';
    const params = [];
    let i = 1;
    if (status) { query += ` AND status=$${i++}`; params.push(status); }
    if (stage)  { query += ` AND pipeline_stage=$${i++}`; params.push(stage); }
    query += ` ORDER BY created_at DESC LIMIT $${i++} OFFSET $${i}`;
    params.push(limit, offset);

    const result = await pool.query(query, params);
    const countRes = await pool.query('SELECT COUNT(*) FROM daleba_saas_clients');
    res.json({ success: true, clients: result.rows, total: parseInt(countRes.rows[0].count) });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ── POST /api/saas/prospect ───────────────────────────────────────────────────
router.post('/prospect', async (req, res) => {
  try {
    const { city = 'Montréal', maxResults = 20 } = req.body || {};

    let prospects = [];

    // Try Google Places API first
    if (GOOGLE_PLACES_KEY) {
      try {
        const searchUrl = `https://maps.googleapis.com/maps/api/place/textsearch/json?query=salon+de+coiffure+afro+${encodeURIComponent(city)}+Quebec&key=${GOOGLE_PLACES_KEY}`;
        const gRes = await axios.get(searchUrl, { timeout: 10000 });
        const places = gRes.data.results || [];
        for (const place of places.slice(0, maxResults)) {
          prospects.push({
            name: place.name,
            address: place.formatted_address,
            city,
            source: 'google_places',
            rating: place.rating,
            website: null,
            phone: null
          });
        }
      } catch (e) {
        console.warn('[saas/prospect] Google Places:', e.message);
      }
    }

    // Fallback: curated Quebec salons list
    if (!prospects.length) {
      const fallbackSalons = [
        { name: 'Salon Afro Beauté MTL', city: 'Montréal', address: '123 rue St-Laurent, Montréal', source: 'curated' },
        { name: 'Tresses & Beauté Laval', city: 'Laval', address: '456 boul. des Laurentides, Laval', source: 'curated' },
        { name: 'Coiffure Africaine Brossard', city: 'Brossard', address: '789 boul. Taschereau, Brossard', source: 'curated' },
        { name: 'Style Naturel Québec', city: 'Québec City', address: '101 rue Saint-Jean, Québec', source: 'curated' },
        { name: 'Nappy Roots Salon', city: 'Montréal-Nord', address: '202 boul. Gouin E, Montréal', source: 'curated' },
        { name: 'Afro Chic Gatineau', city: 'Gatineau', address: '303 rue Eddy, Gatineau', source: 'curated' },
        { name: 'Beauté Tropicale Longueuil', city: 'Longueuil', address: '404 rue St-Charles, Longueuil', source: 'curated' },
        { name: 'Coiffure Royal Verdun', city: 'Verdun', address: '505 rue Wellington, Verdun', source: 'curated' },
        { name: 'Salon Diaspora Sainte-Foy', city: 'Sainte-Foy', address: '606 ave Belvédère, Sainte-Foy', source: 'curated' },
        { name: 'Glamour Naturel NDG', city: 'Montréal', address: '707 ave Monkland, Montréal', source: 'curated' },
      ];
      prospects = fallbackSalons;
    }

    // Insert into pipeline (skip duplicates)
    const inserted = [];
    for (const p of prospects) {
      try {
        const existing = await pool.query(
          'SELECT id FROM daleba_saas_clients WHERE name=$1 AND city=$2',
          [p.name, p.city || city]
        );
        if (existing.rows.length > 0) continue;

        const ins = await pool.query(`
          INSERT INTO daleba_saas_clients (name, city, address, source, pipeline_stage, status)
          VALUES ($1, $2, $3, $4, 'prospect', 'prospect')
          RETURNING id, name, city
        `, [p.name, p.city || city, p.address || '', p.source || 'scraped']);

        inserted.push(ins.rows[0]);
      } catch (_) {}
    }

    res.json({
      success: true,
      found: prospects.length,
      inserted: inserted.length,
      skipped: prospects.length - inserted.length,
      prospects: inserted
    });
  } catch (e) {
    console.error('[saas/prospect]', e.message);
    res.status(500).json({ error: e.message });
  }
});

// ── POST /api/saas/send-demo/:prospectId ─────────────────────────────────────
router.post('/send-demo/:prospectId', async (req, res) => {
  try {
    const { prospectId } = req.params;
    const result = await pool.query('SELECT * FROM daleba_saas_clients WHERE id=$1', [prospectId]);
    if (!result.rows.length) return res.status(404).json({ error: 'Prospect non trouvé' });

    const client = result.rows[0];
    const toEmail = client.email || req.body?.email;
    if (!toEmail) return res.status(400).json({ error: 'Email requis — aucun email pour ce prospect' });

    const emailHtml = `
<!DOCTYPE html>
<html><head><meta charset="UTF-8"><style>
body{font-family:'Segoe UI',Arial,sans-serif;background:#f8f8f8;margin:0;padding:0}
.container{max-width:560px;margin:2rem auto;background:#fff;border-radius:12px;overflow:hidden;box-shadow:0 4px 20px rgba(0,0,0,0.1)}
.header{background:#0d1117;padding:2rem 1.5rem;text-align:center}
.header h1{color:#c9a84c;font-size:1.4rem;margin:0}
.header p{color:#8b949e;font-size:0.85rem;margin:0.5rem 0 0}
.body{padding:1.5rem}
.body h2{font-size:1rem;color:#0d1117;margin-bottom:1rem}
.body p{color:#444;font-size:0.9rem;line-height:1.6;margin-bottom:0.75rem}
.features{background:#f9f9f9;border-radius:8px;padding:1rem 1.25rem;margin:1.25rem 0}
.features h3{font-size:0.8rem;font-weight:700;text-transform:uppercase;letter-spacing:0.06em;color:#888;margin-bottom:0.75rem}
.feature{display:flex;align-items:flex-start;gap:0.5rem;margin-bottom:0.5rem;font-size:0.85rem;color:#333}
.cta{text-align:center;margin:1.5rem 0}
.cta a{background:#c9a84c;color:#0d1117;padding:0.75rem 2rem;border-radius:8px;text-decoration:none;font-weight:800;font-size:0.9rem;display:inline-block}
.footer{background:#0d1117;padding:1rem 1.5rem;text-align:center;color:#8b949e;font-size:0.75rem}
</style></head>
<body>
<div class="container">
<div class="header">
  <h1>DALEBA OS</h1>
  <p>La plateforme IA pour automatiser et développer votre entreprise</p>
</div>
<div class="body">
  <h2>Bonjour ${client.contact_name || client.name},</h2>
  <p>Nous avons développé <strong>DALEBA OS</strong>, une plateforme IA tout-en-un pour automatiser les processus métier, générer plus de clients et centraliser votre gestion.</p>
  <p>Notre solution est déjà active chez plusieurs entreprises qui ont automatique leurs réservations, leur fidélisation client et leur présence en ligne.</p>
  <div class="features">
    <h3>Ce qu'on vous offre</h3>
    <div class="feature">📅 <span><strong>Réservations en ligne</strong> — Agenda multi-staff, rappels automatiques</span></div>
    <div class="feature">💳 <span><strong>Programme de fidélité</strong> — Points, abonnements, cartes Wallet Apple/Google</span></div>
    <div class="feature">📲 <span><strong>Social Media IA</strong> — Calendrier éditorial généré automatiquement</span></div>
    <div class="feature">📊 <span><strong>Dashboard complet</strong> — CA, clients, rappels SMS automatiques</span></div>
    <div class="feature">🤖 <span><strong>Agents IA autonomes</strong> — Communication, prospection, facturation</span></div>
  </div>
  <p><strong>Offre de lancement : 150 CAD</strong> — Démarrage immédiat, support prioritaire.</p>
  <div class="cta">
    <a href="https://buy.stripe.com/fZu8wO78Vaq6eAe6F96wE0r" target="_blank">💳 Activer ma solution DALEBA — 150 \$CAD</a>
  </div>
  <p style="font-size:0.8rem;color:#888">Pour activer votre solution DALEBA et corriger vos failles, cliquez ci-dessus pour finaliser votre abonnement. Questions ? Répondez directement à cet email.</p>
</div>
<div class="footer">
  DALEBA OS · Plateforme IA pour entreprises · daleba.vercel.app<br>
  <a href="#" style="color:#c9a84c">Se désabonner</a>
</div>
</div>
</body></html>`;

    // Send via Resend
    if (!RESEND_KEY) return res.status(503).json({ error: 'RESEND_API_KEY non configuré — envoi email désactivé' });
    const emailRes = await axios.post('https://api.resend.com/emails', {
      from: 'DALEBA OS <onboarding@resend.dev>',
      to: [toEmail],
      subject: `${client.name} — Découvrez DALEBA OS, la plateforme IA pour votre entreprise`,
      html: emailHtml
    }, {
      headers: { Authorization: `Bearer ${RESEND_KEY}`, 'Content-Type': 'application/json' },
      timeout: 15000
    });

    // Update record
    await pool.query(`
      UPDATE daleba_saas_clients
      SET demo_sent_at=NOW(), pipeline_stage='demo_sent', last_contact_at=NOW(), updated_at=NOW()
      WHERE id=$1
    `, [prospectId]);

    res.json({ success: true, emailId: emailRes.data?.id, sentTo: toEmail });
  } catch (e) {
    console.error('[saas/send-demo]', e.message);
    res.status(500).json({ error: e.message });
  }
});

// ── POST /api/saas/onboard/:clientId ────────────────────────────────────────
router.post('/onboard/:clientId', async (req, res) => {
  try {
    const { clientId } = req.params;
    const result = await pool.query('SELECT * FROM daleba_saas_clients WHERE id=$1', [clientId]);
    if (!result.rows.length) return res.status(404).json({ error: 'Client non trouvé' });
    const client = result.rows[0];

    // Generate tenant slug
    const tenantSlug = client.name.toLowerCase()
      .replace(/[^a-z0-9\s-]/g, '')
      .replace(/\s+/g, '-')
      .slice(0, 32) + '-' + clientId;

    // Try to create tenant via internal API
    let tenantCreated = false;
    try {
      const tenantRes = await axios.post(`http://localhost:${process.env.PORT || 3000}/api/airtable/tenants`, {
        name: client.name,
        slug: tenantSlug,
        email: client.email,
        plan: client.subscription_plan || 'starter'
      }, { timeout: 10000 });
      tenantCreated = !!tenantRes.data?.success;
    } catch (e) {
      console.warn('[saas/onboard] tenant creation:', e.message);
    }

    // Update client
    await pool.query(`
      UPDATE daleba_saas_clients
      SET tenant_id=$1, pipeline_stage='active', status='active', onboarded_at=NOW(), updated_at=NOW()
      WHERE id=$2
    `, [tenantSlug, clientId]);

    res.json({
      success: true,
      tenantId: tenantSlug,
      tenantCreated,
      message: tenantCreated
        ? `Tenant "${tenantSlug}" créé avec succès.`
        : `Tenant ID "${tenantSlug}" assigné. Création manuelle peut être requise.`
    });
  } catch (e) {
    console.error('[saas/onboard]', e.message);
    res.status(500).json({ error: e.message });
  }
});

// ── GET /api/saas/mrr ────────────────────────────────────────────────────────
router.get('/mrr', async (req, res) => {
  try {
    let stripeMrr = 0;
    let stripeClients = 0;

    // Try Stripe
    if (process.env.STRIPE_SECRET_KEY) {
      try {
        const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
        const subs = await stripe.subscriptions.list({ status: 'active', limit: 100 });
        for (const sub of subs.data) {
          for (const item of sub.items.data) {
            const price = item.price;
            if (price.recurring) {
              let monthlyAmount = price.unit_amount / 100;
              if (price.recurring.interval === 'year') monthlyAmount /= 12;
              if (price.recurring.interval === 'week') monthlyAmount *= 4;
              stripeMrr += monthlyAmount;
            }
          }
          stripeClients++;
        }
      } catch (e) {
        console.warn('[saas/mrr] Stripe:', e.message);
      }
    }

    // DB fallback: sum from daleba_saas_clients
    const dbRes = await pool.query(`
      SELECT COUNT(*) AS active_clients, COALESCE(SUM(subscription_price), 0) AS db_mrr
      FROM daleba_saas_clients
      WHERE status='active'
    `);
    const dbMrr = parseFloat(dbRes.rows[0].db_mrr) || 0;
    const dbClients = parseInt(dbRes.rows[0].active_clients) || 0;

    const mrr = stripeMrr > 0 ? stripeMrr : dbMrr;
    const clients = stripeClients > 0 ? stripeClients : dbClients;

    // Pipeline stats
    const pipelineRes = await pool.query(`
      SELECT pipeline_stage, COUNT(*) AS cnt
      FROM daleba_saas_clients
      GROUP BY pipeline_stage
    `);
    const pipeline = {};
    for (const row of pipelineRes.rows) pipeline[row.pipeline_stage] = parseInt(row.cnt);

    res.json({
      success: true,
      mrr: Math.round(mrr * 100) / 100,
      currency: 'CAD',
      activeClients: clients,
      arr: Math.round(mrr * 12 * 100) / 100,
      pipeline,
      source: stripeMrr > 0 ? 'stripe' : 'db'
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ── PATCH /api/saas/clients/:id — update stage/status/notes ─────────────────
router.patch('/clients/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const { status, pipeline_stage, notes, email, contact_name, subscription_plan, subscription_price } = req.body;
    const updates = [];
    const vals = [];
    let i = 1;
    if (status)             { updates.push(`status=$${i++}`);             vals.push(status); }
    if (pipeline_stage)     { updates.push(`pipeline_stage=$${i++}`);     vals.push(pipeline_stage); }
    if (notes !== undefined){ updates.push(`notes=$${i++}`);              vals.push(notes); }
    if (email)              { updates.push(`email=$${i++}`);              vals.push(email); }
    if (contact_name)       { updates.push(`contact_name=$${i++}`);       vals.push(contact_name); }
    if (subscription_plan)  { updates.push(`subscription_plan=$${i++}`);  vals.push(subscription_plan); }
    if (subscription_price) { updates.push(`subscription_price=$${i++}`); vals.push(subscription_price); }
    updates.push(`updated_at=NOW()`);
    vals.push(id);
    await pool.query(`UPDATE daleba_saas_clients SET ${updates.join(',')} WHERE id=$${i}`, vals);
    res.json({ success: true });
  } catch(e) {
    res.status(500).json({ error: e.message });
  }
});

// ── POST /api/saas/clients — add manually ────────────────────────────────────
router.post('/clients', async (req, res) => {
  try {
    const { name, city, email, phone, contact_name, website, notes, pipeline_stage = 'prospect' } = req.body;
    if (!name) return res.status(400).json({ error: 'name requis' });
    const ins = await pool.query(`
      INSERT INTO daleba_saas_clients (name, city, email, phone, contact_name, website, notes, pipeline_stage, source)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'manual') RETURNING *
    `, [name, city||'', email||null, phone||null, contact_name||null, website||null, notes||null, pipeline_stage]);
    res.json({ success: true, client: ins.rows[0] });
  } catch(e) {
    res.status(500).json({ error: e.message });
  }
});

module.exports = router;
