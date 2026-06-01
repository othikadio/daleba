'use strict';
/**
 * DALEBA WhatsApp Salon — Session Store
 * Persistance PostgreSQL des conversations clients
 */
const { pool } = require('../../memory/db');

const INIT_SQL = `
  CREATE TABLE IF NOT EXISTS daleba_wa_sessions (
    phone        TEXT PRIMARY KEY,
    display_name TEXT,
    state        TEXT NOT NULL DEFAULT 'idle',
    context      JSONB NOT NULL DEFAULT '{}',
    history      JSONB NOT NULL DEFAULT '[]',
    created_at   TIMESTAMPTZ DEFAULT NOW(),
    updated_at   TIMESTAMPTZ DEFAULT NOW()
  );
  CREATE INDEX IF NOT EXISTS idx_wa_sessions_updated ON daleba_wa_sessions(updated_at DESC);
`;

async function init() {
  try { await pool.query(INIT_SQL); } catch(e) { console.error('[WA-Session] init:', e.message); }
}
init();

// Récupère ou crée une session
async function get(phone) {
  try {
    const r = await pool.query('SELECT * FROM daleba_wa_sessions WHERE phone=$1', [phone]);
    if (r.rows.length) return r.rows[0];
    await pool.query(
      `INSERT INTO daleba_wa_sessions (phone, state, context, history)
       VALUES ($1, 'idle', '{}', '[]') ON CONFLICT (phone) DO NOTHING`,
      [phone]
    );
    return { phone, state: 'idle', context: {}, history: [] };
  } catch(e) { return { phone, state: 'idle', context: {}, history: [] }; }
}

// Met à jour l'état + contexte
async function set(phone, state, context = {}, displayName = null) {
  try {
    await pool.query(
      `INSERT INTO daleba_wa_sessions (phone, display_name, state, context, updated_at)
       VALUES ($1, $2, $3, $4, NOW())
       ON CONFLICT (phone) DO UPDATE
       SET state=$3, context=$4, display_name=COALESCE($2, daleba_wa_sessions.display_name), updated_at=NOW()`,
      [phone, displayName, state, JSON.stringify(context)]
    );
  } catch(e) { console.error('[WA-Session] set:', e.message); }
}

// Ajoute un message à l'historique (max 40)
async function appendHistory(phone, role, text) {
  try {
    await pool.query(
      `UPDATE daleba_wa_sessions
       SET history = (
         SELECT jsonb_agg(m) FROM (
           SELECT m FROM jsonb_array_elements(history || $2::jsonb) AS m
           ORDER BY (m->>'ts')::bigint DESC LIMIT 40
         ) sub
       ),
       updated_at = NOW()
       WHERE phone = $1`,
      [phone, JSON.stringify([{ role, text, ts: Date.now() }])]
    );
  } catch(e) { /* non-bloquant */ }
}

// Récupère les N derniers messages
async function getHistory(phone, limit = 20) {
  try {
    const r = await pool.query(
      `SELECT jsonb_path_query_array(history, '$[0 to $lim]', '{"lim": ${limit-1}}') as msgs
       FROM daleba_wa_sessions WHERE phone=$1`,
      [phone]
    );
    const msgs = r.rows[0]?.msgs || [];
    return [...msgs].sort((a, b) => a.ts - b.ts);
  } catch(e) { return []; }
}

// Réinitialise la session
async function reset(phone) {
  await pool.query(
    `UPDATE daleba_wa_sessions SET state='idle', context='{}', updated_at=NOW() WHERE phone=$1`,
    [phone]
  );
}

module.exports = { get, set, appendHistory, getHistory, reset };
