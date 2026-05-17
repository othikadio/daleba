/**
 * DALEBA — Journal de Bord Quotidien (Point 17)
 * Consigne chaque jour : apprentissages, modifications, corrections
 * Crée une courbe d'apprentissage ascendante de jour en jour
 */

const { pool, DEMO_MODE } = require('../memory/db');

// In-memory journal store for demo mode
const journalStore = [];

/**
 * Types d'entrées de journal
 */
const ENTRY_TYPES = {
  LEARNED:    'learned',    // Nouveau concept, pattern, info assimilée
  MODIFIED:   'modified',   // Fichier ou logique modifié
  CORRECTED:  'corrected',  // Bug ou erreur corrigé
  DECIDED:    'decided',    // Décision stratégique prise
  OPTIMIZED:  'optimized',  // Performance ou coût amélioré
  ACHIEVED:   'achieved',   // Objectif du plan directeur atteint
};

/**
 * Ajoute une entrée dans le journal de bord
 * @param {string} type - Un des ENTRY_TYPES
 * @param {string} summary - Résumé court (1 ligne)
 * @param {string} detail - Détail complet
 * @param {Object} metadata - Données supplémentaires (ex: fichier modifié, modèle utilisé)
 */
async function logEntry(type, summary, detail = '', metadata = {}) {
  const today = new Date().toISOString().slice(0, 10); // YYYY-MM-DD
  console.log(`📓 JOURNAL [${type.toUpperCase()}] ${summary}`);

  if (DEMO_MODE) {
    journalStore.push({ entry_date: today, entry_type: type, summary, detail, metadata, created_at: new Date() });
    return;
  }

  await pool.query(`
    INSERT INTO daleba_journal (entry_date, entry_type, summary, detail, metadata, created_at)
    VALUES ($1, $2, $3, $4, $5, NOW())
  `, [today, type, summary, detail, JSON.stringify(metadata)]);
}

/**
 * Récupère le journal d'une journée
 * @param {string} date - Format YYYY-MM-DD (défaut: aujourd'hui)
 */
async function getDailyJournal(date) {
  const d = date || new Date().toISOString().slice(0, 10);
  if (DEMO_MODE) {
    return journalStore.filter(e => e.entry_date === d);
  }
  const result = await pool.query(`
    SELECT entry_type, summary, detail, metadata, created_at
    FROM daleba_journal
    WHERE entry_date = $1
    ORDER BY created_at ASC
  `, [d]);
  return result.rows;
}

/**
 * Génère le rapport quotidien complet (markdown)
 * @param {string} date - Format YYYY-MM-DD
 */
async function generateDailyReport(date) {
  const d = date || new Date().toISOString().slice(0, 10);
  const entries = await getDailyJournal(d);

  if (entries.length === 0) {
    return `# 📓 Journal DALEBA — ${d}\n\n*Aucune entrée pour cette journée.*`;
  }

  const sections = {
    learned:   { emoji: '🧠', label: 'Appris', items: [] },
    modified:  { emoji: '🔧', label: 'Modifié', items: [] },
    corrected: { emoji: '✅', label: 'Corrigé', items: [] },
    decided:   { emoji: '⚡', label: 'Décisions', items: [] },
    optimized: { emoji: '📈', label: 'Optimisé', items: [] },
    achieved:  { emoji: '🏆', label: 'Accompli', items: [] },
  };

  for (const entry of entries) {
    const section = sections[entry.entry_type];
    if (section) {
      section.items.push(`- **${entry.summary}**${entry.detail ? `\n  ${entry.detail}` : ''}`);
    }
  }

  let report = `# 📓 Journal DALEBA — ${d}\n\n`;
  report += `*${entries.length} entrée(s) — Courbe d'apprentissage en progression*\n\n`;

  for (const [, section] of Object.entries(sections)) {
    if (section.items.length > 0) {
      report += `## ${section.emoji} ${section.label}\n\n`;
      report += section.items.join('\n') + '\n\n';
    }
  }

  return report;
}

/**
 * Récupère la courbe d'apprentissage (stats par jour sur N jours)
 * @param {number} days - Nombre de jours en arrière (défaut: 30)
 */
async function getLearningCurve(days = 30) {
  if (DEMO_MODE) {
    return [];
  }
  const result = await pool.query(`
    SELECT 
      entry_date,
      COUNT(*) as total_entries,
      COUNT(CASE WHEN entry_type = 'learned' THEN 1 END) as learned,
      COUNT(CASE WHEN entry_type = 'modified' THEN 1 END) as modified,
      COUNT(CASE WHEN entry_type = 'corrected' THEN 1 END) as corrected,
      COUNT(CASE WHEN entry_type = 'achieved' THEN 1 END) as achieved
    FROM daleba_journal
    WHERE entry_date >= NOW() - INTERVAL '${days} days'
    GROUP BY entry_date
    ORDER BY entry_date ASC
  `);
  return result.rows;
}

module.exports = {
  logEntry,
  getDailyJournal,
  generateDailyReport,
  getLearningCurve,
  ENTRY_TYPES,
};
