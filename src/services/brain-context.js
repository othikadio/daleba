/**
 * DALEBA — Pont Cérébral (Brain Bridge)
 * Injecte les données temps-réel dans le contexte LLM avant chaque requête admin.
 * Activé automatiquement si la requête contient des mots-clés de gestion.
 */

const ADMIN_KEYWORDS = [
  // Finance / CA
  'bilan', 'chiffre d\'affaires', 'ca ', 'revenue', 'revenu', 'argent', 'paiement',
  'encaissé', 'encaissement', 'vente', 'ventes', 'profit',
  // RDV / Agenda
  'rendez-vous', 'rdv', 'réservation', 'booking', 'agenda', 'planning',
  'no-show', 'absence', 'annulation', 'taux',
  // Mémoire stratégique
  'note', 'notes', 'vision', 'expansion', 'objectif', 'stratégie', 'projet',
  'mémoire', 'mémo', 'idée', 'plan',
  // Clients
  'client', 'clients', 'fidélité', 'retour', 'satisfaction',
  // Équipe
  'équipe', 'coiffeur', 'coiffeurs', 'performance', 'staff',
  // Abonnements
  'abonnement', 'abonnements', 'forfait', 'mensuel',
  // Semaine / période
  'semaine', 'semaine dernière', 'cette semaine', 'mois', 'rapport',
];

/**
 * Détecte si la requête concerne des données métier d'Ulrich (mode admin)
 */
function isAdminQuery(message) {
  const lower = message.toLowerCase();
  return ADMIN_KEYWORDS.some(kw => lower.includes(kw));
}

/**
 * Construit le bloc de contexte dynamique à injecter dans le system prompt
 * Appelé uniquement si isAdminQuery() === true
 */
async function buildDynamicContext(message) {
  const sections = [];
  const lower = message.toLowerCase();

  // ── Rapport financier Square ──────────────────────────────────────────────
  const needsFinance = ['bilan', 'chiffre', 'ca ', 'revenue', 'revenu', 'argent',
    'encaissé', 'vente', 'no-show', 'taux', 'semaine', 'rapport', 'rdv',
    'réservation', 'booking', 'absence', 'annulation'].some(kw => lower.includes(kw));

  if (needsFinance) {
    try {
      const square = require('./square');
      const audit = await square.getSquareWeeklyAudit();
      const isDemo = !process.env.SQUARE_ACCESS_TOKEN;

      sections.push(`
=== DONNÉES SALON — SEMAINE EN COURS ${isDemo ? '(MODE DÉMO — Square non connecté)' : '(SOURCE: Square)'}  ===
Période : ${audit.period.from} → ${audit.period.to}
Chiffre d'affaires : ${audit.revenue.total} CAD
Projection mensuelle : ${audit.projection.month} CAD
Rendez-vous : ${audit.appointments.total} total | ${audit.appointments.completed} complétés | ${audit.appointments.noShow} no-shows (${audit.appointments.noShowRate}%)
Abonnements actifs : ${audit.activeSubscriptions}
Top services :
${audit.topServices.length > 0
  ? audit.topServices.map(s => `  - ${s.service}: ${s.revenue} CAD`).join('\n')
  : '  (aucune donnée de service disponible)'}
${audit.errors ? `Avertissements: ${audit.errors.join(', ')}` : ''}
`);
    } catch (err) {
      sections.push(`\n=== DONNÉES SALON ===\n(Indisponible: ${err.message})\n`);
    }
  }

  // ── Mémoire Stratégique ───────────────────────────────────────────────────
  const needsMemory = ['note', 'notes', 'vision', 'expansion', 'objectif',
    'stratégie', 'projet', 'mémoire', 'mémo', 'idée', 'plan'].some(kw => lower.includes(kw));

  if (needsMemory) {
    try {
      const mem = require('./strategic-memory');

      // Détecte la catégorie demandée
      let category;
      if (lower.includes('expansion')) category = 'expansion';
      else if (lower.includes('vision')) category = 'vision';
      else if (lower.includes('finance')) category = 'finance';
      else if (lower.includes('tech')) category = 'tech';
      else if (lower.includes('salon')) category = 'salon';
      else if (lower.includes('personnel') || lower.includes('perso')) category = 'personal';

      const notes = await mem.getNotes({ category, limit: 10 });
      const summary = await mem.getStrategicSummary();

      sections.push(`
=== MÉMOIRE STRATÉGIQUE D'ULRICH ===
Total notes : ${summary.totalNotes} | Par catégorie : ${JSON.stringify(summary.byCategory)}
${notes.length > 0 ? `\nNotes récentes${category ? ` [${category}]` : ''} :\n${notes.map(n =>
  `  [${n.category}] ${n.title}: ${(n.content || '').slice(0, 150)}...`
).join('\n')}` : '(Aucune note enregistrée pour le moment)'}
`);
    } catch (err) {
      sections.push(`\n=== MÉMOIRE STRATÉGIQUE ===\n(Indisponible: ${err.message})\n`);
    }
  }

  return sections.join('\n');
}

/**
 * Enrichit le system prompt avec les données temps-réel si la requête le justifie.
 * @param {string} message       — message utilisateur
 * @param {string} systemPrompt  — prompt système de base
 * @returns {string}             — prompt système enrichi
 */
async function enrichSystemPrompt(message, systemPrompt) {
  if (!isAdminQuery(message)) return systemPrompt;

  const dynamicCtx = await buildDynamicContext(message);
  if (!dynamicCtx.trim()) return systemPrompt;

  return `${systemPrompt}

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
CONTEXTE TEMPS-RÉEL (injecté automatiquement — ne pas mentionner à un client)
Tu peux utiliser ces données pour répondre aux questions d'Ulrich sur la gestion du salon.
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
${dynamicCtx}
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`;
}

module.exports = { isAdminQuery, enrichSystemPrompt, buildDynamicContext };
