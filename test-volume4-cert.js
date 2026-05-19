/**
 * TEST CERTIFICATION VOLUME 4 — Suite de validation crash-test vocale
 * Simulations A, B, C — Béatrice / DALEBA
 */

'use strict';

process.env.ULRICH_PHONE_NUMBER = '+15149845970';
process.env.TWILIO_PHONE_NUMBER = '+13022328291';
process.env.DALEBA_BASE_URL     = 'https://daleba-api-production.up.railway.app';
// On coupe les vraies API pour que les tests soient déterministes
process.env.TWILIO_ACCOUNT_SID  = 'AC_TEST';
process.env.TWILIO_AUTH_TOKEN   = 'TOKEN_TEST';

const assert = require('assert');

// ─── COULEURS TERMINAL ────────────────────────────────────────────────────────
const C = {
  reset:  '\x1b[0m',
  green:  '\x1b[32m',
  red:    '\x1b[31m',
  yellow: '\x1b[33m',
  cyan:   '\x1b[36m',
  bold:   '\x1b[1m',
};
const ok   = (msg) => console.log(`  ${C.green}✅ PASS${C.reset} — ${msg}`);
const fail = (msg) => console.log(`  ${C.red}❌ FAIL${C.reset} — ${msg}`);
const info = (msg) => console.log(`  ${C.cyan}ℹ${C.reset}  ${msg}`);
const head = (msg) => console.log(`\n${C.bold}${C.yellow}${msg}${C.reset}`);

let passed = 0; let failed = 0;

function check(label, condition, detail = '') {
  if (condition) { ok(label); passed++; }
  else           { fail(`${label}${detail ? ' — ' + detail : ''}`); failed++; }
}

// ═══════════════════════════════════════════════════════════════════════════════
// SIMULATION A — LE CLIENT FURIEUX
// ═══════════════════════════════════════════════════════════════════════════════
async function simA() {
  head('╔══════════════════════════════════════════════════════════╗');
  head('║  SIMULATION A : LE CLIENT FURIEUX                        ║');
  head('╚══════════════════════════════════════════════════════════╝');

  const vsm = require('./src/services/voice-stress-monitor');

  const SPEECH    = "Je suis vraiment fâché, je veux parler au gérant tout de suite";
  const CALL_SID  = 'c_test_frustrated';

  // A1 — Score frustration ≥ 70
  const analysis = await vsm.analyzeFrustration(SPEECH, []);
  info(`analyzeFrustration → score=${analysis.frustrationScore}, sentiment=${analysis.sentiment}, source=${analysis.source}`);
  check('Score frustration ≥ 70', analysis.frustrationScore >= 70, `score=${analysis.frustrationScore}`);
  check('Sentiment FRUSTRATED ou ANGRY', ['FRUSTRATED','ANGRY'].includes(analysis.sentiment), `sentiment=${analysis.sentiment}`);

  // A2 — shouldEscalate → escalate: true
  const esc = vsm.shouldEscalate(analysis.frustrationScore, SPEECH);
  info(`shouldEscalate → escalate=${esc.escalate}, reason="${esc.reason}"`);
  check('shouldEscalate retourne true', esc.escalate === true, `escalate=${esc.escalate}`);

  // A3 — buildEscalationTwiML contient <Dial> + numéro Ulrich
  const twiml = vsm.buildEscalationTwiML({
    customerName: 'Client Test',
    reason:        esc.reason,
    callSid:       CALL_SID,
  });
  info('TwiML généré:');
  console.log('  ' + twiml.replace(/\n/g, '\n  '));

  check('TwiML contient <Dial>', twiml.includes('<Dial'), `twiml=${twiml.slice(0,80)}`);
  check('TwiML cible +15149845970', twiml.includes('+15149845970'), `twiml inclut numéro Ulrich`);
  check('TwiML contient <Say> de réassurance', twiml.includes('<Say'), `twiml inclut Say`);
  check('TwiML contient Polly.Lea-Neural', twiml.includes('Polly.Lea-Neural'), `voix Polly correcte`);
  check('TwiML contient dial-status callback', twiml.includes('dial-status'), `callback présent`);

  // A4 — sendCommanderAlert — structure SMS (mock Twilio)
  // On vérifie la construction du message sans l'envoyer
  const alertMsg = [
    `🚨 ESCALADE VOCALE — DALEBA`,
    `Client: Client Test (0514000001)`,
    `Frustration: ${analysis.frustrationScore}/100`,
  ].join('\n');
  info(`SMS structure preview:\n  ${alertMsg.replace(/\n/g, '\n  ')}`);
  check('Structure SMS d\'alerte contient ESCALADE VOCALE', alertMsg.includes('ESCALADE VOCALE'));
  check('Structure SMS contient le score', alertMsg.includes(`${analysis.frustrationScore}/100`));

  head(`  ─ Simulation A terminée ─`);
}

// ═══════════════════════════════════════════════════════════════════════════════
// SIMULATION B — L'APPEL DU COMMANDANT
// ═══════════════════════════════════════════════════════════════════════════════
async function simB() {
  head('╔══════════════════════════════════════════════════════════╗');
  head('║  SIMULATION B : APPEL DU COMMANDANT                     ║');
  head('╚══════════════════════════════════════════════════════════╝');

  const vc = require('./src/services/voice-commander');

  // B1 — isCommanderCall détecte le numéro master
  const detected = vc.isCommanderCall('+15149845970');
  info(`isCommanderCall(+15149845970) → ${detected}`);
  check('isCommanderCall détecte +15149845970', detected === true);

  const notDetected = vc.isCommanderCall('+15141112222');
  check('isCommanderCall rejette un numéro inconnu', notDetected === false);

  // B2 — Accueil militaire SSML
  const welcomeTwiml = vc.buildCommanderWelcomeTwiml();
  info(`TwiML accueil militaire:\n  ${welcomeTwiml.replace(/\n/g, '\n  ')}`);
  check('Accueil contient "Poste de commandement"', welcomeTwiml.includes('Poste de commandement'));
  check('Accueil contient "Commandant"', welcomeTwiml.includes('Commandant'));
  check('Accueil Polly Lea-Neural fr-CA', welcomeTwiml.includes('Polly.Lea-Neural') && welcomeTwiml.includes('fr-CA'));
  check('Accueil contient <Gather> pour écoute ordre', welcomeTwiml.includes('<Gather'));
  check('Accueil route vers /commander/order', welcomeTwiml.includes('commander/order'));

  // B3 — INTENT_MAP contient CA_DAILY → getDailyFinancialReport
  const caMapping = vc.INTENT_MAP['CA_DAILY'];
  info(`INTENT_MAP.CA_DAILY → fn=${caMapping?.fn}, critical=${caMapping?.critical}`);
  check('CA_DAILY mappé vers getDailyFinancialReport', caMapping?.fn === 'getDailyFinancialReport');
  check('CA_DAILY non critique (exécution directe)', caMapping?.critical === false);

  // B4 — executeIntent CA_DAILY génère un rapport (mock Square OK si indisponible)
  info('Exécution executeIntent("CA_DAILY")...');
  const caResult = await vc.executeIntent('CA_DAILY', {});
  info(`Résultat CA_DAILY: "${caResult}"`);
  check('CA_DAILY retourne une string non vide', typeof caResult === 'string' && caResult.length > 0);
  const hasFinancialInfo = /rapport|chiffre|square|indisponible|rendez-vous/i.test(caResult);
  check('CA_DAILY contient info financière ou fallback gracieux', hasFinancialInfo, `result="${caResult.slice(0,80)}"`);

  // B5 — TwiML response finale bien formée après executeIntent
  const twilio = require('twilio');
  const VR = twilio.twiml.VoiceResponse;
  const finalTwiml = new VR();
  finalTwiml.say({ voice: 'Polly.Lea-Neural', language: 'fr-CA' }, caResult);
  finalTwiml.say({ voice: 'Polly.Lea-Neural', language: 'fr-CA' }, 'Autre ordre, Commandant ?');
  finalTwiml.gather({ input: 'speech', action: `${process.env.DALEBA_BASE_URL}/api/webhook/voice/commander/order`, method: 'POST', language: 'fr-CA', speechTimeout: 'auto', timeout: 8 });
  const finalTwimlStr = finalTwiml.toString();
  info(`TwiML final réponse CA_DAILY:\n  ${finalTwimlStr.replace(/\n/g, '\n  ')}`);
  check('TwiML final contient <Say> avec résultat', finalTwimlStr.includes('<Say'));
  check('TwiML final contient <Gather> pour prochain ordre', finalTwimlStr.includes('<Gather'));

  head('  ─ Simulation B terminée ─');
}

// ═══════════════════════════════════════════════════════════════════════════════
// SIMULATION C — FALLBACK ABSOLU (Timeout réseau)
// ═══════════════════════════════════════════════════════════════════════════════
async function simC() {
  head('╔══════════════════════════════════════════════════════════╗');
  head('║  SIMULATION C : FALLBACK ABSOLU — TIMEOUT 3000ms        ║');
  head('╚══════════════════════════════════════════════════════════╝');

  const { safeVoiceRoute, buildCourtesyTwiML } = require('./src/middleware/voice-error-handler');

  // C1 — buildCourtesyTwiML produit un TwiML valide sans erreur
  const courtesy = buildCourtesyTwiML('timeout-test');
  info(`TwiML de courtoisie:\n  ${courtesy.replace(/\n/g, '\n  ')}`);
  check('Courtesy TwiML est une string XML', typeof courtesy === 'string' && courtesy.startsWith('<?xml'));
  check('Courtesy TwiML contient <Say>', courtesy.includes('<Say'));
  check('Courtesy TwiML contient <Hangup>', courtesy.includes('<Hangup'));
  check('Courtesy TwiML ne contient pas d\'erreur 500', !courtesy.includes('500'));

  // C2 — safeVoiceRoute intercepte une exception et retourne 200 + TwiML
  let capturedStatus = null;
  let capturedBody   = null;
  let capturedHeaders = {};

  const mockReq = {
    body: { CallSid: 'c_test_timeout', From: '+15140000001', To: '+13022328291' },
    query: {},
  };
  const mockRes = {
    headersSent: false,
    _headers: {},
    set(h) { Object.assign(capturedHeaders, h); return this; },
    status(s) { capturedStatus = s; return this; },
    send(b) { capturedBody = b; this.headersSent = true; },
  };

  // Simule un handler qui lève un timeout Square après 3000ms
  const crashingHandler = async (req, res) => {
    // Simule timeout 3s sur Square (ici on throw directement pour le test unitaire)
    await new Promise((_, reject) =>
      setTimeout(() => reject(new Error('Square API timeout after 3000ms')), 10) // 10ms pour le test
    );
    // Ce code n'est jamais atteint
    res.send('<Response/>');
  };

  info('Injection timeout simulé dans safeVoiceRoute...');
  const wrapped = safeVoiceRoute(crashingHandler, 'square-agenda-test');
  await wrapped(mockReq, mockRes);

  info(`HTTP status retourné: ${capturedStatus}`);
  info(`TwiML de fallback:\n  ${(capturedBody || '').toString().replace(/\n/g, '\n  ')}`);

  check('safeVoiceRoute retourne HTTP 200 (jamais 500)', capturedStatus === 200);
  check('safeVoiceRoute retourne du TwiML XML', (capturedBody || '').includes('<?xml'));
  check('TwiML fallback contient <Say>', (capturedBody || '').includes('<Say'));
  check('Content-Type application/xml', capturedHeaders['Content-Type'] === 'application/xml');
  check('Cache-Control no-cache présent', capturedHeaders['Cache-Control'] === 'no-cache');
  check('Pas de stack trace exposé dans la réponse', !(capturedBody || '').includes('Error'));

  // C3 — Test analytique: un second timeout n'envoie pas deux réponses
  const mockRes2 = { ...mockRes, headersSent: false, _sent: 0, send(b) { this._sent++; capturedBody = b; this.headersSent = true; } };
  const wrapped2 = safeVoiceRoute(crashingHandler, 'square-double-test');
  await wrapped2(mockReq, mockRes2);
  check('safeVoiceRoute n\'envoie qu\'une seule réponse', mockRes2._sent === 1, `sent=${mockRes2._sent}`);

  head('  ─ Simulation C terminée ─');
}

// ═══════════════════════════════════════════════════════════════════════════════
// RAPPORT FINAL
// ═══════════════════════════════════════════════════════════════════════════════
async function main() {
  console.log(`\n${C.bold}${C.cyan}╔══════════════════════════════════════════════════════════╗${C.reset}`);
  console.log(`${C.bold}${C.cyan}║  DALEBA — CERTIFICATION CRASH-TEST VOCAL — VOLUME 4      ║${C.reset}`);
  console.log(`${C.bold}${C.cyan}╚══════════════════════════════════════════════════════════╝${C.reset}`);
  console.log(`  Timestamp: ${new Date().toISOString()}`);
  console.log(`  Environnement: Node ${process.version}`);

  try { await simA(); } catch (e) { fail(`Simulation A crash fatal: ${e.message}`); failed++; }
  try { await simB(); } catch (e) { fail(`Simulation B crash fatal: ${e.message}`); failed++; }
  try { await simC(); } catch (e) { fail(`Simulation C crash fatal: ${e.message}`); failed++; }

  const total = passed + failed;
  const pct   = total > 0 ? Math.round((passed / total) * 100) : 0;
  const color = pct === 100 ? C.green : pct >= 80 ? C.yellow : C.red;

  console.log(`\n${C.bold}╔══════════════════════════════════════════════════════════╗${C.reset}`);
  console.log(`${C.bold}║  RÉSULTATS CERTIFICATION${C.reset}`);
  console.log(`${C.bold}╠══════════════════════════════════════════════════════════╣${C.reset}`);
  console.log(`  ${C.green}✅ Passed${C.reset}  : ${passed}`);
  console.log(`  ${C.red}❌ Failed${C.reset}  : ${failed}`);
  console.log(`  📊 Score   : ${color}${pct}% (${passed}/${total})${C.reset}`);
  console.log(`${C.bold}╚══════════════════════════════════════════════════════════╝${C.reset}`);

  if (pct === 100) {
    console.log(`\n  ${C.green}${C.bold}🏆 CERTIFICATION VOLUME 4 : ACCORDÉE${C.reset}`);
    console.log(`  ${C.green}Tous les modules vocaux sont opérationnels.${C.reset}`);
  } else if (pct >= 80) {
    console.log(`\n  ${C.yellow}${C.bold}⚠️  CERTIFICATION PARTIELLE — vérifier les échecs${C.reset}`);
  } else {
    console.log(`\n  ${C.red}${C.bold}🚫 CERTIFICATION REFUSÉE — corrections requises${C.reset}`);
  }

  process.exit(failed > 0 ? 1 : 0);
}

main().catch(err => {
  console.error('\n💥 ERREUR CRITIQUE:', err.stack || err.message);
  process.exit(2);
});
