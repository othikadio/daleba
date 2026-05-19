/**
 * Call Recorder — DALEBA Metacortex Points 237-238, 242-243
 *
 * [237] Enregistrement sélectif — record="record-from-answer" si tenant activé + légal
 * [238] Stockage chiffré + purge automatique 14 jours
 * [242] Destruction état dès CallStatus=completed
 * [243] Masquage numéros de téléphone dans les logs
 */

'use strict';

const crypto = require('crypto');
const bus    = require('./event-bus');

const RETENTION_DAYS = 14; // [238]
const ENCRYPTION_KEY = process.env.RECORDING_ENCRYPTION_KEY ||
  crypto.createHash('sha256').update(process.env.SQUARE_ACCESS_TOKEN || 'daleba-default-key').digest('hex').slice(0, 32);

// ─── [243] MASQUAGE NUMÉROS ───────────────────────────────────────────────────

/**
 * Masque partiellement un numéro de téléphone [243]
 * Ex: +15149845970 → +1514***5970
 *     +15149195970 → +1514***5970
 */
function maskPhone(phone) {
  if (!phone || typeof phone !== 'string') return '***';
  const clean = phone.replace(/\s/g, '');
  if (clean.length < 6) return '***';
  // Garder les 4 premiers + les 4 derniers, masquer le milieu
  const prefix = clean.slice(0, 5);
  const suffix = clean.slice(-4);
  const masked = '*'.repeat(Math.max(3, clean.length - 9));
  return `${prefix}${masked}${suffix}`;
}

// ─── [237] CONFIGURATION ENREGISTREMENT ──────────────────────────────────────

/**
 * Vérifie si l'enregistrement est autorisé pour ce tenant [237]
 * Conditions: loi locale OK + tenant.recording_enabled = true
 */
async function isRecordingEnabled(tenantId) {
  try {
    const maintenance = require('./maintenance');
    const pool = maintenance.getPool();
    if (!pool) return false;
    const r = await pool.query(
      `SELECT recording_enabled, country_code FROM tenant_settings WHERE tenant_id = $1 LIMIT 1`,
      [tenantId]
    ).catch(() => ({ rows: [] }));
    const tenant = r.rows[0];
    if (!tenant?.recording_enabled) return false;
    // Canada (QC) : avis verbal requis — PIPEDA + Loi 25 QC
    // L'avis est injecté dans le message d'accueil par voice-config.js
    const legalCountries = ['CA', 'US', 'FR', 'BE', 'CH'];
    return legalCountries.includes(tenant.country_code || 'CA');
  } catch {
    return false;
  }
}

/**
 * Génère les attributs TwiML pour le <Dial> avec enregistrement [237]
 */
function getRecordingAttributes(callSid) {
  return {
    record:                   'record-from-answer',
    recordingStatusCallback:  `${process.env.DALEBA_BASE_URL || 'https://daleba-api-production.up.railway.app'}/api/webhook/voice/recording-status`,
    recordingStatusCallbackMethod: 'POST',
  };
}

// ─── [238] STOCKAGE CHIFFRÉ ───────────────────────────────────────────────────

/**
 * Chiffre les métadonnées d'enregistrement AES-256-GCM [238]
 */
function encryptMetadata(data) {
  const iv         = crypto.randomBytes(16);
  const cipher     = crypto.createCipheriv('aes-256-gcm', Buffer.from(ENCRYPTION_KEY), iv);
  const encrypted  = Buffer.concat([cipher.update(JSON.stringify(data), 'utf8'), cipher.final()]);
  const authTag    = cipher.getAuthTag();
  return {
    iv:        iv.toString('hex'),
    data:      encrypted.toString('hex'),
    authTag:   authTag.toString('hex'),
    algorithm: 'aes-256-gcm',
  };
}

function decryptMetadata(encrypted) {
  const decipher = crypto.createDecipheriv(
    'aes-256-gcm',
    Buffer.from(ENCRYPTION_KEY),
    Buffer.from(encrypted.iv, 'hex')
  );
  decipher.setAuthTag(Buffer.from(encrypted.authTag, 'hex'));
  const decrypted = Buffer.concat([
    decipher.update(Buffer.from(encrypted.data, 'hex')),
    decipher.final(),
  ]);
  return JSON.parse(decrypted.toString('utf8'));
}

/**
 * Persiste les métadonnées d'un enregistrement dans la DB [238]
 */
async function saveRecordingMetadata(opts = {}) {
  const { callSid, recordingUrl, recordingSid, duration, tenantId, from } = opts;
  const expiresAt = new Date(Date.now() + RETENTION_DAYS * 86400000);

  const metadata = { callSid, recordingUrl, recordingSid, duration, from: maskPhone(from) };
  const encrypted = encryptMetadata(metadata);

  try {
    const maintenance = require('./maintenance');
    const pool = maintenance.getPool();
    if (!pool) return { saved: false, demo: true };

    await pool.query(`
      CREATE TABLE IF NOT EXISTS tenant_call_recordings (
        id           SERIAL PRIMARY KEY,
        tenant_id    TEXT NOT NULL,
        call_sid     TEXT UNIQUE,
        recording_sid TEXT,
        encrypted_meta JSONB,
        duration_s   INTEGER,
        expires_at   TIMESTAMPTZ NOT NULL,
        created_at   TIMESTAMPTZ DEFAULT NOW()
      )
    `).catch(() => {});

    await pool.query(`
      INSERT INTO tenant_call_recordings (tenant_id, call_sid, recording_sid, encrypted_meta, duration_s, expires_at)
      VALUES ($1,$2,$3,$4,$5,$6)
      ON CONFLICT (call_sid) DO UPDATE SET encrypted_meta=$4, expires_at=$6
    `, [tenantId || 'kadio', callSid, recordingSid, JSON.stringify(encrypted), duration || 0, expiresAt]);

    bus.system(`[CallRecorder] 🔒 Enregistrement chiffré: ${callSid} | expire ${expiresAt.toISOString().slice(0,10)}`);
    return { saved: true, expiresAt };
  } catch (err) {
    return { saved: false, error: err.message };
  }
}

// ─── [238] PURGE AUTOMATIQUE 14 JOURS ────────────────────────────────────────

/**
 * Supprime les enregistrements expirés + déclenche la suppression Twilio [238]
 * À appeler via cron
 */
async function purgeExpiredRecordings() {
  try {
    const maintenance = require('./maintenance');
    const pool = maintenance.getPool();
    if (!pool) return { purged: 0, demo: true };

    const expired = await pool.query(
      `DELETE FROM tenant_call_recordings WHERE expires_at < NOW() RETURNING call_sid, recording_sid, tenant_id`
    ).catch(() => ({ rows: [] }));

    const count = expired.rows.length;
    if (count > 0) {
      bus.system(`[CallRecorder] 🗑️ Purge ${count} enregistrements expirés (>14j)`);
      // Supprimer les fichiers audio chez Twilio
      if (process.env.TWILIO_ACCOUNT_SID && process.env.TWILIO_AUTH_TOKEN) {
        const twilio = require('twilio')(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN);
        for (const row of expired.rows) {
          if (row.recording_sid) {
            await twilio.recordings(row.recording_sid).remove().catch(() => {});
          }
        }
      }
    }
    return { purged: count };
  } catch (err) {
    return { purged: 0, error: err.message };
  }
}

// ─── [242] DESTRUCTION D'ÉTAT CallStatus=completed ───────────────────────────

/**
 * Détruit les objets d'état de dialogue à la fin de l'appel [242]
 */
function onCallCompleted(callSid) {
  const sessionStore = require('./voice-session-store');
  sessionStore.closeSession(callSid);
  bus.system(`[CallRecorder] ♻️ État ${callSid} détruit (call completed) [242]`);
}

// ─── EXPORTS ─────────────────────────────────────────────────────────────────

module.exports = {
  maskPhone,
  isRecordingEnabled,
  getRecordingAttributes,
  saveRecordingMetadata,
  purgeExpiredRecordings,
  onCallCompleted,
  encryptMetadata,
  decryptMetadata,
  RETENTION_DAYS,
};
