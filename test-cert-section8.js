'use strict';
/**
 * CERTIFICATION SECTION 8 — Tests 397 / 8.4 · 8.5
 * [397] Shadow DOM isolation + CORS blocage fraudes
 * [374] Allergie croisée
 * [388] Fraud detector rate-limit
 * [391] Widget analytics CTR
 */

process.env.ULRICH_PHONE_NUMBER = '+15149845970';
process.env.ANTHROPIC_API_KEY   = 'sk-test-cert8';

const C = {
  reset:'\x1b[0m', green:'\x1b[32m', red:'\x1b[31m',
  yellow:'\x1b[33m', cyan:'\x1b[36m', bold:'\x1b[1m', dim:'\x1b[2m',
};
let passed = 0, failed = 0;
const ok   = (m) => { console.log(`  ${C.green}✅ PASS${C.reset} — ${m}`); passed++; };
const fail = (m) => { console.log(`  ${C.red}❌ FAIL${C.reset} — ${m}`); failed++; };
const info = (m) => console.log(`  ${C.cyan}ℹ${C.reset}  ${m}`);
const head = (m) => console.log(`\n${C.bold}${C.yellow}╔══════════════════════════════════════════════════════╗\n║  ${m.padEnd(52)}║\n╚══════════════════════════════════════════════════════╝${C.reset}`);

const fraudDet    = require('./src/services/widget-fraud-detector');
const allergyTrk  = require('./src/services/allergy-tracker');
const shadowDom   = require('./src/services/widget-shadow-dom');
const skinFallback= require('./src/services/skin-fallback-questionnaire');
const skinProgress= require('./src/services/skin-progress-tracker');
const extRegistry = require('./src/services/extension-module-registry');
const i18n        = require('./src/services/widget-i18n');
const widgetGen   = require('./src/services/widget-generator');

// ── TEST 8.4-A : Shadow DOM isolation [385] ───────────────────────────────────
async function testShadowDOM() {
  head('TEST 8.4-A — SHADOW DOM ISOLATION [385]');

  const result = shadowDom.generateShadowDOMSnippet('kadio', 'tk_test123', { salonName: 'Kadio Coiffure' });

  if (result.script) ok('Script Shadow DOM généré ✅');
  else fail('Génération Shadow DOM échouée');

  if (result.shadowMode === true) ok('shadowMode: true ✅');
  else fail('shadowMode absent');

  if (result.script.includes('attachShadow')) ok('attachShadow({mode:"open"}) présent ✅');
  else fail('attachShadow manquant — pas de Shadow DOM réel');

  if (result.script.includes(':host{all:initial')) ok('CSS :host isolation (:host{all:initial}) ✅');
  else fail('CSS host isolation manquante');

  if (!result.script.includes('document.body.style')) ok('[385] Aucune mutation document.body.style ✅');
  else fail('[385] Script mute le body du site hôte — violation');

  const sizeKb = parseFloat(result.sizeKb);
  if (sizeKb <= 45) ok(`[360] Taille widget: ${sizeKb} Ko ≤ 45 Ko ✅`);
  else fail(`[360] Taille: ${sizeKb} Ko > 45 Ko`);
}

// ── TEST 8.4-B : CORS Fraud Detector [388] ────────────────────────────────────
async function testFraudDetector() {
  head('TEST 8.4-B — WIDGET FRAUD DETECTOR [388]');

  const API_KEY = 'tk_fraud_test_key';
  const DOMAIN  = 'evil-domain.com';

  // Reset état
  fraudDet.resetKey(API_KEY, DOMAIN);

  // 50 premières requêtes → autorisées
  let lastResult;
  for (let i = 0; i < 50; i++) {
    lastResult = fraudDet.checkRequest(API_KEY, DOMAIN);
  }
  if (lastResult.allowed) ok(`50ème requête encore autorisée (rate_limit = ${fraudDet.RATE_LIMIT}) ✅`);
  else fail(`Blocage trop tôt à la ${lastResult.count}ème requête`);

  // 51ème → suspension
  const blocked = fraudDet.checkRequest(API_KEY, DOMAIN);
  if (!blocked.allowed && blocked.suspended) ok('[388] 51ème requête → clé SUSPENDUE ✅');
  else fail('[388] Fraude non détectée à 51 req/min');

  if (blocked.resumesAt) ok(`[388] resumesAt fourni: ${blocked.resumesAt} ✅`);
  else fail('[388] resumesAt absent');

  // Vérif suspension persistante
  const check2 = fraudDet.checkRequest(API_KEY, DOMAIN);
  if (check2.suspended) ok('[388] Suspension persistante sur requêtes suivantes ✅');
  else fail('[388] Suspension non persistante');

  // Clé différente → non affectée
  const clean = fraudDet.checkRequest('tk_other_key', DOMAIN);
  if (clean.allowed) ok('[388] Autre clé non affectée par la suspension ✅');
  else fail('[388] Contamination entre clés');

  info(`Fenêtre rate-limit: ${fraudDet.WINDOW_MS / 1000}s | Limite: ${fraudDet.RATE_LIMIT} req`);
}

// ── TEST 8.4-C : Allergy Tracker [374] ───────────────────────────────────────
async function testAllergyTracker() {
  head('TEST 8.4-C — ALLERGY TRACKER CROISÉ [374]');

  // Allergie "fruits à coque" → "Huile d'Argan" bloquée
  const result1 = allergyTrk.checkCrossAllergens(
    ['Aloe Vera', "Huile d'Argan", 'Thé Vert'],
    ['fruits à coque']
  );
  info(`Allergies: ["fruits à coque"] | Ingrédients: [Aloe Vera, Huile d'Argan, Thé Vert]`);
  info(`Résultat: safe=${result1.safe}, alertes=${result1.alerts.length}`);

  if (!result1.safe) ok('[374] Allergie croisée détectée (fruits à coque ↔ Argan) ✅');
  else fail('[374] Allergie croisée non détectée');

  const arganBlocked = result1.blockedIngredients.some(i => i.toLowerCase().includes('argan'));
  if (arganBlocked) ok("[374] Huile d'Argan bloquée dans la formulation ✅");
  else fail("[374] Huile d'Argan non bloquée — faille sécurité");

  // Allergie "latex" → "Aloe Vera" bloquée
  const result2 = allergyTrk.checkCrossAllergens(['Aloe Vera', 'Lavande'], ['latex']);
  if (!result2.safe && result2.blockedIngredients.some(i => i.toLowerCase().includes('aloe'))) {
    ok('[374] Allergie croisée latex ↔ Aloe Vera détectée ✅');
  } else {
    fail('[374] Allergie croisée latex ↔ Aloe Vera non détectée');
  }

  // Aucune allergie → tout passe
  const result3 = allergyTrk.checkCrossAllergens(['Calendula', 'Camomille'], []);
  if (result3.safe) ok('[374] Aucune allergie client → tous ingrédients sûrs ✅');
  else fail('[374] Faux positif sans allergie');

  // filterSafeIngredients
  const filtered = allergyTrk.filterSafeIngredients(['Aloe Vera', "Huile d'Argan", 'Calendula'], ['fruits à coque']);
  if (filtered.safeIngredients.includes('Aloe Vera') && filtered.safeIngredients.includes('Calendula')) {
    ok(`[374] filterSafeIngredients: ${filtered.safeIngredients.length} sûrs conservés ✅`);
  } else {
    fail('[374] filterSafeIngredients incorrecte');
  }
}

// ── TEST 8.4-D : Fallback Questionnaire [382] ─────────────────────────────────
async function testFallbackQuestionnaire() {
  head('TEST 8.4-D — FALLBACK QUESTIONNAIRE [382]');

  const answers = {
    feel_after_wash: 'tiraillée et sèche',
    shine_by_noon:   'pas du tout',
    sensitivity:     'rarement',
    pores:           'pratiquement invisibles',
  };

  const result = skinFallback.determineSkinType(answers);
  info(`Réponses: [tiraillée, pas de brillance, peu sensible, pores invisibles]`);
  info(`Profil déterminé: ${result.hydration_index}`);

  if (result.hydration_index === 'sec') ok('[382] Profil "sec" correctement déterminé ✅');
  else fail(`[382] Profil attendu "sec", obtenu "${result.hydration_index}"`);

  if (result.recommended_botanicals?.length >= 2) ok(`[382] ${result.recommended_botanicals.length} botaniques recommandés ✅`);
  else fail('[382] Aucune recommandation botanique');

  if (result.care_routine?.morning && result.care_routine?.evening) ok('[382] Routine complète (matin + soir) ✅');
  else fail('[382] Routine incomplète');

  if (result.confidence_score < 1) ok(`[382] confidence_score=${result.confidence_score} < 1 (questionnaire, pas IA) ✅`);
  else fail('[382] confidence_score devrait être < 1 pour questionnaire');

  if (result.source === 'questionnaire_fallback') ok('[382] source=questionnaire_fallback ✅');
  else fail('[382] source incorrecte');

  // Questions disponibles
  const questions = skinFallback.getQuestions();
  if (questions.length >= 4) ok(`[382] ${questions.length} questions disponibles dans le questionnaire ✅`);
  else fail(`[382] Seulement ${questions.length} question(s)`);
}

// ── TEST 8.4-E : Extension Registry [387] ────────────────────────────────────
async function testExtensionRegistry() {
  head('TEST 8.4-E — EXTENSION MODULE REGISTRY [387]');

  // Module JSON valide
  const moduleConfig = {
    moduleId:  'soins-pieds',
    name:      'Soins Pédicure Spa',
    category:  'foot_care',
    version:   '2.1.0',
    endpoints: ['/api/v1/aesthetics/pedicure/book'],
    services:  ['Pédicure classique', 'Soin Spa pieds'],
  };

  const r = extRegistry.registerModule(moduleConfig);
  if (r.registered) ok('[387] Module "soins-pieds" enregistré depuis JSON ✅');
  else fail('[387] Enregistrement module échoué');

  const m = extRegistry.getModule('soins-pieds');
  if (m?.name === 'Soins Pédicure Spa') ok('[387] getModule retourne le bon module ✅');
  else fail('[387] getModule incorrect');

  // Modules intégrés
  const modules = extRegistry.listModules();
  const hasOnglerie = modules.some(m => m.moduleId === 'onglerie-avancee');
  const hasPMU      = modules.some(m => m.moduleId === 'maquillage-permanent');
  if (hasOnglerie && hasPMU) ok('[387] Modules intégrés: onglerie + maquillage permanent ✅');
  else fail('[387] Modules intégrés manquants');

  // JSON invalide → throw
  try {
    extRegistry.registerModule({ moduleId: 'x', name: 'Test' });
    fail('[387] Devrait rejeter un module sans "endpoints"');
  } catch(e) {
    ok(`[387] Module invalide rejeté: "${e.message.slice(0,50)}" ✅`);
  }

  // moduleId invalide
  try {
    extRegistry.registerModule({ moduleId: 'A B!', name:'Test', category:'x', version:'1', endpoints:['/x'] });
    fail('[387] Devrait rejeter un moduleId avec espaces');
  } catch(e) {
    ok('[387] moduleId invalide rejeté ✅');
  }
}

// ── TEST 8.4-F : Widget i18n [390] ───────────────────────────────────────────
async function testI18n() {
  head('TEST 8.4-F — WIDGET i18n FR/EN [390]');

  const fr = i18n.getTranslations('fr-CA');
  const en = i18n.getTranslations('en-US');

  if (fr.confirm === 'Confirmer le rendez-vous') ok('[390] Traductions FR: "Confirmer le rendez-vous" ✅');
  else fail(`[390] FR incorrect: ${fr.confirm}`);

  if (en.confirm === 'Confirm appointment') ok('[390] Traductions EN: "Confirm appointment" ✅');
  else fail(`[390] EN incorrect: ${en.confirm}`);

  const fallback = i18n.getTranslations('de');
  if (fallback === fr || fallback.confirm === fr.confirm) ok('[390] Fallback → FR pour langue inconnue ✅');
  else fail('[390] Fallback incorrect pour langue inconnue');

  const snippet = i18n.buildI18nSnippet();
  if (snippet.includes('navigator.language')) ok('[390] Snippet détecte navigator.language ✅');
  else fail('[390] Snippet ne détecte pas navigator.language');
}

// ── TEST 8.4-G : Skin Progress Scores [380] ───────────────────────────────────
async function testSkinProgress() {
  head('TEST 8.4-G — SKIN PROGRESS SCORES [380]');

  const analysisBefore = { hydration_index:'sec', irritation_zones:'modérée', texture:'rugueuse' };
  const analysisAfter  = { hydration_index:'normal', irritation_zones:'aucune', texture:'lisse' };

  const scoresBefore = skinProgress.analysisToScores(analysisBefore);
  const scoresAfter  = skinProgress.analysisToScores(analysisAfter);

  info(`Avant: overall=${scoresBefore.overall}/100 | Après: overall=${scoresAfter.overall}/100`);

  if (scoresAfter.overall > scoresBefore.overall) ok('[380] Score amélioré après traitement ✅');
  else fail('[380] Score non amélioré');

  const delta = scoresAfter.overall - scoresBefore.overall;
  if (delta > 0) ok(`[380] Delta: +${delta} points ✅`);

  // [383] Signature numérique
  const sig = skinProgress.signSnapshot(42, 'aesthetician_marie');
  if (sig.signedBy === 'aesthetician_marie') ok('[383] signSnapshot.signedBy correct ✅');
  else fail('[383] signedBy incorrect');
  if (sig.signatureHash?.length === 16) ok(`[383] Signature SHA256 (16 chars): ${sig.signatureHash} ✅`);
  else fail('[383] Signature incorrecte');
}

// ── RAPPORT FINAL ─────────────────────────────────────────────────────────────
async function main() {
  console.log(`\n${C.bold}${C.cyan}╔══════════════════════════════════════════════════════╗\n║  DALEBA — CERTIFICATION SECTION 8 — Tests 8.4 A→G     ║\n╚══════════════════════════════════════════════════════╝${C.reset}`);
  console.log(`  Timestamp: ${new Date().toISOString()}\n  Isolation: zéro DB — zéro réseau — zéro Twilio`);

  for (const [fn, name] of [[testShadowDOM,'Shadow DOM'],[testFraudDetector,'Fraud'],[testAllergyTracker,'Allergy'],[testFallbackQuestionnaire,'Fallback'],[testExtensionRegistry,'Registry'],[testI18n,'i18n'],[testSkinProgress,'Progress']]) {
    try { await fn(); } catch(e) { fail(`${name} crash: ${e.message}`); }
  }

  const total = passed + failed;
  const pct   = total > 0 ? Math.round(passed/total*100) : 0;
  const color = pct===100 ? C.green : pct>=80 ? C.yellow : C.red;

  console.log(`\n${C.bold}╔══════════════════════════════════════════════════════╗\n║  RÉSULTATS — CERTIFICATION SECTION 8${C.reset}`);
  console.log(`  ${C.green}✅ Passed${C.reset}: ${passed}  |  ${C.red}❌ Failed${C.reset}: ${failed}  |  📊 ${color}${C.bold}${pct}% (${passed}/${total})${C.reset}`);
  console.log(`${C.bold}╚══════════════════════════════════════════════════════╝${C.reset}`);
  if (pct===100) console.log(`\n  ${C.green}${C.bold}🏆 CERTIFICATION SECTION 8: ACCORDÉE — Section 351-400 COMPLETE${C.reset}`);

  process.exit(failed>0?1:0);
}

main().catch(e=>{console.error('💥',e.stack);process.exit(2);});
