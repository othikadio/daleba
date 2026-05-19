'use strict';
/**
 * Prequalification Engine — DALEBA [504-506, 508, 510, 512-513]
 * Pré-qualification financière, RCSD, Pitch Memo, lettres corporatives
 */
const bus    = require('./event-bus');
const crypto = require('crypto');

const ELIGIBILITY_THRESHOLD = 0.80; // [506] 80% → OPPORTUNITY_MATCHED

// ─── SCHEMA ──────────────────────────────────────────────────────────────────
async function initSchema(pool) {
  if (!pool?.query) return;
  // [513] Table tenant_funding_applications
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
        -- draft | opportunity_matched | application_in_progress | submitted | approved | rejected
      eligibility_pct NUMERIC(5,2),
      pitch_memo      TEXT,
      cover_letter    TEXT,
      notes           TEXT,
      validation_sig  TEXT,   -- [507] Signature cryptographique d'Ulrich
      submitted_at    TIMESTAMPTZ,
      history         JSONB DEFAULT '[]',
      created_at      TIMESTAMPTZ DEFAULT NOW(),
      updated_at      TIMESTAMPTZ DEFAULT NOW()
    )
  `).catch(() => {});
  await pool.query('CREATE INDEX IF NOT EXISTS idx_funding_apps ON tenant_funding_applications(tenant_id, status)').catch(() => {});
}

// ─── BILAN TENANT (depuis AnalystAgent ou Square) ─────────────────────────────
async function getTenantFinancials(pool, tenantId) {
  // Tente de récupérer depuis tenant_ledgers (si disponible)
  const r = await pool.query(`
    SELECT
      COALESCE(SUM(amount_net),0)                  AS net_revenue_12m,
      COALESCE(AVG(amount_net),0)                  AS avg_transaction,
      COUNT(*)                                      AS tx_count
    FROM tenant_ledgers
    WHERE tenant_id=$1 AND created_at >= NOW() - INTERVAL '12 months'
  `, [tenantId]).catch(() => ({ rows: [{}] }));

  const raw = r.rows[0] || {};
  const netRevenue = parseFloat(raw.net_revenue_12m || 0);
  // Estimations conservatrices si pas de données réelles
  const netMargin     = 0.30;   // 30% marge nette estimée coiffure
  const fixedCosts    = netRevenue * 0.40;
  const netOperIncome = netRevenue * netMargin;
  const liquidityRatio = 1.2;  // ratio de liquidité estimé
  return {
    netRevenue12m:      netRevenue,
    avgTransaction:     parseFloat(raw.avg_transaction || 0),
    txCount:            parseInt(raw.tx_count || 0),
    estimatedNetMargin: netMargin,
    fixedCosts,
    netOperatingIncome: netOperIncome,
    liquidityRatio,
    source: netRevenue > 0 ? 'tenant_ledgers' : 'estimated',
  };
}

// ─── [505] RCSD = Excédent Net d'Exploitation / Service de la Dette ──────────
function calculateDSCR(netOperatingIncome, debtService) {
  if (!debtService || debtService === 0) return { dscr: null, viable: true, reason: 'no_debt_service' };
  const dscr = parseFloat((netOperatingIncome / debtService).toFixed(3));
  const viable = dscr >= 1.25; // seuil standard banques canadiennes
  return {
    dscr,
    viable,
    interpretation: dscr >= 1.5 ? 'Excellent' : dscr >= 1.25 ? 'Acceptable' : dscr >= 1.0 ? 'Limite' : 'Insuffisant',
    recommendation: viable ? 'Dossier finançable' : 'Réduire le service de la dette ou augmenter les revenus avant soumission',
    netOperatingIncome,
    debtService,
  };
}

// ─── [506] Score d'éligibilité ────────────────────────────────────────────────
function scoreEligibility(financials, opportunity) {
  const elig = opportunity.eligibility || {};
  let score = 0; let checks = 0;

  // Revenu minimum
  checks++;
  if (financials.netRevenue12m >= (elig.min_revenue || 0)) score++;

  // Géographie (Québec/Canada = toujours OK pour Kadio Coiffure Longueuil)
  checks++;
  const geo = elig.geography || [];
  if (geo.some(g => ['Canada','Québec','QC'].includes(g))) score++;

  // Secteur
  checks++;
  const sectors = elig.sectors || ['tous'];
  if (sectors.includes('tous') || sectors.some(s => ['beaute','coiffure','services','commerce_detail'].includes(s))) score++;

  // Conditions supplémentaires (bonus)
  const conds = elig.conditions || [];
  const bonusChecks = [
    ['PME', conds.some(c => /PME/.test(c))],
    ['Québec', conds.some(c => /québec/i.test(c))],
    ['moins de 100 employés', conds.some(c => /100\s*employ/i.test(c)) || conds.some(c => /500\s*employ/i.test(c))],
  ];
  for (const [, pass] of bonusChecks) { checks++; if (pass) score++; }

  return parseFloat((score / checks).toFixed(3));
}

// ─── [504-506] Pré-qualification complète ─────────────────────────────────────
async function prequalify(pool, tenantId) {
  await initSchema(pool);
  const scanner = require('./funding-scanner-worker');
  const financials = await getTenantFinancials(pool, tenantId);
  const opportunities = await scanner.getOpportunities(pool);

  const matched = [];
  for (const opp of opportunities) {
    const eligPct = scoreEligibility(financials, opp);
    const dscr = calculateDSCR(financials.netOperatingIncome, opp.max_amount * 0.07); // 7% service/an estimé

    if (eligPct >= ELIGIBILITY_THRESHOLD) {
      matched.push({ ...opp, eligibilityPct: eligPct, dscr, status: 'OPPORTUNITY_MATCHED' });
      bus.system(`[PreQual] ✨ MATCH: "${opp.name}" — ${(eligPct*100).toFixed(0)}% éligibilité`);
      // [506] Persistance OPPORTUNITY_MATCHED
      await createApplication(pool, tenantId, {
        program: opp,
        eligibilityPct: eligPct,
        status: 'opportunity_matched',
      });
    }
  }

  return { tenantId, financials, matched, totalOpportunities: opportunities.length, matchedCount: matched.length };
}

// ─── [513] Gestion applications ───────────────────────────────────────────────
async function createApplication(pool, tenantId, { program, eligibilityPct, status = 'draft' }) {
  await initSchema(pool);
  const appId = `APP-${Date.now()}-${crypto.randomBytes(3).toString('hex').toUpperCase()}`;
  await pool.query(`
    INSERT INTO tenant_funding_applications
      (tenant_id, application_id, program_name, organism, program_url, max_amount, funding_type, status, eligibility_pct)
    VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
    ON CONFLICT (application_id) DO NOTHING
  `, [tenantId, appId, program.name, program.organism, program.url, program.max_amount,
      program.funding_type, status, eligibilityPct]).catch(() => {});
  return { appId, programName: program.name, status };
}

async function updateApplicationStatus(pool, tenantId, { appId, status, notes, validationSig }) {
  await initSchema(pool);
  // [507] Soumission officielle = signature obligatoire
  if (status === 'submitted' && !validationSig)
    throw new Error('[507] Soumission requiert une validation_sig cryptographique du propriétaire');

  const r = await pool.query(`
    UPDATE tenant_funding_applications
    SET status=$3, notes=$4, validation_sig=$5, updated_at=NOW(),
        submitted_at = CASE WHEN $3='submitted' THEN NOW() ELSE submitted_at END,
        history = history || jsonb_build_array(jsonb_build_object('status',$3,'at',NOW()::text,'notes',$4))
    WHERE tenant_id=$1 AND application_id=$2
    RETURNING *
  `, [tenantId, appId, status, notes || '', validationSig || '']).catch(() => ({ rows: [] }));
  return r.rows[0] || { updated: false };
}

async function getApplications(pool, tenantId) {
  await initSchema(pool);
  const r = await pool.query(
    `SELECT * FROM tenant_funding_applications WHERE tenant_id=$1 ORDER BY created_at DESC`,
    [tenantId]
  ).catch(() => ({ rows: [] }));
  return r.rows;
}

// ─── [508] Pitch Memo ─────────────────────────────────────────────────────────
async function generatePitchMemo(pool, tenantId, opportunity) {
  const financials = await getTenantFinancials(pool, tenantId);
  const dscr       = calculateDSCR(financials.netOperatingIncome, (opportunity.max_amount || 25000) * 0.07);

  const memo = `
═══════════════════════════════════════════════════════════════
 MÉMO EXÉCUTIF — OPPORTUNITÉ DE FINANCEMENT
═══════════════════════════════════════════════════════════════

 Programme  : ${opportunity.name}
 Organisme  : ${opportunity.organism}
 Type       : ${opportunity.funding_type?.replace(/_/g,' ').toUpperCase()}
 Montant max: ${(opportunity.max_amount||0).toLocaleString('fr-CA')} $ CAD

───────────────────────────────────────────────────────────────
 PROFIL KADIO COIFFURE
───────────────────────────────────────────────────────────────
 • Salon de coiffure afro professionnel — Longueuil, Québec
 • 615 Antoinette Robidoux, local 100, Longueuil, QC J4J 2V8
 • Propriétaire : Kadio Ehouman Ulrich
 • CA net 12 mois : ${financials.netRevenue12m.toLocaleString('fr-CA')} $ CAD
 • Transactions  : ${financials.txCount} paiements enregistrés
 • RCSD estimé   : ${dscr.dscr || 'N/A'} (${dscr.interpretation || '—'})
 • Liquidité     : ${financials.liquidityRatio}

───────────────────────────────────────────────────────────────
 EFFET DE LEVIER
───────────────────────────────────────────────────────────────
 Ce financement permettrait à Kadio Coiffure de :
   → Moderniser la gestion client (logiciel DALEBA)
   → Agrandir la capacité d'accueil du salon (1-2 postes)
   → Former une employée supplémentaire en soins botaniques
   → Automatiser la prise de rendez-vous et le suivi fidélité

 Retour sur investissement estimé : 18-24 mois
 Impact direct : +25-35% de CA annuel projeté

───────────────────────────────────────────────────────────────
 RECOMMANDATION DALEBA IA
───────────────────────────────────────────────────────────────
 Taux d'éligibilité estimé : ${((opportunity.eligibilityPct||0.85)*100).toFixed(0)}%
 Priorité                  : HAUTE — démarches à initier sous 30 jours
 Montant à demander        : ${Math.min(opportunity.max_amount||25000, Math.round(financials.netRevenue12m * 0.5 || 25000)).toLocaleString('fr-CA')} $ CAD

═══════════════════════════════════════════════════════════════
 DALEBA Business Intelligence — Généré le ${new Date().toLocaleDateString('fr-CA')}
═══════════════════════════════════════════════════════════════`.trim();

  // Sauvegarde dans l'application
  await pool.query(
    `UPDATE tenant_funding_applications SET pitch_memo=$3, updated_at=NOW() WHERE tenant_id=$1 AND program_name=$2`,
    [tenantId, opportunity.name, memo]
  ).catch(() => {});

  bus.system(`[PreQual] 📋 Pitch Memo généré: "${opportunity.name}"`);
  return { memo, programName: opportunity.name };
}

// ─── [510] Lettre de présentation corporative ─────────────────────────────────
async function writeCoverLetter(pool, tenantId, { programName, organism, amount, purpose }) {
  const financials = await getTenantFinancials(pool, tenantId);
  const date       = new Date().toLocaleDateString('fr-CA', { year:'numeric', month:'long', day:'numeric' });

  let letterBody;
  try {
    const { Anthropic } = require('@anthropic-ai/sdk');
    const claude = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
    const resp = await claude.messages.create({
      model: 'claude-opus-4-5', max_tokens: 800,
      messages: [{
        role: 'user',
        content: `Rédige une lettre de présentation corporative d'élite en français pour une demande de financement.
Expéditeur: Kadio Ehouman Ulrich, propriétaire de Kadio Coiffure, 615 Antoinette Robidoux local 100, Longueuil QC J4J 2V8
Destinataire: ${organism}
Programme: ${programName}
Montant demandé: ${(amount||25000).toLocaleString('fr-CA')}$
Objet: ${purpose||"Modernisation et expansion du salon"}
CA annuel: ${financials.netRevenue12m.toLocaleString('fr-CA')}$
Ton: corporate d'élite, rigoureux, ultra-persuasif. 3 paragraphes max. Inclure date ${date}.`,
      }],
    });
    letterBody = resp.content[0].text;
    bus.system(`[PreQual] ✍️ Lettre de présentation rédigée par Claude`);
  } catch {
    letterBody = `${date}

${organism}
Programme: ${programName}

Madame, Monsieur,

C'est avec un grand intérêt et une conviction profonde que je soumets la présente candidature au ${programName}. Kadio Coiffure, salon de coiffure afro professionnel établi à Longueuil depuis plusieurs années, a démontré une croissance soutenue avec un chiffre d'affaires annuel de ${financials.netRevenue12m.toLocaleString('fr-CA')} $ CAD.

Ce financement de ${(amount||25000).toLocaleString('fr-CA')} $ CAD nous permettra d'accélérer notre ${purpose||'modernisation et expansion'}, de créer des emplois durables dans notre communauté, et de renforcer notre position de leader dans les soins capillaires afro à Montréal et sa région.

Je me tiens disponible pour tout entretien complémentaire et vous assure de mon engagement total pour la réussite de ce projet.

Respectueusement,

Kadio Ehouman Ulrich
Propriétaire — Kadio Coiffure
kadioothniel@yahoo.fr`;
    bus.system(`[PreQual] ✍️ Lettre de présentation (template corporatif)`);
  }

  await pool.query(
    `UPDATE tenant_funding_applications SET cover_letter=$3, updated_at=NOW() WHERE tenant_id=$1 AND program_name=$2`,
    [tenantId, programName, letterBody]
  ).catch(() => {});

  return { coverLetter: letterBody, programName };
}

// ─── [512] APPLICATION_IN_PROGRESS ───────────────────────────────────────────
async function startApplication(pool, tenantId, appId) {
  return updateApplicationStatus(pool, tenantId, {
    appId,
    status: 'application_in_progress',
    notes: 'Ulrich a validé OUI — DALEBA commence à remplir les sections du dossier',
  });
}

module.exports = {
  prequalify, calculateDSCR, getTenantFinancials, scoreEligibility,
  generatePitchMemo, writeCoverLetter, createApplication, updateApplicationStatus,
  getApplications, startApplication, initSchema, ELIGIBILITY_THRESHOLD,
};
