/**
 * DALEBA — Meta History Puller (Chantier 1)
 * Pull les conversations Messenger depuis Meta Graph API
 * Pagine jusqu'à épuisement, forme des paires Input/Output, injecte en DB
 *
 * Table daleba_sync_state :
 *   key VARCHAR(100) PRIMARY KEY, value TEXT, updated_at TIMESTAMPTZ
 */

const { Pool } = require('pg');
const ingester = require('./conversation-ingester');

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

const META_TOKEN   = process.env.META_ACCESS_TOKEN;
const META_PAGE_ID = process.env.META_PAGE_ID || '255568957645612';
const GRAPH_BASE   = 'https://graph.facebook.com/v19.0';
const PAGE_NAMES   = ['Kadio Coiffure', 'Kadio', 'Page', '255568957645612'];

// ─── SETUP TABLES ─────────────────────────────────────────────────────────────
const SYNC_STATE_SQL = `
CREATE TABLE IF NOT EXISTS daleba_sync_state (
  key         VARCHAR(100) PRIMARY KEY,
  value       TEXT,
  updated_at  TIMESTAMPTZ DEFAULT NOW()
);
`;

async function ensureSyncTable() {
  await pool.query(SYNC_STATE_SQL);
}

async function getSyncState(key) {
  await ensureSyncTable();
  const r = await pool.query('SELECT value FROM daleba_sync_state WHERE key = $1', [key]);
  return r.rows[0]?.value || null;
}

async function setSyncState(key, value) {
  await ensureSyncTable();
  await pool.query(`
    INSERT INTO daleba_sync_state (key, value, updated_at)
    VALUES ($1, $2, NOW())
    ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = NOW()
  `, [key, value]);
}

// ─── GRAPH API HELPERS ────────────────────────────────────────────────────────
function graphHeaders() {
  return {
    'Authorization': `Bearer ${META_TOKEN}`,
    'Content-Type': 'application/json',
  };
}

async function graphGet(url) {
  const res = await fetch(url, { headers: graphHeaders() });
  const body = await res.json();
  if (!res.ok || body.error) {
    const msg = body.error?.message || `HTTP ${res.status}`;
    throw new Error(`[Meta Graph] ${msg}`);
  }
  return body;
}

// ─── PULL LISTE DES CONVERSATIONS ────────────────────────────────────────────
/**
 * Récupère toutes les conversations Messenger de la page
 * en paginant via les curseurs before/after
 */
async function fetchConversations(afterCursor = null) {
  let url = `${GRAPH_BASE}/${META_PAGE_ID}/conversations?platform=messenger&fields=id,participants&limit=25&access_token=${META_TOKEN}`;
  if (afterCursor) url += `&after=${afterCursor}`;
  return graphGet(url);
}

// ─── PULL MESSAGES D'UN THREAD ───────────────────────────────────────────────
/**
 * Récupère les messages d'une conversation
 * fields: message, from, created_time
 */
async function fetchThreadMessages(conversationId, afterCursor = null) {
  let url = `${GRAPH_BASE}/${conversationId}/messages?fields=message,from,created_time&limit=100&access_token=${META_TOKEN}`;
  if (afterCursor) url += `&after=${afterCursor}`;
  return graphGet(url);
}

// ─── FORMER DES PAIRES INPUT/OUTPUT ──────────────────────────────────────────
/**
 * Construit des paires {client_msg, staff_reply, source} depuis les messages d'un thread
 * L'auteur "page" (pageNames) = staff ; les autres = client
 */
function buildPairsFromThread(messages, participants = []) {
  // Identifier l'ID de la page dans les participants
  const pageParticipantIds = participants
    .filter(p => PAGE_NAMES.some(n => (p.name || '').toLowerCase().includes(n.toLowerCase())))
    .map(p => p.id);

  function isPage(msg) {
    // Si from.id est dans la liste des participants page, ou si from.name match
    if (pageParticipantIds.length && msg.from?.id && pageParticipantIds.includes(msg.from.id)) return true;
    if (PAGE_NAMES.some(n => (msg.from?.name || '').toLowerCase().includes(n.toLowerCase()))) return true;
    return false;
  }

  // Messages triés chronologiquement (API retourne du plus récent au plus ancien)
  const sorted = [...messages].reverse();

  const pairs = [];
  let i = 0;
  while (i < sorted.length - 1) {
    const cur = sorted[i];
    const nxt = sorted[i + 1];

    if (!cur.message || !nxt.message) { i++; continue; }

    if (!isPage(cur) && isPage(nxt)) {
      // Consolider messages consécutifs client
      let clientMsg = cur.message.trim();
      let j = i - 1;
      while (j >= 0 && !isPage(sorted[j]) && sorted[j].message && (i - j) <= 3) {
        clientMsg = sorted[j].message.trim() + '\n' + clientMsg;
        j--;
      }

      // Consolider réponses consécutives staff
      let staffReply = nxt.message.trim();
      let k = i + 2;
      while (k < sorted.length && isPage(sorted[k]) && sorted[k].message && (k - i - 1) <= 3) {
        staffReply += '\n' + sorted[k].message.trim();
        k++;
      }

      if (clientMsg.length > 5 && staffReply.length > 5) {
        pairs.push({
          source: 'messenger',
          client_msg: clientMsg,
          staff_reply: staffReply,
        });
      }
      i = k;
    } else {
      i++;
    }
  }
  return pairs;
}

// ─── PULL ALL (MAIN FUNCTION) ─────────────────────────────────────────────────
/**
 * Tire toutes les conversations, pagine, ingère dans la DB
 * Sauvegarde le curseur de la dernière sync
 */
async function pullAll(options = {}) {
  if (!META_TOKEN) {
    console.warn('[META-PULLER] META_ACCESS_TOKEN manquant — pull ignoré');
    return { skipped: true, reason: 'META_ACCESS_TOKEN manquant' };
  }

  await ingester.setupDB();
  await ensureSyncTable();

  console.log(`[META-PULLER] Début pull Messenger — Page ${META_PAGE_ID}`);

  let totalPairs = 0;
  let totalInserted = 0;
  let totalSkipped = 0;
  let conversationsProcessed = 0;
  let afterCursor = null;
  let firstCursor = null;
  let hasMore = true;
  let errors = [];

  while (hasMore) {
    let convData;
    try {
      convData = await fetchConversations(afterCursor);
    } catch (err) {
      console.error('[META-PULLER] Erreur fetch conversations:', err.message);
      errors.push(err.message);
      break;
    }

    const conversations = convData.data || [];
    if (!conversations.length) { hasMore = false; break; }

    // Sauvegarder le premier curseur (before = le plus récent)
    if (!firstCursor && convData.paging?.cursors?.before) {
      firstCursor = convData.paging.cursors.before;
    }

    for (const conv of conversations) {
      try {
        // Récupérer les participants pour identifier la page
        let participants = conv.participants?.data || [];

        // Récupérer tous les messages du thread
        let allMessages = [];
        let msgAfter = null;
        let msgHasMore = true;

        while (msgHasMore) {
          let msgData;
          try {
            msgData = await fetchThreadMessages(conv.id, msgAfter);
          } catch (err) {
            console.warn(`[META-PULLER] Thread ${conv.id} erreur:`, err.message);
            errors.push(`Thread ${conv.id}: ${err.message}`);
            break;
          }
          const msgs = msgData.data || [];
          allMessages = allMessages.concat(msgs);
          msgAfter = msgData.paging?.cursors?.after;
          msgHasMore = !!msgData.paging?.next && !!msgAfter && msgs.length > 0;

          // Limite de sécurité
          if (allMessages.length >= 500) break;
        }

        if (allMessages.length === 0) continue;

        const pairs = buildPairsFromThread(allMessages, participants);
        if (pairs.length > 0) {
          const result = await ingester.ingestRaw(pairs);
          totalInserted += result.inserted;
          totalSkipped += result.skipped;
          totalPairs += pairs.length;
        }
        conversationsProcessed++;
      } catch (err) {
        console.warn(`[META-PULLER] Conversation ${conv.id}:`, err.message);
        errors.push(`Conv ${conv.id}: ${err.message}`);
      }
    }

    // Pagination conversations
    afterCursor = convData.paging?.cursors?.after;
    hasMore = !!convData.paging?.next && !!afterCursor;

    // Limite de sécurité — max 200 conversations par run
    if (conversationsProcessed >= 200) { hasMore = false; }
  }

  // Sauvegarder le curseur + stats
  const syncData = {
    lastPullAt: new Date().toISOString(),
    lastCursor: firstCursor || afterCursor || null,
    conversationsProcessed,
    totalPairs,
    totalInserted,
    totalSkipped,
    errors: errors.slice(0, 5),
  };
  await setSyncState('messenger_last_sync', JSON.stringify(syncData));

  console.log(`[META-PULLER] ✅ Terminé — ${conversationsProcessed} conversations, ${totalInserted} paires insérées, ${totalSkipped} doublons`);
  return syncData;
}

// ─── SYNC STATUS ──────────────────────────────────────────────────────────────
async function getSyncStatus() {
  await ensureSyncTable();
  const raw = await getSyncState('messenger_last_sync');
  const dbStats = await ingester.getStats().catch(() => null);
  return {
    lastSync: raw ? JSON.parse(raw) : null,
    dbStats,
    tokenConfigured: !!META_TOKEN,
    pageId: META_PAGE_ID,
  };
}

// ─── CHECK TABLE EMPTY ────────────────────────────────────────────────────────
async function isTrainingTableEmpty() {
  try {
    const r = await pool.query("SELECT COUNT(*) FROM daleba_training_data WHERE source = 'messenger'");
    return parseInt(r.rows[0].count, 10) === 0;
  } catch {
    return true; // Si la table n'existe pas encore, on considère vide
  }
}

module.exports = {
  pullAll,
  getSyncStatus,
  isTrainingTableEmpty,
  ensureSyncTable,
};
