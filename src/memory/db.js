const { Pool } = require('pg');

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

/**
 * Sauvegarde un échange dans la mémoire DALEBA
 */
async function saveExchange(sessionId, userMessage, aiResponse, model, routingReason) {
  const query = `
    INSERT INTO daleba_memory (session_id, user_message, ai_response, model_used, routing_reason, created_at)
    VALUES ($1, $2, $3, $4, $5, NOW())
    RETURNING id
  `;
  const result = await pool.query(query, [sessionId, userMessage, aiResponse, model, routingReason]);
  return result.rows[0].id;
}

/**
 * Récupère l'historique d'une session
 */
async function getHistory(sessionId, limit = 10) {
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

/**
 * Sauvegarde une note dans les Annales DALEBA (point 17)
 */
async function saveAnnale(type, content, metadata = {}) {
  const query = `
    INSERT INTO daleba_annales (type, content, metadata, created_at)
    VALUES ($1, $2, $3, NOW())
  `;
  await pool.query(query, [type, content, JSON.stringify(metadata)]);
}

module.exports = { pool, saveExchange, getHistory, saveAnnale };
