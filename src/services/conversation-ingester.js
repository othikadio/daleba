/**
 * DALEBA — Conversation Ingester
 * Ingestion multi-format de conversations historiques (WhatsApp, Messenger, Instagram)
 * Structurées en paires Input/Output pour injection dans le prompt Claude
 *
 * Formats supportés :
 *   - WhatsApp export .txt  (_chat.txt ou export.txt)
 *   - Messenger JSON (inbox/messages_1.json)
 *   - Instagram JSON (direct/inbox/messages_1.json)
 *   - Tableau brut JS/JSON custom
 */

const fs    = require('fs');
const path  = require('path');
const { Pool } = require('pg');

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

// ─── SCHÉMA DB ────────────────────────────────────────────────────────────────
const SETUP_SQL = `
CREATE TABLE IF NOT EXISTS daleba_training_data (
  id            SERIAL PRIMARY KEY,
  source        VARCHAR(20)  NOT NULL,          -- 'whatsapp' | 'messenger' | 'instagram'
  client_msg    TEXT         NOT NULL,           -- message entrant (input)
  staff_reply   TEXT         NOT NULL,           -- réponse équipe (output)
  intent        VARCHAR(50),                     -- booking | tarifs | horaires | general ...
  quality_score FLOAT        DEFAULT 0,          -- score qualité 0-1 (calculé auto)
  used_in_prompt BOOLEAN     DEFAULT false,      -- injecté dans le prompt actif ?
  created_at    TIMESTAMPTZ  DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_training_intent    ON daleba_training_data(intent);
CREATE INDEX IF NOT EXISTS idx_training_quality   ON daleba_training_data(quality_score DESC);
CREATE INDEX IF NOT EXISTS idx_training_prompt    ON daleba_training_data(used_in_prompt);
`;

async function setupDB() {
  await pool.query(SETUP_SQL);
  console.log('✅ [INGESTER] Table daleba_training_data prête');
}

// ─── PARSER WHATSAPP ──────────────────────────────────────────────────────────
/**
 * Parse un export WhatsApp .txt
 * Format : [DD/MM/YYYY, HH:mm:ss] Nom: message
 * Retourne un tableau [{sender, text, ts}]
 */
function parseWhatsApp(filePath, salonNames = ['Kadio Coiffure', 'Ulrich', 'Salon']) {
  const raw = fs.readFileSync(filePath, 'utf8');
  const lines = raw.split('\n');
  const messages = [];
  const regex = /^\[(\d{1,2}\/\d{1,2}\/\d{2,4}),\s*(\d{1,2}:\d{2}(?::\d{2})?)\]\s*([^:]+):\s*(.+)$/;

  for (const line of lines) {
    const m = line.match(regex);
    if (!m) continue;
    const [, date, time, sender, text] = m;
    const isSalon = salonNames.some(n => sender.toLowerCase().includes(n.toLowerCase()));
    messages.push({ sender: sender.trim(), text: text.trim(), isSalon, raw: line });
  }
  return pairMessages(messages, 'whatsapp');
}

// ─── PARSER MESSENGER / INSTAGRAM ────────────────────────────────────────────
/**
 * Parse un export JSON Meta (Messenger ou Instagram)
 * Structure attendue : { messages: [{sender_name, content, timestamp_ms}] }
 * pageNames : noms de la page / compte salon pour identifier les réponses staff
 */
function parseMetaJSON(filePath, pageNames = ['Kadio Coiffure'], source = 'messenger') {
  const raw = JSON.parse(fs.readFileSync(filePath, 'utf8'));
  const msgs = (raw.messages || []).reverse(); // Meta exporte en ordre décroissant
  const messages = msgs
    .filter(m => m.content && typeof m.content === 'string')
    .map(m => ({
      sender:   m.sender_name,
      text:     m.content.trim(),
      isSalon:  pageNames.some(n => m.sender_name?.toLowerCase().includes(n.toLowerCase())),
      ts:       m.timestamp_ms,
    }));
  return pairMessages(messages, source);
}

// ─── APPARIEMENT INPUT / OUTPUT ───────────────────────────────────────────────
/**
 * Parcourt les messages et apparie :
 * Un message CLIENT suivi d'un message SALON = une paire d'entraînement
 */
function pairMessages(messages, source) {
  const pairs = [];
  let i = 0;
  while (i < messages.length - 1) {
    const current = messages[i];
    const next    = messages[i + 1];

    if (!current.isSalon && next.isSalon) {
      // On consolide les messages consécutifs du même camp
      let clientMsg = current.text;
      let j = i - 1;
      while (j >= 0 && !messages[j].isSalon && (i - j) <= 3) {
        clientMsg = messages[j].text + '\n' + clientMsg;
        j--;
      }

      let staffReply = next.text;
      let k = i + 2;
      while (k < messages.length && messages[k].isSalon && (k - i - 1) <= 3) {
        staffReply += '\n' + messages[k].text;
        k++;
      }

      pairs.push({
        source,
        client_msg:  clientMsg.trim(),
        staff_reply: staffReply.trim(),
      });
      i = k;
    } else {
      i++;
    }
  }
  return pairs;
}

// ─── SCORING QUALITÉ ──────────────────────────────────────────────────────────
/**
 * Score une paire Input/Output sur 1.0
 * Critères : longueur réponse, présence mots chaleureux, mention lien/RDV, pas de réponse sèche
 */
function scoreQuality(pair) {
  let score = 0.3; // base
  const reply = pair.staff_reply.toLowerCase();

  // Longueur réponse (40–300 chars = idéal)
  const len = pair.staff_reply.length;
  if (len > 40)  score += 0.1;
  if (len > 80)  score += 0.1;
  if (len > 300) score -= 0.1; // trop long = moins utile pour few-shot

  // Chaleur / politesse
  if (/bonjour|merci|bienvenue|plaisir|ravie?|enchant|absolument/.test(reply)) score += 0.15;
  if (/😊|🌸|✨|💇|🙏|❤️|👍/.test(pair.staff_reply)) score += 0.05;

  // Orientation action (lien, RDV, appel)
  if (/réserv|rdv|rendez-vous|disponib|créneau|appel|514|link|lien/.test(reply)) score += 0.15;

  // Pas de réponse sèche ou inutilisable
  if (/ok|oui|non|d'accord|vu|yes/.test(reply) && len < 30) score -= 0.2;

  // Input pertinent
  if (pair.client_msg.length > 15) score += 0.05;

  return Math.min(1.0, Math.max(0, parseFloat(score.toFixed(2))));
}

// ─── DÉTECTION INTENT ────────────────────────────────────────────────────────
function detectIntent(text) {
  const t = (text || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  if (/rendez|rdv|reserv|book|appoint|creneau|disponib|samedi|dimanche|lundi|mardi|mercredi|jeudi|vendredi|quand|horaire/.test(t)) return 'booking';
  if (/prix|tarif|cout|combien|cher|gratuit/.test(t)) return 'tarifs';
  if (/dread|lock|sisterlocks?|retwist/.test(t)) return 'dreads';
  if (/tresse|natte|braid|knotless|twist/.test(t)) return 'tresses';
  if (/barb|coupe homme|fade/.test(t)) return 'barbier';
  if (/tissage|perruque|lace|wig/.test(t)) return 'tissage';
  if (/soin|hydrat|lissage|defris/.test(t)) return 'soins';
  if (/merci|super|parfait|niquel|bravo/.test(t)) return 'satisfaction';
  return 'general';
}

// ─── INGESTION EN BASE ────────────────────────────────────────────────────────
async function insertPairs(pairs) {
  if (!pairs.length) return { inserted: 0, skipped: 0 };
  let inserted = 0;
  let skipped  = 0;

  for (const pair of pairs) {
    // Déduplique sur (client_msg, staff_reply)
    const exists = await pool.query(
      'SELECT id FROM daleba_training_data WHERE client_msg = $1 AND staff_reply = $2 LIMIT 1',
      [pair.client_msg, pair.staff_reply]
    );
    if (exists.rows.length) { skipped++; continue; }

    const score  = scoreQuality(pair);
    const intent = detectIntent(pair.client_msg);
    await pool.query(
      `INSERT INTO daleba_training_data (source, client_msg, staff_reply, intent, quality_score)
       VALUES ($1, $2, $3, $4, $5)`,
      [pair.source, pair.client_msg, pair.staff_reply, intent, score]
    );
    inserted++;
  }
  return { inserted, skipped };
}

// ─── API PUBLIQUE ─────────────────────────────────────────────────────────────

/**
 * Ingère un fichier WhatsApp .txt
 */
async function ingestWhatsApp(filePath, salonNames) {
  await setupDB();
  console.log(`[INGESTER] Parsing WhatsApp: ${path.basename(filePath)}`);
  const pairs = parseWhatsApp(filePath, salonNames);
  console.log(`[INGESTER] ${pairs.length} paires extraites`);
  const result = await insertPairs(pairs);
  console.log(`[INGESTER] ✅ ${result.inserted} insérées | ${result.skipped} doublons ignorés`);
  return result;
}

/**
 * Ingère un JSON Meta (Messenger ou Instagram)
 */
async function ingestMetaJSON(filePath, pageNames, source = 'messenger') {
  await setupDB();
  console.log(`[INGESTER] Parsing ${source}: ${path.basename(filePath)}`);
  const pairs = parseMetaJSON(filePath, pageNames, source);
  console.log(`[INGESTER] ${pairs.length} paires extraites`);
  const result = await insertPairs(pairs);
  console.log(`[INGESTER] ✅ ${result.inserted} insérées | ${result.skipped} doublons ignorés`);
  return result;
}

/**
 * Ingère un tableau de paires brutes [{client_msg, staff_reply, source}]
 */
async function ingestRaw(pairs) {
  await setupDB();
  const result = await insertPairs(pairs);
  console.log(`[INGESTER] ✅ ${result.inserted} insérées | ${result.skipped} doublons ignorés`);
  return result;
}

/**
 * Résumé stats de la base d'entraînement
 */
async function getStats() {
  await setupDB();
  const total   = await pool.query('SELECT COUNT(*) FROM daleba_training_data');
  const bySource= await pool.query('SELECT source, COUNT(*) as n FROM daleba_training_data GROUP BY source');
  const byIntent= await pool.query('SELECT intent, COUNT(*) as n FROM daleba_training_data GROUP BY intent ORDER BY n DESC');
  const topScore= await pool.query('SELECT AVG(quality_score) as avg, MAX(quality_score) as max FROM daleba_training_data');
  return {
    total:    parseInt(total.rows[0].count),
    bySource: bySource.rows,
    byIntent: byIntent.rows,
    quality:  topScore.rows[0],
  };
}

module.exports = {
  setupDB,
  ingestWhatsApp,
  ingestMetaJSON,
  ingestRaw,
  getStats,
  parseWhatsApp,
  parseMetaJSON,
  scoreQuality,
  detectIntent,
};
