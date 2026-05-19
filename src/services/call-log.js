/**
 * Call Log — DALEBA Metacortex Points 239-241, 243
 *
 * [239-240] Journal des appels pour le HUD /admin/calls
 * [241] Scan AnalystAgent post-appel (nouvelles réservations → stocks botaniques)
 * [243] Masquage automatique des numéros dans les logs
 */

'use strict';

const bus       = require('./event-bus');
const { maskPhone } = require('./call-recorder');

// ─── TABLE LOGS ───────────────────────────────────────────────────────────────

async function initCallLogsTable() {
  try {
    const maintenance = require('./maintenance');
    const pool = maintenance.getPool();
    if (!pool) return;
    await pool.query(`
      CREATE TABLE IF NOT EXISTS tenant_call_logs (
        id               SERIAL PRIMARY KEY,
        tenant_id        TEXT        NOT NULL DEFAULT 'kadio',
        call_sid         TEXT        UNIQUE,
        from_masked      TEXT,
        to_number        TEXT,
        started_at       TIMESTAMPTZ DEFAULT NOW(),
        ended_at         TIMESTAMPTZ,
        duration_s       INTEGER,
        intent           TEXT,
        frustration_score INTEGER    DEFAULT 0,
        transcript       TEXT,
        summary          TEXT,
        booking_id       TEXT,
        escalated        BOOLEAN     DEFAULT false,
        recording_sid    TEXT,
        status           TEXT        DEFAULT 'active'
      );
      CREATE INDEX IF NOT EXISTS idx_cl_tenant  ON tenant_call_logs(tenant_id);
      CREATE INDEX IF NOT EXISTS idx_cl_started ON tenant_call_logs(started_at DESC);
      CREATE INDEX IF NOT EXISTS idx_cl_intent  ON tenant_call_logs(intent);
    `);
  } catch (e) {
    console.warn('[CallLog] init skipped:', e.message);
  }
}

initCallLogsTable();

// ─── ÉCRIRE / MAJ UN LOG D'APPEL ─────────────────────────────────────────────

async function upsertCallLog(callSid, data = {}) {
  try {
    const maintenance = require('./maintenance');
    const pool = maintenance.getPool();
    if (!pool) return;

    // [243] Toujours masquer le numéro avant log
    const fromMasked = maskPhone(data.from);

    await pool.query(`
      INSERT INTO tenant_call_logs
        (call_sid, tenant_id, from_masked, to_number, intent, frustration_score,
         transcript, summary, booking_id, escalated, recording_sid, status, ended_at, duration_s)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)
      ON CONFLICT (call_sid) DO UPDATE SET
        intent=$5, frustration_score=$6, transcript=$7, summary=$8,
        booking_id=$9, escalated=$10, recording_sid=$11, status=$12,
        ended_at=$13, duration_s=$14
    `, [
      callSid,
      data.tenantId       || 'kadio',
      fromMasked,
      data.to             || null,
      data.intent         || null,
      data.frustrationScore || 0,
      data.transcript     || null,
      data.summary        || null,
      data.bookingId      || null,
      data.escalated      || false,
      data.recordingSid   || null,
      data.status         || 'active',
      data.endedAt        || null,
      data.durationS      || null,
    ]);
  } catch (err) {
    console.warn('[CallLog] upsert skipped:', err.message);
  }
}

// ─── LIRE LES LOGS (pour HUD [239-240]) ──────────────────────────────────────

async function getTodayCallLogs(tenantId = 'kadio', limit = 50) {
  try {
    const maintenance = require('./maintenance');
    const pool = maintenance.getPool();
    if (!pool) return [];
    const r = await pool.query(`
      SELECT id, call_sid, from_masked, intent, frustration_score, transcript,
             summary, booking_id, escalated, recording_sid, status, started_at, duration_s
      FROM tenant_call_logs
      WHERE tenant_id = $1
        AND started_at >= CURRENT_DATE
      ORDER BY started_at DESC
      LIMIT $2
    `, [tenantId, limit]);
    return r.rows;
  } catch {
    return [];
  }
}

async function getCallLog(callSid) {
  try {
    const maintenance = require('./maintenance');
    const pool = maintenance.getPool();
    if (!pool) return null;
    const r = await pool.query(
      `SELECT * FROM tenant_call_logs WHERE call_sid = $1`,
      [callSid]
    );
    return r.rows[0] || null;
  } catch {
    return null;
  }
}

// ─── [241] CRON SCAN ANALYST ─────────────────────────────────────────────────

/**
 * Toutes les heures — scanne tenant_appointments pour ajustement stocks botaniques [241]
 */
async function analyzeNewVoiceBookings(tenantId = 'kadio') {
  try {
    const maintenance = require('./maintenance');
    const pool = maintenance.getPool();
    if (!pool) return { analyzed: 0, demo: true };

    // Réservations vocales < 1h non encore analysées
    const recent = await pool.query(`
      SELECT id, customer_id, service_name, start_at, created_at
      FROM tenant_appointments
      WHERE tenant_id = $1
        AND call_sid IS NOT NULL
        AND created_at >= NOW() - INTERVAL '1 hour'
        AND status = 'CONFIRMED'
    `, [tenantId]).catch(() => ({ rows: [] }));

    if (!recent.rows.length) return { analyzed: 0 };

    // Identifier les services botaniques
    const botanicalServices = recent.rows.filter(r =>
      /botanique|soin|bain|argan|kérat|kerat|mask|traitement/i.test(r.service_name || '')
    );

    if (botanicalServices.length) {
      bus.system(`[CallLog][241] ${botanicalServices.length} réservation(s) botanique(s) détectée(s) — alerte stocks`);
      // Émettre événement pour AnalystAgent
      bus.emit('analyst:stock_check', { tenantId, services: botanicalServices });
    }

    return { analyzed: recent.rows.length, botanical: botanicalServices.length };
  } catch (err) {
    return { analyzed: 0, error: err.message };
  }
}

// ─── EXPORTS ─────────────────────────────────────────────────────────────────

module.exports = {
  upsertCallLog,
  getTodayCallLogs,
  getCallLog,
  analyzeNewVoiceBookings,
};
