require('dotenv').config();
const { Pool } = require('pg');

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

async function migrate() {
  console.log('🔧 DALEBA — Migration de la base de données...');

  await pool.query(`
    CREATE TABLE IF NOT EXISTS daleba_memory (
      id          SERIAL PRIMARY KEY,
      session_id  TEXT NOT NULL,
      user_message TEXT NOT NULL,
      ai_response  TEXT NOT NULL,
      model_used   TEXT NOT NULL,
      routing_reason TEXT,
      created_at  TIMESTAMP DEFAULT NOW()
    );

    CREATE INDEX IF NOT EXISTS idx_memory_session ON daleba_memory(session_id);
    CREATE INDEX IF NOT EXISTS idx_memory_created ON daleba_memory(created_at);
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS daleba_annales (
      id         SERIAL PRIMARY KEY,
      type       TEXT NOT NULL,
      content    TEXT NOT NULL,
      metadata   JSONB DEFAULT '{}',
      created_at TIMESTAMP DEFAULT NOW()
    );
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS daleba_sessions (
      id          TEXT PRIMARY KEY,
      created_at  TIMESTAMP DEFAULT NOW(),
      last_active TIMESTAMP DEFAULT NOW(),
      metadata    JSONB DEFAULT '{}'
    );
  `);

  console.log('✅ Tables créées : daleba_memory, daleba_annales, daleba_sessions');
  await pool.end();
}

migrate().catch(err => {
  console.error('❌ Erreur migration:', err);
  process.exit(1);
});
