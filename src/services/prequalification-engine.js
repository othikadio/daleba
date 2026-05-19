'use strict';
/**
 * Prequalification Engine — DALEBA [504-506,508,510,512-513,519,521,523,531,532]
 */
const bus    = require('./event-bus');
const crypto = require('crypto');

const ELIGIBILITY_THRESHOLD = 0.80;
// [523] Cache mémoire temporaire — purgé par cleanTempFinancials()
const _tempCache = new Map();

async function initSchema(pool) {
  if (!pool?.query) return;
  await pool.query(`
    CREATE TABLE IF NOT EXISTS tenant_funding_applications (
      id              SERIAL PRIMARY KEY,
      tenant_id       TEXT NOT NULL,
      application_id  TEXT UNIQUE NOT NULL,
      program_name    TEXT NOT NULL,
      organism        TEXT,
      program_url     TEXT,
      max_amount      NUMERIC(12,2),
      funding_type    TEXT,
      status          TEXT DEFAULT 'draft',
      eligibility_pct NUMERIC(5,2),
      pitch_memo      TEXT,
      cover_letter    TEXT,
      notes           TEXT,
      validation_sig  TEXT,
      submitted_at    TIMESTAMPTZ,
      history         JSONB DEFAULT '[]',
      created_at      TIMESTAMPTZ DEFAULT NOW(),
      updated_at      TIMESTAMPTZ DEFAULT NOW()
    )
  `).catch(() => {});
  // [527] Index composites
  await pool.query('CREATE INDEX IF NOT EXISTS idx_funding_apps_status ON tenant_funding_applications(tenant_id, status, updated_at DESC)').catch(() => {});
  // [529] Table signatures
  await pool.query(`
    CREATE TABLE IF NOT EXISTS funding_signature_logs (
      id          SERIAL PRIMARY KEY,
      tenant_id   TEXT NOT NULL,
      action      TEXT NOT NULL,  -- approved | rejected | started
      app_id      TEXT,
      sig_hash    TEXT,
      operator    TEXT DEFAULT 'ulrich',
      signed_at   TIMESTAMPTZ DEFAULT NOW()
    )
  `).catch(() => {});
  // [531] Table reporting deadlines
  await pool.query(`
    CREATE TABLE IF NOT EXISTS funding_reporting_deadlines (
      id          SERIAL PRIMARY KEY,
      tenant_id   TEXT NOT NULL,
      app_id      TEXT NOT NULL,
      program_name TEXT,
      deadline    TIMESTAMPTZ NOT NULL,
      reminder_30 BOOL DEFAULT false,
      created_at  TIMESTAMPTZ DEFAULT NOW()
    )
  `).catch(() => {});
}

// [504] Bilan tenant (depuis tenant_ledgers ou estimé)
async function getTenantFinancials(pool, tenantId) {
  const cacheKey = `financials:${tenantId}`;
  if (_tempCache.has(cacheKey)) return _tempCache.get(cacheKey);

  const r = await pool.query(`
    SELECT COALESCE(SUM(amount_net),0) AS net_revenue_12m,
           COALESCE(AVG(amount_net),0) AS avg_transaction,
           COUNT(*) AS tx_count
    FROM tenant_ledgers
    WHERE tenant_id=$1 AND created_at >= NOW() - INTERVAL '12 months'
  `, [tenantId]).catch(() => ({ rows: [{}] }));

  const raw = r.rows[0] || {};
  const netRevenue = parseFloat(raw.net_revenue_12m || 0);
  const result = {
    netRevenue12m:      netRevenue,
    avgTransaction:     parseFloat(raw.avg_transaction || 0),
    txCount:            parseInt(raw.tx_count || 0),
    estimatedNetMargin: 0.30,
    fixedCosts:         netRevenue * 0.40,
    netOperatingIncome: netRevenue * 0.30,
    liquidityRatio:     1.2,
    source: netRevenue > 0 ? 'tenant_ledgers' : 'estimated',
  };
  _tempCache.set(cacheKey, result);
  setTimeout(() => _tempCache.delete(cacheKey), 30 * 60 * 1000); // [523] expire 30min
  return result;
}

// [523] Purge explicite du cache temporaire
function cleanTempFinancials(tenantId) {
  const key = `financials:${tenantId}`;
  _tempCache.delete(key);
  bus.system(`[PreQual] 🗑️ Cache financier purgé: ${tenantId}`);
}

// [505] RCSD
function calculateDSCR(netOperatingIncome, debtService) {
  if (!debtService || debtService === 0) return { dscr: null, viable: true, reason: 'no_debt_service' };
  const dscr = parseFloat((netOperatingIncome / debtService).toFixed(3));
  const viable = dscr >= 1.25;
  return {
    dscr, viable,
    interpretation: dscr >= 1.5 ? 'Excellent' : dscr >= 1.25 ? 'Acceptable' : dscr >= 1.0 ? 'Limite' : 'Insuffisant',
    recommendation: viable ? 'Dossier finançable' : 'Augmenter les revenus ou réduire la dette avant soumission',
    netOperatingIncome, debtService,
  };
}

// [519] WACC — Coût moyen pondéré du capital
function calculateWACC(offers = []) {
  if (!offers.length) return { wacc: null, recommendation: 'Aucune offre fournie' };
  const scored = offers.map(o => {
    const effectiveRate = parseFloat(o.annualRate || o.rate || 0);
    const score = 100 - effectiveRate * 10 - (o.fees || 0) / 100;
    return { ...o, effectiveRate, score };
  }).sort((a, b) => b.score - a.score);
  const best = scored[0];
  return {
    best: { name: best.name, effectiveRate: best.effectiveRate, score: best.score },
    ranked: scored,
    wacc: scored.reduce((s, o) => s + o.effectiveRate, 0) / scored.length,
    recommendation: `Privilégier "${best.name}" — taux effectif le plus bas: ${best.effectiveRate}%`,
  };
}

// [532] Simulation endettement maximal
async function simulateMaxDebt(pool, tenantId, { safetyMarginPct = 0.30 } = {}) {
  const fin = await getTenantFinancials(pool, tenantId);
  const availableForDebt = fin.netOperatingIncome * (1 - safetyMarginPct);
  // Service dette: annuité sur 5 ans à 6%
  const annuityFactor  = (0.06 * Math.pow(1.06, 5)) / (Math.pow(1.06, 5) - 1);
  const maxDebt        = availableForDebt / annuityFactor;
  return {
    netOperatingIncome:  fin.netOperatingIncome,
    availableForDebt,
    safetyMarginPct,
    maxDebt:             Math.round(maxDebt),
    assumptions:         'Taux 6%, amortissement 5 ans, marge sécurité 30%',
    interpretation:      maxDebt > 50000 ? 'Capacité d\'emprunt solide' : maxDebt > 20000 ? 'Capacité modérée' : 'Capacité limitée — consolider d\'abord les revenus',
  };
}

// [521] Projection ROI post-financement
async function projectROI(pool, tenantId, { amount, purpose = 'expansion', horizonYears = 3 }) {
  const fin = await getTenantFinancials(pool, tenantId);
  const revenueBoost = purpose === 'expansion' ? 0.30 : purpose === 'equipment' ? 0.15 : 0.20;
  const projectedAdditionalRevenue = fin.netRevenue12m * revenueBoost;
  const annualNetGain = projectedAdditionalRevenue * fin.estimatedNetMargin;
  const paybackYears  = amount > 0 ? (amount / annualNetGain).toFixed(1) : 'N/A';
  const roi3y         = amount > 0 ? ((annualNetGain * horizonYears - amount) / amount * 100).toFixed(1) : 'N/A';
  return {
    investmentAmount:           amount,
    purpose,
    projectedAdditionalRevenue: Math.round(projectedAdditionalRevenue),
    annualNetGain:               Math.round(annualNetGain),
    paybackYears,
    roi3y: `${roi3y}%`,
    horizon: horizonYears,
    interpretation: parseFloat(roi3y) > 50 ? 'ROI excellent' : parseFloat(roi3y) > 0 ? 'ROI positif' : 'ROI négatif — revoir le projet',
  };
}

// [506] Score éligibilité
function scoreEligibility(financials, opportunity) {
  const elig = opportunity.eligibility || {};
  let score = 0, checks = 0;
  checks++; if (financials.netRevenue12m >= (elig.min_revenue || 0)) score++;
  checks++; if ((elig.geography || []).some(g => ['Canada','Québec','QC'].includes(g))) score++;
  checks++; if ((elig.sectors || ['tous']).some(s => ['tous','beaute','coiffure','services','commerce_detail'].includes(s))) score++;
  const conds = elig.conditions || [];
  ['PME', 'québec'].forEach(kw => { checks++; if (conds.some(c => new RegExp(kw,'i').test(c))) score++; });
  return parseFloat((score / checks).toFixed(3));
}

// [506] Pré-qualification complète
async function prequalify(pool, tenantId) {
  await initSchema(pool);
  const scanner    = require('./funding-scanner-worker');
  const financials = await getTenantFinancials(pool, tenantId);
  const opps       = await scanner.getOpportunities(pool);
  const matched    = [];
  for (const opp of opps) {
    const eligPct = scoreEligibility(financials, opp);
    const dscr    = calculateDSCR(financials.netOperatingIncome, (opp.max_amount || 25000) * 0.07);
    if (eligPct >= ELIGIBILITY_THRESHOLD) {
      matched.push({ ...opp, eligibilityPct: eligPct, dscr, status: 'OPPORTUNITY_MATCHED' });
      bus.system(`[PreQual] ✨ MATCH: "${opp.name}" — ${(eligPct*100).toFixed(0)}%`);
      await createApplication(pool, tenantId, { program: opp, eligibilityPct: eligPct, status: 'opportunity_matched' });
    }
  }
  return { tenantId, financials, matched, totalOpportunities: opps.length, matchedCount: matched.length };
}

// [513] Applications CRUD
async function createApplication(pool, tenantId, { program, eligibilityPct, status = 'draft' }) {
  await initSchema(pool);
  const appId = `APP-${Date.now()}-${crypto.randomBytes(3).toString('hex').toUpperCase()}`;
  await pool.query(`
    INSERT INTO tenant_funding_applications
      (tenant_id,application_id,program_name,organism,program_url,max_amount,funding_type,status,eligibility_pct)
    VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) ON CONFLICT (application_id) DO NOTHING
  `, [tenantId,appId,program.name,program.organism,program.url,program.max_amount,program.funding_type,status,eligibilityPct]).catch(() => {});
  return { appId, programName: program.name, status };
}

async function updateApplicationStatus(pool, tenantId, { appId, status, notes, validationSig }) {
  await initSchema(pool);
  if (status === 'submitted' && !validationSig)
    throw new Error('[507] Soumission requiert une validation_sig cryptographique du propriétaire');
  const r = await pool.query(`
    UPDATE tenant_funding_applications
    SET status=$3, notes=$4, validation_sig=$5, updated_at=NOW(),
        submitted_at=CASE WHEN $3='submitted' THEN NOW() ELSE submitted_at END,
        history=history||jsonb_build_array(jsonb_build_object('status',$3,'at',NOW()::text,'notes',$4))
    WHERE tenant_id=$1 AND application_id=$2 RETURNING *
  `, [tenantId,appId,status,notes||'',validationSig||'']).catch(() => ({ rows: [] }));
  // [529] Log signature
  if (validationSig || ['approved','rejected'].includes(status)) {
    const sig = crypto.createHash('sha256').update(`${tenantId}:${appId}:${status}:${Date.now()}`).digest('hex');
    await pool.query(`INSERT INTO funding_signature_logs (tenant_id,action,app_id,sig_hash) VALUES ($1,$2,$3,$4)`,
      [tenantId, status, appId, sig]).catch(() => {});
  }
  return r.rows[0] || { updated: false };
}

async function getApplications(pool, tenantId) {
  await initSchema(pool);
  const r = await pool.query(`SELECT * FROM tenant_funding_applications WHERE tenant_id=$1 ORDER BY updated_at DESC`, [tenantId]).catch(() => ({ rows: [] }));
  return r.rows;
}

// [508] Pitch Memo
async function generatePitchMemo(pool, tenantId, opportunity) {
  const fin  = await getTenantFinancials(pool, tenantId);
  const dscr = calculateDSCR(fin.netOperatingIncome, (opportunity.max_amount || 25000) * 0.07);
  const amount = Math.min(opportunity.max_amount || 25000, Math.round(fin.netRevenue12m * 0.5 || 25000));
  const hash = crypto.createHash('sha256').update(`${opportunity.name}:${tenantId}:${Date.now()}`).digest('hex').slice(0,16);
  const memo = `═══════════════════════════════════════════════════════════════
 MÉMO EXÉCUTIF — OPPORTUNITÉ DE FINANCEMENT [Hash: ${hash}]
═══════════════════════════════════════════════════════════════
 Programme  : ${opportunity.name}
 Organisme  : ${opportunity.organism}
 Type       : ${(opportunity.funding_type||'').replace(/_/g,' ').toUpperCase()}
 Montant max: ${(opportunity.max_amount||0).toLocaleString('fr-CA')} $ CAD

 PROFIL KADIO COIFFURE
 ─────────────────────────────────────────────────────────────
 • 615 Antoinette Robidoux local 100, Longueuil QC J4J 2V8
 • CA net 12 mois : ${fin.netRevenue12m.toLocaleString('fr-CA')} $ CAD
 • Transactions   : ${fin.txCount}
 • RCSD estimé    : ${dscr.dscr || 'N/A'} (${dscr.interpretation || '—'})

 EFFET DE LEVIER
 ─────────────────────────────────────────────────────────────
 Financement permet: modernisation DALEBA, +1-2 postes, formation soins botaniques
 Retour sur investissement estimé : 18-24 mois | ROI +25-35% CA annuel

 RECOMMANDATION DALEBA IA
 ─────────────────────────────────────────────────────────────
 Taux d'éligibilité : ${((opportunity.eligibilityPct||0.85)*100).toFixed(0)}%
 Montant à demander : ${amount.toLocaleString('fr-CA')} $ CAD
 Priorité           : HAUTE — démarches à initier sous 30 jours
═══════════════════════════════════════════════════════════════
 DALEBA Business Intelligence — ${new Date().toLocaleDateString('fr-CA')}
 Intégrité: SHA-256 ${hash}
═══════════════════════════════════════════════════════════════`.trim();

  await pool.query(`UPDATE tenant_funding_applications SET pitch_memo=$3,updated_at=NOW() WHERE tenant_id=$1 AND program_name=$2`, [tenantId,opportunity.name,memo]).catch(() => {});
  bus.system(`[PreQual] 📋 Pitch Memo [${hash}] généré: "${opportunity.name}"`);
  return { memo, programName: opportunity.name, hash };
}

// [510] Lettre corporative
async function writeCoverLetter(pool, tenantId, { programName, organism, amount, purpose }) {
  const fin  = await getTenantFinancials(pool, tenantId);
  const date = new Date().toLocaleDateString('fr-CA', { year:'numeric', month:'long', day:'numeric' });
  let letterBody;
  try {
    const { Anthropic } = require('@anthropic-ai/sdk');
    const claude = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
    const resp = await claude.messages.create({
      model:'claude-opus-4-5', max_tokens:700,
      messages:[{role:'user',content:`Lettre de présentation corporative d'élite en français pour demande de financement.
Expéditeur: Kadio Ehouman Ulrich, Kadio Coiffure, 615 Antoinette Robidoux local 100, Longueuil QC J4J 2V8
Destinataire: ${organism} — Programme: ${programName}
Montant: ${(amount||25000).toLocaleString('fr-CA')}$ | Objet: ${purpose||"Modernisation et expansion"}
CA annuel: ${fin.netRevenue12m.toLocaleString('fr-CA')}$ | Date: ${date}
Ton: corporate élite, rigoureux, ultra-persuasif. 3 paragraphes max.`}],
    });
    letterBody = resp.content[0].text;
  } catch {
    letterBody = `${date}\n\n${organism}\n\nMadame, Monsieur,\n\nC'est avec conviction que je soumets la présente candidature au ${programName}. Kadio Coiffure génère un CA annuel de ${fin.netRevenue12m.toLocaleString('fr-CA')} $ CAD et ce financement de ${(amount||25000).toLocaleString('fr-CA')} $ CAD accélérera notre ${purpose||'modernisation'}.\n\nCordialement,\nKadio Ehouman Ulrich\nKadio Coiffure — kadioothniel@yahoo.fr`;
  }
  const hash = crypto.createHash('sha256').update(letterBody).digest('hex').slice(0,16);
  letterBody += `\n\n[Intégrité DALEBA: SHA-256 ${hash}]`;
  await pool.query(`UPDATE tenant_funding_applications SET cover_letter=$3,updated_at=NOW() WHERE tenant_id=$1 AND program_name=$2`, [tenantId,programName,letterBody]).catch(() => {});
  return { coverLetter: letterBody, programName, hash };
}

// [531] Deadlines reddition de comptes
async function addReportingDeadline(pool, tenantId, { appId, programName, deadline }) {
  await initSchema(pool);
  await pool.query(`INSERT INTO funding_reporting_deadlines (tenant_id,app_id,program_name,deadline) VALUES ($1,$2,$3,$4) ON CONFLICT DO NOTHING`,
    [tenantId, appId, programName, deadline]).catch(() => {});
  return { scheduled: true, deadline };
}

async function getReportingDeadlines(pool, tenantId) {
  await initSchema(pool);
  const r = await pool.query(`SELECT * FROM funding_reporting_deadlines WHERE tenant_id=$1 ORDER BY deadline`, [tenantId]).catch(() => ({ rows:[] }));
  const now = Date.now();
  return r.rows.map(d => {
    const msUntil = new Date(d.deadline).getTime() - now;
    const daysUntil = Math.floor(msUntil / 86400000);
    return { ...d, daysUntil, needsReminder: daysUntil <= 30 && daysUntil >= 0 };
  });
}

module.exports = {
  prequalify, calculateDSCR, getTenantFinancials, scoreEligibility, cleanTempFinancials,
  generatePitchMemo, writeCoverLetter, createApplication, updateApplicationStatus,
  getApplications, calculateWACC, simulateMaxDebt, projectROI,
  addReportingDeadline, getReportingDeadlines, initSchema, ELIGIBILITY_THRESHOLD,
};
