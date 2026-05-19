const Anthropic = require('@anthropic-ai/sdk');
const { DALEBA_SYSTEM_PROMPT } = require('./persona');

// [032] Prompt Caching — réduit les coûts de ~50% sur les system prompts répétitifs
const client = process.env.ANTHROPIC_API_KEY
  ? new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })
  : null;

// Cache activé pour les system prompts > 1024 tokens
const PROMPT_CACHE_THRESHOLD = 1024;

// ─── PERSONA DALEBA (Pilier II — Point 11) ───────────────────────────────────
// Persona principale importée depuis persona.js
// Gardée ici pour compatibilité avec le flow WhatsApp existant
const DALEBA_PERSONA = `Tu es Daleba, la réceptionniste IA de Kadio Coiffure — le salon de coiffure premium de Longueuil, Québec.

**Ton identité :**
- Chaleureuse, professionnelle, élégante. Jamais froide, jamais robotique.
- Tu représentes le luxe accessible : haut de gamme mais accueillant.
- Tu parles naturellement, avec une touche de chaleur africaine subtile.

**Salon Kadio Coiffure :**
- Adresse : 615 Antoinette Robidoux, local 100, Longueuil, QC J4J 2V8
- Téléphone : (514) 919-5970
- Site : https://daleba.vercel.app
- Horaires : Lun-Ven 9h-19h, Sam 8h-18h, Dim fermé
- Services & prix approximatifs :
  - Coupe femme : 45–75$
  - Coupe homme : 25–40$
  - Tresses/Braids : 80–200$
  - Tissage/Weave : 150–300$
  - Défrisage : 80–120$
  - Coloration : 60–150$
  - Soin capillaire : 40–70$
  - Manucure/Pédicure : 35–65$
  - Épilation : 20–50$

**Langue :**
Tu détectes automatiquement la langue du client et t'adaptes.
- Français (FR) par défaut
- Anglais (EN) si le client écrit en anglais
- Tu peux saluer en langues africaines (Dioula : "I ni ce !", Nouchi, Lingala, etc.) si c'est pertinent

**Accueil standard (nouveau client WhatsApp) :**
"Bonjour ! Je suis Daleba, votre assistante chez Kadio Coiffure. 💇✨
Dans quelle langue souhaitez-vous qu'on communique ?
🇫🇷 Français | 🇬🇧 English"

**Ce que tu peux faire :**
- Donner des infos sur les services et prix
- Prendre et confirmer des rendez-vous (collecter : service, date/heure souhaitée, prénom, téléphone)
- Répondre aux questions sur le salon
- Rediriger vers un humain si besoin : "Je vais vous mettre en contact avec notre équipe !"

**Ce que tu ne fais PAS :**
- Promettre des prix exacts (tu donnes des fourchettes)
- Confirmer un créneau sans vérification réelle du calendrier
- Parler d'autres salons

Reste toujours dans ton rôle de Daleba. Sois élégante, chaleureuse, efficace.`;

async function query(message, systemPrompt = '', history = []) {
  if (!client) {
    throw new Error('ANTHROPIC_API_KEY non configurée');
  }

  const messages = [
    ...history,
    { role: 'user', content: message },
  ];

  // Priorité : systemPrompt explicite > DALEBA_SYSTEM_PROMPT (persona de guerre) > DALEBA_PERSONA legacy
  const finalSystemPrompt = systemPrompt || DALEBA_SYSTEM_PROMPT || DALEBA_PERSONA;

  // [032] Prompt caching — active le cache si le system prompt est long (> 1024 tokens estimés)
  const estimatedTokens = Math.ceil((finalSystemPrompt || '').length / 4);
  const useCache = estimatedTokens >= PROMPT_CACHE_THRESHOLD;

  const systemParam = useCache
    ? [{ type: 'text', text: finalSystemPrompt, cache_control: { type: 'ephemeral' } }]
    : finalSystemPrompt;

  const createParams = {
    model: 'claude-sonnet-4-5',
    max_tokens: 4096,
    system: systemParam,
    messages,
  };

  // Beta header requis pour prompt caching
  const response = await (useCache
    ? client.beta.promptCaching.messages.create(createParams)
    : client.messages.create(createParams));

  return {
    model: 'claude',
    content: response.content[0].text,
    usage: response.usage,
  };
}

// ─── FLOW WHATSAPP DALEBA ────────────────────────────────────────────────────
// États de conversation pour guider les clients WhatsApp
const whatsappSessions = new Map();

async function handleWhatsApp(from, message) {
  if (!client) {
    return "Je suis temporairement indisponible. Appelez-nous au (514) 919-5970 🙏";
  }

  const session = whatsappSessions.get(from) || { step: 'greeting', data: {} };
  let response;

  // Nouveau client ou réinitialisation
  if (session.step === 'greeting' || /^(bonjour|hello|salut|hi|allô|start)/i.test(message)) {
    whatsappSessions.set(from, { step: 'menu', data: {} });
    return `Bonjour ! Je suis Daleba, votre assistante chez Kadio Coiffure. 💇✨

Que puis-je faire pour vous ?

1️⃣ Prendre un rendez-vous
2️⃣ Infos & services
3️⃣ Parler à quelqu'un

Répondez avec le numéro de votre choix.`;
  }

  // Navigation du menu
  if (session.step === 'menu') {
    if (message.trim() === '1' || /rdv|rendez.vous|réserv|book/i.test(message)) {
      whatsappSessions.set(from, { step: 'rdv_service', data: {} });
      return `Super ! Pour quel service souhaitez-vous réserver ? 💇

• Coupe femme / homme
• Tresses / Braids
• Tissage / Weave
• Défrisage
• Coloration
• Soin capillaire
• Autre

Dites-moi le service qui vous intéresse !`;
    }

    if (message.trim() === '2' || /info|service|prix|tarif/i.test(message)) {
      whatsappSessions.set(from, { step: 'menu', data: {} });
      return `Voici nos services chez Kadio Coiffure ✨

💇‍♀️ *Coiffure femme :* 45–75$
💇‍♂️ *Coupe homme :* 25–40$
🪡 *Tresses/Braids :* 80–200$
💁 *Tissage/Weave :* 150–300$
💆 *Défrisage :* 80–120$
🎨 *Coloration :* 60–150$
💧 *Soin capillaire :* 40–70$
💅 *Manucure/Pédicure :* 35–65$

📍 615 Antoinette Robidoux, local 100, Longueuil
⏰ Lun-Ven 9h-19h | Sam 8h-18h

Pour réserver : tapez 1 ou visitez https://daleba.vercel.app/reservation`;
    }

    if (message.trim() === '3' || /humain|personne|quelqu'un|agent/i.test(message)) {
      whatsappSessions.set(from, { step: 'menu', data: {} });
      return `Bien sûr ! 😊 Je vous mets en contact avec notre équipe.

📞 Appelez-nous : (514) 919-5970
⏰ Lun-Ven 9h-19h | Sam 8h-18h

Ou laissez votre numéro et nous vous rappellerons dans les plus brefs délais !`;
    }
  }

  // Flow réservation
  if (session.step === 'rdv_service') {
    session.data.service = message;
    session.step = 'rdv_date';
    whatsappSessions.set(from, session);
    return `Parfait ! Quelle date et heure vous conviennent ? 📅

Par exemple : "Jeudi 22 mai à 14h"
(Nos heures : Lun-Ven 9h-19h, Sam 8h-18h)`;
  }

  if (session.step === 'rdv_date') {
    session.data.date = message;
    session.step = 'rdv_name';
    whatsappSessions.set(from, session);
    return `Super ! Quel est votre prénom ? 😊`;
  }

  if (session.step === 'rdv_name') {
    session.data.name = message;
    session.step = 'rdv_phone';
    whatsappSessions.set(from, session);
    return `Bonjour ${message} ! 🌟 Quel est votre numéro de téléphone pour la confirmation ?`;
  }

  if (session.step === 'rdv_phone') {
    session.data.phone = message;
    session.step = 'menu';
    const { service, date, name, phone } = session.data;
    whatsappSessions.set(from, { step: 'menu', data: {} });
    return `✅ Parfait ${name} ! Votre demande est enregistrée.

📋 *Récapitulatif :*
• Service : ${service}
• Date souhaitée : ${date}
• Nom : ${name}
• Tél : ${phone}

Notre équipe vous confirmera le rendez-vous par SMS sous peu.
Merci de votre confiance chez Kadio Coiffure ! 💇✨`;
  }

  // Fallback : utiliser Claude directement avec le persona Daleba
  const result = await query(message, DALEBA_PERSONA, []);
  return result.content;
}

function clearWhatsAppSession(from) {
  whatsappSessions.delete(from);
}

module.exports = { query, handleWhatsApp, clearWhatsAppSession, DALEBA_PERSONA, callClaude: query };
