/**
 * Migration — Radar Planétaire : Table daleba_opportunities
 * Usage : node src/scripts/migrate-opportunities.js
 */
require('dotenv').config();
const { pool } = require('../memory/db');

const SQL = `
CREATE TABLE IF NOT EXISTS daleba_opportunities (
  id                 SERIAL PRIMARY KEY,
  source_platform    VARCHAR(100) NOT NULL,
  source_url         TEXT,
  country            VARCHAR(100),
  language_original  VARCHAR(10)  DEFAULT 'en',
  title              VARCHAR(600),
  description_orig   TEXT,
  description_fr     TEXT,
  budget_raw         VARCHAR(300),
  budget_estimated   DECIMAL(12,2),
  budget_currency    VARCHAR(10)  DEFAULT 'USD',
  category           VARCHAR(100),
  score              INTEGER      DEFAULT 0,
  keywords_matched   TEXT,
  status             VARCHAR(20)  DEFAULT 'pending',
  detected_at        TIMESTAMPTZ  DEFAULT NOW(),
  approved_at        TIMESTAMPTZ,
  rejected_at        TIMESTAMPTZ,
  notes              TEXT
);
CREATE INDEX IF NOT EXISTS idx_opp_status   ON daleba_opportunities(status);
CREATE INDEX IF NOT EXISTS idx_opp_score    ON daleba_opportunities(score DESC);
CREATE INDEX IF NOT EXISTS idx_opp_detected ON daleba_opportunities(detected_at DESC);
`;

async function migrate() {
  const client = await pool.connect();
  try {
    console.log('[migrate-opportunities] Démarrage migration...');
    await client.query(SQL);
    console.log('[migrate-opportunities] ✅ Table daleba_opportunities OK.');
    console.log('[migrate-opportunities] ✅ Index idx_opp_status, idx_opp_score, idx_opp_detected OK.');
  } catch (err) {
    console.error('[migrate-opportunities] ❌ Erreur :', err.message);
    process.exit(1);
  } finally {
    client.release();
    await pool.end();
  }
}

migrate();
