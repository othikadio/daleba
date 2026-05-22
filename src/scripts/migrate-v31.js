'use strict';
/**
 * DALEBA — Migration V31-AUTH
 * Tables: appointment_ratings, otp_sessions
 */

require('dotenv').config();
const { Pool } = require('pg');

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

async function migrate() {
  console.log('[MIGRATE-V31] Démarrage migration...');

  // Table appointment_ratings
  await pool.query(`
    CREATE TABLE IF NOT EXISTS appointment_ratings (
      id              SERIAL PRIMARY KEY,
      appointment_id  INT NOT NULL,
      client_rating   INT CHECK (client_rating BETWEEN 1 AND 5),
      staff_rating    INT CHECK (staff_rating BETWEEN 1 AND 5),
      comment         TEXT,
      created_at      TIMESTAMP DEFAULT NOW(),
      UNIQUE (appointment_id)
    );
  `);
  console.log('[MIGRATE-V31] appointment_ratings OK');

  // Table otp_sessions (backup persistant)
  await pool.query(`
    CREATE TABLE IF NOT EXISTS otp_sessions (
      id          SERIAL PRIMARY KEY,
      phone       VARCHAR(20) NOT NULL UNIQUE,
      code_hash   VARCHAR(64) NOT NULL,
      expires_at  TIMESTAMP NOT NULL,
      attempts    INT DEFAULT 0,
      created_at  TIMESTAMP DEFAULT NOW()
    );
  `);
  console.log('[MIGRATE-V31] otp_sessions OK');

  await pool.end();
  console.log('[MIGRATE-V31] Migration terminée.');
}

migrate().catch(err => {
  console.error('[MIGRATE-V31] Erreur:', err.message);
  process.exit(1);
});
