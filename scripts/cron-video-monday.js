/**
 * cron-video-monday.js — Génération automatique vidéo botanique chaque lundi (V24)
 *
 * Usage:
 *   node scripts/cron-video-monday.js         (exécution immédiate)
 *   node-cron planifié via Railway cron job    (expression: "0 8 * * 1")
 *
 * Railway Cron: Schedule = "0 8 * * 1" (chaque lundi à 8h00 UTC)
 * Command: node scripts/cron-video-monday.js
 */

require('dotenv').config();

const { generateBotanicalVideo } = require('../src/services/video-studio');

// Numéro de semaine ISO pour cycler entre les tips automatiquement
function getISOWeek(date) {
  const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  const dayNum = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  return Math.ceil((((d - yearStart) / 86400000) + 1) / 7);
}

async function runMondayVideoJob() {
  const now = new Date();
  const weekNum = getISOWeek(now);
  const tipIndex = weekNum % 2; // Alterne entre tip 0 et tip 1 chaque semaine

  console.log(`\n🌿 [CRON LUNDI] Semaine ${weekNum} — Génération vidéo botanique tip #${tipIndex}`);
  console.log(`   Date: ${now.toISOString()}`);

  try {
    const result = await generateBotanicalVideo(1, { tipIndex });

    console.log(`\n✅ Vidéo générée:`);
    console.log(`   Mode    : ${result.mode}`);
    console.log(`   Job ID  : ${result.jobId}`);
    console.log(`   Statut  : ${result.status}`);
    console.log(`   Preview : ${result.previewUrl}`);
    if (result.mode === 'creatomate') {
      console.log(`   Creatomate Job: ${result.creatomateJobId}`);
      console.log(`   Temps estimé  : ${result.estimatedTime}s`);
    }
    console.log(`\n   Titre   : ${result.tip.title}`);
    process.exit(0);
  } catch (err) {
    console.error(`\n❌ Erreur génération vidéo:`, err.message);
    process.exit(1);
  }
}

// Lancement immédiat (Railway l'appelle directement comme un script)
runMondayVideoJob();
