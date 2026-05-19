'use strict';
/**
 * Widget Analytics — DALEBA Metacortex Point 391
 * Simulateur de conversion: CTR, taux de complétion, funnel par tenant.
 */
const bus = require('./event-bus');

async function initSchema(pool) {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS widget_events (
      id          SERIAL PRIMARY KEY,
      tenant_id   TEXT NOT NULL,
      event_type  TEXT NOT NULL,  -- view | click | step1 | step2 | step3 | completed | abandoned
      session_id  TEXT,
      service_id  TEXT,
      ts          TIMESTAMPTZ DEFAULT NOW()
    )
  `).catch(() => {});
  await pool.query('CREATE INDEX IF NOT EXISTS idx_widget_ev ON widget_events(tenant_id, event_type, ts DESC)').catch(() => {});
}

async function trackEvent(pool, tenantId, eventType, sessionId, serviceId) {
  await initSchema(pool);
  await pool.query(
    'INSERT INTO widget_events (tenant_id, event_type, session_id, service_id) VALUES ($1,$2,$3,$4)',
    [tenantId, eventType, sessionId, serviceId]
  ).catch(() => {});
}

/**
 * [391] Calcule CTR et taux de complétion pour un tenant
 */
async function getConversionReport(pool, tenantId, days = 30) {
  await initSchema(pool);
  const since = new Date(Date.now() - days * 86400000).toISOString();

  const r = await pool.query(`
    SELECT event_type, COUNT(*) AS cnt
    FROM widget_events
    WHERE tenant_id=$1 AND ts >= $2
    GROUP BY event_type
  `, [tenantId, since]).catch(() => ({ rows: [] }));

  const counts = {};
  for (const row of r.rows) counts[row.event_type] = parseInt(row.cnt);

  const views     = counts['view']      || 0;
  const clicks    = counts['click']     || 0;
  const completed = counts['completed'] || 0;
  const abandoned = counts['abandoned'] || 0;

  const ctr            = views     > 0 ? Math.round(clicks    / views     * 100) : 0;
  const completionRate = clicks    > 0 ? Math.round(completed / clicks    * 100) : 0;
  const abandonRate    = clicks    > 0 ? Math.round(abandoned / clicks    * 100) : 0;

  bus.system(`[WidgetAnalytics] ${tenantId}: CTR=${ctr}%, Complétion=${completionRate}%, Abandon=${abandonRate}%`);
  return { tenantId, period: `${days}j`, views, clicks, completed, abandoned, ctr, completionRate, abandonRate, counts };
}

module.exports = { trackEvent, getConversionReport, initSchema };
