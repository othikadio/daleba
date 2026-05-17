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

module.exports = { pool, saveExchange, getHistory, saveAnnale, DEMO_MODE };
