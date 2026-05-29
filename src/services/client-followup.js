/**
 * DALEBA — Relance Client Automatisée (Point 40)
 * Envoie des SMS de suivi après les RDV et relances d'inactivité.
 */

const { logError } = require('./error-monitor');

// ─── SMS TEMPLATES ────────────────────────────────────────────────────────────
const TEMPLATES = {
  POST_VISIT_2H: (nom) =>
    `Merci ${nom} de votre visite chez Kadio Coiffure ! Comment s'est passée votre expérience ? 😊 Répondez à ce message pour nous laisser un avis.`,
  RELANCE_7J: (nom) =>
    `Bonjour ${nom} ! 💇 C'est DALEBA de chez Kadio Coiffure. Il serait temps de reprendre soin de vous non ? Réservez en 2 clics : https://kadiocoiffure.vercel.app/hub`,
  INACTIF_30J: (nom) =>
    `Bonjour ${nom}, ça fait un moment qu'on ne vous a pas vu ! 🌟 Votre prochaine transformation vous attend. Réservez : https://kadiocoiffure.vercel.app/hub`,
};

// Tracker des SMS déjà envoyés (en mémoire + persist dans logs)
const sentTracker = new Set();
let sentLog = [];

const fs = require('fs');
const path = require('path');
const IS_SERVERLESS = !!(process.env.VERCEL || process.env.AWS_LAMBDA_FUNCTION_NAME);
const LOGS_DIR = IS_SERVERLESS ? '/tmp/daleba-logs' : path.join(__dirname, '../../logs');
const TRACKER_FILE = path.join(LOGS_DIR, 'followup-sent.json');

// Charger l'état persisté au démarrage
function loadSentTracker() {
  try {
    if (fs.existsSync(TRACKER_FILE)) {
      const data = JSON.parse(fs.readFileSync(TRACKER_FILE, 'utf8'));
      sentLog = data;
      data.forEach(entry => sentTracker.add(entry.key));
      console.log(`📬 Followup tracker chargé: ${sentTracker.size} SMS déjà envoyés`);
    }
  } catch (err) {
    console.warn('⚠️ Impossible de charger followup-sent.json:', err.message);
  }
}

function saveSentTracker() {
  try {
    try {
      if (!fs.existsSync(LOGS_DIR)) fs.mkdirSync(LOGS_DIR, { recursive: true });
      fs.writeFileSync(TRACKER_FILE, JSON.stringify(sentLog, null, 2));
    } catch (_) {}
  } catch (err) {
    console.error('❌ Impossible de sauvegarder followup-sent.json:', err.message);
  }
}

function markSent(key, type, phone) {
  sentTracker.add(key);
  sentLog.push({ key, type, phone, sentAt: new Date().toISOString() });
  saveSentTracker();
}

// ─── ENVOI SMS via Twilio ─────────────────────────────────────────────────────
async function sendSMS(to, body) {
  const SID = process.env.TWILIO_ACCOUNT_SID;
  const TOKEN = process.env.TWILIO_AUTH_TOKEN;
  const FROM = process.env.TWILIO_PHONE_NUMBER;

  if (!SID || !TOKEN || !FROM) {
    console.warn(`⚠️ Twilio non configuré — SMS simulé vers ${to}: ${body.slice(0, 50)}...`);
    return { success: false, simulated: true };
  }

  try {
    const auth = Buffer.from(`${SID}:${TOKEN}`).toString('base64');
    const res = await fetch(
      `https://api.twilio.com/2010-04-01/Accounts/${SID}/Messages.json`,
      {
        method: 'POST',
        headers: {
          Authorization: `Basic ${auth}`,
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: new URLSearchParams({ To: to, From: FROM, Body: body }),
      }
    );
    const data = await res.json();
    if (!res.ok) throw new Error(data.message || `HTTP ${res.status}`);
    console.log(`📱 SMS envoyé → ${to}: SID=${data.sid}`);
    return { success: true, sid: data.sid };
  } catch (err) {
    console.error('❌ Erreur SMS:', err.message);
    return { success: false, error: err.message };
  }
}

// ─── LOGIQUE DE FOLLOWUP ──────────────────────────────────────────────────────
const stats = { post2h: 0, relance7j: 0, inactif30j: 0, errors: 0 };

/**
 * Scanne tous les RDV et déclenche les SMS appropriés.
 * Appeler depuis un setInterval ou manuellement.
 */
async function checkAppointmentFollowups() {
  console.log('🔍 Scan followup clients en cours...');

  try {
    // Import dynamique pour éviter les dépendances circulaires
    // getAllAppointments peut ne pas exister selon la version du service
    let appointments = [];
    try {
      const apptService = require('./appointments');
      if (typeof apptService.getAllAppointments === 'function') {
        appointments = await apptService.getAllAppointments();
      } else {
        // Fallback : pas de fonction getAllAppointments disponible
        console.warn('⚠️ getAllAppointments non disponible — followup ignoré ce cycle');
      }
    } catch (importErr) {
      console.warn('⚠️ Impossible de charger appointments service:', importErr.message);
    }

    const now = Date.now();

    for (const appt of appointments) {
      const phone = appt.phone || appt.client_phone;
      const nom = appt.name || appt.client_name || 'Cher(e) client(e)';
      const endTime = new Date(appt.end_time || appt.date).getTime();
      const elapsedMs = now - endTime;
      const elapsedH = elapsedMs / (1000 * 60 * 60);
      const elapsedD = elapsedH / 24;

      if (!phone) continue;

      // RDV terminé depuis ~2h (entre 1.8h et 3h)
      if (appt.status === 'completed' && elapsedH >= 1.8 && elapsedH < 3) {
        const key = `post2h:${appt.id}`;
        if (!sentTracker.has(key)) {
          const result = await sendSMS(phone, TEMPLATES.POST_VISIT_2H(nom));
          if (result.success || result.simulated) {
            markSent(key, 'POST_VISIT_2H', phone);
            stats.post2h++;
          }
        }
      }

      // RDV terminé depuis 7j, pas de nouveau RDV récent
      if (appt.status === 'completed' && elapsedD >= 7 && elapsedD < 8) {
        const key = `relance7j:${appt.id}`;
        if (!sentTracker.has(key)) {
          const result = await sendSMS(phone, TEMPLATES.RELANCE_7J(nom));
          if (result.success || result.simulated) {
            markSent(key, 'RELANCE_7J', phone);
            stats.relance7j++;
          }
        }
      }

      // Inactif depuis 30j
      if (appt.status === 'completed' && elapsedD >= 30 && elapsedD < 31) {
        const key = `inactif30j:${appt.id}`;
        if (!sentTracker.has(key)) {
          const result = await sendSMS(phone, TEMPLATES.INACTIF_30J(nom));
          if (result.success || result.simulated) {
            markSent(key, 'INACTIF_30J', phone);
            stats.inactif30j++;
          }
        }
      }
    }

    console.log(`✅ Scan followup terminé. Stats: `, stats);
  } catch (err) {
    stats.errors++;
    logError(err, 'CLIENT_FOLLOWUP');
    console.error('❌ Erreur checkAppointmentFollowups:', err.message);
  }
}

/**
 * Démarre le cron interne (toutes les heures)
 */
function startFollowupCron() {
  loadSentTracker();
  const interval = setInterval(checkAppointmentFollowups, 60 * 60 * 1000);
  console.log('⏰ Cron followup clients démarré (intervalle: 1h)');
  return interval;
}

/**
 * Stats actuelles
 */
function getFollowupStats() {
  return {
    ...stats,
    totalSent: sentTracker.size,
    trackerEntries: sentLog.length,
  };
}

module.exports = {
  checkAppointmentFollowups,
  startFollowupCron,
  getFollowupStats,
  TEMPLATES,
};
