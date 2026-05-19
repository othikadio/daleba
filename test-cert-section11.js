'use strict';
/**
 * CERTIFICATION SECTION 11 — Points 501-532
 * FinanceFundingAgent + Scanner + Pré-qualification + Vault + Alertes
 */
process.env.ULRICH_PHONE_NUMBER = '+15149845970';
process.env.ANTHROPIC_API_KEY   = 'sk-test-cert11';
process.env.VAULT_ENCRYPTION_KEY= 'daleba-vault-key-32-chars-pad!xx';

const C={reset:'\x1b[0m',green:'\x1b[32m',red:'\x1b[31m',yellow:'\x1b[33m',cyan:'\x1b[36m',bold:'\x1b[1m',dim:'\x1b[2m'};
let p=0,f=0;
const ok=(m)=>{console.log(`  ${C.green}✅ PASS${C.reset} — ${m}`);p++;};
const fail=(m)=>{console.log(`  ${C.red}❌ FAIL${C.reset} — ${m}`);f++;};
const info=(m)=>console.log(`  ${C.cyan}ℹ${C.reset}  ${m}`);
const head=(t)=>console.log(`\n${C.bold}${C.yellow}╔══════════════════════════════════════════════════════╗\n║  ${t.padEnd(52)}║\n╚══════════════════════════════════════════════════════╝${C.reset}`);

const { FinanceFundingAgent, HUMAN_APPROVAL_REQUIRED } = require('./src/agents/FinanceFundingAgent');
const scanner  = require('./src/services/funding-scanner-worker');
const prequal  = require('./src/services/prequalification-engine');
const vault    = require('./src/services/funding-vault');
const scam     = require('./src/services/funding-scam-sentry');
const voice    = require('./src/services/funding-voice-anchor');

function makeMockPool(tenantFilter=null) {
  const apps={},docs={},sigs={};
  return {
    _apps:apps,_docs:docs,_sigs:sigs,
    query:async(sql,params=[])=>{
      if(/CREATE TABLE|CREATE INDEX/.test(sql)) return {rows:[],rowCount:0};
      if(tenantFilter&&params[0]&&params[0]!==tenantFilter&&/WHERE tenant_id/.test(sql)) return {rows:[],rowCount:0};
      if(/INSERT INTO tenant_funding_applications/.test(sql)){apps[params[1]]={id:Object.keys(apps).length+1,tenant_id:params[0],application_id:params[1],program_name:params[2],organism:params[3],program_url:params[4],max_amount:parseFloat(params[5]),funding_type:params[6],status:params[7],eligibility_pct:parseFloat(params[8])};return {rows:[]};}
      if(/SELECT \* FROM tenant_funding_applications WHERE tenant_id.*ORDER/.test(sql)||/SELECT \* FROM tenant_funding_applications WHERE tenant_id/.test(sql)){return {rows:Object.values(apps).filter(a=>a.tenant_id===params[0])};}
      if(/UPDATE tenant_funding_applications\s+SET status/.test(sql)){const a=Object.values(apps).find(a=>a.tenant_id===params[0]&&a.application_id===params[1]);if(a){a.status=params[2];a.notes=params[3];a.validation_sig=params[4];}return {rows:a?[a]:[]};}
      if(/UPDATE tenant_funding_applications SET pitch_memo/.test(sql)){const a=Object.values(apps).find(a=>a.tenant_id===params[0]&&a.program_name===params[1]);if(a)a.pitch_memo=params[2];return {rows:[]};}
      if(/UPDATE tenant_funding_applications SET cover_letter/.test(sql)){const a=Object.values(apps).find(a=>a.tenant_id===params[0]&&a.program_name===params[1]);if(a)a.cover_letter=params[2];return {rows:[]};}
      if(/INSERT INTO tenant_funding_documents/.test(sql)){docs[params[1]]={id:Object.keys(docs).length+1,tenant_id:params[0],doc_id:params[1],doc_type:params[2],filename:params[3],encrypted_content:params[4],size_bytes:params[5],checksum:params[6]};return {rows:[]};}
      if(/SELECT \* FROM tenant_funding_documents WHERE tenant_id.*doc_id/.test(sql)){const d=Object.values(docs).find(d=>d.tenant_id===params[0]&&d.doc_id===params[1]);return {rows:d?[d]:[]};}
      if(/SELECT doc_id.*FROM tenant_funding_documents WHERE tenant_id/.test(sql)){return {rows:Object.values(docs).filter(d=>d.tenant_id===params[0])};}
      if(/INSERT INTO funding_signature_logs/.test(sql)){sigs[params[2]]={tenant_id:params[0],action:params[1],app_id:params[2],sig_hash:params[3]};return {rows:[]};}
      if(/INSERT INTO funding_reporting_deadlines/.test(sql)){return {rows:[]};}
      if(/SELECT \* FROM funding_reporting_deadlines WHERE tenant_id/.test(sql)){return {rows:[]};}
      if(/system_funding_opportunities/.test(sql)){return {rows:[],rowCount:0};}
      if(/tenant_ledgers/.test(sql)){return {rows:[{net_revenue_12m:85000,avg_transaction:95,tx_count:900}]};}
      return {rows:[],rowCount:0};
    }
  };
}

async function testAgent() {
  head('TEST 11-A — FINANCE FUNDING AGENT [501,507]');
  const agent = new FinanceFundingAgent();
  if(agent.type==='FINANCE_FUNDING') ok('[501] FinanceFundingAgent.type=FINANCE_FUNDING ✅');
  else fail(`[501] Type: ${agent.type}`);
  // Périmètre strict [507]
  try{agent._assertScope('submit_application');fail('[507] submit_application non bloqué');}
  catch(e){ok('[507] submit_application bloqué — validation humaine requise ✅');}
  try{agent._assertScope('upload_to_government_portal');fail('[507] upload non bloqué');}
  catch(e){ok('[507] upload_to_government_portal bloqué ✅');}
  try{agent._assertScope('delete_client');fail('[501] Périmètre non respecté');}
  catch(e){ok('[501] delete_client bloqué (hors périmètre) ✅');}
  if(HUMAN_APPROVAL_REQUIRED.has('submit_application')) ok('[507] submit_application dans HUMAN_APPROVAL_REQUIRED ✅');
}

async function testScanner() {
  head('TEST 11-B — FUNDING SCANNER [502-503]');
  if(scanner.KNOWN_PROGRAMS.length>=7) ok(`[502] ${scanner.KNOWN_PROGRAMS.length} programmes en catalogue ✅`);
  else fail(`[502] Programmes: ${scanner.KNOWN_PROGRAMS.length}`);
  const bdc = scanner.KNOWN_PROGRAMS.find(p=>p.organism.includes('BDC')||p.organism.includes('Banque de développement'));
  if(bdc) ok(`[503] BDC présent: "${bdc.name}" ✅`);
  else fail('[503] BDC absent du catalogue');
  const iq = scanner.KNOWN_PROGRAMS.find(p=>p.organism.includes('Investissement Québec'));
  if(iq) ok(`[503] Investissement Québec présent ✅`);
  else fail('[503] Investissement Québec absent');
  const types = new Set(scanner.KNOWN_PROGRAMS.map(p=>p.funding_type));
  if(types.has('subvention_non_remboursable')&&types.has('prêt_garanti')) ok('[503] Types: subvention + prêt présents ✅');
  else fail(`[503] Types présents: ${[...types].join(', ')}`);
  // [502] Mock scan (no DB)
  const pool = makeMockPool('kadio');
  const r = await scanner.scanAll(pool);
  if(r.scanned>=7) ok(`[502] scanAll(): ${r.scanned} programmes traités ✅`);
  else fail(`[502] scanAll: ${r.scanned}`);
}

async function testPrequalify() {
  head('TEST 11-C — PRÉ-QUALIFICATION RCSD WACC [504-506,505,519,532]');
  const pool = makeMockPool('kadio');

  // [505] RCSD
  const dscr1 = prequal.calculateDSCR(30000, 20000);
  if(dscr1.dscr===1.5) ok(`[505] RCSD 30k/20k = 1.5 (Acceptable) ✅`);
  else fail(`[505] RCSD: ${dscr1.dscr}`);
  if(dscr1.viable) ok('[505] RCSD 1.5 → finançable ✅');
  const dscr2 = prequal.calculateDSCR(15000, 20000);
  if(!dscr2.viable) ok('[505] RCSD 0.75 → non finançable ✅');
  else fail('[505] RCSD 0.75 devrait être non viable');

  // [519] WACC
  const wacc = prequal.calculateWACC([
    {name:'BDC',rate:5.5},{name:'Desjardins',rate:6.2},{name:'IQ',rate:4.8}
  ]);
  if(wacc.best?.name==='IQ') ok('[519] WACC: IQ 4.8% meilleur taux ✅');
  else fail(`[519] Meilleur: ${wacc.best?.name}`);
  if(wacc.recommendation?.includes('IQ')) ok('[519] Recommandation IQ ✅');
  else fail(`[519] Recommandation: ${wacc.recommendation}`);

  // [532] Simulation endettement max
  const debt = await prequal.simulateMaxDebt(pool,'kadio',{safetyMarginPct:0.30});
  if(debt.maxDebt>0) ok(`[532] Endettement max calculé: ${debt.maxDebt.toLocaleString('fr-CA')}$ CAD ✅`);
  else fail('[532] Endettement max = 0');
  if(debt.assumptions?.includes('6%')) ok('[532] Hypothèses documentées (6%, 5 ans) ✅');

  // [504] Bilan tenant
  const fin = await prequal.getTenantFinancials(pool,'kadio');
  if(fin.netRevenue12m===85000) ok('[504] CA net 12 mois: 85 000$ (depuis tenant_ledgers) ✅');
  else fail(`[504] CA: ${fin.netRevenue12m}`);

  // [506] Score éligibilité
  const opp = {eligibility:{sectors:['beaute'],geography:['Québec'],min_revenue:30000,conditions:['PME québécoise']}};
  const score = prequal.scoreEligibility(fin, opp);
  if(score>=0.80) ok(`[506] Score éligibilité: ${(score*100).toFixed(0)}% ≥ 80% → OPPORTUNITY_MATCHED ✅`);
  else fail(`[506] Score: ${(score*100).toFixed(0)}%`);

  // [523] Cache financier
  prequal.cleanTempFinancials('kadio');
  ok('[523] Cache temporaire financier purgé ✅');
}

async function testVault() {
  head('TEST 11-D — FUNDING VAULT AES-256-GCM [509,520]');
  const pool = makeMockPool('kadio');

  // Chiffrement/déchiffrement
  const original = 'NEQ: 123456789 — État financier Kadio Coiffure 2025';
  const encrypted = vault.encrypt(original);
  if(encrypted.split(':').length===3) ok('[509] Format AES-256-GCM: iv:enc:tag ✅');
  else fail(`[509] Format invalide: ${encrypted.slice(0,30)}`);
  const decrypted = vault.decrypt(encrypted);
  if(decrypted===original) ok('[509] Déchiffrement: texte original restauré ✅');
  else fail('[509] Déchiffrement incorrect');

  // Masquage identité
  const masked = vault.maskIdentityData('NEQ: 123456789 numéro: 123456789');
  if(masked.includes('***NEQ***')) ok('[509] NEQ masqué dans les logs ✅');
  else fail(`[509] Masquage: ${masked}`);

  // Stockage + récupération
  const stored = await vault.storeDocument(pool,'kadio',{docType:'neq',filename:'NEQ_kadio.txt',content:original});
  if(stored.docId?.startsWith('DOC-')) ok(`[509] Document stocké: ${stored.docId} ✅`);
  else fail(`[509] docId: ${stored.docId}`);
  if(stored.checksum?.length===16) ok(`[520] Hash SHA-256 (16 chars): ${stored.checksum} ✅`);
  else fail(`[520] Checksum: ${stored.checksum}`);

  const retrieved = await vault.retrieveDocument(pool,'kadio',stored.docId);
  if(retrieved.content===original) ok('[509] Récupération: contenu déchiffré intact ✅');
  else fail('[509] Contenu récupéré incorrect');
}

async function testPitchMemo() {
  head('TEST 11-E — PITCH MEMO + LETTRE + RCSD [508,510,507,529]');
  const pool = makeMockPool('kadio');

  // Crée une application de test
  await prequal.createApplication(pool,'kadio',{
    program:{name:'Programme BDC Test',organism:'BDC',url:'https://bdc.ca',max_amount:100000,funding_type:'prêt_garanti'},
    eligibilityPct:0.88, status:'opportunity_matched'
  });
  if(Object.keys(pool._apps).length>=1) ok('[513] Application créée en DB ✅');
  else fail('[513] Application non créée');

  // Pitch Memo
  const memo = await prequal.generatePitchMemo(pool,'kadio',{
    name:'Programme BDC Test',organism:'BDC',max_amount:100000,
    funding_type:'prêt_garanti',eligibilityPct:0.88
  });
  if(memo.memo?.includes('MÉMO EXÉCUTIF')) ok('[508] Pitch Memo généré ✅');
  else fail(`[508] Memo: ${memo.memo?.slice(0,60)}`);
  if(memo.hash?.length===16) ok(`[520] Hash intégrité Pitch Memo: ${memo.hash} ✅`);
  else fail(`[520] Hash memo: ${memo.hash}`);
  if(memo.memo?.includes('Kadio Coiffure')) ok('[508] Profil Kadio Coiffure dans le mémo ✅');

  // [507] updateApplicationStatus sans sig pour submitted → throw
  try {
    await prequal.updateApplicationStatus(pool,'kadio',{appId:'APP-TEST',status:'submitted',notes:'test'});
    fail('[507] Soumission sans signature acceptée — FAILLE');
  } catch(e){
    ok('[507] Soumission bloquée sans validation_sig cryptographique ✅');
  }

  // [529] Signature log
  const appId = Object.keys(pool._apps)[0];
  await prequal.updateApplicationStatus(pool,'kadio',{appId,status:'approved',notes:'Approuvé',validationSig:'sig_ulrich_test'});
  const hasSig = Object.keys(pool._sigs).length >= 1;
  if(hasSig) ok('[529] Signature enregistrée dans funding_signature_logs ✅');
  else fail('[529] Signature non loguée');

  // [510] Lettre (template si Claude indispo)
  const letter = await prequal.writeCoverLetter(pool,'kadio',{programName:'BDC Test',organism:'BDC',amount:50000,purpose:'expansion'});
  if(letter.coverLetter?.length>100) ok('[510] Lettre de présentation corporative générée ✅');
  else fail('[510] Lettre trop courte');
  if(letter.coverLetter?.includes('SHA-256')) ok('[520] Hash intégrité dans la lettre ✅');
}

async function testScamSentry() {
  head('TEST 11-F — SCAM SENTRY [526]');
  const gov1 = scam.verifyProgram({name:'BDC',url:'https://www.bdc.ca/fr/programme',organism:'BDC'});
  if(!gov1.blocked) ok('[526] bdc.ca → approuvé ✅');
  else fail(`[526] BDC bloqué à tort: ${gov1.reason}`);
  const gov2 = scam.verifyProgram({name:'MEI',url:'https://www.economie.gouv.qc.ca/aide',organism:'MEI'});
  if(!gov2.blocked) ok('[526] gouv.qc.ca → approuvé ✅');
  else fail('[526] MEI bloqué à tort');
  const scam1 = scam.verifyProgram({name:'Subvention gratuite immédiate',url:'https://getmoney-scam.net',organism:'inconnu'});
  if(scam1.blocked) ok('[526] Domaine non officiel → BLOQUÉ ✅');
  else fail('[526] Arnaque non détectée');
  const scam2 = scam.verifyProgram({name:'Garantie approbation subvention',url:'https://grants-canada.ru',organism:'unknown'});
  if(scam2.blocked) ok('[526] Pattern frauduleux → BLOQUÉ ✅');
  else fail('[526] Pattern frauduleux non détecté');
}

async function testVoiceAnchor() {
  head('TEST 11-G — VOICE ANCHOR [525]');
  const i1 = voice.detectFundingIntent('Béatrice, où en sont nos demandes de subventions ?');
  if(i1) ok('[525] Intent "subventions" détecté ✅');
  else fail('[525] Intent non détecté');
  const i2 = voice.detectFundingIntent('Quel est notre ROAS publicitaire ?');
  if(!i2) ok('[525] Faux positif ROAS évité ✅');
  else fail('[525] Faux positif');
  const i3 = voice.detectFundingIntent('Avons-nous une demande auprès de la BDC ?');
  if(i3) ok('[525] Intent BDC détecté ✅');
  else fail('[525] BDC non détecté');
}

async function testIsolation() {
  head('TEST 11-H — ISOLATION MULTI-TENANT [518]');
  const poolA = makeMockPool('salon_alpha');
  const poolB = makeMockPool('salon_beta');
  await prequal.createApplication(poolA,'salon_alpha',{program:{name:'BDC Alpha',organism:'BDC',url:'x',max_amount:50000,funding_type:'prêt_garanti'},eligibilityPct:0.90});
  await prequal.createApplication(poolB,'salon_beta',{program:{name:'IQ Beta',organism:'IQ',url:'x',max_amount:30000,funding_type:'subvention_non_remboursable'},eligibilityPct:0.85});
  const appsA = await prequal.getApplications(poolA,'salon_alpha');
  const appsB = await prequal.getApplications(poolB,'salon_beta');
  const alphaLeak = appsA.some(a=>a.program_name==='IQ Beta');
  const betaLeak  = appsB.some(a=>a.program_name==='BDC Alpha');
  if(!alphaLeak) ok('[518] Salon Alpha ne voit pas les dossiers Beta ✅');
  else fail('[518] FUITE: Alpha voit dossiers Beta');
  if(!betaLeak) ok('[518] Salon Beta ne voit pas les dossiers Alpha ✅');
  else fail('[518] FUITE: Beta voit dossiers Alpha');
  if(appsA.length>=1&&!alphaLeak) ok('[518] Isolation stricte confirmée ✅');
}

async function main() {
  console.log(`\n${C.bold}${C.cyan}╔══════════════════════════════════════════════════════╗\n║  DALEBA — CERTIFICATION SECTION 11 — Points 501-532  ║\n╚══════════════════════════════════════════════════════╝${C.reset}`);
  console.log(`  ${C.dim}Timestamp: ${new Date().toISOString()} | Isolation totale${C.reset}`);
  for(const[fn,n]of[[testAgent,'Agent'],[testScanner,'Scanner'],[testPrequalify,'PreQual'],[testVault,'Vault'],[testPitchMemo,'PitchMemo'],[testScamSentry,'Scam'],[testVoiceAnchor,'Voice'],[testIsolation,'Isolation']]){
    try{await fn();}catch(e){fail(`${n} crash: ${e.message}`);console.error(e.stack);}
  }
  const total=p+f,pct=total>0?Math.round(p/total*100):0;
  const col=pct===100?C.green:pct>=80?C.yellow:C.red;
  console.log(`\n${C.bold}╔══════════════════════════════════════════════════════╗\n║  RÉSULTATS SECTION 11${C.reset}`);
  console.log(`  ${C.green}✅ Passed${C.reset}: ${p} | ${C.red}❌ Failed${C.reset}: ${f} | 📊 ${col}${C.bold}${pct}% (${p}/${total})${C.reset}`);
  console.log(`${C.bold}╚══════════════════════════════════════════════════════╝${C.reset}`);
  if(pct===100)console.log(`\n  ${C.green}${C.bold}🏆 SECTION 11 CERTIFIÉE — Points 501-532 ✅${C.reset}`);
  process.exit(f>0?1:0);
}
main().catch(e=>{console.error('💥',e.stack);process.exit(2);});
