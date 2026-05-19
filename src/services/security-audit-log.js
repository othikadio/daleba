'use strict';
/**
 * Security Audit Log — DALEBA Metacortex Point 330
 * Chaque modification HUD (planning, commission) signée par admin Ulrich
 * et loguée dans le journal de sécurité.
 */
const bus = require('./event-bus');

const ULRICH_ADMIN_ID = 'ulrich_kadio_ehouman'; // ID admin signataire

async function initSchema(pool) {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS security_audit_log (
      id          SERIAL PRIMARY KEY,
      tenant_id   TEXT NOT NULL,
      admin_id    TEXT NOT NULL,
      action      TEXT NOT NULL,  -- ex: 'UPDATE_COMMISSION', 'BLOCK_SCHEDULE'
      target_type TEXT,           -- 'employee' | 'schedule' | 'payout'
      target_id   TEXT,
      old_value   JSONB,
      new_value   JSONB,
      ip_address  TEXT,
      signed_at   TIMESTAMPTZ DEFAULT NOW()
    )
  `).catch(() => {});
}

/**
 * [330] Enregistre une action admin dans le journal de sécurité
 */
async function logAdminAction(pool, { tenantId, adminId = ULRICH_ADMIN_ID, action, targetType, targetId, oldValue, newValue, ipAddress }) {
  await initSchema(pool);

  await pool.query(`
    INSERT INTO security_audit_log (tenant_id, admin_id, action, target_type, target_id, old_value, new_value, ip_address)
    VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
  `, [
    tenantId,
    adminId,
    action,
    targetType || null,
    targetId   || null,
    oldValue   ? JSON.stringify(oldValue)  : null,
    newValue   ? JSON.stringify(newValue)  : null,
    ipAddress  || null,
  ]);

  bus.system(`[AuditLog] ${action} | admin=${adminId} | ${targetType}:${targetId}`);
  return { logged: true, action, adminId, signedAt: new Date().toISOString() };
}

/**
 * Middleware Express qui auto-log les actions admin sur les routes staff
 */
function auditMiddleware(action, targetType) {
  return async (req, res, next) => {
    const oldSend = res.json.bind(res);
    res.json = function(data) {
      if (data?.success !== false) {
        const { pool } = require('../memory/db');
        const tenantId = req.user?.tenantId || req.query.tenantId || 'kadio';
        logAdminAction(pool, {
          tenantId,
          adminId:    req.user?.id || ULRICH_ADMIN_ID,
          action,
          targetType,
          targetId:   req.params?.squareId || req.body?.employeeId,
          oldValue:   null,
          newValue:   req.body || {},
          ipAddress:  req.ip,
        }).catch(() => {});
      }
      return oldSend(data);
    };
    next();
  };
}

async function getAuditLog(pool, tenantId, { limit = 50, action } = {}) {
  const params = [tenantId];
  let sql = `SELECT * FROM security_audit_log WHERE tenant_id=$1`;
  if (action) { params.push(action); sql += ` AND action=$${params.length}`; }
  sql += ` ORDER BY signed_at DESC LIMIT $${params.length + 1}`;
  params.push(limit);
  return pool.query(sql, params).then(r => r.rows).catch(() => []);
}

module.exports = { initSchema, logAdminAction, auditMiddleware, getAuditLog, ULRICH_ADMIN_ID };
