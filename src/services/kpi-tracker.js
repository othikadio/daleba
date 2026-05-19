'use strict';
/**
 * KPI Tracker — DALEBA Metacortex Points 338-339
 * [338] Suivi des objectifs de vente individuels
 * [339] SMS félicitations + badge HUD si objectif atteint avant échéance
 */
const bus = require('./event-bus');

async function initSchema(pool) {
  if (!pool) return;
  await pool.query(`
    CREATE TABLE IF NOT EXISTS staff_kpi_targets (
      id              SERIAL PRIMARY KEY,
      tenant_id       TEXT NOT NULL,
      employee_square_id TEXT NOT NULL,
      period_label    TEXT NOT NULL,   -- ex: '2026-05'
      target_ca       NUMERIC(10,2),   -- objectif CA
      target_clients  INTEGER,         -- objectif nb clients
      achieved_ca     NUMERIC(10,2) DEFAULT 0,
      achieved_clients INTEGER DEFAULT 0,
      badge_awarded   BOOL DEFAULT false,
      notified_at     TIMESTAMPTZ,
      created_at      TIMESTAMPTZ DEFAULT NOW(),
      UNIQUE(tenant_id, employee_square_id, period_label)
    )
  `).catch(() => {});
}

/**
 * [338] Mettre à jour la progression d'un employé
 */
async function updateProgress(pool, tenantId, employeeSquareId, periodLabel, { achievedCA, achievedClients }) {
  await initSchema(pool);
  await pool.query(`
    INSERT INTO staff_kpi_targets (tenant_id, employee_square_id, period_label, achieved_ca, achieved_clients)
    VALUES ($1,$2,$3,$4,$5)
    ON CONFLICT (tenant_id, employee_square_id, period_label)
    DO UPDATE SET achieved_ca=$4, achieved_clients=$5
  `, [tenantId, employeeSquareId, periodLabel, achievedCA, achievedClients]);
}

/**
 * [339] Vérifie si un employé a atteint son objectif et déclenche la récompense
 */
async function checkAndReward(pool, tenantId, employeeSquareId) {
  await initSchema(pool);
  const periodLabel = new Date().toISOString().slice(0, 7);

  const r = await pool.query(`
    SELECT k.*, sp.name, sp.phone, sp.commission_service
    FROM staff_kpi_targets k
    JOIN staff_profiles sp ON sp.tenant_id=k.tenant_id AND sp.square_id=k.employee_square_id
    WHERE k.tenant_id=$1 AND k.employee_square_id=$2 AND k.period_label=$3
  `, [tenantId, employeeSquareId, periodLabel]).catch(() => ({ rows: [] }));

  const kpi = r.rows[0];
  if (!kpi || kpi.badge_awarded) return null; // déjà récompensé

  const hitCA      = kpi.target_ca && parseFloat(kpi.achieved_ca) >= parseFloat(kpi.target_ca);
  const hitClients = kpi.target_clients && parseInt(kpi.achieved_clients) >= parseInt(kpi.target_clients);

  if (hitCA || hitClients) {
    // Badge sur HUD
    await pool.query(`
      UPDATE staff_kpi_targets SET badge_awarded=true, notified_at=NOW()
      WHERE tenant_id=$1 AND employee_square_id=$2 AND period_label=$3
    `, [tenantId, employeeSquareId, periodLabel]).catch(() => {});

    // [339] SMS félicitations
    const notifier = require('./staff-notifier');
    if (kpi.phone) {
      const msg = `🏆 ${kpi.name?.split(' ')[0]}, félicitations ! Tu as atteint ton objectif ${hitCA ? `de CA (${kpi.achieved_ca} CAD)` : `de ${kpi.achieved_clients} clients`} avant la fin du mois. Bravo, continuer comme ça !`;
      await notifier.notifyStaff({
        staffPhone: kpi.phone,
        staffName: kpi.name?.split(' ')[0],
        eventType: 'GOAL_REACHED',
        clientName: '',
        service: msg,
        startAt: new Date().toISOString(),
      }).catch(() => {});
    }

    bus.system(`[KPI] 🏆 Objectif atteint: ${kpi.name} — badge accordé`);
    return { rewarded: true, name: kpi.name, periodLabel, hitCA, hitClients };
  }

  return { rewarded: false };
}

async function setTarget(pool, tenantId, employeeSquareId, periodLabel, { targetCA, targetClients }) {
  await initSchema(pool);
  await pool.query(`
    INSERT INTO staff_kpi_targets (tenant_id, employee_square_id, period_label, target_ca, target_clients)
    VALUES ($1,$2,$3,$4,$5)
    ON CONFLICT (tenant_id, employee_square_id, period_label)
    DO UPDATE SET target_ca=$4, target_clients=$5
  `, [tenantId, employeeSquareId, periodLabel, targetCA, targetClients]);
}

async function getTeamKPIs(pool, tenantId) {
  await initSchema(pool);
  const periodLabel = new Date().toISOString().slice(0, 7);
  const r = await pool.query(`
    SELECT k.*, sp.name
    FROM staff_kpi_targets k
    JOIN staff_profiles sp ON sp.tenant_id=k.tenant_id AND sp.square_id=k.employee_square_id
    WHERE k.tenant_id=$1 AND k.period_label=$2
    ORDER BY (k.achieved_ca / NULLIF(k.target_ca, 0)) DESC NULLS LAST
  `, [tenantId, periodLabel]).catch(() => ({ rows: [] }));
  return r.rows;
}

module.exports = { initSchema, updateProgress, checkAndReward, setTarget, getTeamKPIs };
