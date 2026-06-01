'use strict';
/**
 * SMS Kill Switch & Purge — DALEBA [Anti-Spam Définitif]
 * ─────────────────────────────────────────────────────
 * Intercept global sur TOUTES les sorties SMS vers Ulrich.
 * Règles:
 *  - BAISSE_CA → HUD uniquement, JAMAIS SMS
 *  - SMS Ulrich: max 3/heure, max 10/jour
 *  - Au démarrage: purge cooldowns corrompus + log des sources actives
 *  - Env: SMS_MASTER_KILL=true → bloque TOUT (sauf urgences niveau 5)
 */
const bus = require('./event-bus');

// ── Niveaux de criticité ──────────────────────────────────────
const SEVERITY = {
  BAISSE_CA:          0,   // 0 = JAMAIS SMS, HUD only
  PROMO_ENVOYEE:      0,
  CONTENU_PUBLIE:     0,
  LOW_APPOINTMENTS:   1,   // 1 = 1/jour max
  STOCK_ALERT:        2,
  CLIENT_COMPLAINT:   3,   // 3 = envoyer
  PAYMENT_FAILED:     4,
  VOICE_ESCALATION:   4,
  URGENT:             5,   // 5 = toujours envoyer (urgence absolue)
  SECURITY_BREACH:    5,
  SYSTEM_DOWN:        5,
};

const MIN_SEVERITY_FOR_SMS = parseInt(process.env.SMS_MIN_SEVERITY || '3');
const MASTER_KILL          = process.env.SMS_MASTER_KILL === 'true';
const MAX_SMS_PER_HOUR     = parseInt(process.env.SMS_MAX_PER_HOUR || '3');
const MAX_SMS_PER_DAY      = parseInt(process.env.SMS_MAX_PER_DAY  || '10');

// Compteurs en mémoire (reset au redémarrage — c'est voulu)
const counters = { hourly: 0, daily: 0, hourReset: Date.now(), dayReset: Date.now() };

function resetCounters() {
  const now = Date.now();
  if (now - counters.hourReset  > 3600_000) { counters.hourly = 0; counters.hourReset  = now; }
  if (now - counters.dayReset   > 86400_000){ counters.daily  = 0; counters.dayReset   = now; }
}

/**
 * Vérifie si un SMS peut être envoyé
 * @returns {object} { allowed: bool, reason: string }
 */
function canSendSMS(alertType, severityOverride) {
  resetCounters();
  const severity = severityOverride ?? SEVERITY[alertType] ?? 2;

  // Urgences absolues — ignorent tous les filtres
  if (severity >= 5) return { allowed: true, reason: 'URGENCE_ABSOLUE' };

  // Kill switch master (env var)
  if (MASTER_KILL) return { allowed: false, reason: 'SMS_MASTER_KILL=true' };

  // Criticité insuffisante
  if (severity < MIN_SEVERITY_FOR_SMS)
    return { allowed: false, reason: `severity ${severity} < min ${MIN_SEVERITY_FOR_SMS}` };

  // Rate limits
  if (counters.hourly >= MAX_SMS_PER_HOUR)
    return { allowed: false, reason: `rate_limit: ${counters.hourly}/${MAX_SMS_PER_HOUR} SMS/heure` };
  if (counters.daily  >= MAX_SMS_PER_DAY)
    return { allowed: false, reason: `rate_limit: ${counters.daily}/${MAX_SMS_PER_DAY} SMS/jour` };

  return { allowed: true, reason: 'ok' };
}

function recordSMSSent() {
  resetCounters();
  counters.hourly++;
  counters.daily++;
}

/**
 * Purge des cooldowns corrompus au démarrage
 * Supprime les entrées > 48h (Railway fantôme)
 */
async function purgeStaleAlerts(pool) {
  if (!pool?.query) return;
  try {
    // Créer la table si elle n'existe pas (migration idempotente)
    await pool.query(`
      CREATE TABLE IF NOT EXISTS daleba_alert_cooldowns (
        alert_type TEXT PRIMARY KEY,
        last_sent  BIGINT NOT NULL DEFAULT 0
      )
    `);

    // last_sent est un BIGINT epoch-ms — comparaison en ms, pas en INTERVAL
    const cutoff48h = Date.now() - 48 * 60 * 60 * 1000;
    const cutoffFuture = Date.now() + 60 * 60 * 1000;
    const { rowCount } = await pool.query(
      `DELETE FROM daleba_alert_cooldowns
       WHERE last_sent < $1 OR last_sent > $2`,
      [cutoff48h, cutoffFuture]
    );
    if (rowCount > 0) {
      bus.system(`[SMSKillSwitch] 🧹 Purge: ${rowCount} cooldowns corrompus supprimés`);
    }

    // Reset BAISSE_CA définitivement (ne doit JAMAIS envoyer de SMS)
    await pool.query(`DELETE FROM daleba_alert_cooldowns WHERE alert_type = 'BAISSE_CA'`);

    const { rows } = await pool.query(`SELECT alert_type, last_sent FROM daleba_alert_cooldowns ORDER BY last_sent DESC`);
    if (rows.length > 0) {
      const fmt = rows.map(r => {
        const hoursAgo = Math.round((Date.now() - parseInt(r.last_sent)) / 3600000);
        return `${r.alert_type}(${hoursAgo}h ago)`;
      });
      bus.system(`[SMSKillSwitch] 📋 Cooldowns actifs: ${fmt.join(', ')}`);
    }
  } catch(e) {
    bus.system(`[SMSKillSwitch] ⚠️ Purge échouée: ${e.message}`);
  }
}

/**
 * Wrapper à injecter dans twilio-sender / commander-alerts
 * Remplace l'envoi direct par un envoi filtré
 */
async function guardedSend(alertType, sendFn, severity) {
  const check = canSendSMS(alertType, severity);
  if (!check.allowed) {
    bus.system(`[SMSKillSwitch] 🔇 SMS bloqué [${alertType}]: ${check.reason}`);
    bus.emit('sms:blocked', { alertType, reason: check.reason });
    return { sent: false, blocked: true, reason: check.reason };
  }
  const result = await sendFn();
  recordSMSSent();
  bus.system(`[SMSKillSwitch] ✅ SMS envoyé [${alertType}] | heure: ${counters.hourly}/${MAX_SMS_PER_HOUR} | jour: ${counters.daily}/${MAX_SMS_PER_DAY}`);
  return result;
}

/**
 * Rapport état du kill switch
 */
function getStatus() {
  resetCounters();
  return {
    masterKill:        MASTER_KILL,
    minSeverity:       MIN_SEVERITY_FOR_SMS,
    maxPerHour:        MAX_SMS_PER_HOUR,
    maxPerDay:         MAX_SMS_PER_DAY,
    sentThisHour:      counters.hourly,
    sentToday:         counters.daily,
    baisseCaStatus:    'HUD_ONLY — SMS définitivement désactivé',
    severityLevels:    SEVERITY,
  };
}

module.exports = { canSendSMS, guardedSend, purgeStaleAlerts, getStatus, recordSMSSent, SEVERITY };
