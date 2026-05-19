/**
 * Tests Unitaires TwiML — DALEBA Metacortex Point 248
 *
 * Valide la génération de TwiML pour chaque route vocale:
 * - Welcome (accueil + SSML)
 * - Availability (créneaux fr-CA)
 * - Confirmation réservation
 * - Identité client
 * - Escalade urgence (Say + Dial)
 * - Fallback mécanique
 * - Courtesy TwiML [236]
 * - Accueil militaire [232]
 * - OTP vocal [221]
 */

'use strict';

process.env.ULRICH_PHONE_NUMBER = '+15149845970';
process.env.TWILIO_PHONE_NUMBER = '+13022328291';

const assert = (label, cond, got) => {
  if (cond) { console.log(`  ✅ ${label}`); return true; }
  else { console.error(`  ❌ ${label} | got: ${JSON.stringify(got)}`); return false; }
};

let passed = 0, failed = 0;
function check(label, cond, got) {
  if (assert(label, cond, got)) passed++; else failed++;
}

function hdr(title) { console.log(`\n[${title}]`); }

// ─── MODULES ──────────────────────────────────────────────────────────────────

const twimlGen  = require('./src/services/twiml-generator');
const stress    = require('./src/services/voice-stress-monitor');
const { safeVoiceRoute, buildCourtesyTwiML } = require('./src/middleware/voice-error-handler');
const { maskPhone } = require('./src/services/call-recorder');
const commander = require('./src/services/voice-commander');
const bookingMgr = require('./src/services/voice-booking-manager');

// ─── TESTS TwiML WELCOME [207-209] ───────────────────────────────────────────

hdr('WELCOME TwiML [207-209, 246]');
const welcomeT = twimlGen.buildWelcomeTwiML({
  callSid: 'CA_UNIT_01',
  tenantName: 'Kadio Coiffure',
  customerName: null,
  callbackPath: '/api/webhook/voice/gather',
});
check('[207] Gather présent',        welcomeT.includes('<Gather'), welcomeT.slice(0,100));
check('[207] input="speech"',        welcomeT.includes('input="speech"'));
check('[207] language="fr-CA"',      welcomeT.includes('language="fr-CA"'));
check('[207] speechTimeout="auto"',  welcomeT.includes('speechTimeout="auto"'));
check('[207] timeout="5"',           welcomeT.includes('timeout="5"'));
check('[208] Polly.Lea-Neural',      welcomeT.includes('Polly.Lea-Neural'));
check('[209] <break> SSML',          welcomeT.includes('<break'));
check('[246] speechModel=phone_call',welcomeT.includes('phone_call'));
check('[246] enhanced=true',         welcomeT.includes('enhanced="true"'));

// ─── WELCOME PERSONNALISÉ [216] ───────────────────────────────────────────────

hdr('WELCOME PERSONNALISÉ [216]');
const welcomePerso = twimlGen.buildWelcomeTwiML({
  tenantName: 'Kadio Coiffure', customerName: 'Marie',
});
check('[216] Prénom dans TwiML',  welcomePerso.includes('Marie'));
check('[216] "ravi de vous"',     welcomePerso.includes('ravi'));

// ─── AVAILABILITÉ [214-215] ───────────────────────────────────────────────────

hdr('DISPONIBILITÉS [214-215]');
const slots = [
  { label: 'demain le matin à 14h', startAt: new Date(Date.now()+86400000).toISOString() },
  { label: 'ce vendredi à 10h30',   startAt: new Date(Date.now()+172800000).toISOString() },
  { label: 'ce samedi à 13h',       startAt: new Date(Date.now()+259200000).toISOString() },
  { label: 'la semaine prochaine',  startAt: new Date(Date.now()+604800000).toISOString() },
];
const availT = twimlGen.buildAvailabilityTwiML(slots);
check('[214] Max 3 créneaux',     !availT.includes('la semaine prochaine'));
check('[215] Formulation naturelle', availT.includes('demain') || availT.includes('Nous avons'));
check('[208] Polly dans avail',   availT.includes('Polly.Lea-Neural'));
check('[209] break SSML avail',   availT.includes('<break'));

// ─── CONFIRMATION [218-220] ───────────────────────────────────────────────────

hdr('CONFIRMATION RDV [218-220]');
const confirmT = twimlGen.buildConfirmationTwiML({
  customerName: 'Jean', slotLabel: 'vendredi à 10h30', serviceName: 'Coupe',
});
check('[218] Confirm TwiML généré', confirmT.length > 50);
check('[218] Mention créneau',      confirmT.includes('vendredi') || confirmT.includes('10h30'));
check('[220] Mention confirmation', confirmT.includes('confirm') || confirmT.includes('not'));

// ─── ESCALADE [224-225] ───────────────────────────────────────────────────────

hdr('ESCALADE URGENCE [224-225]');
const escalT = stress.buildEscalationTwiML({
  customerName: 'Pierre', reason: 'Frustration score: 85/100',
});
check('[225] <Say> présent',         escalT.includes('<Say'));
check('[225] <Dial> présent',        escalT.includes('<Dial'));
check('[225] Polly Lea Neural',      escalT.includes('Polly.Lea-Neural'));
check('[225] Numéro Ulrich',         escalT.includes('+15149845970'));
check('[225] Message transfert',     escalT.includes('transfère') || escalT.includes('Ulrich'));
check('[225] <break> SSML',          escalT.includes('<break'));
check('[224] shouldEscalate(75)',    stress.shouldEscalate(75, '').escalate === true);
check('[224] shouldEscalate(KW)',    stress.shouldEscalate(0, 'je veux parler à un humain').escalate === true);
check('[224] No escalate normal',    stress.shouldEscalate(30, 'réserver vendredi').escalate === false);

// ─── FALLBACK MÉCANIQUE [235] ─────────────────────────────────────────────────

hdr('FALLBACK MÉCANIQUE [235]');
const fallbackT = bookingMgr.buildFallbackTwiML({ tenantName: 'Kadio Coiffure' });
check('[235] Say présent',      fallbackT.includes('<Say'));
check('[235] Hangup présent',   fallbackT.includes('<Hangup'));
check('[235] Polly Lea Neural', fallbackT.includes('Polly.Lea-Neural'));
check('[235] Message SMS',      fallbackT.includes('SMS') || fallbackT.includes('message'));

// ─── COURTESY TwiML [236] ─────────────────────────────────────────────────────

hdr('COURTESY TwiML [236]');
const courtT = buildCourtesyTwiML('test-route');
check('[236] Say présent',      courtT.includes('<Say'));
check('[236] Hangup présent',   courtT.includes('<Hangup'));
check('[236] Message d\'excuse',courtT.includes('désolé') || courtT.includes('erreur'));
check('[236] Numéro fallback',  courtT.includes('neuf') || courtT.includes('519') || courtT.includes('cinq'));

// ─── MASQUAGE NUMÉROS [243] ───────────────────────────────────────────────────

hdr('MASQUAGE NUMÉROS [243]');
check('[243] +15149845970 masqué', maskPhone('+15149845970') !== '+15149845970');
check('[243] Format ***',          maskPhone('+15149845970').includes('***'));
check('[243] Préserve 1er+dernier',maskPhone('+15149845970').startsWith('+1514'));
check('[243] null safe',           maskPhone(null) === '***');

// ─── ACCUEIL MILITAIRE [232] ──────────────────────────────────────────────────

hdr('POSTE DE COMMANDEMENT [231-234]');
const cmdT = commander.buildCommanderWelcomeTwiml();
check('[232] "commandement"',    cmdT.includes('commandement'));
check('[232] "Commandant"',      cmdT.includes('Commandant'));
check('[232] SSML break',        cmdT.includes('<break'));
check('[232] Gather présent',    cmdT.includes('<Gather'));
check('[233] CA_DAILY mappé',    commander.INTENT_MAP['CA_DAILY'] !== undefined);
check('[233] SWARM_STATUS mappé',commander.INTENT_MAP['SWARM_STATUS'] !== undefined);
check('[233] ERRORS mappé',      commander.INTENT_MAP['ERRORS'] !== undefined);
check('[234] buildConfirmationTwiml', typeof commander.buildConfirmationTwiml === 'function');

// ─── IDENTITÉ INCONNUE [217] ─────────────────────────────────────────────────

hdr('CAPTURE IDENTITÉ [217]');
const idT = twimlGen.buildIdentityCapturesTwiML('firstname');
check('[217] Gather pour prénom', idT.includes('<Gather'));
check('[217] Question prénom',    idT.includes('prénom') || idT.includes('prenom'));
check('[217] Polly Lea',         idT.includes('Polly.Lea-Neural'));

// ─── GZIP FILTER [244] ────────────────────────────────────────────────────────

hdr('COMPRESSION GZIP [244]');
check('[244] compression installé', (() => { try { require('compression'); return true; } catch { return false; } })());

// ─── RAPPORT FINAL ────────────────────────────────────────────────────────────

const total = passed + failed;
console.log(`\n${'='.repeat(52)}`);
console.log(`TESTS TwiML 248 | Score: ${passed}/${total} (${Math.round(passed/total*100)}%)`);
if (failed === 0) console.log('✅ TOUS LES TESTS PASSENT');
else console.log(`❌ ${failed} test(s) en échec`);
console.log('='.repeat(52));
process.exit(failed > 0 ? 1 : 0);
