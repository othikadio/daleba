/**
 * DALEBA V26 — Cerveau Autonome Marketing
 * Analyse le taux de remplissage de l'agenda Square
 * Déclenche automatiquement le Studio Vidéo si agenda vide > 40%
 */

const bus = require('./event-bus');

const FILL_RATE_THRESHOLD = 0.60; // Déclenchement si < 60% rempli (= vide > 40%)
const WORKING_HOURS_PER_DAY = 9;  // 9h–18h = 9 créneaux horaires
const SLOT_DURATION_MIN = 60;     // Durée moyenne d'un créneau (minutes)
const SLOTS_PER_DAY = Math.floor((WORKING_HOURS_PER_DAY * 60) / SLOT_DURATION_MIN); // 9

// ─── ANALYSE DU TAUX DE REMPLISSAGE ──────────────────────────────────────────

/**
 * Calcule le taux de remplissage de l'agenda pour la semaine prochaine
 * @param {string} tenantId — identifiant du tenant (null = Kadio Coiffure)
 */
async function analyzeWeekFillRate(tenantId = null) {
  try {
    const square = require('./square');

    // Plage: semaine prochaine (lundi → dimanche)
    const now    = new Date();
    const dayOfWeek = now.getDay(); // 0=dim, 1=lun...
    const daysUntilNextMonday = (8 - dayOfWeek) % 7 || 7;
    const nextMonday = new Date(now);
    nextMonday.setDate(now.getDate() + daysUntilNextMonday);
    nextMonday.setHours(0, 0, 0, 0);

    const nextSunday = new Date(nextMonday);
    nextSunday.setDate(nextMonday.getDate() + 6);
    nextSunday.setHours(23, 59, 59, 999);

    const startAt = nextMonday.toISOString();
    const endAt   = nextSunday.toISOString();

    // Récupérer les RDV confirmés
    let bookedSlots = 0;
    let bookings = [];
    try {
      const result = await square.getBookings(startAt, endAt);
      bookings = (result.bookings || []).filter(b =>
        ['ACCEPTED', 'APPROVED'].includes(b.status)
      );
      bookedSlots = bookings.length;
    } catch (err) {
      bus.system(`[MARKETING] Erreur Square bookings: ${err.message}`);
    }

    // Jours ouvrés semaine (mardi–samedi pour un salon)
    const workingDays = 5;
    const totalSlots  = workingDays * SLOTS_PER_DAY;
    const fillRate    = totalSlots > 0 ? bookedSlots / totalSlots : 0;
    const emptyRate   = 1 - fillRate;

    bus.system(`[MARKETING] Agenda semaine prochaine: ${bookedSlots}/${totalSlots} RDV (${Math.round(fillRate * 100)}% rempli)`);

    return {
      tenantId,
      period:      { from: startAt.slice(0, 10), to: endAt.slice(0, 10) },
      bookedSlots,
      totalSlots,
      fillRate:    +fillRate.toFixed(3),
      emptyRate:   +emptyRate.toFixed(3),
      fillPct:     Math.round(fillRate * 100),
      emptyPct:    Math.round(emptyRate * 100),
      triggerMarketing: emptyRate > (1 - FILL_RATE_THRESHOLD),
      bookings:    bookings.slice(0, 5), // preview
      analyzedAt:  new Date().toISOString(),
    };
  } catch (err) {
    bus.system(`[MARKETING] Erreur analyse: ${err.message}`);
    return {
      tenantId,
      error:           err.message,
      fillRate:        0,
      emptyRate:       1,
      triggerMarketing: true, // En cas d'erreur, on déclenche quand même
      analyzedAt:      new Date().toISOString(),
    };
  }
}

// ─── GÉNÉRATION DE CONTENU PROMOTIONNEL ─────────────────────────────────────

/**
 * Construit le prompt LLM pour un contenu promo ciblé agenda vide
 * @param {object} analysis — résultat de analyzeWeekFillRate
 * @param {object} weeklyAudit — données Square de la semaine passée
 */
function buildPromoPrompt(analysis, weeklyAudit = {}) {
  const emptyPct = analysis.emptyPct || 50;
  const topServices = (weeklyAudit.topServices || []).slice(0, 3).map(s => s.name).join(', ') || 'coiffure';
  const period = analysis.period ? `du ${analysis.period.from} au ${analysis.period.to}` : 'la semaine prochaine';

  return `Tu es Béatrice, l'IA marketing de Kadio Coiffure.
L'agenda du salon est rempli à seulement ${100 - emptyPct}% pour ${period}.
Services populaires: ${topServices}.

Génère un post Instagram/Facebook court et percutant (max 3 phrases + hashtags) pour:
- Attirer des clients cette semaine
- Mettre en avant la disponibilité immédiate
- Ton chaleureux, professionnel, authentique
- Inclure une offre ou urgence douce (ex: "Quelques créneaux encore disponibles cette semaine !")

Format: texte prêt à copier-coller, sans explication.`;
}

/**
 * Worker autonome: analyse l'agenda et déclenche le contenu si nécessaire
 * Appelé par le cron V20 ou manuellement
 */
async function runMarketingWorker(tenantId = null) {
  bus.system('[MARKETING] Worker autonome démarré — analyse agenda...');

  const result = {
    tenantId,
    analysisRun:    true,
    contentTriggered: false,
    contentGenerated: null,
    analysis:       null,
    error:          null,
  };

  try {
    // 1. Analyser le taux de remplissage
    const analysis = await analyzeWeekFillRate(tenantId);
    result.analysis = analysis;

    if (!analysis.triggerMarketing) {
      bus.system(`[MARKETING] Agenda OK (${analysis.fillPct}% rempli) — aucune action nécessaire`);
      result.message = `Agenda à ${analysis.fillPct}% — pas de déclenchement`;
      return result;
    }

    bus.system(`[MARKETING] ⚡ Agenda vide à ${analysis.emptyPct}% — génération contenu promo`);
    result.contentTriggered = true;

    // 2. Récupérer données Square semaine passée pour contexte
    let weeklyAudit = {};
    try {
      const square = require('./square');
      weeklyAudit = await square.getSquareWeeklyAudit();
    } catch (e) {
      bus.system(`[MARKETING] Audit Square optionnel échoué: ${e.message}`);
    }

    // 3. Générer contenu promo via LLM
    const prompt = buildPromoPrompt(analysis, weeklyAudit);
    let promoContent = null;

    try {
      const claude = require('../agents/claude');
      promoContent = await claude.chat(prompt, [], null);
    } catch (e) {
      bus.system(`[MARKETING] Erreur LLM: ${e.message}`);
      promoContent = `🌟 Quelques créneaux disponibles cette semaine chez Kadio Coiffure ! Profitez-en pour prendre soin de vous. Réservez en ligne dès maintenant 💇‍♀️ #KadioCoiffure #Longueuil #Coiffure #RendezVousDisponible`;
    }

    // 4. Enregistrer dans la file sociale
    try {
      const socialScheduler = require('./social-scheduler');
      await socialScheduler.schedulePost({
        platform:    'instagram',
        content:     promoContent,
        caption:     promoContent,
        topic:       'promo_agenda_vide',
        style:       'urgency_promo',
        scheduledAt: new Date(Date.now() + 2 * 60 * 60 * 1000).toISOString(), // dans 2h
      });
      bus.system('[MARKETING] ✅ Contenu promo planifié dans la file sociale');
    } catch (e) {
      bus.system(`[MARKETING] File sociale: ${e.message}`);
    }

    result.contentGenerated = promoContent;
    result.message = `Agenda ${analysis.emptyPct}% vide — contenu promo généré et planifié`;

  } catch (err) {
    result.error = err.message;
    bus.system(`[MARKETING] ❌ Worker error: ${err.message}`);
  }

  return result;
}

// ─── HISTORIQUE & STATS MARKETING ────────────────────────────────────────────

async function getMarketingStats(tenantId = null) {
  try {
    const { pool, DEMO_MODE } = require('../memory/db');
    if (DEMO_MODE || !pool) {
      return { campaigns: 0, lastTrigger: null, avgFillRate: null };
    }
    const r = await pool.query(`
      SELECT COUNT(*) as total, MAX(created_at) as last_trigger
      FROM daleba_content_queue
      WHERE topic = 'promo_agenda_vide'
      ${tenantId ? "AND metadata->>'tenantId' = $1" : ''}
    `, tenantId ? [tenantId] : []);
    return {
      campaigns:   parseInt(r.rows[0]?.total || '0', 10),
      lastTrigger: r.rows[0]?.last_trigger || null,
    };
  } catch {
    return { campaigns: 0, lastTrigger: null };
  }
}

module.exports = {
  analyzeWeekFillRate,
  runMarketingWorker,
  buildPromoPrompt,
  getMarketingStats,
  FILL_RATE_THRESHOLD,
};
