/**
 * DALEBA — Migration Base de Données Multi-Tenant
 * Architecture : 1 serveur, N entreprises, isolation totale par business_id
 */

require('dotenv').config();
const { Pool } = require('pg');

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

async function migrate() {
  console.log('🔧 DALEBA — Migration multi-tenant...\n');

  // ─── PILIER 1 : ENTREPRISES (TENANTS) ────────────────────────────
  await pool.query(`
    CREATE TABLE IF NOT EXISTS businesses (
      id           SERIAL PRIMARY KEY,
      name         TEXT NOT NULL,
      slug         TEXT NOT NULL UNIQUE,
      type         TEXT NOT NULL, -- 'salon', 'restaurant', 'clinic', 'retail', etc.
      address      TEXT,
      phone        TEXT,
      email        TEXT,
      website      TEXT,
      logo_url     TEXT,
      timezone     TEXT DEFAULT 'America/Toronto',
      currency     TEXT DEFAULT 'CAD',
      settings     JSONB DEFAULT '{}',
      is_active    BOOLEAN DEFAULT true,
      created_at   TIMESTAMP DEFAULT NOW(),
      updated_at   TIMESTAMP DEFAULT NOW()
    );

    CREATE UNIQUE INDEX IF NOT EXISTS idx_businesses_slug ON businesses(slug);
    CREATE INDEX IF NOT EXISTS idx_businesses_type ON businesses(type);
  `);
  console.log('✅ Table: businesses');

  // ─── PILIER 2 : UTILISATEURS (TOUS RÔLES) ─────────────────────────
  await pool.query(`
    CREATE TABLE IF NOT EXISTS users (
      id            SERIAL PRIMARY KEY,
      business_id   INTEGER REFERENCES businesses(id) ON DELETE CASCADE,
      name          TEXT NOT NULL,
      email         TEXT NOT NULL UNIQUE,
      phone         TEXT,
      password_hash TEXT,
      role          TEXT NOT NULL DEFAULT 'client',
      -- roles: super_admin | business_admin | employee | client
      avatar_url    TEXT,
      is_active     BOOLEAN DEFAULT true,
      last_login    TIMESTAMP,
      settings      JSONB DEFAULT '{}',
      created_at    TIMESTAMP DEFAULT NOW()
    );

    CREATE INDEX IF NOT EXISTS idx_users_business ON users(business_id);
    CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);
    CREATE INDEX IF NOT EXISTS idx_users_role ON users(role);
  `);
  console.log('✅ Table: users');

  // ─── PILIER 3 : SERVICES PAR ENTREPRISE ──────────────────────────
  await pool.query(`
    CREATE TABLE IF NOT EXISTS services (
      id            SERIAL PRIMARY KEY,
      business_id   INTEGER NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
      name          TEXT NOT NULL,
      description   TEXT,
      duration_min  INTEGER NOT NULL DEFAULT 30, -- durée en minutes
      price         DECIMAL(10,2) NOT NULL DEFAULT 0,
      category      TEXT,
      is_active     BOOLEAN DEFAULT true,
      created_at    TIMESTAMP DEFAULT NOW()
    );

    CREATE INDEX IF NOT EXISTS idx_services_business ON services(business_id);
  `);
  console.log('✅ Table: services');

  // ─── PILIER 4 : STAFF / EMPLOYÉS PAR ENTREPRISE ──────────────────
  await pool.query(`
    CREATE TABLE IF NOT EXISTS staff (
      id            SERIAL PRIMARY KEY,
      business_id   INTEGER NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
      user_id       INTEGER REFERENCES users(id),
      name          TEXT NOT NULL,
      role_title    TEXT DEFAULT 'Employé',
      services      INTEGER[] DEFAULT '{}', -- service IDs qu'il peut offrir
      schedule      JSONB DEFAULT '{}',     -- horaires par jour de semaine
      color         TEXT DEFAULT '#6366f1', -- couleur dans le calendrier
      is_active     BOOLEAN DEFAULT true,
      created_at    TIMESTAMP DEFAULT NOW()
    );

    CREATE INDEX IF NOT EXISTS idx_staff_business ON staff(business_id);
  `);
  console.log('✅ Table: staff');

  // ─── PILIER 5 : RENDEZ-VOUS ───────────────────────────────────────
  await pool.query(`
    CREATE TABLE IF NOT EXISTS appointments (
      id            SERIAL PRIMARY KEY,
      business_id   INTEGER NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
      client_id     INTEGER REFERENCES users(id),
      staff_id      INTEGER REFERENCES staff(id),
      service_id    INTEGER REFERENCES services(id),
      client_name   TEXT NOT NULL,
      client_phone  TEXT,
      client_email  TEXT,
      service_name  TEXT,
      start_time    TIMESTAMP NOT NULL,
      end_time      TIMESTAMP NOT NULL,
      duration_min  INTEGER,
      price         DECIMAL(10,2),
      status        TEXT DEFAULT 'pending',
      -- status: pending | confirmed | completed | cancelled | no_show
      notes         TEXT,
      sms_sent      BOOLEAN DEFAULT false,
      reminder_sent BOOLEAN DEFAULT false,
      created_at    TIMESTAMP DEFAULT NOW(),
      updated_at    TIMESTAMP DEFAULT NOW()
    );

    CREATE INDEX IF NOT EXISTS idx_appointments_business ON appointments(business_id);
    CREATE INDEX IF NOT EXISTS idx_appointments_staff ON appointments(staff_id);
    CREATE INDEX IF NOT EXISTS idx_appointments_client ON appointments(client_id);
    CREATE INDEX IF NOT EXISTS idx_appointments_start ON appointments(start_time);
    CREATE INDEX IF NOT EXISTS idx_appointments_status ON appointments(status);
  `);
  console.log('✅ Table: appointments');

  // ─── PILIER 6 : PAIEMENTS ─────────────────────────────────────────
  await pool.query(`
    CREATE TABLE IF NOT EXISTS payments (
      id                  SERIAL PRIMARY KEY,
      business_id         INTEGER NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
      appointment_id      INTEGER REFERENCES appointments(id),
      client_id           INTEGER REFERENCES users(id),
      amount              DECIMAL(10,2) NOT NULL,
      currency            TEXT DEFAULT 'CAD',
      status              TEXT DEFAULT 'pending',
      -- status: pending | paid | refunded | failed
      stripe_session_id   TEXT,
      stripe_payment_id   TEXT,
      method              TEXT DEFAULT 'card',
      created_at          TIMESTAMP DEFAULT NOW()
    );

    CREATE INDEX IF NOT EXISTS idx_payments_business ON payments(business_id);
    CREATE INDEX IF NOT EXISTS idx_payments_appointment ON payments(appointment_id);
  `);
  console.log('✅ Table: payments');

  // ─── PILIER 7 : CLIENTS PAR ENTREPRISE ───────────────────────────
  await pool.query(`
    CREATE TABLE IF NOT EXISTS clients (
      id              SERIAL PRIMARY KEY,
      business_id     INTEGER NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
      user_id         INTEGER REFERENCES users(id),
      name            TEXT NOT NULL,
      email           TEXT,
      phone           TEXT,
      notes           TEXT,
      tags            TEXT[] DEFAULT '{}',
      visit_count     INTEGER DEFAULT 0,
      last_visit      TIMESTAMP,
      total_spent     DECIMAL(10,2) DEFAULT 0,
      no_show_count   INTEGER DEFAULT 0,
      created_at      TIMESTAMP DEFAULT NOW()
    );

    CREATE INDEX IF NOT EXISTS idx_clients_business ON clients(business_id);
    CREATE INDEX IF NOT EXISTS idx_clients_phone ON clients(phone);
    CREATE UNIQUE INDEX IF NOT EXISTS idx_clients_biz_email ON clients(business_id, email) WHERE email IS NOT NULL;
  `);
  console.log('✅ Table: clients');

  // ─── PILIER 8 : MÉMOIRE DALEBA (multi-tenant) ────────────────────
  await pool.query(`
    CREATE TABLE IF NOT EXISTS daleba_memory (
      id              SERIAL PRIMARY KEY,
      business_id     INTEGER REFERENCES businesses(id),
      session_id      TEXT NOT NULL,
      user_message    TEXT NOT NULL,
      ai_response     TEXT NOT NULL,
      model_used      TEXT NOT NULL,
      routing_reason  TEXT,
      created_at      TIMESTAMP DEFAULT NOW()
    );

    CREATE INDEX IF NOT EXISTS idx_memory_session ON daleba_memory(session_id);
    CREATE INDEX IF NOT EXISTS idx_memory_business ON daleba_memory(business_id);
    CREATE INDEX IF NOT EXISTS idx_memory_created ON daleba_memory(created_at);
  `);
  console.log('✅ Table: daleba_memory');

  // ─── PILIER 9 : JOURNAL DE BORD ──────────────────────────────────
  await pool.query(`
    CREATE TABLE IF NOT EXISTS daleba_journal (
      id           SERIAL PRIMARY KEY,
      entry_date   DATE NOT NULL,
      entry_type   TEXT NOT NULL,
      summary      TEXT NOT NULL,
      detail       TEXT DEFAULT '',
      metadata     JSONB DEFAULT '{}',
      created_at   TIMESTAMP DEFAULT NOW()
    );

    CREATE INDEX IF NOT EXISTS idx_journal_date ON daleba_journal(entry_date);
    CREATE INDEX IF NOT EXISTS idx_journal_type ON daleba_journal(entry_type);
  `);
  console.log('✅ Table: daleba_journal');

  // ─── PILIER 10 : ANNALES & SESSIONS ──────────────────────────────
  await pool.query(`
    CREATE TABLE IF NOT EXISTS daleba_annales (
      id          SERIAL PRIMARY KEY,
      type        TEXT NOT NULL,
      content     TEXT NOT NULL,
      metadata    JSONB DEFAULT '{}',
      created_at  TIMESTAMP DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS daleba_sessions (
      id          TEXT PRIMARY KEY,
      business_id INTEGER REFERENCES businesses(id),
      created_at  TIMESTAMP DEFAULT NOW(),
      last_active TIMESTAMP DEFAULT NOW(),
      metadata    JSONB DEFAULT '{}'
    );
  `);
  console.log('✅ Tables: daleba_annales, daleba_sessions');

  // ─── SEED : Kadio Coiffure (business #1) ─────────────────────────
  await pool.query(`
    INSERT INTO businesses (name, slug, type, address, phone, timezone, currency)
    VALUES (
      'Kadio Coiffure et Esthétique',
      'kadiocoiffure',
      'salon',
      '615 Antoinette Robidoux, Local 100, Longueuil, QC J4J 2V8',
      '+14501234567',
      'America/Toronto',
      'CAD'
    )
    ON CONFLICT (slug) DO NOTHING;
  `);
  console.log('✅ Seed: Kadio Coiffure (business #1)');

  console.log('\n╔══════════════════════════════════════╗');
  console.log('║  DALEBA DB — Migration complète ✅   ║');
  console.log('║  Architecture multi-tenant active    ║');
  console.log('╚══════════════════════════════════════╝\n');

  await pool.end();
}

migrate().catch(err => {
  console.error('❌ Erreur migration:', err);
  process.exit(1);
});
