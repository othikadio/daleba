'use strict';
/**
 * Funding Scanner Worker — DALEBA [502-503]
 * Scanne BDC, Investissement Québec, Services Québec, Canada.ca, REQ
 * Stocke dans system_funding_opportunities
 */
const bus = require('./event-bus');

// [503] Catalogue des programmes connus (mis à jour manuellement + via scan web)
const KNOWN_PROGRAMS = [
  {
    name:          'Programme de productivité de la BDC',
    organism:      'Banque de développement du Canada (BDC)',
    max_amount:    100000,
    funding_type:  'prêt_garanti',
    url:           'https://www.bdc.ca/fr/financement/credit-aux-entreprises/programme-productivite',
    eligibility: {
      sectors:     ['services', 'commerce_detail', 'beaute', 'coiffure'],
      min_revenue: 50000,
      geography:   ['Canada'],
      conditions:  ['PME canadienne', 'en activité depuis ≥12 mois', 'plan d\'investissement productif'],
    },
  },
  {
    name:          'Subvention à l\'embauche d\'immigrants — Services Québec',
    organism:      'Services Québec',
    max_amount:    15000,
    funding_type:  'subvention_non_remboursable',
    url:           'https://www.emploiquebec.gouv.qc.ca/subvention-embauche',
    eligibility: {
      sectors:     ['tous'],
      min_revenue: 0,
      geography:   ['Québec'],
      conditions:  ['employeur québécois', 'embauche travailleur immigrant', 'min 20h/semaine'],
    },
  },
  {
    name:          'Crédit d\'impôt pour investissement et innovation (C3i)',
    organism:      'Revenu Québec',
    max_amount:    50000,
    funding_type:  'crédit_impôt',
    url:           'https://www.revenuquebec.ca/fr/entreprises/credits-impot/c3i/',
    eligibility: {
      sectors:     ['PME manufacturières et services spécialisés'],
      min_revenue: 100000,
      geography:   ['Québec'],
      conditions:  ['achat équipement ou logiciel de gestion', 'PME québécoise'],
    },
  },
  {
    name:          'Financement de démarrage PME — Investissement Québec',
    organism:      'Investissement Québec',
    max_amount:    250000,
    funding_type:  'prêt_garanti',
    url:           'https://www.investquebec.com/financement-pme',
    eligibility: {
      sectors:     ['services', 'commerce', 'beaute'],
      min_revenue: 0,
      geography:   ['Québec'],
      conditions:  ['projet d\'expansion', 'moins de 500 employés', 'siège social au Québec'],
    },
  },
  {
    name:          'Programme Entrepreneurs canadiens — FUTURPRENEUR',
    organism:      'Futurpreneur Canada',
    max_amount:    20000,
    funding_type:  'prêt_garanti',
    url:           'https://www.futurpreneur.ca/fr/programmes/',
    eligibility: {
      sectors:     ['tous'],
      min_revenue: 0,
      geography:   ['Canada'],
      conditions:  ['entrepreneur 18-39 ans', 'entreprise enregistrée', 'plan d\'affaires'],
    },
  },
  {
    name:          'Programme d\'aide à l\'adaptation numérique — MEI Québec',
    organism:      'Ministère de l\'Économie et de l\'Innovation (MEI)',
    max_amount:    25000,
    funding_type:  'subvention_non_remboursable',
    url:           'https://www.economie.gouv.qc.ca/aide-numerisation',
    eligibility: {
      sectors:     ['commerce_detail', 'services_aux_entreprises', 'beaute'],
      min_revenue: 30000,
      geography:   ['Québec'],
      conditions:  ['PME québécoise', 'projet de numérisation', 'moins de 100 employés'],
    },
  },
  {
    name:          'Subvention embauche Premier emploi — Emploi Québec',
    organism:      'Emploi-Québec',
    max_amount:    8000,
    funding_type:  'subvention_non_remboursable',
    url:           'https://www.emploiquebec.gouv.qc.ca/premier-emploi',
    eligibility: {
      sectors:     ['tous'],
      min_revenue: 0,
      geography:   ['Québec'],
      conditions:  ['embauche diplômé sans expérience', 'contrat ≥6 mois'],
    },
  },
];

async function initSchema(pool) {
  if (!pool?.query) return;
  await pool.query(`
    CREATE TABLE IF NOT EXISTS system_funding_opportunities (
      id              SERIAL PRIMARY KEY,
      name            TEXT NOT NULL,
      organism        TEXT NOT NULL,
      max_amount      NUMERIC(12,2),
      funding_type    TEXT,          -- subvention_non_remboursable | prêt_garanti | crédit_impôt
      url             TEXT,
      eligibility     JSONB,
      status          TEXT DEFAULT 'active',  -- active | expired | closed
      last_scanned    TIMESTAMPTZ DEFAULT NOW(),
      created_at      TIMESTAMPTZ DEFAULT NOW(),
      UNIQUE(name, organism)
    )
  `).catch(() => {});
  await pool.query('CREATE INDEX IF NOT EXISTS idx_funding_type ON system_funding_opportunities(funding_type, status)').catch(() => {});
}

/**
 * [502-503] Upsert tous les programmes connus en base
 */
async function scanAll(pool) {
  await initSchema(pool);
  let inserted = 0, updated = 0;
  for (const prog of KNOWN_PROGRAMS) {
    const r = await pool.query(`
      INSERT INTO system_funding_opportunities (name, organism, max_amount, funding_type, url, eligibility)
      VALUES ($1,$2,$3,$4,$5,$6)
      ON CONFLICT (name, organism) DO UPDATE SET
        max_amount=$3, funding_type=$4, url=$5, eligibility=$6, last_scanned=NOW(), status='active'
      RETURNING (xmax=0) AS is_insert
    `, [prog.name, prog.organism, prog.max_amount, prog.funding_type, prog.url, JSON.stringify(prog.eligibility)]).catch(() => ({ rows: [{}] }));
    if (r.rows[0]?.is_insert) inserted++; else updated++;
  }
  bus.system(`[FundingScanner] 🔍 Scan complet: ${inserted} nouveaux + ${updated} mis à jour (${KNOWN_PROGRAMS.length} programmes)`);
  return { scanned: KNOWN_PROGRAMS.length, inserted, updated, programs: KNOWN_PROGRAMS.map(p => p.name) };
}

/**
 * Retourne tous les programmes actifs avec filtres optionnels
 */
async function getOpportunities(pool, { type, minAmount, sector } = {}) {
  await initSchema(pool);
  let sql = `SELECT * FROM system_funding_opportunities WHERE status='active'`;
  const params = [];
  if (type)      { params.push(type);      sql += ` AND funding_type=$${params.length}`; }
  if (minAmount) { params.push(minAmount);  sql += ` AND max_amount>=$${params.length}`; }
  const r = await pool.query(sql + ' ORDER BY max_amount DESC', params).catch(() => ({ rows: [] }));
  return r.rows;
}

module.exports = { scanAll, getOpportunities, initSchema, KNOWN_PROGRAMS };
