/**
 * DALEBA — Auto-Scheduler V20 (Cruise Control)
 * Routines autonomes: réengagement fidélité + contenu social
 * Tourne en fond sur Railway — jamais sur Vercel/serverless
 */

const bus = require('./event-bus');

const IS_SERVERLESS = !!(process.env.VERCEL || process.env.AWS_LAMBDA_FUNCTION_NAME);

// ─── UTILITAIRES TIMING ───────────────────────────────────────────────────────

/**
 * Calcule le nombre de ms avant le prochain lundi à 9h00 (America/Toronto)
 */
function msUntilNextMondayMorning() {
  const now = new Date();
  const day = now.getUTCDay(); // 0=Sun, 1=Mon...
  const daysUntilMonday = day === 1 ? 7 : (8 - day) % 7 || 7;
  const nextMonday = new Date(now);
  nextMonday.setUTCDate(now.getUTCDate() + daysUntilMonday);
  nextMonday.setUTCHours(14, 0, 0, 0); // 14h UTC = 9h EST / 10h EDT
  return Math.max(nextMonday - now, 60 * 1000); // min 1 minute
}

/**
 * Calcule le nombre de ms avant le prochain dimanche à 20h UTC (batch hebdo fidélité)
 */
function msUntilNextSundayEvening() {
  const now = new Date();
  const day = now.getUTCDay();
  const daysUntilSunday = day === 0 ? 7 : (7 - day);
  const nextSunday = new Date(now);
  nextSunday.setUTCDate(now.getUTCDate() + daysUntilSunday);
  nextSunday.setUTCHours(20, 0, 0, 0);
  return Math.max(nextSunday - now, 60 * 1000);
}

// ─── ROUTINE 1 : RÉENGAGEMENT FIDÉLITÉ (chaque dimanche soir) ────────────────

async function runLoyaltyReengagement() {
  bus.system('[V20] Routine fidélité démarrée — scan clients inactifs...');
  try {
    const loyalty = require('./loyalty-engine');
    const square  = require('./square');

    // 1. Campagne SMS pour clients inactifs 30+ jours
    const result = await loyalty.runReengagementCampaign(30);
    bus.system(`[V20] Réengagement: ${result.sent} SMS envoyés`);

    // 2. Enrichir les profils fidélité depuis Square (sync des paiements récents)
    try {
      const { payments = [] } = await square.getPayments(
        new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString(),
        new Date().toISOString()
      );
      const completed = payments.filter(p => p.status === 'COMPLETED');
      for (const p of completed) {
        const amountCAD = (p.amount_money?.amount || 0) / 100;
        if (amountCAD <= 0) continue;
        // Récupérer infos client Square si dispo
        let name, phone;
        if (p.customer_id) {
          try {
            const res = await fetch(`https://connect.squareup.com/v2/customers/${p.customer_id}`, {
              headers: {
                'Authorization': `Bearer ${process.env.SQUARE_ACCESS_TOKEN}`,
                'Square-Version': '2024-02-22',
              }
            });
            if (res.ok) {
              const data = await res.json();
              name  = data.customer?.given_name;
              phone = data.customer?.phone_number;
            }
          } catch (_) {}
        }
        if (phone) {
          await loyalty.awardPoints({
            squareCustomerId: p.customer_id,
            phone,
            name,
            amountCAD,
            source: 'square_weekly_sync',
          });
        }
      }
      bus.system(`[V20] ${completed.length} paiements Square synchronisés → points fidélité`);
    } catch (squareErr) {
      bus.emit('error', `[V20] Sync Square: ${squareErr.message}`);
    }

  } catch (err) {
    bus.emit('error', `[V20] Routine fidélité échouée: ${err.message}`);
  }

  // Reprogrammer pour la semaine suivante
  const next = msUntilNextSundayEvening();
  bus.system(`[V20] Prochaine routine fidélité dans ${Math.round(next / 3600000)}h`);
  setTimeout(runLoyaltyReengagement, next);
}

// ─── ROUTINE 2 : CONTENU SOCIAL (chaque lundi matin) ─────────────────────────

async function runSocialContentGeneration() {
  bus.system('[V20] Pipeline contenu social démarré...');
  try {
    const social  = require('./social-scheduler');
    const square  = require('./square');

    // Récupérer les perfs de la semaine pour contextualiser le contenu
    let perfContext = '';
    try {
      const audit = await square.getSquareWeeklyAudit();
      const top = audit.topServices?.[0];
      perfContext = top ? `Service le plus demandé cette semaine: ${top.service}. CA: ${audit.revenue.total} CAD.` : '';
    } catch (_) {}

    // Générer les 3 posts hebdomadaires obligatoires
    const posts = await generateWeeklyTriple(perfContext);

    bus.system(`[V20] Contenu social: ${posts.length} posts générés pour la semaine`);

  } catch (err) {
    bus.emit('error', `[V20] Pipeline social échoué: ${err.message}`);
  }

  // Reprogrammer pour lundi prochain
  const next = msUntilNextMondayMorning();
  bus.system(`[V20] Prochain pipeline contenu dans ${Math.round(next / 3600000)}h`);
  setTimeout(runSocialContentGeneration, next);
}

/**
 * Génère le triple de posts hebdomadaires:
 * 1. Astuce botanique (Instagram Reels)
 * 2. Mise en avant abonnements (Facebook)
 * 3. Script TikTok percutant
 */
async function generateWeeklyTriple(perfContext = '') {
  const social = require('./social-scheduler');
  const now = new Date();

  const configs = [
    {
      topic: `Astuce soin capillaire botanique${perfContext ? ' — basé sur vos hits du salon' : ''} — semaine ${now.toISOString().slice(0, 10)}`,
      style: 'reels_caption',
      platform: 'instagram',
      daysOffset: 1, // publier mardi
    },
    {
      topic: `Abonnements Kadio Coiffure — offres & avantages fidélité${perfContext ? ` | ${perfContext}` : ''}`,
      style: 'fb_post',
      platform: 'facebook',
      daysOffset: 3, // publier jeudi
    },
    {
      topic: `Script TikTok viral: transformation capillaire${perfContext ? ` ${perfContext}` : ''} chez Kadio Coiffure Longueuil`,
      style: 'tiktok_script',
      platform: 'tiktok',
      daysOffset: 5, // publier samedi
    },
  ];

  const scheduled = [];
  for (const cfg of configs) {
    try {
      const generated = await social.generateContent({
        topic: cfg.topic,
        style: cfg.style,
        platform: cfg.platform,
        language: 'fr',
      });
      const scheduledAt = new Date(now.getTime() + cfg.daysOffset * 24 * 60 * 60 * 1000).toISOString();
      const post = await social.schedulePost({
        platform: cfg.platform,
        content: generated.content,
        topic: cfg.topic,
        style: cfg.style,
        scheduledAt,
      });
      scheduled.push(post);
      bus.system(`[V20] Post planifié: [${cfg.platform}] ${cfg.topic.slice(0, 50)}...`);
    } catch (err) {
      bus.emit('error', `[V20] Génération post ${cfg.platform}: ${err.message}`);
    }
  }
  return scheduled;
}

// ─── DÉMARRAGE DES ROUTINES ───────────────────────────────────────────────────

function startV20Crons() {
  if (IS_SERVERLESS) {
    console.log('[V20] Mode serverless détecté — crons V20 désactivés');
    return;
  }

  console.log('[V20] Cruise Control activé — routines autonomes en veille...');

  // Routine fidélité: premier run dans 5 min (sanity check), puis chaque dimanche soir
  setTimeout(async () => {
    bus.system('[V20] Cruise Control V20 — Routines fidélité & contenu actives');
    const loyaltyIn = msUntilNextSundayEvening();
    const socialIn  = msUntilNextMondayMorning();

    bus.system(`[V20] Fidélité → dimanche soir (dans ${Math.round(loyaltyIn / 3600000)}h)`);
    bus.system(`[V20] Contenu social → lundi matin (dans ${Math.round(socialIn / 3600000)}h)`);

    setTimeout(runLoyaltyReengagement, loyaltyIn);
    setTimeout(runSocialContentGeneration, socialIn);

    // V21 — Commander Alerts: scan toutes les heures
    const { runAllAlertChecks } = require('./commander-alerts');
    bus.system('[V21] Commander Alerts actif — scan Square toutes les heures');
    setInterval(runAllAlertChecks, 60 * 60 * 1000); // chaque heure
    // Premier scan dans 10 minutes
    setTimeout(runAllAlertChecks, 10 * 60 * 1000);
  }, 5 * 60 * 1000);

  console.log('[V20/V21] Crons programmés: fidélité + contenu + alertes commandant');
}

module.exports = { startV20Crons, generateWeeklyTriple, runLoyaltyReengagement, runSocialContentGeneration };
