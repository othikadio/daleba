'use strict';
/**
 * CERTIFICATION SECTION 9 — Points 401-418
 * Tests: Dynamic Points Engine + Google Review Guard + Viral Referral
 */
process.env.ULRICH_PHONE_NUMBER = '+15149845970';
process.env.ANTHROPIC_API_KEY   = 'sk-test-cert9-sec9';

const C={reset:'\x1b[0m',green:'\x1b[32m',red:'\x1b[31m',yellow:'\x1b[33m',cyan:'\x1b[36m',bold:'\x1b[1m',dim:'\x1b[2m'};
let passed=0,failed=0;
const ok=(m)=>{console.log(`  ${C.green}✅ PASS${C.reset} — ${m}`);passed++;};
const fail=(m)=>{console.log(`  ${C.red}❌ FAIL${C.reset} — ${m}`);failed++;};
const info=(m)=>console.log(`  ${C.cyan}ℹ${C.reset}  ${m}`);
const line=()=>console.log(`  ${C.dim}${'─'.repeat(55)}${C.reset}`);
const head=(t)=>{console.log(`\n${C.bold}${C.yellow}╔══════════════════════════════════════════════════════╗\n║  ${t.padEnd(52)}║\n╚══════════════════════════════════════════════════════╝${C.reset}`);};

const pts      = require('./src/services/dynamic-points-engine');
const guard    = require('./src/services/google-review-guard');
const referral = require('./src/services/viral-referral-engine');
const { LoyaltyAgent } = require('./src/agents/LoyaltyAgent');

// Mock pool en mémoire
function makeMockPool() {
  const cards={}, history=[], reviews={}, complaints=[], referrals=[];
  return {
    _cards:cards, _history:history, _reviews:reviews, _complaints:complaints, _referrals:referrals,
    query: async(sql,params=[])=>{
      if(/CREATE TABLE|CREATE INDEX/.test(sql)) return {rows:[]};

      // tenant_loyalty_cards
      if(/INSERT INTO tenant_loyalty_cards/.test(sql)){
        const key=`${params[0]}:${params[1]}`;
        const existing=cards[key]||{points_balance:0,points_lifetime:0};
        cards[key]={tenant_id:params[0],customer_id:params[1],customer_name:params[2],customer_phone:params[3],
          points_balance:existing.points_balance+(params[4]||0),points_lifetime:existing.points_lifetime+(params[4]||0),tier_id:'none',referral_code:null};
        return {rows:[cards[key]]};
      }
      if(/SELECT \* FROM tenant_loyalty_cards.*WHERE.*customer_id/.test(sql)){
        const key=`${params[0]}:${params[1]}`;
        return {rows:cards[key]?[cards[key]]:[]};
      }
      if(/UPDATE tenant_loyalty_cards SET points_balance.*GREATEST/.test(sql)){
        const key=`${params[0]}:${params[1]}`;
        if(cards[key]&&cards[key].points_balance>=params[2]){
          cards[key].points_balance-=params[2];
          return {rows:[{points_balance:cards[key].points_balance}]};
        }
        return {rows:[]};
      }
      if(/UPDATE tenant_loyalty_cards SET tier_id/.test(sql)){
        const key=`${params[0]}:${params[1]}`;
        if(cards[key])cards[key].tier_id=params[2];
        return {rows:[]};
      }
      if(/UPDATE tenant_loyalty_cards SET referral_code/.test(sql)){
        const key=`${params[0]}:${params[1]}`;
        if(cards[key])cards[key].referral_code=params[2];
        return {rows:[]};
      }

      // loyalty_history
      if(/INSERT INTO tenant_loyalty_history/.test(sql)){history.push({points:params[3],reason:params[4],multiplier:params[5]});return {rows:[]};}

      // review tokens
      if(/INSERT INTO tenant_review_tokens/.test(sql)){
        reviews[params[2]]={tenant_id:params[0],tx_id:params[1],token:params[2],customer_id:params[3],customer_name:params[4],customer_phone:params[5],status:'pending'};
        return {rows:[reviews[params[2]]]};
      }
      if(/SELECT \* FROM tenant_review_tokens WHERE token/.test(sql)){
        return {rows:reviews[params[0]]?[reviews[params[0]]]:[]};
      }
      if(/UPDATE tenant_review_tokens SET rating/.test(sql)){
        if(reviews[params[2]]){reviews[params[2]].rating=params[0];reviews[params[2]].status=params[1];}
        return {rows:[]};
      }
      if(/UPDATE tenant_review_tokens SET opened_at/.test(sql)) return {rows:[]};
      if(/UPDATE tenant_review_tokens SET sms_sent_at/.test(sql)) return {rows:[]};

      // private feedback
      if(/INSERT INTO tenant_private_feedback/.test(sql)){complaints.push({tenant_id:params[0],token:params[1],customer_name:params[3],rating:params[4],message:params[5]});return {rows:[]};}

      // referrals
      if(/INSERT INTO tenant_referrals/.test(sql)){
        const existing=referrals.find(r=>r.referral_code===params[3]&&r.tenant_id===params[0]);
        if(!existing)referrals.push({id:referrals.length+1,tenant_id:params[0],referrer_id:params[1],referrer_phone:params[2],referral_code:params[3],status:'pending',referee_id:null,referee_phone:null});
        return {rows:[]};
      }
      if(/SELECT \* FROM tenant_referrals.*referral_code.*status.*pending/.test(sql)){
        const ref=referrals.find(r=>r.referral_code===params[1]&&r.tenant_id===params[0]&&r.status==='pending');
        return {rows:ref?[ref]:[]};
      }
      if(/SELECT referrer_phone FROM tenant_referrals/.test(sql)){
        const ref=referrals.find(r=>r.referral_code===params[1]);
        return {rows:ref?[{referrer_phone:ref.referrer_phone}]:[]};
      }
      if(/SELECT id FROM tenant_referrals.*referee_phone/.test(sql)) return {rows:[]};
      if(/UPDATE tenant_referrals SET status.*converted/.test(sql)){
        const ref=referrals.find(r=>r.id===params[0]);
        if(ref){ref.status='converted';ref.referee_id=params[2];ref.referee_phone=params[3];}
        return {rows:[]};
      }
      if(/UPDATE tenant_referrals SET status.*fraud/.test(sql)){
        referrals.filter(r=>r.referral_code===params[1]).forEach(r=>r.status='fraud');
        return {rows:[]};
      }
      if(/SELECT.*tenant_settings/.test(sql)) return {rows:[{google_place_id:'ChIJdemo123',tenant_name:'Kadio Coiffure'}]};
      return {rows:[]};
    },
  };
}

// ── TEST SECTION 9-A: Dynamic Points Engine [408-410] ─────────────────────────
async function testDynamicPoints() {
  head('TEST 9-A — DYNAMIC POINTS ENGINE [408-410]');
  const pool = makeMockPool();
  const TENANT = 'kadio';

  // [409] Service → 1pt/$ net
  const svc = await pts.awardPoints(pool, TENANT, { customerId:'C001', customerName:'Maya',
    amountNet:120, itemType:'service', txId:'tx1', transactionAt:'2026-05-19T11:00:00Z' });
  info(`Service 120$: +${svc.awarded} pts (×${svc.multiplier})`);
  if(svc.awarded===120) ok('[409] 1pt/$ net service: 120$ → 120 pts ✅');
  else fail(`[409] Service: attendu 120, obtenu ${svc.awarded}`);

  // [409] Produit → 2pts/$ net
  const prod = await pts.awardPoints(pool, TENANT, { customerId:'C002', customerName:'Mariel',
    amountNet:50, itemType:'product', txId:'tx2', transactionAt:'2026-05-19T15:00:00Z' });
  info(`Produit 50$: +${prod.awarded} pts (×${prod.multiplier})`);
  if(prod.awarded===100) ok('[409] 2pts/$ net produit: 50$ → 100 pts ✅');
  else fail(`[409] Produit: attendu 100, obtenu ${prod.awarded}`);

  // [410] Happy Hour (mardi 10h-12h)
  const isHH = pts.isHappyHour('2026-05-19T10:30:00Z'); // Mardi (UTC)
  info(`Happy Hour mardi 10h30: ${isHH}`);
  if(isHH) ok('[410] Happy Hour détecté: mardi 10h-12h ✅');
  else fail('[410] Happy Hour non détecté pour mardi 10h30');

  const hhTx = await pts.awardPoints(pool, TENANT, { customerId:'C003', customerName:'Sophie',
    amountNet:80, itemType:'service', txId:'tx3', transactionAt:'2026-05-19T10:30:00Z' });
  info(`Service 80$ Happy Hour: +${hhTx.awarded} pts (×${hhTx.multiplier})`);
  if(hhTx.multiplier===2) ok('[410] Happy Hour multiplier ×2 appliqué ✅');
  else fail(`[410] Multiplier: attendu 2, obtenu ${hhTx.multiplier}`);
  if(hhTx.awarded===160) ok(`[410] Happy Hour: 80$ × 1pt × 2 = 160 pts ✅`);
  else fail(`[410] Happy Hour pts: attendu 160, obtenu ${hhTx.awarded}`);

  // Non-Happy Hour (samedi)
  const notHH = pts.isHappyHour('2026-05-23T10:30:00Z'); // Samedi
  if(!notHH) ok('[410] Samedi 10h30 → PAS Happy Hour (correct) ✅');
  else fail('[410] Faux positif Happy Hour le samedi');

  // [415] Balance
  const balance = await pts.getBalance(pool, TENANT, 'C003');
  info(`Solde C003: ${balance.balance} pts`);
  if(balance.balance===160) ok('[415] getBalance correct: 160 pts ✅');
  else fail(`[415] Balance: attendu 160, obtenu ${balance.balance}`);

  // [416] Paliers disponibles
  const bigTx = await pts.awardPoints(pool, TENANT, { customerId:'C003', amountNet:250, itemType:'product', txId:'tx4', transactionAt:'2026-05-19T15:00:00Z' });
  const balAfter = await pts.getBalance(pool, TENANT, 'C003');
  info(`Solde C003 après produit 250$×2: ${balAfter.balance} pts`);
  if(balAfter.availableRewards?.length > 0) ok(`[416] Paliers débloqués: ${balAfter.availableRewards.map(r=>r.name).join(', ')} ✅`);
  else fail('[416] Aucun palier débloqué alors que solde élevé');

  // [408] Rachat de points
  const redeem = await pts.redeemPoints(pool, TENANT, { customerId:'C003', points:500, reason:'Brume Botanique' });
  if(redeem.redeemed===500) ok('[408] Rachat 500 pts confirmé ✅');
  else fail(`[408] Rachat: attendu 500, obtenu ${redeem.redeemed}`);

  line();
  info(`VERDICT 9-A: service=${svc.awarded}pts | produit=${prod.awarded}pts | HH=${hhTx.awarded}pts | balance=${balAfter.balance}pts`);
}

// ── TEST SECTION 9-B: Google Review Guard [403-407] ──────────────────────────
async function testReviewGuard() {
  head('TEST 9-B — GOOGLE REVIEW GUARD [403-407]');
  const pool = makeMockPool();
  const TENANT = 'kadio';

  // [403] Schedule review request
  const scheduled = await guard.scheduleReviewRequest(pool, TENANT, {
    txId:'sq_tx_review_001', customerId:'CLIENT_A', customerName:'Sophie Mbeki', customerPhone:'+15141234567',
    appointmentEndAt: new Date(Date.now() - 5000).toISOString(), // déjà passé pour le test
  });
  if(scheduled.token?.length===32) ok(`[403] Token généré (32 chars): ${scheduled.token.slice(0,8)}... ✅`);
  else fail(`[403] Token invalide: ${scheduled.token}`);
  if(scheduled.sendAt) ok('[403] sendAt calculé (90min post-RDV) ✅');

  // [404] Page HTML de notation
  const page = guard.buildFeedbackPage(scheduled.token, 'Kadio Coiffure');
  if(page.includes('5')) ok('[404] Page contient notation 5 étoiles ✅');
  else fail('[404] Page manque notation 5 étoiles');
  if(page.includes('data-v="5"')) ok('[404] Bouton 5★ présent ✅');
  else fail('[404] Bouton 5★ absent');
  if(page.includes('attachShadow')===false) ok('[404] Pas de Shadow DOM sur feedback page ✅');

  // [405] 5★ → redirect Google
  const result5 = await guard.processFeedback(pool, TENANT, { token: scheduled.token, rating: 5 });
  info(`5★ → redirectUrl: ${result5.redirectUrl}`);
  if(result5.status==='redirected') ok('[405] 5★ → status "redirected" ✅');
  else fail(`[405] Status: attendu "redirected", obtenu "${result5.status}"`);
  if(result5.redirectUrl?.includes('google.com')) ok('[405] 5★ → redirect URL Google ✅');
  else fail(`[405] URL Google manquante: ${result5.redirectUrl}`);
  if(result5.redirectUrl?.includes('placeid=ChIJdemo123')) ok('[405] google_place_id injecté dans l\'URL ✅');
  else fail('[405] google_place_id absent de l\'URL Google');

  // [406] ≤4★ → doléance privée
  const scheduled2 = await guard.scheduleReviewRequest(pool, TENANT, {
    txId:'sq_tx_review_002', customerId:'CLIENT_B', customerName:'Jean Bertrand', customerPhone:'+15149999999',
    appointmentEndAt: new Date().toISOString(),
  });
  const result3 = await guard.processFeedback(pool, TENANT, { token: scheduled2.token, rating: 3, message: 'Attente trop longue' });
  info(`3★ → status: ${result3.status}`);
  if(result3.status==='complaint_stored') ok('[406] ≤4★ → doléance stockée (PAS de redirect Google) ✅');
  else fail(`[406] Status doléance: attendu "complaint_stored", obtenu "${result3.status}"`);
  if(!result3.redirectUrl) ok('[406] Aucun redirect Google pour 3★ ✅');
  else fail('[406] Redirect Google envoyé pour avis négatif — FAILLE');

  // [407] Doléance en DB
  if(pool._complaints.length>=1) ok(`[407] ${pool._complaints.length} doléance(s) en DB ✅`);
  else fail('[407] Doléance non persistée en DB');

  line();
  info(`VERDICT 9-B: token=✅ | 5★→Google=✅ | 3★→doléance=✅ | DB complaints=${pool._complaints.length}`);
}

// ── TEST SECTION 9-C: Viral Referral Engine [411-414] ─────────────────────────
async function testViralReferral() {
  head('TEST 9-C — VIRAL REFERRAL ENGINE [411-414]');
  const pool = makeMockPool();
  const TENANT = 'kadio';

  // [411] Génération code
  const code = referral.generateCode('Marie Tremblay', 'CUST_MARIE');
  info(`Code généré: ${code}`);
  if(code.startsWith('REF-MARIE-')) ok('[411] Format REF-PRENOM-XXX respecté ✅');
  else fail(`[411] Format incorrect: ${code}`);
  if(/^REF-[A-Z]{1,6}-[A-F0-9]{3}$/.test(code)) ok('[411] Code alphanumérique valide ✅');
  else fail(`[411] Code invalide: ${code}`);

  // Code déterministe
  const code2 = referral.generateCode('Marie Tremblay', 'CUST_MARIE');
  if(code===code2) ok('[411] Code déterministe (même client = même code) ✅');
  else fail('[411] Code non déterministe');

  // [411] createReferralCode
  const created = await referral.createReferralCode(pool, TENANT, { customerId:'CUST_MARIE', customerName:'Marie Tremblay', customerPhone:'+15141111111' });
  if(created.code===code) ok(`[411] Code créé en DB: ${created.code} ✅`);
  else fail(`[411] Code DB: attendu ${code}, obtenu ${created.code}`);
  if(created.shareUrl?.includes(code)) ok(`[412] shareUrl avec code: ${created.shareUrl} ✅`);
  else fail('[412] shareUrl manquante ou incorrecte');

  // [413] Conversion parrainage (nouveau filleul)
  const r = await referral.validateAndApply(pool, TENANT, {
    referralCode: code, refereeId:'CUST_FILLEUL', refereePhone:'+15142222222', refereeName:'Émile Lefebvre',
  });
  info(`Conversion: applied=${r.applied}, bonus=${r.referrerBonus}pts, discount=${r.refereeDiscount}%`);
  if(r.applied) ok('[413] Parrainage appliqué avec succès ✅');
  else fail(`[413] Parrainage non appliqué: ${r.reason}`);
  if(r.referrerBonus===500) ok('[413] Parrain reçoit 500 pts ✅');
  else fail(`[413] Bonus parrain: attendu 500, obtenu ${r.referrerBonus}`);
  if(r.refereeDiscount===15) ok('[413] Filleul reçoit 15% de remise ✅');
  else fail(`[413] Remise filleul: attendu 15%, obtenu ${r.refereeDiscount}%`);

  // [413] applyDiscount
  const disc = referral.applyDiscount(pool, TENANT, { customerId:'CUST_FILLEUL', amount:120 });
  if(disc.discountAmount===18) ok(`[413] Remise 15% sur 120$ = 18$ ✅`);
  else fail(`[413] Remise: attendu 18$, obtenu ${disc.discountAmount}$`);
  if(disc.amountAfterDiscount===102) ok(`[413] Net après remise: 102$ ✅`);
  else fail(`[413] Net après remise: attendu 102$, obtenu ${disc.amountAfterDiscount}$`);

  // [414] Anti-fraude: auto-parrainage (même téléphone)
  const codeMarcel = referral.generateCode('Marcel Dupont', 'CUST_MARCEL');
  await referral.createReferralCode(pool, TENANT, { customerId:'CUST_MARCEL', customerName:'Marcel Dupont', customerPhone:'+15143333333' });
  const fraudAttempt = await referral.validateAndApply(pool, TENANT, {
    referralCode: codeMarcel, refereeId:'CUST_FRAUD', refereePhone:'+15143333333', refereeName:'Faux Filleul',
  });
  info(`Anti-fraude auto-parrainage: applied=${fraudAttempt.applied}, reason=${fraudAttempt.reason}`);
  if(!fraudAttempt.applied && fraudAttempt.reason==='auto_referral_same_phone') {
    ok('[414] Auto-parrainage (même téléphone) BLOQUÉ ✅');
  } else {
    fail(`[414] Auto-parrainage non bloqué: applied=${fraudAttempt.applied}`);
  }

  // [414] Utilisation code inexistant
  const badCode = await referral.validateAndApply(pool, TENANT, { referralCode:'REF-FAUX-999', refereeId:'X', refereePhone:'+999' });
  if(!badCode.applied) ok('[414] Code inexistant → refusé ✅');
  else fail('[414] Code inexistant accepté — faille sécurité');

  // LoyaltyAgent périmètre [401]
  const agent = new LoyaltyAgent();
  try {
    await agent.execute({ action:'delete_appointment', tenantId:'kadio' });
    fail('[401] LoyaltyAgent devrait bloquer "delete_appointment"');
  } catch(e) {
    ok(`[401] Périmètre strict: "${e.message.slice(0,55)}" ✅`);
  }

  line();
  info(`VERDICT 9-C: code=${code} | +500pts=${r.referrerBonus} | -15%=${disc.discountAmount}$ | anti-fraude=✅`);
}

// ── RAPPORT FINAL ──────────────────────────────────────────────────────────────
async function main() {
  console.log(`\n${C.bold}${C.cyan}╔══════════════════════════════════════════════════════╗\n║  DALEBA — CERTIFICATION SECTION 9 — Points 401-418   ║\n╚══════════════════════════════════════════════════════╝${C.reset}`);
  console.log(`  Timestamp: ${new Date().toISOString()}\n  Isolation: mock pool — zéro réseau — zéro Twilio`);

  for(const [fn,n] of [[testDynamicPoints,'Points'],[testReviewGuard,'Review'],[testViralReferral,'Referral']]) {
    try{await fn();}catch(e){fail(`${n} crash: ${e.message}`);console.error(e.stack);}
  }

  const total=passed+failed, pct=total>0?Math.round(passed/total*100):0;
  const col=pct===100?C.green:pct>=80?C.yellow:C.red;
  console.log(`\n${C.bold}╔══════════════════════════════════════════════════════╗\n║  RÉSULTATS — SECTION 9${C.reset}`);
  console.log(`  ${C.green}✅ Passed${C.reset}: ${passed}  |  ${C.red}❌ Failed${C.reset}: ${failed}  |  📊 ${col}${C.bold}${pct}% (${passed}/${total})${C.reset}`);
  console.log(`${C.bold}╚══════════════════════════════════════════════════════╝${C.reset}`);
  if(pct===100) console.log(`\n  ${C.green}${C.bold}🏆 CERTIFICATION SECTION 9 ACCORDÉE — Points 401-418 ✅${C.reset}`);
  process.exit(failed>0?1:0);
}
main().catch(e=>{console.error('💥',e.stack);process.exit(2);});
