/**
 * Cashflow Engine — DALEBA Metacortex Points 164-167
 *
 * [164] AnalystAgent lance l'analyse chaque soir à 23h30 UTC
 * [165] Moyenne mobile + saisonnalité jour de semaine + vélocité de croissance
 * [166] Alerte si projection < 85% moyenne → DALEBA ALERT — PREDICTIVE_DROP
 * [167] Alerte transmise à MediaAgent via event-bus → contenu de relance forcé
 */

'use strict';

const bus = require('./event-bus');
const fiscal = require('./fiscal-engine');

// ─── CONSTANTES [165-166] ────────────────────────────────────────────────────

const LOOKBACK_DAYS     = 30;   // Historique à analyser
const FORECAST_DAYS     = 7;    // Horizon de prévision
const DROP_THRESHOLD    = 0.85; // [166] 85% → alerte PREDICTIVE_DROP
const MOVING_AVG_WINDOW = 7;    // Fenêtre moyenne mobile

// ─── EXTRACTION HISTORIQUE [164] ─────────────────────────────────────────────

async function fetchDailySales(tenantId = 'kadio', days = LOOKBACK_DAYS) {
  const maintenance = require('./maintenance');
  const pool = maintenance.getPool();
  if (!pool) return [];

  const r = await pool.query(`
    SELECT
      date_trunc('day', timestamp_utc AT TIME ZONE 'America/Toronto') AS day,
      EXTRACT(DOW FROM timestamp_utc AT TIME ZONE 'America/Toronto')  AS dow,
      SUM(amount_net)   AS net_revenue,
      SUM(amount_gross) AS gross_revenue,
      COUNT(*)          AS tx_count,
      SUM(amount_tip)   AS total_tips
    FROM tenant_ledgers
    WHERE tenant_id = $1
      AND timestamp_utc >= NOW() - INTERVAL '${days} days'
      AND audit_status != 'flagged'
    GROUP BY 1, 2
    ORDER BY 1 ASC
  `, [tenantId]).catch(() => ({ rows: [] }));

  return r.rows.map(row => ({
    day:          row.day,
    dow:          parseInt(row.dow),     // 0=Dim, 1=Lun, ... 6=Sam
    netRevenue:   parseFloat(row.net_revenue || 0),
    grossRevenue: parseFloat(row.gross_revenue || 0),
    txCount:      parseInt(row.tx_count),
    tips:         parseFloat(row.total_tips || 0),
  }));
}

// ─── MOYENNE MOBILE [165] ────────────────────────────────────────────────────

function movingAverage(series, window = MOVING_AVG_WINDOW) {
  if (series.length < window) return series.length > 0 ? series.reduce((a, b) => a + b, 0) / series.length : 0;
  const slice = series.slice(-window);
  return fiscal.roundCents(slice.reduce((a, b) => a + b, 0) / slice.length);
}

// ─── SAISONNALITÉ PAR JOUR [165] ─────────────────────────────────────────────

function computeSeasonality(dailySales) {
  const dowBuckets = Array(7).fill(null).map(() => ({ total: 0, count: 0 }));

  for (const d of dailySales) {
    dowBuckets[d.dow].total += d.netRevenue;
    dowBuckets[d.dow].count += 1;
  }

  const globalAvg = dailySales.reduce((s, d) => s + d.netRevenue, 0) / (dailySales.length || 1);

  // Indice saisonnier : ratio par rapport à la moyenne globale
  return dowBuckets.map((b, idx) => {
    const dayAvg = b.count > 0 ? b.total / b.count : globalAvg;
    return {
      dow:   idx,
      label: ['Dim','Lun','Mar','Mer','Jeu','Ven','Sam'][idx],
      avg:   fiscal.roundCents(dayAvg),
      index: globalAvg > 0 ? fiscal.roundCents(dayAvg / globalAvg) : 1,
    };
  });
}

// ─── VÉLOCITÉ DE CROISSANCE [165] ────────────────────────────────────────────

function computeGrowthVelocity(dailySales) {
  if (dailySales.length < 14) return 0;

  const recent  = dailySales.slice(-7).reduce((s, d) => s + d.netRevenue, 0) / 7;
  const previous = dailySales.slice(-14, -7).reduce((s, d) => s + d.netRevenue, 0) / 7;

  if (previous === 0) return 0;
  return fiscal.roundCents(((recent - previous) / previous) * 100); // % de croissance
}

// ─── PRÉVISION 7 JOURS [165] ─────────────────────────────────────────────────

function forecastRevenue(dailySales, seasonality) {
  const revenues = dailySales.map(d => d.netRevenue);
  const baseAvg  = movingAverage(revenues);
  const velocity = computeGrowthVelocity(dailySales);
  const velocityFactor = 1 + (velocity / 100) / 7; // par jour

  const forecast = [];
  const today = new Date();

  for (let i = 1; i <= FORECAST_DAYS; i++) {
    const date = new Date(today);
    date.setDate(today.getDate() + i);
    const dow   = date.getDay();
    const sIdx  = seasonality[dow]?.index || 1;
    const pred  = fiscal.roundCents(baseAvg * sIdx * Math.pow(velocityFactor, i));

    forecast.push({
      date:       date.toISOString().split('T')[0],
      dow,
      label:      ['Dim','Lun','Mar','Mer','Jeu','Ven','Sam'][dow],
      predicted:  pred,
      base:       baseAvg,
      seasonal:   sIdx,
    });
  }

  return {
    forecast,
    baseAvg,
    weekTotal: fiscal.roundCents(forecast.reduce((s, d) => s + d.predicted, 0)),
    velocity: `${velocity > 0 ? '+' : ''}${velocity}%`,
  };
}

// ─── MOTEUR DE PRÉVISION PRINCIPAL [164] ─────────────────────────────────────

async function runCashflowForecast(tenantId = 'kadio', province = 'QC') {
  console.log(`[CashflowEngine] Analyse 30 jours pour ${tenantId}…`);

  const dailySales  = await fetchDailySales(tenantId, LOOKBACK_DAYS);

  if (dailySales.length < 7) {
    return { status: 'insufficient_data', days: dailySales.length, message: 'Moins de 7 jours de données' };
  }

  const revenues    = dailySales.map(d => d.netRevenue);
  const seasonality = computeSeasonality(dailySales);
  const velocity    = computeGrowthVelocity(dailySales);
  const baseAvg     = movingAverage(revenues);
  const { forecast, weekTotal } = forecastRevenue(dailySales, seasonality);

  // [165] Semaines précédentes (référence)
  const recentWeekAvg = movingAverage(revenues.slice(-7));
  const prevWeekAvg   = revenues.length >= 14
    ? revenues.slice(-14, -7).reduce((a, b) => a + b, 0) / 7
    : baseAvg;

  // [166] Détection chute ≥ 15%
  const forecastDailyAvg = weekTotal / FORECAST_DAYS;
  const dropRatio = prevWeekAvg > 0 ? forecastDailyAvg / prevWeekAvg : 1;
  const isDropAlert = dropRatio < DROP_THRESHOLD;

  const result = {
    tenantId,
    analysedAt:   new Date().toISOString(),
    daysAnalysed: dailySales.length,
    baseAvg:      fiscal.roundCents(baseAvg),
    recentWeekAvg: fiscal.roundCents(recentWeekAvg),
    prevWeekAvg:  fiscal.roundCents(prevWeekAvg),
    forecastDailyAvg: fiscal.roundCents(forecastDailyAvg),
    dropRatio:    fiscal.roundCents(dropRatio * 100),
    velocity:     `${velocity > 0 ? '+' : ''}${velocity}%`,
    forecast,
    seasonality,
    weekTotal:    fiscal.roundCents(weekTotal),
    isDropAlert,
  };

  // [166] Alerte si projection < 85%
  if (isDropAlert) {
    const alertMsg = [
      `⚠️ DALEBA ALERT — PREDICTIVE_DROP`,
      `Projection semaine: $${weekTotal.toFixed(2)} CAD`,
      `Ratio vs sem. préc.: ${result.dropRatio}% (seuil: ${DROP_THRESHOLD * 100}%)`,
      `Vélocité: ${velocity}%`,
      `Action requise: contenu de relance immédiat`,
    ].join('\n');

    console.warn(`[CashflowEngine] ${alertMsg}`);
    bus.system(alertMsg);

    // [167] Transmission à MediaAgent via event-bus
    _triggerMediaRelance(result, tenantId);
    // [167] HUD event finance
    if (bus.finance) bus.finance(`⚠️ PREDICTIVE_DROP — ${tenantId} | $${weekTotal.toFixed(2)}/sem — relance média déclenchée`);
  } else {
    bus.system(`[CashflowEngine] Prévision ${tenantId}: $${weekTotal.toFixed(2)}/sem (${result.dropRatio}% vs sem. préc.)`);
  }

  // Persister la prévision dans daleba_notes
  const maintenance = require('./maintenance');
  const pool = maintenance.getPool();
  if (pool) {
    await pool.query(`
      INSERT INTO daleba_notes (category, key, content, created_at)
      VALUES ('cashflow_forecast', $1, $2, NOW())
      ON CONFLICT (category, key)
      DO UPDATE SET content = EXCLUDED.content, created_at = NOW()
    `, [`forecast_${tenantId}_${new Date().toISOString().split('T')[0]}`, JSON.stringify(result)])
      .catch(() => {});
  }

  return result;
}

// ─── [167] DÉCLENCHEUR MÉDIAS RELANCE ─────────────────────────────────────────

function _triggerMediaRelance(forecastResult, tenantId) {
  // Publie un événement que MediaAgent surveille
  bus.emit('predictive_drop', {
    type:       'predictive_drop',
    tenantId,
    dropRatio:  forecastResult.dropRatio,
    weekTotal:  forecastResult.weekTotal,
    velocity:   forecastResult.velocity,
    urgency:    'high',
    action:     'create_relance_content',
    message:    `Chiffre d'affaires prévu en baisse de ${100 - forecastResult.dropRatio}%. Créer contenu de relance urgent.`,
    triggeredAt: new Date().toISOString(),
  });

  // Tenter de déclencher MediaAgent directement si disponible
  setImmediate(async () => {
    try {
      const AgentManager = require('./agent-manager');
      await AgentManager.orchestrate([{
        type: 'MediaAgent',
        action: 'trigger_relance_campaign',
        params: {
          reason:    'predictive_drop',
          dropRatio: forecastResult.dropRatio,
          urgency:   'high',
          brief:     `CA prévu -${(100 - forecastResult.dropRatio).toFixed(0)}% cette semaine. Créer contenu promotionnel urgent pour Kadio Coiffure.`,
        },
      }], { parallel: false });
    } catch (e) {
      // AgentManager non disponible — bus event suffira
      console.warn('[CashflowEngine] AgentManager non disponible:', e.message);
    }
  });
}

// ─── SCHEDULER 23h30 UTC [164] ───────────────────────────────────────────────

function startCashflowScheduler(tenantId = 'kadio') {
  // Calcule le délai jusqu'au prochain 23h30 UTC
  function msUntilNext2330() {
    const now   = new Date();
    const next  = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), 23, 30, 0));
    if (next <= now) next.setUTCDate(next.getUTCDate() + 1);
    return next - now;
  }

  function scheduleNext() {
    const delay = msUntilNext2330();
    console.log(`[CashflowEngine] Prochain run dans ${Math.round(delay / 3600000 * 10) / 10}h (23h30 UTC)`);
    setTimeout(async () => {
      await runCashflowForecast(tenantId).catch(e => console.error('[CashflowEngine] Run failed:', e.message));
      scheduleNext(); // replanifier le suivant
    }, delay);
  }

  scheduleNext();
}

// ─── EXPORTS ─────────────────────────────────────────────────────────────────

module.exports = {
  runCashflowForecast, fetchDailySales, computeSeasonality,
  computeGrowthVelocity, forecastRevenue, movingAverage,
  startCashflowScheduler, DROP_THRESHOLD, LOOKBACK_DAYS, FORECAST_DAYS,
};
