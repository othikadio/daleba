/**
 * DALEBA — Routeur d'Intentions Publicitaires
 * Optimisé pour convertir les prospects en RDV en < 2 secondes
 * Utilisé par le communication-hub lors des campagnes Meta Ads
 */

const BOOKING_LINK = 'https://daleba-api-production.up.railway.app/reservation';

const SALON_INFO = {
  name: 'Kadio Coiffure',
  address: '615 Antoinette-Robidoux, local 100, Longueuil, QC',
  phone: '514-919-5970',
  website: 'daleba.vercel.app',
  hours: 'Mar–Sam : 9h–19h | Dim : 10h–17h | Lun : Fermé',
};

// ─── CATALOGUE TARIFS (données réelles kadio-services-final.json) ─────────────
const TARIFS = {
  dreads: {
    label: 'Dreads / Locks 🔒',
    highlights: [
      'Repousses retwist gel tête complète → 140$+',
      'Repousses interlock crochet tête complète → 150$+',
      'Départ de dreads crochet tête complète → 250$+',
      'Entretien locks → 80$+',
      'Installation Sisterlocks → à partir de 900$',
    ],
  },
  tresses: {
    label: 'Tresses & Nattes 🧶',
    highlights: [
      'Box Braids → 150$+',
      'Knotless Braids → 180$+',
      'Nattes Américaines → 150$+',
      'Twist avec mèches → 150$+',
      'Crochet braids → 120$+',
    ],
  },
  barbier: {
    label: 'Barbier 💈',
    highlights: [
      'Coupe homme → 35$+',
      'Coupe + barbe → 40$+',
      'Barbe seule → 20$+',
      'Contours → 20$+',
      'Coupe enfant (12 ans et moins) → 30$+',
    ],
  },
  coiffure: {
    label: 'Coiffure ✂️',
    highlights: [
      'Coupe afro → 40$+',
      'Chignon → 80$+',
      'Laver + sécher + lisser → 75$+',
      'Coupe garçonnière → 50$+',
    ],
  },
  tissage: {
    label: 'Tissage & Perruques 💫',
    highlights: [
      'Pose lace frontale → 150$+',
      'Pose frontale 360° → 200$+',
      'Tissage → 100$+',
      'Pose perruque closure → 100$+',
    ],
  },
  soins: {
    label: 'Soins Capillaires 🚿',
    highlights: [
      'Soin hydratation profonde → 60$+',
      'Lissage défrisant → 50$+',
    ],
  },
};

// ─── DÉTECTION D'INTENT AVANCÉE ───────────────────────────────────────────────

/**
 * Détecte l'intent publicitaire avec précision
 * @param {string} text
 * @returns {string} 'booking' | 'tarifs' | 'dreads' | 'tresses' | 'barbier' | 'coiffure' | 'tissage' | 'soins' | 'formation' | 'general'
 */
function detectAdIntent(text) {
  const t = (text || '').toLowerCase()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, ''); // retire les accents pour matching

  // Réservation / RDV
  if (/rendez|rdv|reserv|book|appoint|creneau|disponib|prendre|planifier|fixer|voulais|voudrais|j'aimerais|puis-je|peut on|peut-on/.test(t)) return 'booking';

  // Dreads / Locks
  if (/dread|lock|sisterlocks?|retwist|interlock|barrel/.test(t)) return 'dreads';

  // Tresses / Nattes
  if (/tresse|natte|braid|knotless|box braid|twist|crochet|cornrow/.test(t)) return 'tresses';

  // Barbier
  if (/barbier|coupe homme|barbe|contour|lineup|fade|garcon/.test(t)) return 'barbier';

  // Tissage / Perruques
  if (/tissage|lace|frontale|perruque|closure|wig/.test(t)) return 'tissage';

  // Soins capillaires
  if (/soin|hydrat|lissage|defris|traitement/.test(t)) return 'soins';

  // Formation / forfaits
  if (/formation|cours|apprendre|forfait|formation|coaching/.test(t)) return 'formation';

  // Tarifs généraux
  if (/prix|tarif|cout|combien|service|menu|offre/.test(t)) return 'tarifs';

  return 'general';
}

// ─── HANDLERS D'INTENT ───────────────────────────────────────────────────────

/**
 * Génère une réponse chaude + lien de réservation
 */
function responseBooking(channel = 'facebook') {
  const emoji = channel === 'instagram' ? '✨' : '💇';
  return (
    `Bonjour ! ${emoji} Bienvenue chez Kadio Coiffure — nous serions ravis de prendre soin de vous !\n\n` +
    `Pour réserver votre créneau directement en ligne, c'est par ici :\n` +
    `👉 ${BOOKING_LINK}\n\n` +
    `C'est rapide, vous voyez nos disponibilités en temps réel. Si vous avez des questions sur nos services, je suis là ! 🌟`
  );
}

/**
 * Génère une réponse tarifs complète
 */
function responseTarifs() {
  const lignes = Object.values(TARIFS)
    .map(cat => `${cat.label}\n${cat.highlights.slice(0, 3).map(h => `  • ${h}`).join('\n')}`)
    .join('\n\n');

  return (
    `Voici nos tarifs chez Kadio Coiffure 💇✨\n\n` +
    `${lignes}\n\n` +
    `Les prix sont indiqués à partir de (+ taxes). Pour réserver :\n👉 ${BOOKING_LINK}\n\n` +
    `Des questions ? Je suis là ! 😊`
  );
}

/**
 * Génère une réponse pour une catégorie de service spécifique
 */
function responseCategory(categoryKey) {
  const cat = TARIFS[categoryKey];
  if (!cat) return responseTarifs();

  return (
    `${cat.label} — Nos tarifs chez Kadio Coiffure :\n\n` +
    cat.highlights.map(h => `• ${h}`).join('\n') +
    `\n\nPrix + taxes, tarifs exacts selon longueur/épaisseur.\n\n` +
    `Pour prendre RDV :\n👉 ${BOOKING_LINK}\n\n` +
    `Hâte de vous accueillir ! ✨`
  );
}

/**
 * Génère une réponse formation
 */
function responseFormation() {
  return (
    `Merci de votre intérêt pour nos formations ! 🎓\n\n` +
    `Kadio Coiffure propose des formations professionnelles en coiffure afro (dreads, tresses, tissage...).\n\n` +
    `Pour connaître les forfaits disponibles et les dates, contactez-nous directement :\n` +
    `📞 ${SALON_INFO.phone}\n` +
    `🌐 ${SALON_INFO.website}\n\n` +
    `Ou réservez un appel de consultation ici :\n👉 ${BOOKING_LINK}`
  );
}

/**
 * Réponse générale avec LLM (Claude) enrichi contexte salon
 */
async function responseGeneralLLM(text) {
  try {
    const claude = require('../agents/claude');
    const systemPrompt = `Tu es Daleba, l'assistante IA de Kadio Coiffure (${SALON_INFO.name}).
Salon : ${SALON_INFO.address} | Tel: ${SALON_INFO.phone} | Horaires: ${SALON_INFO.hours}
Services : Dreads/Locks, Tresses/Nattes, Barbier, Coiffure, Tissage, Soins capillaires.
Lien réservation en ligne : ${BOOKING_LINK}
Réponds en français, chaleureusement, en moins de 3 phrases. Si pertinent, glisse toujours le lien de réservation.`;

    const result = await claude.query(text, systemPrompt, []);
    return result.content || responseBooking();
  } catch {
    return (
      `Bonjour ! Je suis Daleba, votre assistante chez Kadio Coiffure ✨\n\n` +
      `Comment puis-je vous aider ? Pour prendre rendez-vous directement :\n👉 ${BOOKING_LINK}`
    );
  }
}

// ─── POINT D'ENTRÉE PRINCIPAL ────────────────────────────────────────────────

/**
 * Route un message entrant de prospect publicitaire et retourne la réponse
 * @param {string} text — message du prospect
 * @param {string} channel — 'facebook' | 'instagram'
 * @returns {Promise<string>} réponse prête à envoyer
 */
async function routeAdMessage(text, channel = 'facebook') {
  const intent = detectAdIntent(text);
  console.log(`[AD-ROUTER] Intent détecté: ${intent} | Canal: ${channel}`);

  switch (intent) {
    case 'booking':
      return responseBooking(channel);

    case 'dreads':
      return responseCategory('dreads');

    case 'tresses':
      return responseCategory('tresses');

    case 'barbier':
      return responseCategory('barbier');

    case 'coiffure':
      return responseCategory('coiffure');

    case 'tissage':
      return responseCategory('tissage');

    case 'soins':
      return responseCategory('soins');

    case 'tarifs':
      return responseTarifs();

    case 'formation':
      return responseFormation();

    case 'general':
    default:
      return responseGeneralLLM(text);
  }
}

module.exports = {
  routeAdMessage,
  detectAdIntent,
  BOOKING_LINK,
  SALON_INFO,
  TARIFS,
};
