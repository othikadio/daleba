/**
 * DALEBA — Routeur d'Intentions Publicitaires
 * Optimisé pour convertir les prospects en RDV en < 2 secondes
 * Utilisé par le communication-hub lors des campagnes Meta Ads
 * Prix mis à jour V32 (mai 2026) — vrais tarifs Kadio Coiffure
 */

const BOOKING_LINK = 'https://kadiocoiffure.vercel.app/hub';

const SALON_INFO = {
  name: 'Kadio Coiffure et Esthétique',
  address: '615 Antoinette-Robidoux, local 100, Longueuil, QC J4J 2V8',
  phone: '514-919-5970',
  email: 'kadiocoiffureetesthetique@yahoo.com',
  website: 'kadiocoiffure.vercel.app/hub',
  hours: 'Mardi–Samedi : 9h–19h | Dimanche : 10h–17h | Lundi : Fermé',
};

// ─── CATALOGUE TARIFS RÉELS (mis à jour mai 2026) ─────────────────────────────
const TARIFS = {
  dreads: {
    label: 'Locks et Dreadlocks',
    highlights: [
      'Repousses retwist gel — tête complète : 135$ + taxes',
      'Repousses interlock crochet — tête complète : 150$ + taxes',
      'Repousses interlock crochet — demi tête : 125$ + taxes',
      'Départ de locks crochet — tête complète : à partir de 350$ + taxes',
      'Installation locks : à partir de 250$ + taxes',
      'Installation Sisterlocks : à partir de 850$ + taxes',
      'Entretien Sisterlocks : sur RDV + taxes',
    ],
  },
  tresses: {
    label: 'Tresses et Nattes',
    highlights: [
      'Knotless Petit : 300$+ + taxes (8h)',
      'Knotless Moyen : 150$+ + taxes (5h)',
      'Knotless Gros : 120$+ + taxes (5h)',
      'Knotless court : à partir de 120$ + taxes',
      'Nattes Américaines : à partir de 140$ + taxes',
      'Crochet braids : à partir de 170$ + taxes',
      'Twist tête complète : à partir de 120$ + taxes',
    ],
  },
  barbier: {
    label: 'Barbier et Coupe Homme',
    highlights: [
      'Coupe barbier sans barbe : 35$ + taxes (35 min)',
      'Coupe barbier avec barbe : 40$ + taxes (45 min)',
      'Coupe barbier enfant (12 ans et moins) : 30$ + taxes',
      'Barbe seule : 20$ + taxes (30 min)',
      'Contours : 20$+ + taxes (1h)',
      'Coupe homme : 35$+ + taxes',
      'Coupe homme + barbe : 40$+ + taxes',
    ],
  },
  soins: {
    label: 'Technique et Soins',
    highlights: [
      'Lissage défrisant en pot : 60$+ + taxes (1h)',
      'Soin hydratation profonde : 40$ + taxes (1h)',
      'Coupe des pointes : 30$+ + taxes',
      'Laver, sécher, lisser ou friser : 65$+ + taxes (1h30)',
      'Chignon : 80$+ + taxes (1h)',
      'Finger coils : 60$ + taxes (1h)',
    ],
  },
  tissage: {
    label: 'Tissage et Perruques',
    highlights: [
      'Tissage : à partir de 120$ + taxes (2h45)',
      'Pose lace frontale : 150$+ + taxes (1h30)',
      'Pose frontale 360° : 200$+ + taxes (2h)',
      'Pose perruque closure : 100$+ + taxes (2h)',
      'Pose perruque closure avec coiffure : 150$+ + taxes',
      'Coiffure sur lace frontale : 30$+ + taxes',
    ],
  },
  forfaits: {
    label: 'Forfaits Mensuels',
    highlights: [
      'Locs Illimité : 129,99$/mois + taxes',
      'Knotless & Tresses Signature : 139,99$/mois + taxes',
      'Tresses Rapides : 79,99$/mois + taxes',
      'Barbier Coupe & Barbe : 64,99$/mois + taxes',
      'Barbier Simple : 59,99$/mois + taxes',
      'Microlocs / Sisterlocks : 149,99$/mois + taxes',
    ],
  },
};

// ─── NOTE TAXES ────────────────────────────────────────────────────────────────
// Tous les prix sont AVANT taxes. TPS 5% + TVQ 9,975% = 14,975% s'appliquent.
// Dépôt de 20% requis à la réservation (sauf services Barbier : 0$ de dépôt).

// ─── DÉTECTION D'INTENT AVANCÉE ───────────────────────────────────────────────
function detectAdIntent(text) {
  const t = (text || '').toLowerCase()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '');

  if (/rendez|rdv|reserv|book|appoint|creneau|disponib|prendre|planifier|fixer|voulais|voudrais|j'aimerais|puis-je|peut on|peut-on/.test(t)) return 'booking';
  if (/dread|lock|sisterlocks?|retwist|interlock/.test(t)) return 'dreads';
  if (/tresse|natte|braid|knotless|box braid|twist|crochet|cornrow/.test(t)) return 'tresses';
  if (/barbier|coupe homme|barbe|contour|lineup|fade|garcon/.test(t)) return 'barbier';
  if (/tissage|lace|frontale|perruque|closure|wig/.test(t)) return 'tissage';
  if (/soin|hydrat|lissage|defris|traitement|chignon|finger coil/.test(t)) return 'soins';
  if (/forfait|abonnement|mensuel|passe|prepaye/.test(t)) return 'forfaits';
  if (/formation|cours|apprendre|coaching/.test(t)) return 'formation';
  if (/prix|tarif|cout|combien|service|menu|offre/.test(t)) return 'tarifs';
  return 'general';
}

// ─── HANDLERS ─────────────────────────────────────────────────────────────────
function responseBooking() {
  return (
    `Bonjour ! Bienvenue chez Kadio Coiffure et Esthétique — nous serions ravis de prendre soin de vous.\n\n` +
    `Pour réserver votre créneau en ligne (disponibilités en temps réel) :\n` +
    `${BOOKING_LINK}\n\n` +
    `Des questions sur nos services ? N'hésitez pas !`
  );
}

function responseTarifs() {
  const lignes = Object.values(TARIFS)
    .map(cat => `${cat.label}\n${cat.highlights.slice(0, 3).map(h => `  - ${h}`).join('\n')}`)
    .join('\n\n');

  return (
    `Nos tarifs chez Kadio Coiffure et Esthétique :\n\n` +
    `${lignes}\n\n` +
    `Prix avant taxes (TPS 5% + TVQ 9,975%). Dépôt de 20% requis à la réservation (sauf Barbier : 0$).\n\n` +
    `Réserver en ligne : ${BOOKING_LINK}`
  );
}

function responseCategory(categoryKey) {
  const cat = TARIFS[categoryKey];
  if (!cat) return responseTarifs();

  return (
    `${cat.label} — Kadio Coiffure et Esthétique :\n\n` +
    cat.highlights.map(h => `- ${h}`).join('\n') +
    `\n\nPrix avant taxes, tarifs exacts selon longueur et épaisseur.\n\n` +
    `Réserver un créneau : ${BOOKING_LINK}`
  );
}

function responseFormation() {
  return (
    `Merci de votre intérêt pour nos formations !\n\n` +
    `Kadio Coiffure propose des formations professionnelles en Locks et Sisterlocks (Certificat à la réussite) :\n\n` +
    `- Formation Locks : 1 138,50$ taxes incluses\n` +
    `- Formation Sisterlocks : 563,50$ taxes incluses\n` +
    `- Formation Complète (Locks + Sisterlocks) : 1 493,85$ taxes incluses\n\n` +
    `Prix abonnés Kadio : -20%.\n\n` +
    `Pour plus d'infos et inscription : ${SALON_INFO.website}/formation.html\n` +
    `Téléphone : ${SALON_INFO.phone}`
  );
}

async function responseGeneralLLM(text, intent = 'general') {
  try {
    const claude = require('../agents/claude');
    let styleBlock = '';
    try {
      const styleExtractor = require('./style-extractor');
      styleBlock = await styleExtractor.buildStylePromptBlock(intent);
    } catch { /* fail silencieux */ }

    const systemPrompt =
      `Tu es Daleba, l'assistante IA de ${SALON_INFO.name}.\n` +
      `Adresse : ${SALON_INFO.address}\n` +
      `Téléphone : ${SALON_INFO.phone} | Courriel : ${SALON_INFO.email}\n` +
      `Horaires : ${SALON_INFO.hours}\n` +
      `Services : Locks/Dreads, Tresses/Nattes, Barbier, Tissage/Perruques, Technique/Soins, Formations.\n` +
      `Lien réservation : ${BOOKING_LINK}\n` +
      `Tous les prix sont avant taxes (TPS 5% + TVQ 9,975%). Dépôt 20% requis sauf Barbier (0$).\n` +
      `Réponds en français, chaleureusement et professionnellement, en 2-4 phrases max.` +
      styleBlock;

    const result = await claude.query(text, systemPrompt, []);
    return result.content || responseBooking();
  } catch {
    return (
      `Bonjour ! Je suis Daleba, votre assistante chez Kadio Coiffure et Esthétique.\n\n` +
      `Comment puis-je vous aider ? Pour prendre rendez-vous :\n${BOOKING_LINK}`
    );
  }
}

// ─── POINT D'ENTRÉE PRINCIPAL ─────────────────────────────────────────────────
async function routeAdMessage(text, channel = 'facebook') {
  const intent = detectAdIntent(text);
  console.log(`[AD-ROUTER] Intent: ${intent} | Canal: ${channel}`);

  switch (intent) {
    case 'booking':   return responseBooking();
    case 'dreads':    return responseCategory('dreads');
    case 'tresses':   return responseCategory('tresses');
    case 'barbier':   return responseCategory('barbier');
    case 'soins':     return responseCategory('soins');
    case 'tissage':   return responseCategory('tissage');
    case 'forfaits':  return responseCategory('forfaits');
    case 'tarifs':    return responseTarifs();
    case 'formation': return responseFormation();
    case 'general':
    default:          return responseGeneralLLM(text, intent);
  }
}

module.exports = { routeAdMessage, detectAdIntent, BOOKING_LINK, SALON_INFO, TARIFS };
