/**
 * DALEBA V23 — Migration Adaptée au schéma Railway (KADIO OS Platform)
 * Schéma existant: UUIDs, businesses avec colonnes Twilio/Stripe intégrées
 * On ne casse rien — on ajoute uniquement ce qui manque.
 */

require('dotenv').config();
const { Pool } = require('pg');
const pool = new Pool({ connectionString: process.env.DATABASE_URL });

async function migrate() {
  console.log('🚀 DALEBA V23 — Migration SaaS Multi-Tenant (schéma adapté)...\n');

  // ─── 1. tenant_integrations (tokens OAuth dynamiques par business) ────────
  await pool.query(`
    CREATE TABLE IF NOT EXISTS tenant_integrations (
      id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      business_id     UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
      provider        TEXT NOT NULL,
      -- 'square' | 'meta' | 'twilio' | 'stripe' | 'google'
      access_token    TEXT,
      refresh_token   TEXT,
      token_expires   TIMESTAMPTZ,
      scope           TEXT,
      extra           JSONB DEFAULT '{}',
      is_active       BOOLEAN DEFAULT true,
      connected_at    TIMESTAMPTZ DEFAULT NOW(),
      updated_at      TIMESTAMPTZ DEFAULT NOW(),
      UNIQUE(business_id, provider)
    );
    CREATE INDEX IF NOT EXISTS idx_integrations_business ON tenant_integrations(business_id);
    CREATE INDEX IF NOT EXISTS idx_integrations_provider ON tenant_integrations(provider);
  `);
  console.log('✅ Table: tenant_integrations');

  // ─── 2. tenant_twilio (sous-comptes Twilio dédiés par tenant) ─────────────
  await pool.query(`
    CREATE TABLE IF NOT EXISTS tenant_twilio (
      id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      business_id         UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE UNIQUE,
      twilio_account_sid  TEXT,
      twilio_auth_token   TEXT,
      phone_number        TEXT,
      phone_sid           TEXT,
      subaccount_sid      TEXT,
      status              TEXT DEFAULT 'active',
      provisioned_at      TIMESTAMPTZ DEFAULT NOW(),
      updated_at          TIMESTAMPTZ DEFAULT NOW()
    );
    CREATE INDEX IF NOT EXISTS idx_tenant_twilio_business ON tenant_twilio(business_id);
  `);
  console.log('✅ Table: tenant_twilio');

  // ─── 3. subscription_plans (plans SaaS DALEBA) ────────────────────────────
  await pool.query(`
    CREATE TABLE IF NOT EXISTS subscription_plans (
      id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      name            TEXT NOT NULL UNIQUE,
      price_monthly   DECIMAL(10,2) NOT NULL,
      price_yearly    DECIMAL(10,2),
      features        JSONB DEFAULT '[]',
      limits          JSONB DEFAULT '{}',
      stripe_price_id TEXT,
      is_active       BOOLEAN DEFAULT true,
      created_at      TIMESTAMPTZ DEFAULT NOW()
    );
  `);

  await pool.query(`
    INSERT INTO subscription_plans (name, price_monthly, price_yearly, features, limits)
    VALUES
      ('Starter',    49.00,  490.00,
       '["RDV en ligne","SMS rappels 500/mois","1 employé","Tableau de bord"]',
       '{"sms_per_month":500,"staff_max":1,"locations_max":1}'),
      ('Pro',        99.00,  990.00,
       '["Tout Starter","SMS 2000/mois","5 employés","Fidélité","Social media"]',
       '{"sms_per_month":2000,"staff_max":5,"locations_max":2}'),
      ('Enterprise', 249.00, 2490.00,
       '["Tout Pro","SMS illimités","Employés illimités","Agent vocal IA","Support prioritaire"]',
       '{"sms_per_month":99999,"staff_max":999,"locations_max":10}')
    ON CONFLICT (name) DO NOTHING;
  `);
  console.log('✅ Table: subscription_plans + 3 plans (Starter / Pro / Enterprise)');

  // ─── 4. business_subscriptions ────────────────────────────────────────────
  await pool.query(`
    CREATE TABLE IF NOT EXISTS business_subscriptions (
      id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      business_id         UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE UNIQUE,
      plan_id             UUID REFERENCES subscription_plans(id),
      stripe_customer_id  TEXT,
      stripe_sub_id       TEXT,
      status              TEXT DEFAULT 'trial',
      trial_ends_at       TIMESTAMPTZ,
      current_period_end  TIMESTAMPTZ,
      created_at          TIMESTAMPTZ DEFAULT NOW(),
      updated_at          TIMESTAMPTZ DEFAULT NOW()
    );
    CREATE INDEX IF NOT EXISTS idx_subscriptions_business ON business_subscriptions(business_id);
    CREATE INDEX IF NOT EXISTS idx_subscriptions_status ON business_subscriptions(status);
  `);
  console.log('✅ Table: business_subscriptions');

  // ─── 5. daleba_loyalty ────────────────────────────────────────────────────
  await pool.query(`
    CREATE TABLE IF NOT EXISTS daleba_loyalty (
      id                    SERIAL PRIMARY KEY,
      business_id           UUID REFERENCES businesses(id),
      square_customer_id    TEXT,
      phone                 TEXT,
      name                  TEXT,
      email                 TEXT,
      points                INTEGER DEFAULT 0,
      total_spent           DECIMAL(10,2) DEFAULT 0,
      last_visit            TIMESTAMPTZ,
      source                TEXT DEFAULT 'square',
      reengagement_sent_at  TIMESTAMPTZ DEFAULT '2000-01-01',
      created_at            TIMESTAMPTZ DEFAULT NOW(),
      updated_at            TIMESTAMPTZ DEFAULT NOW(),
      UNIQUE(business_id, phone)
    );
    CREATE INDEX IF NOT EXISTS idx_loyalty_business ON daleba_loyalty(business_id);
    CREATE INDEX IF NOT EXISTS idx_loyalty_phone    ON daleba_loyalty(phone);
    CREATE INDEX IF NOT EXISTS idx_loyalty_points   ON daleba_loyalty(points DESC);
  `);
  console.log('✅ Table: daleba_loyalty');

  // ─── 6. daleba_content_queue ──────────────────────────────────────────────
  await pool.query(`
    CREATE TABLE IF NOT EXISTS daleba_content_queue (
      id            SERIAL PRIMARY KEY,
      business_id   UUID REFERENCES businesses(id),
      platform      TEXT NOT NULL,
      content       TEXT NOT NULL,
      media_url     TEXT,
      topic         TEXT,
      style         TEXT,
      status        TEXT DEFAULT 'pending',
      scheduled_at  TIMESTAMPTZ NOT NULL,
      published_at  TIMESTAMPTZ,
      error         TEXT,
      created_at    TIMESTAMPTZ DEFAULT NOW()
    );
    CREATE INDEX IF NOT EXISTS idx_content_business  ON daleba_content_queue(business_id);
    CREATE INDEX IF NOT EXISTS idx_content_status    ON daleba_content_queue(status);
    CREATE INDEX IF NOT EXISTS idx_content_scheduled ON daleba_content_queue(scheduled_at);
  `);
  console.log('✅ Table: daleba_content_queue');

  // ─── 7. daleba_chat_sessions (Human-in-the-loop) ──────────────────────────
  await pool.query(`
    CREATE TABLE IF NOT EXISTS daleba_chat_sessions (
      id            SERIAL PRIMARY KEY,
      business_id   UUID REFERENCES businesses(id),
      client_id     VARCHAR(64) NOT NULL,
      channel       VARCHAR(32) NOT NULL DEFAULT 'voice',
      status        VARCHAR(32) NOT NULL DEFAULT 'bot_handling',
      call_sid      VARCHAR(64),
      metadata      JSONB DEFAULT '{}',
      created_at    TIMESTAMPTZ DEFAULT NOW(),
      updated_at    TIMESTAMPTZ DEFAULT NOW(),
      UNIQUE(business_id, client_id, channel)
    );
    CREATE INDEX IF NOT EXISTS idx_chat_sessions_business ON daleba_chat_sessions(business_id);
    CREATE INDEX IF NOT EXISTS idx_chat_sessions_status   ON daleba_chat_sessions(status);
  `);
  console.log('✅ Table: daleba_chat_sessions');

  // ─── 8. daleba_notes (strategic-memory) ───────────────────────────────────
  await pool.query(`
    CREATE TABLE IF NOT EXISTS daleba_notes (
      id          SERIAL PRIMARY KEY,
      business_id UUID REFERENCES businesses(id),
      title       TEXT NOT NULL,
      content     TEXT NOT NULL,
      category    VARCHAR(50) NOT NULL DEFAULT 'note',
      tags        JSONB DEFAULT '[]',
      priority    VARCHAR(20) DEFAULT 'normal',
      author_id   VARCHAR(100) DEFAULT 'ulrich',
      created_at  TIMESTAMPTZ DEFAULT NOW(),
      updated_at  TIMESTAMPTZ DEFAULT NOW()
    );
    CREATE INDEX IF NOT EXISTS idx_notes_business  ON daleba_notes(business_id);
    CREATE INDEX IF NOT EXISTS idx_notes_category  ON daleba_notes(category);
  `);
  console.log('✅ Table: daleba_notes');

  // ─── SEED : Kadio Coiffure — Client Zéro ──────────────────────────────────
  const KADIO_ID = '00000000-0000-0000-0000-000000000001';

  // Mise à jour du business existant (credentials depuis env)
  const _sid   = process.env.TWILIO_ACCOUNT_SID || '';
  const _token = process.env.TWILIO_AUTH_TOKEN || '';
  const _phone = process.env.TWILIO_PHONE_NUMBER || '';
  await pool.query(`
    UPDATE businesses
    SET
      name                 = 'Kadio Coiffure et Esthétique',
      twilio_account_sid   = NULLIF($2, ''),
      twilio_auth_token    = NULLIF($3, ''),
      twilio_phone_from    = NULLIF($4, ''),
      updated_at           = NOW()
    WHERE id = $1
  `, [KADIO_ID, _sid, _token, _phone]);
  console.log('✅ Seed: businesses → Kadio Coiffure mis à jour (Twilio depuis env)');

  // tenant_integrations: Square (credentials depuis env)
  const squareToken = process.env.SQUARE_ACCESS_TOKEN;
  const squareLocId = process.env.SQUARE_LOCATION_ID || '';
  if (squareToken) {
    await pool.query(`
      INSERT INTO tenant_integrations (business_id, provider, access_token, extra, is_active)
      VALUES ($1, 'square', $2, $3, true)
      ON CONFLICT (business_id, provider) DO UPDATE
        SET access_token = EXCLUDED.access_token,
            extra = EXCLUDED.extra,
            updated_at = NOW()
    `, [KADIO_ID, squareToken, JSON.stringify({ location_id: squareLocId, env: 'production' })]);
    console.log('✅ Seed: tenant_integrations → Square connecté (Kadio Coiffure)');
  } else {
    console.log('⚠️  SQUARE_ACCESS_TOKEN non défini — seed Square ignoré');
  }

  // tenant_twilio: sous-compte Twilio Kadio (credentials depuis env)
  const twilioSid   = process.env.TWILIO_ACCOUNT_SID;
  const twilioToken = process.env.TWILIO_AUTH_TOKEN;
  const twilioPhone = process.env.TWILIO_PHONE_NUMBER || '+13022328291';
  if (twilioSid && twilioToken) {
    await pool.query(`
      INSERT INTO tenant_twilio (business_id, twilio_account_sid, twilio_auth_token, phone_number, status)
      VALUES ($1, $2, $3, $4, 'active')
      ON CONFLICT (business_id) DO UPDATE
        SET twilio_account_sid = EXCLUDED.twilio_account_sid,
            twilio_auth_token  = EXCLUDED.twilio_auth_token,
            phone_number       = EXCLUDED.phone_number,
            status             = 'active',
            updated_at         = NOW()
    `, [KADIO_ID, twilioSid, twilioToken, twilioPhone]);
    console.log(`✅ Seed: tenant_twilio → ${twilioPhone} (Kadio Coiffure)`);
  } else {
    console.log('⚠️  TWILIO_ACCOUNT_SID / TWILIO_AUTH_TOKEN non définis — seed Twilio ignoré');
  }

  // business_subscriptions: plan Enterprise trial 30j
  await pool.query(`
    INSERT INTO business_subscriptions (business_id, plan_id, status, trial_ends_at)
    SELECT $1, id, 'trial', NOW() + INTERVAL '30 days'
    FROM subscription_plans WHERE name = 'Enterprise'
    ON CONFLICT (business_id) DO UPDATE
      SET status = 'trial', updated_at = NOW()
  `, [KADIO_ID]);
  console.log('✅ Seed: business_subscriptions → Plan Enterprise trial 30 jours');

  // ─── RAPPORT FINAL ────────────────────────────────────────────────────────
  const [biz, integrations, twilio, sub] = await Promise.all([
    pool.query("SELECT id, name FROM businesses WHERE id = $1", [KADIO_ID]),
    pool.query("SELECT provider, is_active FROM tenant_integrations WHERE business_id = $1", [KADIO_ID]),
    pool.query("SELECT phone_number, status FROM tenant_twilio WHERE business_id = $1", [KADIO_ID]),
    pool.query("SELECT s.status, s.trial_ends_at, p.name as plan FROM business_subscriptions s JOIN subscription_plans p ON p.id = s.plan_id WHERE s.business_id = $1", [KADIO_ID]),
  ]);

  console.log('\n╔══════════════════════════════════════════════════════════════╗');
  console.log('║        DALEBA V23 — Rapport d\'Audit Migration ✅             ║');
  console.log('╠══════════════════════════════════════════════════════════════╣');
  console.log(`║ Business     : ${biz.rows[0]?.name}`);
  console.log(`║ ID           : ${biz.rows[0]?.id}`);
  console.log(`║ Intégrations : ${integrations.rows.map(r=>r.provider).join(', ')}`);
  console.log(`║ Twilio       : ${twilio.rows[0]?.phone_number} (${twilio.rows[0]?.status})`);
  console.log(`║ Plan         : ${sub.rows[0]?.plan} — ${sub.rows[0]?.status}`);
  console.log(`║ Trial fin    : ${sub.rows[0]?.trial_ends_at?.toISOString().slice(0,10)}`);
  console.log('╚══════════════════════════════════════════════════════════════╝\n');

  await pool.end();
}

migrate().catch(err => {
  console.error('❌ Erreur migration V23:', err.message);
  process.exit(1);
});
