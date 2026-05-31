/**
 * DALEBA — Worker Rappels SMS via Airtable
 * Tourne toutes les 15 minutes
 * Récupère les rappels en attente → envoie SMS → marque comme envoyé dans Airtable
 */

const airtable = require('../services/airtable');

const TWILIO_SID   = process.env.TWILIO_ACCOUNT_SID;
const TWILIO_TOKEN = process.env.TWILIO_AUTH_TOKEN;
const TWILIO_FROM  = process.env.TWILIO_PHONE_NUMBER;

let isRunning = false;

// ─── TWILIO SMS ───────────────────────────────────────────────────────────────

async function sendSMS(to, body) {
  if (!TWILIO_SID || !TWILIO_TOKEN || !TWILIO_FROM) {
    console.warn('[SMS Worker] Twilio non configuré — SMS simulé vers', to);
    return { sid: `SIMULATED-${Date.now()}`, status: 'simulated' };
  }

  const url = `https://api.twilio.com/2010-04-01/Accounts/${TWILIO_SID}/Messages.json`;
  const auth = Buffer.from(`${TWILIO_SID}:${TWILIO_TOKEN}`).toString('base64');

  const params = new URLSearchParams({ To: to, From: TWILIO_FROM, Body: body });
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Basic ${auth}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: params.toString(),
  });

  const data = await res.json();
  if (!res.ok) {
    throw new Error(`Twilio [${res.status}]: ${data.message || JSON.stringify(data)}`);
  }
  return { sid: data.sid, status: data.status };
}

// ─── FORMATAGE MESSAGE ────────────────────────────────────────────────────────

function buildReminderMessage(reminder) {
  const fields = reminder.fields || {};
  const client = fields['Client'] || 'Cher(e) client(e)';
  const type   = fields['Type rappel'] || '24h';
  const dateRdv = fields['Date RDV'];
  const service = fields['Square Appointment ID'] ? 'votre rendez-vous' : 'votre rendez-vous';

  // Si un message custom est défini dans Airtable, l'utiliser
  if (fields['Message'] && fields['Message'].trim()) {
    return fields['Message'];
  }

  // Format date
  let dateStr = 'bientôt';
  if (dateRdv) {
    try {
      const d = new Date(dateRdv);
      dateStr = d.toLocaleDateString('fr-CA', {
        weekday: 'long', day: 'numeric', month: 'long',
        hour: '2-digit', minute: '2-digit',
        timeZone: 'America/Toronto',
      });
    } catch { /* best effort */ }
  }

  const templates = {
    '24h': `Bonjour ${client} 👋 Rappel : vous avez ${service} à Kadio Coiffure ${dateStr}. À demain ! 💇‍♀️`,
    '1h':  `Bonjour ${client} ! Votre rendez-vous chez Kadio Coiffure est dans 1h (${dateStr}). Nous vous attendons ! 🌟`,
    'confirmation': `Bonjour ${client}, votre rendez-vous chez Kadio Coiffure est confirmé pour ${dateStr}. À bientôt ! 💛`,
    'anniversaire': `Joyeux anniversaire ${client} ! 🎂 Profitez d'un soin offert chez Kadio Coiffure ce mois-ci. Appelez le +1 450-XXX-XXXX.`,
    'réengagement': `Bonjour ${client} 😊 Ça fait un moment ! Revenez chez Kadio Coiffure — prenez RDV sur kadiocoiffure.vercel.app`,
  };

  return templates[type] || templates['24h'];
}

// ─── WORKER PRINCIPAL ─────────────────────────────────────────────────────────

async function runSMSReminderWorker() {
  if (isRunning) {
    console.log('[SMS Worker] Déjà en cours d\'exécution, ignoré.');
    return;
  }

  if (!airtable.isConfigured()) {
    // Mode silencieux si Airtable non configuré
    return;
  }

  isRunning = true;
  const startedAt = Date.now();
  let sent = 0;
  let failed = 0;

  try {
    console.log('[SMS Worker] 🔔 Démarrage scan rappels en attente...');
    const reminders = await airtable.getPendingReminders();

    if (reminders.length === 0) {
      console.log('[SMS Worker] Aucun rappel en attente.');
      return;
    }

    console.log(`[SMS Worker] ${reminders.length} rappel(s) à envoyer`);

    for (const reminder of reminders) {
      const fields = reminder.fields || {};
      const phone  = fields['Téléphone'];
      const client = fields['Client'] || 'Client';

      if (!phone) {
        console.warn(`[SMS Worker] Rappel ${reminder.id} sans téléphone — ignoré`);
        // Marquer comme annulé
        await airtable.updateRecord('Rappels SMS', reminder.id, { 'Statut': 'annulé' });
        continue;
      }

      // Incrémenter le compteur de tentatives
      const tentatives = (fields['Tentatives'] || 0) + 1;
      if (tentatives > 3) {
        console.warn(`[SMS Worker] Rappel ${reminder.id} — max tentatives atteint, annulé`);
        await airtable.updateRecord('Rappels SMS', reminder.id, { 'Statut': 'annulé', 'Tentatives': tentatives });
        continue;
      }

      try {
        const message = buildReminderMessage(reminder);
        const result = await sendSMS(phone, message);

        // Marquer comme envoyé
        await airtable.updateRecord('Rappels SMS', reminder.id, {
          'Statut': 'envoyé',
          'Envoyé le': new Date().toISOString(),
          'Twilio SID': result.sid || '',
          'Tentatives': tentatives,
        });

        // Mettre à jour le compteur de rappels sur l'abonné si email présent
        const email = fields['Email'];
        if (email) {
          const subscriber = await airtable.getSubscriberByEmail(email);
          if (subscriber) {
            const currentCount = subscriber.fields?.['Rappels envoyés'] || 0;
            await airtable.updateRecord('Abonnés', subscriber.id, {
              'Rappels envoyés': currentCount + 1,
            });
          }
        }

        sent++;
        console.log(`[SMS Worker] ✅ SMS envoyé à ${client} (${phone}) — SID: ${result.sid}`);
        await airtable.delay(300); // Respecter rate limit Twilio + Airtable
      } catch (e) {
        failed++;
        console.error(`[SMS Worker] ❌ Erreur envoi ${client} (${phone}):`, e.message);

        // Marquer comme échoué
        try {
          await airtable.updateRecord('Rappels SMS', reminder.id, {
            'Statut': tentatives >= 3 ? 'échoué' : 'en_attente',
            'Tentatives': tentatives,
          });
        } catch { /* best effort */ }

        await airtable.delay(300);
      }
    }
  } catch (e) {
    console.error('[SMS Worker] Erreur critique:', e.message);
  } finally {
    isRunning = false;
    const elapsed = ((Date.now() - startedAt) / 1000).toFixed(1);
    if (sent + failed > 0) {
      console.log(`[SMS Worker] Terminé en ${elapsed}s — ${sent} envoyés, ${failed} échecs`);
    }
  }
}

// ─── PLANIFICATION ────────────────────────────────────────────────────────────

/**
 * Démarre le worker toutes les 15 minutes
 * @returns {NodeJS.Timeout}
 */
function startSMSReminderWorker() {
  const INTERVAL_MS = 15 * 60 * 1000; // 15 minutes
  console.log('[SMS Worker] 🚀 Démarré — scan toutes les 15 minutes');

  // Premier run immédiat
  runSMSReminderWorker().catch(e => console.error('[SMS Worker] Run error:', e.message));

  // Puis toutes les 15 minutes
  return setInterval(() => {
    runSMSReminderWorker().catch(e => console.error('[SMS Worker] Run error:', e.message));
  }, INTERVAL_MS);
}

module.exports = {
  runSMSReminderWorker,
  startSMSReminderWorker,
  sendSMS,
};
