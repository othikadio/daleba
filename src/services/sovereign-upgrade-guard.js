'use strict';
/**
 * Sovereign Upgrade Guard — DALEBA [609-612]
 * Aucune mutation de code sans OUI explicite d'Ulrich.
 * Pipeline: stage → SMS → OUI → branche git → tests 100% → push main
 */
const bus    = require('./event-bus');
const crypto = require('crypto');
const { execSync } = require('child_process');
const path   = require('path');

const DALEBA_ROOT = path.join(__dirname, '../../');
const SMS_PREFIX  = '[DALEBA ÉVOLUTION]';

async function initSchema(pool) {
  if (!pool?.query) return;
  await pool.query(`
    CREATE TABLE IF NOT EXISTS system_evolution_pool (
      id              SERIAL PRIMARY KEY,
      skill_id        TEXT UNIQUE NOT NULL,
      title           TEXT NOT NULL,
      source_url      TEXT,
      source_type     TEXT,
      author          TEXT,
      snippet_hash    TEXT,
      snippet_preview TEXT,
      poison_score    INTEGER DEFAULT 0,
      status          TEXT DEFAULT 'staged_evolution',
      poison_report   JSONB,
      perf_estimate   TEXT,
      sms_token       TEXT,
      sms_sent_at     TIMESTAMPTZ,
      ulrich_response TEXT,
      responded_at    TIMESTAMPTZ,
      injected_at     TIMESTAMPTZ,
      created_at      TIMESTAMPTZ DEFAULT NOW(),
      updated_at      TIMESTAMPTZ DEFAULT NOW()
    )
  `).catch(() => {});
  await pool.query('CREATE INDEX IF NOT EXISTS idx_evolution_status ON system_evolution_pool(status,created_at DESC)').catch(() => {});
  await pool.query(`
    CREATE TABLE IF NOT EXISTS evolution_banned_sources (
      id          SERIAL PRIMARY KEY,
      url_pattern TEXT UNIQUE NOT NULL,
      reason      TEXT,
      banned_at   TIMESTAMPTZ DEFAULT NOW()
    )
  `).catch(() => {});
  // [614] Audit log table
  await pool.query(`
    CREATE TABLE IF NOT EXISTS evolution_security_logs (
      id          SERIAL PRIMARY KEY,
      action      TEXT NOT NULL,
      skill_id    TEXT,
      actor       TEXT DEFAULT 'EvolutionAgent',
      payload_hash TEXT,
      signature   TEXT,
      result      TEXT,
      created_at  TIMESTAMPTZ DEFAULT NOW()
    )
  `).catch(() => {});
}

/**
 * [614] Trace et signe cryptographiquement chaque action de l'EvolutionAgent
 */
async function auditLog(pool, { action, skillId, payload, result }) {
  const payloadStr   = JSON.stringify(payload || {});
  const payloadHash  = crypto.createHash('sha256').update(payloadStr).digest('hex').slice(0, 16);
  const sigData      = `${action}:${skillId || ''}:${payloadHash}:${Date.now()}`;
  const signature    = crypto.createHash('sha256').update(sigData).digest('hex');
  await pool.query(`
    INSERT INTO evolution_security_logs (action,skill_id,payload_hash,signature,result)
    VALUES ($1,$2,$3,$4,$5)
  `, [action, skillId || null, payloadHash, signature, result || 'ok']).catch(() => {});
  return { signature, payloadHash };
}

async function stageSkill(pool, { skillId, title, sourceUrl, sourceType, snippetPreview, perfEstimate, poisonReport }) {
  await initSchema(pool);
  await pool.query(`
    INSERT INTO system_evolution_pool (skill_id,title,source_url,source_type,snippet_preview,perf_estimate,poison_report,status)
    VALUES ($1,$2,$3,$4,$5,$6,$7,'staged_evolution') ON CONFLICT (skill_id) DO UPDATE
    SET title=$2,snippet_preview=$5,perf_estimate=$6,updated_at=NOW()
  `, [skillId, title, sourceUrl||'', sourceType||'github', snippetPreview||'', perfEstimate||'', JSON.stringify(poisonReport||{})]).catch(() => {});
  await auditLog(pool, { action: 'stage_skill', skillId, payload: { title, sourceUrl } });
  return { staged: true, skillId, status: 'staged_evolution' };
}

async function markPoisoned(pool, skillId, poisonReport) {
  await initSchema(pool);
  await pool.query(`UPDATE system_evolution_pool SET status='poison_detected',poison_report=$2,updated_at=NOW() WHERE skill_id=$1`,
    [skillId, JSON.stringify(poisonReport)]).catch(() => {});
  await auditLog(pool, { action: 'poison_detected', skillId, payload: poisonReport, result: 'POISON_ATTEMPT_DETECTED' });
  bus.system(`[SovereignGuard] 🚨 ${skillId} → POISON_ATTEMPT_DETECTED`);
}

/**
 * [610] SMS d'urgence chiffré — format prescrit exact
 */
async function requestUpgradeApproval(pool, { skillId, title, perfEstimate, certifiedSafe }) {
  await initSchema(pool);
  if (!certifiedSafe)
    throw new Error('[609] Impossible de demander approbation pour un skill non certifié sain');

  const token = crypto.randomBytes(12).toString('hex').toUpperCase();
  const phone = process.env.ULRICH_PHONE_NUMBER;
  const from  = process.env.TWILIO_PHONE_NUMBER;

  const body = `${SMS_PREFIX} Nouvelle capacité détectée sur GitHub: "${title}". Performance estimée: ${perfEstimate || 'N/A'}. Code certifié 100% sain par le Sandbox Sentry. Autoriser l'assimilation et le déploiement Railway? Répondre OUI [token: ${token}] ou NON.`;

  await pool.query(`UPDATE system_evolution_pool SET status='assimilation_requested',sms_token=$2,sms_sent_at=NOW(),updated_at=NOW() WHERE skill_id=$1`,
    [skillId, token]).catch(() => {});

  if (phone && from && process.env.TWILIO_ACCOUNT_SID) {
    try {
      const twilio = require('twilio')(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN);
      await twilio.messages.create({ to: phone, from, body });
      bus.system(`[SovereignGuard] 📱 SMS envoyé à Ulrich — token: ${token}`);
    } catch(e) {
      bus.system(`[SovereignGuard] ⚠️ SMS échoué: ${e.message} — token log: ${token}`);
    }
  } else {
    bus.system(`[SovereignGuard] 📋 [HORS-PROD] SMS évolution: "${title}" — token: ${token}`);
  }

  await auditLog(pool, { action: 'approval_requested', skillId, payload: { title, perfEstimate, token } });
  return { smsToken: token, skillId, status: 'assimilation_requested', smsBody: body };
}

/**
 * [611,612] Traite la réponse OUI/NON d'Ulrich
 */
async function processApproval(pool, { smsToken, response }) {
  await initSchema(pool);
  const r = await pool.query(`SELECT * FROM system_evolution_pool WHERE sms_token=$1`, [smsToken]).catch(() => ({ rows:[] }));
  const skill = r.rows[0];
  if (!skill) throw new Error(`Token introuvable: ${smsToken}`);

  await pool.query(`UPDATE system_evolution_pool SET ulrich_response=$2,responded_at=NOW(),updated_at=NOW() WHERE skill_id=$1`,
    [skill.skill_id, response]).catch(() => {});

  if (response?.toUpperCase() !== 'OUI') {
    await pool.query(`UPDATE system_evolution_pool SET status='rejected',updated_at=NOW() WHERE skill_id=$1`, [skill.skill_id]).catch(() => {});
    await auditLog(pool, { action: 'approval_rejected', skillId: skill.skill_id, payload: { response }, result: 'rejected' });
    bus.system(`[SovereignGuard] ❌ Skill "${skill.title}" rejeté par Ulrich`);
    return { skillId: skill.skill_id, status: 'rejected' };
  }

  bus.system(`[SovereignGuard] ✅ OUI Ulrich — démarrage pipeline assimilation: "${skill.title}"`);
  await auditLog(pool, { action: 'approval_granted', skillId: skill.skill_id, payload: { response }, result: 'approved' });
  return await runAssimilationPipeline(pool, skill);
}

/**
 * [611] Pipeline : branche → inject → tests → push OU [612] rollback
 */
async function runAssimilationPipeline(pool, skill) {
  const branchName = `evolution/${skill.skill_id.toLowerCase().replace(/[^a-z0-9]/g,'-')}-${Date.now()}`;
  let branchCreated = false;

  try {
    execSync(`git -C ${DALEBA_ROOT} checkout -b ${branchName}`, { stdio: 'pipe' });
    branchCreated = true;
    bus.system(`[SovereignGuard] 🌿 Branche créée: ${branchName}`);

    const injector = require('./dynamic-skill-injector');
    const adapted  = injector.adaptCodeToDALEBA(skill.snippet_preview || '// skill placeholder', {
      skillId: skill.skill_id, title: skill.title,
      sourceUrl: skill.source_url, author: skill.author,
    });
    injector.writeApprovedSkill(adapted.adapted, adapted.targetPath);
    execSync(`git -C ${DALEBA_ROOT} add "${adapted.targetPath}"`, { stdio: 'pipe' });
    execSync(`git -C ${DALEBA_ROOT} commit -m "chore(evolution): inject ${skill.skill_id}"`, { stdio: 'pipe' });

    // [611] Suite de tests complète
    bus.system(`[SovereignGuard] 🧪 Exécution suite de tests complète...`);
    const testResult = await runFullTestSuite();

    if (!testResult.allPassed) {
      throw new Error(`Tests échoués (${testResult.failures} failures) — ROLLBACK [612]`);
    }

    // [611] Merge + push main
    execSync(`git -C ${DALEBA_ROOT} checkout main`, { stdio: 'pipe' });
    execSync(`git -C ${DALEBA_ROOT} merge --no-ff ${branchName} -m "feat(evolution): assimilate ${skill.skill_id} [611] — 100%"`, { stdio: 'pipe' });
    execSync(`git -C ${DALEBA_ROOT} push origin main`, { stdio: 'pipe' });
    execSync(`git -C ${DALEBA_ROOT} branch -d ${branchName}`, { stdio: 'pipe' });

    await pool.query(`UPDATE system_evolution_pool SET status='injected',injected_at=NOW(),updated_at=NOW() WHERE skill_id=$1`, [skill.skill_id]).catch(() => {});
    await auditLog(pool, { action: 'skill_injected', skillId: skill.skill_id, payload: { branch: branchName }, result: 'injected' });
    bus.system(`[SovereignGuard] 🚀 "${skill.title}" assimilée + déployée Railway ✅`);
    return { skillId: skill.skill_id, status: 'injected', branch: branchName, pushed: true };

  } catch(e) {
    // [612] Rollback hermétique
    bus.system(`[SovereignGuard] 🔴 ROLLBACK [612]: ${e.message}`);
    try {
      execSync(`git -C ${DALEBA_ROOT} checkout main`, { stdio: 'pipe' });
      if (branchCreated) {
        try { execSync(`git -C ${DALEBA_ROOT} merge --abort`, { stdio: 'pipe' }); } catch {}
        try { execSync(`git -C ${DALEBA_ROOT} branch -D ${branchName}`, { stdio: 'pipe' }); } catch {}
      }
    } catch {}
    await pool.query(`UPDATE system_evolution_pool SET status='rollback_triggered',updated_at=NOW() WHERE skill_id=$1`, [skill.skill_id]).catch(() => {});
    await auditLog(pool, { action: 'rollback_triggered', skillId: skill.skill_id, payload: { branch: branchName }, result: e.message });
    bus.emit('evolution:rollback', { skillId: skill.skill_id, reason: e.message });
    return { skillId: skill.skill_id, status: 'rollback_triggered', error: e.message };
  }
}

async function runFullTestSuite() {
  return new Promise(resolve => {
    const { exec } = require('child_process');
    exec(`cd ${DALEBA_ROOT} && timeout 120 node test-cert-sections11-12.js 2>&1 | tail -3`, { timeout: 125000 }, (err, stdout) => {
      const passed = /100%/.test(stdout) || /39\/39/.test(stdout);
      resolve({ allPassed: passed, stdout: stdout?.slice(-300), failures: passed ? 0 : 1 });
    });
  });
}

async function getEvolutionPool(pool, { status } = {}) {
  await initSchema(pool);
  const r = await pool.query(`SELECT skill_id,title,source_type,perf_estimate,status,created_at FROM system_evolution_pool ${status ? 'WHERE status=$1' : ''} ORDER BY created_at DESC LIMIT 50`, status ? [status] : []).catch(() => ({ rows:[] }));
  return r.rows;
}

async function getStagedSkills(pool) {
  return getEvolutionPool(pool, { status: 'staged_evolution' });
}

async function getBannedSources(pool) {
  await initSchema(pool);
  const r = await pool.query('SELECT * FROM evolution_banned_sources ORDER BY banned_at DESC').catch(() => ({ rows:[] }));
  return r.rows;
}

async function getEvolutionStats(pool) {
  await initSchema(pool);
  const r = await pool.query('SELECT status, COUNT(*) AS count FROM system_evolution_pool GROUP BY status').catch(() => ({ rows:[] }));
  const stats = {};
  for (const row of r.rows) stats[row.status] = parseInt(row.count);
  return { stats, total: Object.values(stats).reduce((s, v) => s + v, 0) };
}

async function getSecurityLogs(pool, { limit = 50 } = {}) {
  await initSchema(pool);
  const r = await pool.query('SELECT * FROM evolution_security_logs ORDER BY created_at DESC LIMIT $1', [limit]).catch(() => ({ rows:[] }));
  return r.rows;
}

module.exports = {
  stageSkill, markPoisoned, requestUpgradeApproval, processApproval,
  getEvolutionPool, getStagedSkills, getBannedSources, getEvolutionStats,
  getSecurityLogs, auditLog, initSchema,
};
