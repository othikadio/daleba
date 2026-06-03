const { Pool } = require('pg');

// ── Demo mode ────────────────────────────────────────────────────────────────
const DEMO_MODE = !process.env.DATABASE_URL ||
  process.env.DATABASE_URL.includes('user:password@host') ||
  process.env.MODE === 'demo';

if (DEMO_MODE) {
  console.log('⚡ Mode DÉMO actif — base de données en mémoire');
}

// In-memory stores
const memoryStore = [];
const annalesStore = [];
const chatSessionsStore = new Map(); // V22 — Human-in-the-loop sessions

// Pool PostgreSQL (null en mode démo)
const pool = DEMO_MODE ? null : new Pool({ connectionString: process.env.DATABASE_URL });

async function saveExchange(sessionId, userMessage, aiResponse, model, routingReason) {
  if (DEMO_MODE) {
    const entry = { id: memoryStore.length + 1, session_id: sessionId, user_message: userMessage, ai_response: aiResponse, model_used: model, routing_reason: routingReason, created_at: new Date() };
    memoryStore.push(entry);
    return entry.id;
  }
  const query = `
    INSERT INTO daleba_memory (session_id, user_message, ai_response, model_used, routing_reason, created_at)
    VALUES ($1, $2, $3, $4, $5, NOW())
    RETURNING id
  `;
  const result = await pool.query(query, [sessionId, userMessage, aiResponse, model, routingReason]);
  return result.rows[0].id;
}

async function getHistory(sessionId, limit = 10) {
  if (DEMO_MODE) {
    return memoryStore
      .filter(r => r.session_id === sessionId)
      .slice(-limit)
      .map(r => ({ user_message: r.user_message, ai_response: r.ai_response, model_used: r.model_used, created_at: r.created_at }));
  }
  const query = `
    SELECT user_message, ai_response, model_used, created_at
    FROM daleba_memory
    WHERE session_id = $1
    ORDER BY created_at DESC
    LIMIT $2
  `;
  const result = await pool.query(query, [sessionId, limit]);
  return result.rows.reverse();
}

async function saveAnnale(type, content, metadata = {}) {
  if (DEMO_MODE) {
    annalesStore.push({ type, content, metadata, created_at: new Date() });
    return;
  }
  const query = `
    INSERT INTO daleba_annales (type, content, metadata, created_at)
    VALUES ($1, $2, $3, NOW())
  `;
  await pool.query(query, [type, content, JSON.stringify(metadata)]);
}

// ── V22 — daleba_chat_sessions (Human-in-the-loop) ─────────────────────────

/**
 * Initialise la table daleba_chat_sessions (idempotent)
 * Statuts : 'bot_handling' | 'human_required'
 */
async function initChatSessionsTable() {
  if (DEMO_MODE || !pool) return;
  await pool.query(`
    CREATE TABLE IF NOT EXISTS daleba_chat_sessions (
      id            SERIAL PRIMARY KEY,
      client_id     VARCHAR(64) NOT NULL,
      channel       VARCHAR(32) NOT NULL DEFAULT 'voice',
      status        VARCHAR(32) NOT NULL DEFAULT 'bot_handling',
      call_sid      VARCHAR(64),
      metadata      JSONB DEFAULT '{}',
      created_at    TIMESTAMPTZ DEFAULT NOW(),
      updated_at    TIMESTAMPTZ DEFAULT NOW(),
      UNIQUE(client_id, channel)
    );
    CREATE INDEX IF NOT EXISTS idx_chat_sessions_status ON daleba_chat_sessions(status);
    CREATE INDEX IF NOT EXISTS idx_chat_sessions_client ON daleba_chat_sessions(client_id);
  `);
}

/**
 * Crée ou récupère une session chat pour un client/canal
 */
async function getOrCreateChatSession({ clientId, channel = 'voice', callSid = null }) {
  if (DEMO_MODE || !pool) {
    const key = `${clientId}:${channel}`;
    if (!chatSessionsStore.has(key)) {
      chatSessionsStore.set(key, {
        id: chatSessionsStore.size + 1, client_id: clientId, channel,
        status: 'bot_handling', call_sid: callSid, metadata: {}, created_at: new Date(), updated_at: new Date(),
      });
    }
    const s = chatSessionsStore.get(key);
    if (callSid) { s.call_sid = callSid; s.updated_at = new Date(); }
    return s;
  }
  const result = await pool.query(`
    INSERT INTO daleba_chat_sessions (client_id, channel, call_sid, updated_at)
    VALUES ($1, $2, $3, NOW())
    ON CONFLICT (client_id, channel) DO UPDATE
      SET call_sid = EXCLUDED.call_sid, updated_at = NOW()
    RETURNING *
  `, [clientId, channel, callSid]);
  return result.rows[0];
}

/**
 * Met à jour le statut d'une session
 * @param {number|string} sessionId
 * @param {'bot_handling'|'human_required'} status
 * @param {Object} metadata  — données contextuelles (raison, timestamp…)
 */
async function updateSessionStatus(sessionId, status, metadata = {}) {
  if (DEMO_MODE || !pool) {
    for (const [key, s] of chatSessionsStore.entries()) {
      if (s.id === sessionId || s.id === Number(sessionId)) {
        s.status = status;
        s.metadata = { ...s.metadata, ...metadata };
        s.updated_at = new Date();
        return s;
      }
    }
    return null;
  }
  const result = await pool.query(`
    UPDATE daleba_chat_sessions
    SET status = $2, metadata = metadata || $3::jsonb, updated_at = NOW()
    WHERE id = $1
    RETURNING *
  `, [sessionId, status, JSON.stringify(metadata)]);
  return result.rows[0] || null;
}

/**
 * Vérifie si un client/canal est en mode human_required
 */
async function isHumanRequired(clientId, channel = 'text') {
  if (DEMO_MODE || !pool) {
    const key = `${clientId}:${channel}`;
    const s = chatSessionsStore.get(key);
    return s ? s.status === 'human_required' : false;
  }
  const result = await pool.query(
    `SELECT status FROM daleba_chat_sessions WHERE client_id = $1 AND channel = $2`,
    [clientId, channel]
  );
  return result.rows[0]?.status === 'human_required';
}

/**
 * Récupère toutes les sessions actives (pour le dashboard Ulrich)
 */
async function getAllChatSessions() {
  if (DEMO_MODE || !pool) {
    return Array.from(chatSessionsStore.values())
      .sort((a, b) => new Date(b.updated_at) - new Date(a.updated_at));
  }
  const result = await pool.query(`
    SELECT * FROM daleba_chat_sessions
    ORDER BY updated_at DESC
    LIMIT 100
  `);
  return result.rows;
}

/**
 * Alias pour créer une session explicitement (voix ou texte)
 */
async function createChatSession({ clientId, channel, callSid, status = 'bot_handling' }) {
  return getOrCreateChatSession({ clientId, channel, callSid });
}

// Init table daleba_memory (chat history) — création automatique si absente
async function initMemoryTable() {
  if (DEMO_MODE || !pool) return;
  await pool.query(`
    CREATE TABLE IF NOT EXISTS daleba_memory (
      id              SERIAL PRIMARY KEY,
      session_id      VARCHAR(128) NOT NULL,
      user_message    TEXT,
      ai_response     TEXT,
      model_used      VARCHAR(64),
      routing_reason  VARCHAR(128),
      created_at      TIMESTAMPTZ DEFAULT NOW()
    );
    CREATE INDEX IF NOT EXISTS idx_memory_session ON daleba_memory(session_id);
  `);
}

// Init tables au démarrage (non-bloquant)
initChatSessionsTable().catch(err => console.warn('[DB] daleba_chat_sessions init skipped:', err.message));
initMemoryTable().catch(err => console.warn('[DB] daleba_memory init skipped:', err.message));

module.exports = {
  pool, saveExchange, getHistory, saveAnnale, DEMO_MODE,
  // V22 — Human-in-the-loop
  getOrCreateChatSession,
  createChatSession,
  updateSessionStatus,
  isHumanRequired,
  getAllChatSessions,
};
