require('dotenv').config();
const { Pool } = require('pg');
const pool = new Pool({ connectionString: process.env.DATABASE_URL });

async function migrateV23() {
  console.log('🚀 DALEBA V23 — Migration SaaS Multi-Tenant...\n');

  // 1. Ajouter business_id sur daleba_loyalty
  await pool.query(`
    ALTER TABLE daleba_loyalty ADD COLUMN IF NOT EXISTS business_id INTEGER REFERENCES businesses(id);
    UPDATE daleba_loyalty SET business_id = 1 WHERE business_id IS NULL;
    CREATE INDEX IF NOT EXISTS idx_loyalty_business ON daleba_loyalty(business_id);
  `);
  console.log('✅ daleba_loyalty.business_id ajouté');

  // 2. Ajouter business_id sur daleba_content_queue
  await pool.query(`
    ALTER TABLE daleba_content_queue ADD COLUMN IF NOT EXISTS business_id INTEGER REFERENCES businesses(id);
    UPDATE daleba_content_queue SET business_id = 1 WHERE business_id IS NULL;
    CREATE INDEX IF NOT EXISTS idx_content_business ON daleba_content_queue(business_id);
  `);
  console.log('✅ daleba_content_queue.business_id ajouté');

  // 3. Ajouter business_id sur daleba_chat_sessions
  await pool.query(`
    ALTER TABLE daleba_chat_sessions ADD COLUMN IF NOT EXISTS business_id INTEGER REFERENCES businesses(id);
    UPDATE daleba_chat_sessions SET business_id = 1 WHERE business_id IS NULL;
    CREATE INDEX IF NOT EXISTS idx_chat_sessions_business ON daleba_chat_sessions(business_id);
  `);
  console.log('✅ daleba_chat_sessions.business_id ajouté');

  // 4. Table tenant_integrations (tokens OAuth dynamiques)
  await pool.query(`
    CREATE TABLE IF NOT EXISTS tenant_integrations (
      id              SERIAL PRIMARY KEY,
      business_id     INTEGER NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
      provider        TEXT NOT NULL,
      -- providers: 'square' | 'meta' | 'twilio' | 'stripe' | 'google'
      access_token    TEXT,
      refresh_token   TEXT,
      token_expires   TIMESTAMPTZ,
      scope           TEXT,
      extra           JSONB DEFAULT '{}',
      -- extra: { location_id, page_id, phone_number_id, etc. }
      is_active       BOOLEAN DEFAULT true,
      connected_at    TIMESTAMPTZ DEFAULT NOW(),
      updated_at      TIMESTAMPTZ DEFAULT NOW(),
      UNIQUE(business_id, provider)
    );
    CREATE INDEX IF NOT EXISTS idx_integrations_business ON tenant_integrations(business_id);
    CREATE INDEX IF NOT EXISTS idx_integrations_provider ON tenant_integrations(provider);
  `);
  console.log('✅ Table: tenant_integrations');

  // 5. Table tenant_twilio (sous-comptes Twilio par tenant)
  await pool.query(`
    CREATE TABLE IF NOT EXISTS tenant_twilio (
      id                  SERIAL PRIMARY KEY,
      business_id         INTEGER NOT NULL REFERENCES businesses(id) ON DELETE CASCADE UNIQUE,
      twilio_account_sid  TEXT,
      twilio_auth_token   TEXT,
      phone_number        TEXT,
      phone_sid           TEXT,
      subaccount_sid      TEXT,
      -- NULL = utilise le master account, NOT NULL = sous-compte dédié
      status              TEXT DEFAULT 'active',
      provisioned_at      TIMESTAMPTZ DEFAULT NOW(),
      updated_at          TIMESTAMPTZ DEFAULT NOW()
    );
    CREATE INDEX IF NOT EXISTS idx_tenant_twilio_business ON tenant_twilio(business_id);
  `);
  console.log('✅ Table: tenant_twilio');

  // 6. Table subscription_plans (plans SaaS)
  await pool.query(`
    CREATE TABLE IF NOT EXISTS subscription_plans (
      id              SERIAL PRIMARY KEY,
      name            TEXT NOT NULL,
      -- 'starter' | 'pro' | 'enterprise'
      price_monthly   DECIMAL(10,2) NOT NULL,
      price_yearly    DECIMAL(10,2),
      features        JSONB DEFAULT '[]',
      limits          JSONB DEFAULT '{}',
      -- limits: { sms_per_month, staff_max, locations_max }
      stripe_price_id TEXT,
      is_active       BOOLEAN DEFAULT true,
      created_at      TIMESTAMPTZ DEFAULT NOW()
    );

    INSERT INTO subscription_plans (name, price_monthly, price_yearly, features, limits)
    VALUES
      ('Starter', 49.00, 490.00, '["RDV en ligne","SMS rappels (500/mois)","1 employé","Tableau de bord"]', '{"sms_per_month":500,"staff_max":1,"locations_max":1}'),
      ('Pro', 99.00, 990.00, '["Tout Starter","SMS illimités","5 employés","Fidélité","Social media"]', '{"sms_per_month":2000,"staff_max":5,"locations_max":2}'),
      ('Enterprise', 249.00, 2490.00, '["Tout Pro","Employés illimités","Agent vocal IA","Intégration Meta","Support prioritaire"]', '{"sms_per_month":10000,"staff_max":999,"locations_max":10}')
    ON CONFLICT DO NOTHING;
  `);
  console.log('✅ Table: subscription_plans + 3 plans seedés');

  // 7. Table business_subscriptions
  await pool.query(`
    CREATE TABLE IF NOT EXISTS business_subscriptions (
      id                  SERIAL PRIMARY KEY,
      business_id         INTEGER NOT NULL REFERENCES businesses(id) ON DELETE CASCADE UNIQUE,
      plan_id             INTEGER REFERENCES subscription_plans(id),
      stripe_customer_id  TEXT,
      stripe_sub_id       TEXT,
      status              TEXT DEFAULT 'active',
      -- active | trial | past_due | cancelled
      trial_ends_at       TIMESTAMPTZ,
      current_period_end  TIMESTAMPTZ,
      created_at          TIMESTAMPTZ DEFAULT NOW(),
      updated_at          TIMESTAMPTZ DEFAULT NOW()
    );
    CREATE INDEX IF NOT EXISTS idx_subscriptions_business ON business_subscriptions(business_id);
    CREATE INDEX IF NOT EXISTS idx_subscriptions_status ON business_subscriptions(status);
  `);
  console.log('✅ Table: business_subscriptions');

  // 8. Seed: Kadio Coiffure intégrations (Client Zéro)
  // Variables d'env requises: SQUARE_ACCESS_TOKEN, SQUARE_LOCATION_ID
  // TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, TWILIO_PHONE_NUMBER
  const squareToken = process.env.SQUARE_ACCESS_TOKEN || '';
  const squareLocationId = process.env.SQUARE_LOCATION_ID || '';
  const twilioSid = process.env.TWILIO_ACCOUNT_SID || '';
  const twilioAuth = process.env.TWILIO_AUTH_TOKEN || '';
  const twilioPhone = process.env.TWILIO_PHONE_NUMBER || '';

  if (!squareToken) console.warn('⚠️  SQUARE_ACCESS_TOKEN non défini — seed Square ignoré');
  if (!twilioSid)   console.warn('⚠️  TWILIO_ACCOUNT_SID non défini — seed Twilio ignoré');

  if (squareToken) {
    await pool.query(`
      INSERT INTO tenant_integrations (business_id, provider, access_token, extra, is_active)
      VALUES (1, 'square', $1, $2, true)
      ON CONFLICT (business_id, provider) DO UPDATE
        SET access_token = EXCLUDED.access_token,
            extra = EXCLUDED.extra,
            updated_at = NOW()
    `, [squareToken, JSON.stringify({ location_id: squareLocationId, env: 'production' })]);
    console.log('✅ Seed: Square → Kadio Coiffure (business #1)');
  }

  if (twilioSid) {
    await pool.query(`
      INSERT INTO tenant_twilio (business_id, twilio_account_sid, twilio_auth_token, phone_number, status)
      VALUES (1, $1, $2, $3, 'active')
      ON CONFLICT (business_id) DO UPDATE
        SET twilio_account_sid = EXCLUDED.twilio_account_sid,
            twilio_auth_token = EXCLUDED.twilio_auth_token,
            phone_number = EXCLUDED.phone_number,
            updated_at = NOW()
    `, [twilioSid, twilioAuth, twilioPhone]);
    console.log('✅ Seed: Twilio → Kadio Coiffure (business #1)');
  }

  // 9. Seed: Kadio Coiffure en plan Enterprise (trial 30 jours)
  await pool.query(`
    INSERT INTO business_subscriptions (business_id, plan_id, status, trial_ends_at)
    VALUES (1, 3, 'trial', NOW() + INTERVAL '30 days')
    ON CONFLICT (business_id) DO NOTHING;
  `);
  console.log('✅ Seed: Kadio Coiffure → Plan Enterprise (trial 30j)');

  console.log('\n╔══════════════════════════════════════════════════╗');
  console.log('║  DALEBA V23 — SaaS Multi-Tenant opérationnel ✅  ║');
  console.log('║  Client Zéro: Kadio Coiffure (business #1)       ║');
  console.log('╚══════════════════════════════════════════════════╝\n');
  
  await pool.end();
}

migrateV23().catch(err => {
  console.error('❌ Erreur migration V23:', err);
  process.exit(1);
});
