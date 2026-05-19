/**
 * Tax Digest — DALEBA Metacortex Points 173, 183-186
 *
 * [173] generateTaxDigest() — synthèse trimestrielle TPS/TVQ
 * [183] Détection chute CA hebdomadaire > 15%
 * [184] Mémo financier vocal pour voice-commander
 * [185] Gestion remboursements + ajustement livres comptables
 * [186] Cron dimanche 23h59 — archive + rapport hebdomadaire
 */

'use strict';

const bus    = require('./event-bus');
const fiscal = require('./fiscal-engine');

// ─── UTILITAIRES DATE ─────────────────────────────────────────────────────────

function currentQuarter() {
  const d = new Date();
  const q = Math.ceil((d.getMonth() + 1) / 3);
  return { year: d.getFullYear(), quarter: q, label: `${d.getFullYear()}-Q${q}` };
}

function quarterDates(year, quarter) {
  const startMonth = (quarter - 1) * 3;
  const endMonth   = startMonth + 2;
  return {
    start: new Date(Date.UTC(year, startMonth, 1)).toISOString(),
    end:   new Date(Date.UTC(year, endMonth + 1, 0, 23, 59, 59)).toISOString(),
  };
}

// ─── [173] DIGEST TRIMESTRIEL ─────────────────────────────────────────────────

/**
 * Synthèse des montants fiscaux du trimestre courant (ou spécifié).
 * Données pour déclaration Revenu Québec + ARC.
 */
async function generateTaxDigest(tenantId = 'kadio', year = null, quarter = null) {
  const maintenance = require('./maintenance');
  const pool = maintenance.getPool();

  const q    = currentQuarter();
  const y    = year    || q.year;
  const qt   = quarter || q.quarter;
  const { start, end } = quarterDates(y, qt);

  const rows = pool ? await pool.query(`
    SELECT
      province_code,
      SUM(amount_net)   AS total_net,
      SUM(amount_tps)   AS total_tps,
      SUM(amount_tvq)   AS total_tvq,
      SUM(amount_gross) AS total_gross,
      COUNT(*)          AS tx_count,
      SUM(CASE WHEN refunded THEN amount_net ELSE 0 END)   AS refunded_net,
      SUM(CASE WHEN refunded THEN amount_tps ELSE 0 END)   AS refunded_tps,
      SUM(CASE WHEN refunded THEN amount_tvq ELSE 0 END)   AS refunded_tvq
    FROM tenant_ledgers
    WHERE tenant_id = $1
      AND timestamp_utc BETWEEN $2 AND $3
      AND audit_status != 'flagged'
    GROUP BY province_code
  `, [tenantId, start, end]).catch(() => ({ rows: [] })) : { rows: [] };

  const totals = {
    net: 0, tps: 0, tvq: 0, gross: 0, txCount: 0,
    refundedNet: 0, refundedTps: 0, refundedTvq: 0,
  };

  const byProvince = {};
  for (const row of rows.rows) {
    const prov = row.province_code || 'QC';
    byProvince[prov] = {
      net:   parseFloat(row.total_net  || 0),
      tps:   parseFloat(row.total_tps  || 0),
      tvq:   parseFloat(row.total_tvq  || 0),
      gross: parseFloat(row.total_gross || 0),
      txCount: parseInt(row.tx_count  || 0),
      refundedNet: parseFloat(row.refunded_net || 0),
      refundedTps: parseFloat(row.refunded_tps || 0),
      refundedTvq: parseFloat(row.refunded_tvq || 0),
    };
    for (const k of ['net','tps','tvq','gross','txCount']) totals[k] += byProvince[prov][k];
    totals.refundedNet += byProvince[prov].refundedNet;
    totals.refundedTps += byProvince[prov].refundedTps;
    totals.refundedTvq += byProvince[prov].refundedTvq;
  }

  // Montants nets à déclarer (déduit remboursements)
  const tpsADeclarer = fiscal.roundCents(totals.tps - totals.refundedTps);
  const tvqADeclarer = fiscal.roundCents(totals.tvq - totals.refundedTvq);
  const totalADeclarer = fiscal.roundCents(tpsADeclarer + tvqADeclarer);

  // Date limite dépôt déclaration (dernier jour du mois suivant la fin du trimestre)
  const endQuarterMonth = qt * 3; // 3, 6, 9, 12
  const deadlineDate = new Date(Date.UTC(y, endQuarterMonth, 0)); // dernier jour
  deadlineDate.setMonth(deadlineDate.getMonth() + 1);

  const digest = {
    tenantId,
    period:        { year: y, quarter: qt, label: `${y}-Q${qt}`, start, end },
    deadline:      deadlineDate.toISOString().split('T')[0],
    byProvince,
    totals: {
      net:           fiscal.roundCents(totals.net),
      tps:           fiscal.roundCents(totals.tps),
      tvq:           fiscal.roundCents(totals.tvq),
      gross:         fiscal.roundCents(totals.gross),
      txCount:       totals.txCount,
    },
    refunds: {
      net: fiscal.roundCents(totals.refundedNet),
      tps: fiscal.roundCents(totals.refundedTps),
      tvq: fiscal.roundCents(totals.refundedTvq),
    },
    aDeclarer: {
      tps:   tpsADeclarer,
      tvq:   tvqADeclarer,
      total: totalADeclarer,
    },
    generatedAt: new Date().toISOString(),
  };

  // Persistance
  if (pool) {
    await pool.query(`
      INSERT INTO daleba_notes (category, key, content, created_at)
      VALUES ('tax_digest', $1, $2, NOW())
      ON CONFLICT (category, key) DO UPDATE SET content = EXCLUDED.content, created_at = NOW()
    `, [`digest_${tenantId}_${y}-Q${qt}`, JSON.stringify(digest)]).catch(() => {});
  }

  return digest;
}

// ─── [183] DÉTECTION CHUTE HEBDOMADAIRE ──────────────────────────────────────

async function detectWeeklyDrop(tenantId = 'kadio') {
  const maintenance = require('./maintenance');
  const pool = maintenance.getPool();
  if (!pool) return null;

  const r = await pool.query(`
    SELECT
      date_trunc('week', timestamp_utc AT TIME ZONE 'America/Toronto') AS week_start,
      SUM(amount_net) AS weekly_net,
      COUNT(*) AS tx_count
    FROM tenant_ledgers
    WHERE tenant_id = $1
      AND timestamp_utc >= NOW() - INTERVAL '28 days'
      AND audit_status != 'flagged'
      AND refunded = FALSE
    GROUP BY 1 ORDER BY 1 ASC
  `, [tenantId]).catch(() => ({ rows: [] }));

  if (r.rows.length < 2) return null;

  const weeks = r.rows.map(w => ({ net: parseFloat(w.weekly_net || 0), txCount: parseInt(w.tx_count) }));
  const current  = weeks[weeks.length - 1].net;
  const previous = weeks[weeks.length - 2].net;

  if (previous === 0) return null;
  const dropPct = fiscal.roundCents(((previous - current) / previous) * 100);

  if (dropPct >= 15) {
    // [183] Shield capture l'alerte
    const shield = require('./notification-shield');
    shield.reportMetricChange(
      `weekly_drop_${tenantId}`,
      Math.round(dropPct),
      `⚠️ CA hebdomadaire -${dropPct}% (${tenantId}) : $${current.toFixed(2)} vs $${previous.toFixed(2)}`
    );
    bus.system(`⚠️ WEEKLY_DROP ${tenantId}: -${dropPct}% | $${current.toFixed(2)} vs $${previous.toFixed(2)} sem. préc.`);
    return { alert: true, dropPct, current, previous };
  }

  return { alert: false, dropPct, current, previous };
}

// ─── [184] MÉMO FINANCIER VOCAL ───────────────────────────────────────────────

async function generateVoiceMemo(tenantId = 'kadio') {
  const maintenance = require('./maintenance');
  const pool = maintenance.getPool();

  // Chiffres du jour
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  let todayNet = 0, todayGross = 0, todayTxCount = 0, todayTips = 0;
  if (pool) {
    const r = await pool.query(`
      SELECT SUM(amount_net) AS net, SUM(amount_gross) AS gross,
             COUNT(*) AS cnt, SUM(amount_tip) AS tips
      FROM tenant_ledgers
      WHERE tenant_id = $1 AND timestamp_utc >= $2 AND refunded = FALSE
    `, [tenantId, today.toISOString()]).catch(() => ({ rows: [{}] }));
    todayNet    = parseFloat(r.rows[0]?.net   || 0);
    todayGross  = parseFloat(r.rows[0]?.gross || 0);
    todayTxCount = parseInt(r.rows[0]?.cnt   || 0);
    todayTips   = parseFloat(r.rows[0]?.tips  || 0);
  }

  // Semaine courante
  const weekStart = new Date(today);
  weekStart.setDate(today.getDate() - today.getDay());
  let weekNet = 0;
  if (pool) {
    const r = await pool.query(`
      SELECT SUM(amount_net) AS net FROM tenant_ledgers
      WHERE tenant_id = $1 AND timestamp_utc >= $2 AND refunded = FALSE
    `, [tenantId, weekStart.toISOString()]).catch(() => ({ rows: [{}] }));
    weekNet = parseFloat(r.rows[0]?.net || 0);
  }

  const panierMoyen = todayTxCount > 0 ? fiscal.roundCents(todayNet / todayTxCount) : 0;
  const dayName = ['dimanche','lundi','mardi','mercredi','jeudi','vendredi','samedi'][today.getDay()];

  // [184] Rédigé sans jargon — prêt pour lecture vocale (Polly/ElevenLabs)
  const memo = [
    `Bonjour. Voici votre rapport financier pour ce ${dayName}.`,
    todayTxCount > 0
      ? `Aujourd'hui, ${todayTxCount} transaction${todayTxCount > 1 ? 's' : ''} ont été enregistrée${todayTxCount > 1 ? 's' : ''}, pour un chiffre d'affaires net de ${todayNet.toFixed(2)} dollars canadiens.`
      : `Aucune transaction enregistrée aujourd'hui pour le moment.`,
    panierMoyen > 0 ? `Le panier moyen de la journée est de ${panierMoyen.toFixed(2)} dollars.` : '',
    todayTips > 0 ? `Les pourboires du jour s'élèvent à ${todayTips.toFixed(2)} dollars, non inclus dans le chiffre d'affaires.` : '',
    weekNet > 0 ? `Cette semaine, le cumul des revenus nets atteint ${weekNet.toFixed(2)} dollars.` : '',
    `Fin du rapport. Bonne journée.`,
  ].filter(Boolean).join(' ');

  return { memo, todayNet, todayGross, todayTxCount, todayTips, weekNet, panierMoyen };
}

// ─── [185] GESTION REMBOURSEMENTS ────────────────────────────────────────────

async function processRefund(txId, refundAmount, reason = '') {
  const maintenance = require('./maintenance');
  const pool = maintenance.getPool();
  if (!pool) return { error: 'DB indisponible' };

  // Récupérer la transaction originale
  const orig = await pool.query(
    `SELECT * FROM tenant_ledgers WHERE tx_id = $1 LIMIT 1`, [txId]
  ).catch(() => ({ rows: [] }));

  if (!orig.rows[0]) return { error: `Transaction ${txId} introuvable` };
  const tx = orig.rows[0];

  // Montant réel du remboursement (max = montant original)
  const refAmt   = Math.min(refundAmount, parseFloat(tx.amount_gross));
  const province = tx.province_code || 'QC';

  // [185] Recalcul fiscal du remboursement
  const refFiscal = fiscal.decomposeFromGross(refAmt, province);

  // Marquer la transaction comme remboursée (partiel ou total)
  const isPartial = refAmt < parseFloat(tx.amount_gross);
  await pool.query(`
    UPDATE tenant_ledgers
    SET refunded = TRUE,
        refund_amount = $1,
        refund_at     = NOW(),
        refund_reason = $2,
        metadata = metadata || $3
    WHERE tx_id = $4
  `, [
    refAmt, reason,
    JSON.stringify({ refunded: true, refundAmt: refAmt, partial: isPartial }),
    txId,
  ]).catch(() => {});

  // Insérer une ligne de correction (écriture inversée) dans le ledger
  const refTxId = `refund_${txId}_${Date.now()}`;
  await pool.query(`
    INSERT INTO tenant_ledgers (
      tenant_id, tx_id, source, amount_gross, currency, payment_mode,
      timestamp_utc, sale_type, amount_net, amount_tps, amount_tvq,
      province_code, tax_label, refunded, metadata
    ) VALUES ($1,$2,$3,$4,$5,$6,NOW(),$7,$8,$9,$10,$11,$12,TRUE,$13)
    ON CONFLICT (tx_id) DO NOTHING
  `, [
    tx.tenant_id, refTxId, tx.source,
    -refAmt, tx.currency, tx.payment_mode,
    tx.sale_type,
    -refFiscal.amount_net, -refFiscal.amount_tps, -refFiscal.amount_tvq,
    province, refFiscal.taxProfile.label,
    JSON.stringify({ original_tx_id: txId, reason }),
  ]).catch(() => {});

  bus.system(`💸 Remboursement: ${txId} → -$${refAmt.toFixed(2)} | TPS: -$${refFiscal.amount_tps} | TVQ: -$${refFiscal.amount_tvq}`);

  return {
    txId, refTxId, refundAmount: refAmt,
    fiscal: { net: -refFiscal.amount_net, tps: -refFiscal.amount_tps, tvq: -refFiscal.amount_tvq },
    isPartial,
  };
}

// ─── [186] RAPPORT HEBDOMADAIRE + CRON DIMANCHE 23h59 ────────────────────────

async function generateWeeklyReport(tenantId = 'kadio') {
  const maintenance = require('./maintenance');
  const pool = maintenance.getPool();

  const weekEnd   = new Date();
  const weekStart = new Date(weekEnd);
  weekStart.setDate(weekEnd.getDate() - 7);

  let stats = { net: 0, gross: 0, tps: 0, tvq: 0, txCount: 0, tips: 0, refunds: 0, flagged: 0 };

  if (pool) {
    const r = await pool.query(`
      SELECT
        SUM(amount_net)   AS net,
        SUM(amount_gross) AS gross,
        SUM(amount_tps)   AS tps,
        SUM(amount_tvq)   AS tvq,
        COUNT(*)          AS cnt,
        SUM(amount_tip)   AS tips,
        SUM(CASE WHEN refunded THEN ABS(amount_gross) ELSE 0 END) AS refunds,
        COUNT(*) FILTER (WHERE audit_status='flagged') AS flagged
      FROM tenant_ledgers
      WHERE tenant_id = $1 AND timestamp_utc BETWEEN $2 AND $3
    `, [tenantId, weekStart.toISOString(), weekEnd.toISOString()]).catch(() => ({ rows: [{}] }));

    if (r.rows[0]) {
      stats.net    = parseFloat(r.rows[0].net    || 0);
      stats.gross  = parseFloat(r.rows[0].gross  || 0);
      stats.tps    = parseFloat(r.rows[0].tps    || 0);
      stats.tvq    = parseFloat(r.rows[0].tvq    || 0);
      stats.txCount = parseInt(r.rows[0].cnt     || 0);
      stats.tips   = parseFloat(r.rows[0].tips   || 0);
      stats.refunds = parseFloat(r.rows[0].refunds || 0);
      stats.flagged = parseInt(r.rows[0].flagged  || 0);
    }

    // Archive — marquer les transactions de la semaine comme archived
    await pool.query(`
      UPDATE tenant_ledgers
      SET metadata = metadata || '{"archived": true}'
      WHERE tenant_id = $1
        AND timestamp_utc BETWEEN $2 AND $3
        AND audit_status = 'ok'
        AND NOT (metadata->>'archived')::boolean IS TRUE
    `, [tenantId, weekStart.toISOString(), weekEnd.toISOString()]).catch(() => {});
  }

  const report = {
    tenantId,
    week:    { start: weekStart.toISOString().split('T')[0], end: weekEnd.toISOString().split('T')[0] },
    stats,
    panierMoyen: stats.txCount > 0 ? fiscal.roundCents(stats.net / stats.txCount) : 0,
    generatedAt: new Date().toISOString(),
    reportType: 'weekly',
  };

  // Journal de sécurité [186]
  if (pool) {
    await pool.query(`
      INSERT INTO daleba_notes (category, key, content, created_at)
      VALUES ('weekly_report', $1, $2, NOW())
    `, [`report_${tenantId}_${report.week.end}`, JSON.stringify(report)]).catch(() => {});
  }

  bus.system(`📊 Rapport hebdo archivé: ${tenantId} | CA net: $${stats.net.toFixed(2)} | ${stats.txCount} tx`);
  return report;
}

function startWeeklyReportScheduler(tenantId = 'kadio') {
  function msUntilSunday2359() {
    const now  = new Date();
    const next = new Date(now);
    // Trouver le prochain dimanche
    const daysUntilSunday = (7 - now.getDay()) % 7 || 7;
    next.setDate(now.getDate() + daysUntilSunday);
    next.setHours(23, 59, 0, 0);
    if (next <= now) next.setDate(next.getDate() + 7);
    return next - now;
  }

  function scheduleNext() {
    const delay = msUntilSunday2359();
    console.log(`[TaxDigest] Rapport hebdo planifié dans ${Math.round(delay / 3600000)}h (dim. 23h59)`);
    setTimeout(async () => {
      await generateWeeklyReport(tenantId).catch(e => console.error('[TaxDigest] Weekly report:', e.message));
      scheduleNext();
    }, delay);
  }

  scheduleNext();
}

// ─── EXPORTS ─────────────────────────────────────────────────────────────────

module.exports = {
  generateTaxDigest, detectWeeklyDrop, generateVoiceMemo,
  processRefund, generateWeeklyReport, startWeeklyReportScheduler,
};
