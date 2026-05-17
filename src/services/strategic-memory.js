/**
 * DALEBA — Mémoire Stratégique d'Ulrich
 * Stocke visions, notes, objectifs, fichiers sans perte
 * Catégories: vision | finance | salon | expansion | tech | personal
 */

const { pool, DEMO_MODE } = require('../memory/db');
const bus = require('./event-bus');

// In-memory store (demo + cache)
const memStore = [];
let memSeq = 0;

const CATEGORIES = ['vision', 'finance', 'salon', 'expansion', 'tech', 'personal', 'note'];

/**
 * Sauvegarde une note stratégique
 */
async function saveNote({ title, content, category = 'note', tags = [], priority = 'normal', authorId = 'ulrich' }) {
  if (!title || !content) throw new Error('title et content requis');
  if (!CATEGORIES.includes(category)) throw new Error(`Catégorie invalide. Options: ${CATEGORIES.join(', ')}`);

  const entry = {
    id: ++memSeq,
    title: title.trim(),
    content: content.trim(),
    category,
    tags: Array.isArray(tags) ? tags : tags.split(',').map(t => t.trim()),
    priority,
    authorId,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };

  if (DEMO_MODE) {
    memStore.push(entry);
    bus.system(`Note sauvegardée: [${category}] ${title.slice(0, 40)}`);
    return entry;
  }

  try {
    const res = await pool.query(`
      INSERT INTO daleba_notes (title, content, category, tags, priority, author_id, created_at, updated_at)
      VALUES ($1, $2, $3, $4, $5, $6, NOW(), NOW())
      RETURNING *
    `, [entry.title, entry.content, entry.category, JSON.stringify(entry.tags), entry.priority, entry.authorId]);
    const saved = res.rows[0];
    bus.system(`Note sauvegardée: [${category}] ${title.slice(0, 40)}`);
    return saved;
  } catch (err) {
    // Fallback mémoire si table inexistante
    memStore.push(entry);
    bus.system(`Note sauvegardée (mem): [${category}] ${title.slice(0, 40)}`);
    return entry;
  }
}

/**
 * Récupère les notes (avec filtres)
 */
async function getNotes({ category, search, limit = 20, priority } = {}) {
  if (DEMO_MODE || memStore.length > 0) {
    let results = [...memStore];
    if (category) results = results.filter(n => n.category === category);
    if (priority) results = results.filter(n => n.priority === priority);
    if (search) {
      const s = search.toLowerCase();
      results = results.filter(n =>
        n.title.toLowerCase().includes(s) ||
        n.content.toLowerCase().includes(s) ||
        n.tags.some(t => t.toLowerCase().includes(s))
      );
    }
    return results.slice(-limit).reverse();
  }

  try {
    let query = 'SELECT * FROM daleba_notes WHERE 1=1';
    const params = [];
    if (category) { params.push(category); query += ` AND category = $${params.length}`; }
    if (priority) { params.push(priority); query += ` AND priority = $${params.length}`; }
    if (search) {
      params.push(`%${search}%`);
      query += ` AND (title ILIKE $${params.length} OR content ILIKE $${params.length})`;
    }
    query += ` ORDER BY created_at DESC LIMIT $${params.length + 1}`;
    params.push(limit);
    const res = await pool.query(query, params);
    return res.rows;
  } catch (_) {
    return memStore.slice(-limit).reverse();
  }
}

/**
 * Met à jour une note
 */
async function updateNote(id, updates) {
  const idx = memStore.findIndex(n => n.id === parseInt(id));
  if (idx >= 0) {
    memStore[idx] = { ...memStore[idx], ...updates, updatedAt: new Date().toISOString() };
    return memStore[idx];
  }
  if (!DEMO_MODE) {
    try {
      const { title, content, category, tags, priority } = updates;
      const res = await pool.query(`
        UPDATE daleba_notes SET
          title = COALESCE($1, title),
          content = COALESCE($2, content),
          category = COALESCE($3, category),
          tags = COALESCE($4::jsonb, tags),
          priority = COALESCE($5, priority),
          updated_at = NOW()
        WHERE id = $6
        RETURNING *
      `, [title, content, category, tags ? JSON.stringify(tags) : null, priority, id]);
      return res.rows[0];
    } catch (_) {}
  }
  throw new Error(`Note ${id} introuvable`);
}

/**
 * Supprime une note
 */
async function deleteNote(id) {
  const idx = memStore.findIndex(n => n.id === parseInt(id));
  if (idx >= 0) { memStore.splice(idx, 1); return true; }
  if (!DEMO_MODE) {
    try { await pool.query('DELETE FROM daleba_notes WHERE id = $1', [id]); return true; }
    catch (_) {}
  }
  return false;
}

/**
 * Résumé de la mémoire stratégique (pour le HUD)
 */
async function getStrategicSummary() {
  const notes = await getNotes({ limit: 100 });
  const byCat = {};
  CATEGORIES.forEach(c => { byCat[c] = 0; });
  notes.forEach(n => { byCat[n.category] = (byCat[n.category] || 0) + 1; });

  return {
    totalNotes: notes.length,
    byCategory: byCat,
    recentTitles: notes.slice(0, 5).map(n => ({ id: n.id, title: n.title, category: n.category, ts: n.createdAt || n.created_at })),
  };
}

module.exports = { saveNote, getNotes, updateNote, deleteNote, getStrategicSummary, CATEGORIES };
