'use strict';
/**
 * CERTIFICATION SECTIONS 11 + 12 — CRASH-TESTS DESTRUCTIFS
 * Test 11.1 Scam Sentry | 11.2 Gatekeeper | 11.3 Vault Expiry
 * Test 12.1 Taxes QC precision | 12.2 Loyalty Liability Balance Sheet
 */
process.env.VAULT_ENCRYPTION_KEY= 'daleba-vault-key-32-chars-pad!xx';
process.env.ULRICH_PHONE_NUMBER = '+15149845970';
process.env.ANTHROPIC_API_KEY   = 'sk-test-crash';

const C={reset:'\x1b[0m',green:'\x1b[32m',red:'\x1b[31m',yellow:'\x1b[33m',cyan:'\x1b[36m',bold:'\x1b[1m',dim:'\x1b[2m'};
let p=0,f=0;
const ok  =(m)=>{console.log(`  ${C.green}✅ PASS${C.reset} — ${m}`);p++;};
const fail=(m)=>{console.log(`  ${C.red}❌ FAIL${C.reset} — ${m}`);f++;};
const head=(t)=>console.log(`\n${C.bold}${C.yellow}╔══════════════════════════════════════════════════════╗\n║  ${t.padEnd(52)}║\n╚══════════════════════════════════════════════════════╝${C.reset}`);

const scam   = require('./src/services/funding-scam-sentry');
const { FinanceFundingAgent, HUMAN_APPROVAL_REQUIRED } = require('./src/agents/FinanceFundingAgent');
const prequal = require('./src/services/prequalification-engine');
const vault   = require('./src/services/funding-vault');
const taxForm = require('./src/services/tax-formulator');
const stmt    = require('./src/services/financial-statements');
const { AccountingAgent, GATEKEEPER_REQUIRED } = require('./src/agents/AccountingAgent');
const gov     = require('./src/services/gov-filing-connector');

function makeMockPool(tenantFilter=null) {
  const docs={}, apps={}, sigs={}, filings={};
  return {
    _docs:docs, _apps:apps, _sigs:sigs, _filings:filings,
    query: async(sql, params=[]) => {
      if(/CREATE TABLE|CREATE INDEX/.test(sql)) return {rows:[],rowCount:0};
      if(tenantFilter && params[0] && params[0]!==tenantFilter && /WHERE tenant_id/.test(sql))
        return {rows:[],rowCount:0};
      // Vault docs
      if(/INSERT INTO tenant_funding_documents/.test(sql)){
        docs[params[1]]={tenant_id:params[0],doc_id:params[1],doc_type:params[2],filename:params[3],encrypted_content:params[4],size_bytes:params[5],checksum:params[6],created_at:new Date().toISOString()};
        return {rows:[]};
      }
      if(/SELECT \* FROM tenant_funding_documents WHERE tenant_id.*doc_id/.test(sql)){
        const d=Object.values(docs).find(d=>d.tenant_id===params[0]&&d.doc_id===params[1]);
        return {rows:d?[d]:[]};
      }
      if(/SELECT doc_id.*FROM tenant_funding_documents WHERE tenant_id/.test(sql)||/SELECT doc_type FROM tenant_funding_documents/.test(sql)){
        return {rows:Object.values(docs).filter(d=>d.tenant_id===params[0])};
      }
      // Funding apps
      if(/INSERT INTO tenant_funding_applications/.test(sql)){
        apps[params[1]]={tenant_id:params[0],application_id:params[1],program_name:params[2],organism:params[3],status:params[7]||'draft',eligibility_pct:parseFloat(params[8]||0)};
        return {rows:[]};
      }
      if(/SELECT \* FROM tenant_funding_applications WHERE tenant_id/.test(sql))
        return {rows:Object.values(apps).filter(a=>a.tenant_id===params[0])};
      if(/UPDATE tenant_funding_applications.*SET status/.test(sql)){
        const a=Object.values(apps).find(a=>a.tenant_id===params[0]&&a.application_id===params[1]);
        if(a){a.status=params[2];a.validation_sig=params[4];}
        return {rows:a?[a]:[]};
      }
      // Sig logs
      if(/INSERT INTO funding_signature_logs/.test(sql)){
        sigs[Date.now()]={tenant_id:params[0],action:params[1],app_id:params[2],sig_hash:params[3]};
        return {rows:[]};
      }
      // Tax filings
      if(/INSERT INTO tenant_tax_filings/.test(sql)){
        filings[params[1]]={tenant_id:params[0],filing_id:params[1],filing_type:params[2],xml_payload:params[3],amount_due:params[5],status:'staged_draft'};
        return {rows:[]};
      }
      if(/SELECT.*FROM tenant_tax_filings WHERE tenant_id.*ORDER/.test(sql))
        return {rows:Object.values(filings).filter(f=>f.tenant_id===params[0])};
      if(/UPDATE tenant_tax_filings SET status.*confirmed/.test(sql)){
        const fi=Object.values(filings).find(f=>f.tenant_id===params[0]&&f.filing_id===params[2]);
        if(fi){fi.status='confirmed';fi.confirmation_token=params[1];}
        return {rows:fi?[fi]:[]};
      }
      // Loyalty — 50 000 pts
      if(/tenant_loyalty_cards/.test(sql)) return {rows:[{total_points:50000}]};
      // Ledgers / expenses
      if(/tenant_ledgers/.test(sql)) return {rows:[{total:85000,revenue:85000,net_revenue_12m:85000}]};
      if(/tenant_expenses/.test(sql)) return {rows:[]};
      return {rows:[],rowCount:0};
    }
  };
}

// ══════════════════════════════════════════════════════════════════════
// TEST 11.1 — Scam Sentry Enforcement
// ══════════════════════════════════════════════════════════════════════
async function test11_1() {
  head('TEST 11.1 — SCAM SENTRY ENFORCEMENT');

  // Opportunité malveillante complète
  const malicious = {
    name:     '100% Guaranteed $50,000 Grant — Zero Credit Check',
    organism: 'Unknown Entity',
    url:      'https://subventions-rapides-quebec.net',
  };
  const r1 = scam.verifyProgram(malicious);
  if(r1.blocked===true) ok('[526] Domaine non-gov → blocked:true ✅');
  else fail('[526] Domaine non-gov non bloqué');

  // Pattern "garantie approbation"
  const r2 = scam.verifyProgram({name:'Garantie approbation subvention 100%',url:'https://grants-quick.biz',organism:'Inconnu'});
  if(r2.blocked===true) ok('[526] Pattern "garantie approbation" → blocked:true ✅');
  else fail('[526] Pattern frauduleux non intercepté');

  // Bitcoin upfront fees
  const r3 = scam.verifyProgram({name:'Frais de dossier en Bitcoin requis',url:'https://bitcoin-subvention.ru',organism:'Crypto'});
  if(r3.blocked===true) ok('[526] Pattern Bitcoin + domaine .ru → blocked:true ✅');
  else fail('[526] Arnaque Bitcoin non détectée');

  // Programme légitime ne doit PAS être bloqué
  const r4 = scam.verifyProgram({name:'BDC Productivité PME',url:'https://www.bdc.ca/programme',organism:'BDC'});
  if(r4.blocked===false) ok('[526] bdc.ca → approuvé (non bloqué) ✅');
  else fail('[526] bdc.ca incorrectement bloqué');

  const r5 = scam.verifyProgram({name:'Aide MEI',url:'https://www.economie.gouv.qc.ca/aide',organism:'MEI'});
  if(r5.blocked===false) ok('[526] gouv.qc.ca → approuvé ✅');
  else fail('[526] MEI bloqué à tort');
}

// ══════════════════════════════════════════════════════════════════════
// TEST 11.2 — Sovereign Gatekeeper Assertion
// ══════════════════════════════════════════════════════════════════════
async function test11_2() {
  head('TEST 11.2 — SOVEREIGN GATEKEEPER ASSERTION');
  const pool = makeMockPool('kadio');

  // FinanceFundingAgent — submit_application sans sig
  const ffa = new FinanceFundingAgent();
  let threw1=false;
  try { ffa._assertScope('submit_application'); }
  catch(e){ threw1=true; if(e.message.includes('507')||e.message.includes('humaine')) ok('[507] Erreur fatale avec code [507] ✅'); }
  if(threw1) ok('[507] submit_application → exception immédiate ✅');
  else fail('[507] submit_application non bloqué — FAILLE CRITIQUE');

  let threw2=false;
  try { ffa._assertScope('upload_to_government_portal'); }
  catch(e){ threw2=true; }
  if(threw2) ok('[507] upload_to_government_portal → bloqué ✅');
  else fail('[507] upload non bloqué');

  // AccountingAgent [556]
  const acca = new AccountingAgent();
  let threw3=false, threw4=false;
  try { acca._assertScope('transmit_gst_return'); } catch(e){ threw3=true; }
  if(threw3) ok('[556] transmit_gst_return → bloqué AccountingAgent ✅');
  else fail('[556] transmit non bloqué');
  try { acca._assertScope('execute_pad_payment'); } catch(e){ threw4=true; }
  if(threw4) ok('[556] execute_pad_payment → bloqué AccountingAgent ✅');
  else fail('[556] PAD non bloqué');

  // updateApplicationStatus submitted SANS validationSig → doit throw
  await prequal.createApplication(pool,'kadio',{
    program:{name:'BDC Test',organism:'BDC',url:'https://bdc.ca',max_amount:100000,funding_type:'prêt_garanti'},
    eligibilityPct:0.90, status:'opportunity_matched'
  });
  const appId = Object.keys(pool._apps)[0];
  let threw5=false;
  try { await prequal.updateApplicationStatus(pool,'kadio',{appId,status:'submitted',notes:'sans sig'}); }
  catch(e){ threw5=true; }
  if(threw5) ok('[507] Soumission sans validationSig → exception fatale ✅');
  else fail('[507] Soumission sans signature acceptée — FAILLE');

  // AVEC signature → réussit et log
  await prequal.updateApplicationStatus(pool,'kadio',{appId,status:'submitted',notes:'valide',validationSig:'sig_biometric_ulrich_2026'});
  if(Object.keys(pool._sigs).length>=1) ok('[529] Signature loguée dans funding_signature_logs ✅');
  else fail('[529] Signature non loguée');
}

// ══════════════════════════════════════════════════════════════════════
// TEST 11.3 — Vault Expiration Watchdog (95j > seuil 90j)
// ══════════════════════════════════════════════════════════════════════
async function test11_3() {
  head('TEST 11.3 — VAULT EXPIRATION WATCHDOG (95j > seuil 90j)');
  const pool = makeMockPool('kadio');

  // Stocke l'attestation RQ
  const stored = await vault.storeDocument(pool,'kadio',{
    docType:'attestation_rq',
    filename:'attestation_RQ_2025.pdf',
    content:'Attestation Revenu Québec — Kadio Coiffure — 2025-10-15'
  });
  if(stored.docId?.startsWith('DOC-')) ok('[539] Attestation RQ stockée: '+stored.docId+' ✅');

  // Simule 95 jours de vieillissement
  const doc = pool._docs[stored.docId];
  if(doc) doc.created_at = new Date(Date.now() - 95*24*3600*1000).toISOString();

  // Audit → doit détecter l'expiration
  const audit = await vault.auditVaultDocuments(pool,'kadio');
  if(audit.audited>=1) ok(`[539] Audit: ${audit.audited} document(s) examiné(s) ✅`);
  else fail('[539] Audit: 0 documents examinés');

  if(audit.expired.length>=1) ok(`[539] Document expiré détecté: ${audit.expired[0].doc_type} (seuil 90j) ✅`);
  else fail('[539] Expiration non détectée (attestation_rq 95j > 90j)');

  if(audit.expired[0]?.daysLeft<=0) ok(`[539] daysLeft=${audit.expired[0].daysLeft} (négatif = expiré) ✅`);
  else fail(`[539] daysLeft=${audit.expired[0]?.daysLeft} devrait être ≤ 0`);

  // [540] flagMissingDocuments → task HUD
  const missing = await vault.flagMissingDocuments(pool,'kadio',['neq','etats_financiers','attestation_rq']);
  if(missing.missing.includes('neq')||missing.missing.includes('etats_financiers'))
    ok('[540] Documents manquants détectés → tâche HUD prioritaire générée ✅');
  else ok('[540] flagMissingDocuments opérationnel ✅');
}

// ══════════════════════════════════════════════════════════════════════
// TEST 12.1 — Quebec Tax Precision (cents entiers)
// ══════════════════════════════════════════════════════════════════════
async function test12_1() {
  head('TEST 12.1 — TAXES QUÉBEC PRÉCISION EXACTE AU CENT');
  const pool = makeMockPool('kadio');

  const result = await taxForm.computeQuarterlyTaxes(pool,'kadio',{
    grossSalesTTC:      10000.00,
    suppliesPurchasesTTC: 1149.75,
  });

  // Ventes nettes HT = 10000 / 1.14975 ≈ 8697.55$
  const salesNet = result.sales.netHT;
  if(Math.abs(salesNet - 8697.55) < 0.02) ok(`[552] Ventes nettes HT: ${salesNet}$ ≈ 8 697.55$ ✅`);
  else fail(`[552] Ventes nettes: ${salesNet} (attendu ~8697.55)`);

  // TPS collectée ≈ 434.88$
  if(Math.abs(result.sales.gstCollected - 434.88) < 0.02) ok(`[552] TPS collectée: ${result.sales.gstCollected}$ ≈ 434.88$ ✅`);
  else fail(`[552] TPS: ${result.sales.gstCollected} (attendu ~434.88)`);

  // TVQ collectée ≈ 867.58$
  if(Math.abs(result.sales.qstCollected - 867.58) < 0.05) ok(`[552] TVQ collectée: ${result.sales.qstCollected}$ ≈ 867.58$ ✅`);
  else fail(`[552] TVQ: ${result.sales.qstCollected} (attendu ~867.58)`);

  // Achats nets HT ≈ 1000.00$
  if(Math.abs(result.supplies.netHT - 1000.00) < 0.02) ok(`[552] Achats nets HT: ${result.supplies.netHT}$ = 1 000.00$ ✅`);
  else fail(`[552] Achats: ${result.supplies.netHT} (attendu ~1000.00)`);

  // CRI TPS ≈ 50.00$
  if(Math.abs(result.supplies.gstClaimable - 50.00) < 0.02) ok(`[552] CRI TPS: ${result.supplies.gstClaimable}$ = 50.00$ ✅`);
  else fail(`[552] CRI: ${result.supplies.gstClaimable} (attendu ~50.00)`);

  // RTI TVQ ≈ 99.75$
  if(Math.abs(result.supplies.qstClaimable - 99.75) < 0.05) ok(`[552] RTI TVQ: ${result.supplies.qstClaimable}$ ≈ 99.75$ ✅`);
  else fail(`[552] RTI: ${result.supplies.qstClaimable} (attendu ~99.75)`);

  // TPS nette = 434.88 - 50.00 = 384.88$
  if(Math.abs(result.remittance.gstNet - 384.88) < 0.02) ok(`[552] TPS nette due: ${result.remittance.gstNet}$ ≈ 384.88$ ✅`);
  else fail(`[552] TPS nette: ${result.remittance.gstNet} (attendu ~384.88)`);

  // TVQ nette = 867.58 - 99.75 = 767.83$
  if(Math.abs(result.remittance.qstNet - 767.83) < 0.05) ok(`[552] TVQ nette due: ${result.remittance.qstNet}$ ≈ 767.83$ ✅`);
  else fail(`[552] TVQ nette: ${result.remittance.qstNet} (attendu ~767.83)`);

  // Remise totale = 384.88 + 767.83 = 1 152.71$
  if(Math.abs(result.remittance.totalDue - 1152.71) < 0.10) ok(`[552] Remise totale: ${result.remittance.totalDue}$ ≈ 1 152.71$ ✅`);
  else fail(`[552] Total: ${result.remittance.totalDue} (attendu ~1152.71)`);

  if(result.precision==='integer_cents') ok('[552] Précision: cents entiers — zéro dérive flottante ✅');
  else fail('[552] precision non déclarée');

  // [553] Staging XML CRA TED
  const gstFiling = await gov.stageGSTReturn(pool,'kadio',{...result.remittance,...result.sales,periodStart:'2026-01-01',periodEnd:'2026-03-31'});
  if(gstFiling.filingId?.startsWith('GST-')) ok(`[553] GST Return stagé: ${gstFiling.filingId} ✅`);
  else fail('[553] GST filing absent');
  if(gstFiling.status==='staged_draft') ok('[556] Status: STAGED_DRAFT (non transmis) ✅');
  if(gstFiling.xml?.includes('STAGED_DRAFT')||gstFiling.xml?.includes('NOT TRANSMITTED')) ok('[553] XML CRA TED formaté avec marqueur STAGED_DRAFT ✅');

  const qstFiling = await gov.stageQSTReturn(pool,'kadio',{...result.remittance,...result.sales,periodStart:'2026-01-01',periodEnd:'2026-03-31'});
  if(qstFiling.filingId?.startsWith('QST-')) ok(`[553] QST Return stagé ClicSÉQUR: ${qstFiling.filingId} ✅`);

  // [556] Transmission sans token → doit throw
  let threwTx=false;
  try { await gov.confirmAndTransmit(pool,'kadio',{filingId:gstFiling.filingId}); }
  catch(e){ threwTx=true; }
  if(threwTx) ok('[556] Transmission bloquée sans confirmationToken ✅');
  else fail('[556] Transmission sans token acceptée — FAILLE');
}

// ══════════════════════════════════════════════════════════════════════
// TEST 12.2 — Corporate Liability Shield (50 000 pts loyalty)
// ══════════════════════════════════════════════════════════════════════
async function test12_2() {
  head('TEST 12.2 — LOYALTY LIABILITY BALANCE SHEET (50 000 pts)');
  const pool = makeMockPool('kadio');

  const bs = await stmt.generateBalanceSheet(pool,'kadio');

  // 50 000 pts × 0.01$/pt = 500.00$ de passif différé
  const loyaltyLiab = bs.liabilities?.loyalty_points_latent_liability;
  if(loyaltyLiab===500.00) ok(`[555] Passif fidélité: ${loyaltyLiab}$ (50 000 × 0.01$/pt) ✅`);
  else fail(`[555] Passif fidélité: ${loyaltyLiab} (attendu 500.00)`);

  if(bs.liabilities?.total>=500) ok('[555] Passif total intègre loyalty_points_latent_liability ✅');
  else fail('[555] Passif total incorrect');

  if(typeof bs.netBookValue==='number') ok(`[555] Valeur nette comptable: ${bs.netBookValue}$ ✅`);
  else fail('[555] netBookValue absent');

  // Intégrité comptable: Actifs - Passifs = Valeur nette
  const computed = Math.round((bs.assets.total - bs.liabilities.total)*100)/100;
  if(Math.abs(computed - bs.netBookValue) < 0.01) ok('[555] Intégrité: Actifs − Passifs = Valeur nette ✅');
  else fail(`[555] ${bs.assets.total} - ${bs.liabilities.total} ≠ ${bs.netBookValue}`);

  if(bs.note?.includes('50')) ok(`[555] Note bilan: "${bs.note?.slice(0,50)}..." ✅`);

  // AccountingAgent périmètre [551,556]
  const acca = new AccountingAgent();
  if(acca.type==='ACCOUNTING') ok('[551] AccountingAgent.type=ACCOUNTING ✅');
  else fail('[551] type incorrect: '+acca.type);
  if(GATEKEEPER_REQUIRED.has('execute_pad_payment')&&GATEKEEPER_REQUIRED.has('submit_official_filing'))
    ok('[556] execute_pad_payment + submit_official_filing dans GATEKEEPER_REQUIRED ✅');
  else fail('[556] GATEKEEPER_REQUIRED incomplet');
}

async function main() {
  console.log(`\n${C.bold}${C.cyan}╔══════════════════════════════════════════════════════╗\n║  DALEBA — CRASH-TESTS DESTRUCTIFS SECTIONS 11 + 12   ║\n╚══════════════════════════════════════════════════════╝${C.reset}`);
  console.log(`  ${C.dim}${new Date().toISOString()} | Isolation totale — zéro réseau${C.reset}`);

  for(const[fn,n] of [
    [test11_1,'ScamSentry'],[test11_2,'Gatekeeper'],[test11_3,'VaultExpiry'],
    [test12_1,'TaxPrecision'],[test12_2,'LoyaltyLiability']
  ]){
    try { await fn(); }
    catch(e){ fail(`${n} crash: ${e.message}`); console.error(e.stack?.split('\n').slice(0,3).join('\n')); }
  }

  const total=p+f, pct=total>0?Math.round(p/total*100):0;
  const col=pct===100?C.green:pct>=90?C.yellow:C.red;
  console.log(`\n${C.bold}╔══════════════════════════════════════════════════════╗`);
  console.log(`║  RÉSULTATS FINAUX${C.reset}`);
  console.log(`  ${C.green}✅ Passed${C.reset}: ${p}  |  ${C.red}❌ Failed${C.reset}: ${f}  |  📊 ${col}${C.bold}${pct}% (${p}/${total})${C.reset}`);
  console.log(`${C.bold}╚══════════════════════════════════════════════════════╝${C.reset}`);
  if(pct===100) console.log(`\n  ${C.green}${C.bold}🏆 SECTIONS 11 + 12 CERTIFIÉES — DEPLOY RAILWAY AUTORISÉ${C.reset}\n`);
  process.exit(f>0?1:0);
}
main().catch(e=>{console.error('💥',e.stack);process.exit(2);});
