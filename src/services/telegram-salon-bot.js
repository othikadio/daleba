/**
 * DALEBA — Bot Telegram Kadio Coiffure (@Kadiocoiffurebot)
 * Assistant IA dédié exclusivement au salon de coiffure
 * Connecté à Square, DALEBA et toute la connaissance du salon
 */

'use strict';

const axios = require('axios');

const BOT_TOKEN = process.env.TELEGRAM_SALON_BOT_TOKEN || '8828232335:AAGnV_BO-nllyhHkjbnGSCOpiSJk-YxNAVk';
const TELEGRAM_API = `https://api.telegram.org/bot${BOT_TOKEN}`;

// ─── DONNÉES SALON COMPLÈTES ──────────────────────────────────────────────────

const SALON_INFO = {
  name: 'Kadio Coiffure',
  address: '615 Antoinette-Robidoux, local 100, Longueuil, QC J4J 2V8',
  phone: '+1 (514) 919-5970',
  website: 'https://kadiocoiffure.vercel.app',
  booking_url: 'https://kadiocoiffure.vercel.app/hub',
  owner: 'Kadio Ehouman Ulrich',
  hours: {
    lundi: '10h00 – 19h00',
    mardi: '10h00 – 19h00',
    mercredi: '10h00 – 19h00',
    jeudi: '10h00 – 19h00',
    vendredi: '10h00 – 20h00',
    samedi: '09h00 – 18h00',
    dimanche: 'Fermé',
  },
};

const SERVICES_CATALOG = [
  {
    cat: '🔒 Dreads / Locks',
    items: [
      'Repousses retwist au gel (tête complète) — 140$+',
      'Repousses interlock au crochet (tête complète) — 150$+',
      'Repousses demi-tête — à partir de 120$+',
      'Départ de dreads crochet (tête complète) — 250$+',
      'Création de locks — 250$+',
      'Entretien locks — 80$+',
      'Installation Sisterlocks — à partir de 900$',
      'Entretien Sisterlocks — 250$+',
      'Barrel twist (locks) — 80$+',
      'Réparation de dreads — 40$+',
    ],
  },
  {
    cat: '🧶 Tresses & Nattes',
    items: [
      'Nattes Américaines — 150$+',
      'Box Braids — 150$+',
      'Knotless Braids — 180$+',
      'Crochet braids — 120$+',
      'Twist avec mèches — 150$+',
      'Twist sans mèches — 120$+',
      'Barrel twist (tête complète) — 100$+',
      'Nattes collées — à partir de 60$+',
    ],
  },
  {
    cat: '💈 Barbier',
    items: [
      'Coupe homme — 35$+',
      'Coupe + barbe — 40$+',
      'Contours — 20$+',
      'Barbe — 20$+',
      'Coupe 12 ans et moins — 30$+',
    ],
  },
  {
    cat: '✂️ Coiffure',
    items: [
      'Coupe cheveux afro — 40$+',
      'Coupe garçonnière — 50$+',
      'Chignon — 80$+',
      'Laver, sécher, lisser — 75$+',
      'Coupe des pointes — 30$+',
    ],
  },
  {
    cat: '💫 Tissage & Perruques',
    items: [
      'Tissage — 100$+',
      'Pose lace frontale — 150$+',
      'Pose frontale 360° — 200$+',
      'Pose perruque closure — 100$+',
    ],
  },
  {
    cat: '🎨 Teinture & Soins',
    items: [
      'Teinture noire — 50$+',
      'Soin hydratation profonde — 60$+',
      'Lissage défrisant — 50$+',
    ],
  },
];

// ─── SYSTEM PROMPT ────────────────────────────────────────────────────────────

function buildSystemPrompt() {
  const servicesText = SERVICES_CATALOG.map(cat =>
    `${cat.cat}:\n${cat.items.map(i => `  • ${i}`).join('\n')}`
  ).join('\n\n');

  const hoursText = Object.entries(SALON_INFO.hours)
    .map(([j, h]) => `  ${j.charAt(0).toUpperCase() + j.slice(1)} : ${h}`)
    .join('\n');

  return `Tu es l'assistante officielle de Kadio Coiffure, un salon de coiffure afro situé à Longueuil, Québec.

IDENTITÉ : Tu t'appelles "Kadio Coiffure IA" (ou simplement "l'assistante du salon"). Tu es chaleureuse, professionnelle, et tu représentes le salon avec fierté.

SALON :
• Nom : ${SALON_INFO.name}
• Adresse : ${SALON_INFO.address}
• Téléphone : ${SALON_INFO.phone}
• Site web : ${SALON_INFO.website}
• Réservation en ligne : ${SALON_INFO.booking_url}

HORAIRES :
${hoursText}

SERVICES & TARIFS :
${servicesText}

RÈGLES DE COMMUNICATION :
1. Réponds TOUJOURS en français (sauf si le client écrit en anglais — adapte-toi à sa langue)
2. Sois chaleureuse, positive et professionnelle
3. Pour les réservations : dirige vers le site web OU propose d'appeler le salon
4. Les prix affichés sont des minimums (le "+" signifie "et plus selon la longueur/complexité")
5. Pour les consultations gratuites ou devis précis : suggère d'appeler ou venir au salon
6. Ne jamais inventer de prix ou disponibilités — dire "contactez-nous pour confirmer"
7. Réponds de manière concise (Telegram = mobile, évite les murs de texte)
8. Utilise des emojis avec modération pour rendre les réponses agréables

GESTION DES RÉSERVATIONS :
• Réservation en ligne : ${SALON_INFO.booking_url}
• Par téléphone : ${SALON_INFO.phone}
• Dépôt peut être requis pour certains services longs (ex: Sisterlocks, tresses longues)
• Annulation : prévenir au moins 24h à l'avance

TU NE GÈRES PAS :
• Paiements (rediriger vers le salon)
• Modifications/annulations directes (appeler le salon)
• Questions hors contexte salon (rediriger poliment)`;
}

// ─── SESSIONS EN MÉMOIRE ──────────────────────────────────────────────────────

const sessions = new Map(); // chatId → [{role, content}]

function getSession(chatId) {
  if (!sessions.has(chatId)) {
    sessions.set(chatId, []);
  }
  return sessions.get(chatId);
}

function addToSession(chatId, role, content) {
  const hist = getSession(chatId);
  hist.push({ role, content });
  // Garder max 20 messages (fenêtre glissante)
  if (hist.length > 20) hist.splice(0, hist.length - 20);
}

// ─── APPEL IA ─────────────────────────────────────────────────────────────────

async function askAI(chatId, userMessage) {
  addToSession(chatId, 'user', userMessage);
  const history = getSession(chatId);

  // Essaie Claude d'abord (via DARE ou Anthropic direct)
  const anthropicKey = process.env.ANTHROPIC_API_KEY;
  const openaiKey = process.env.OPENAI_API_KEY;

  if (anthropicKey) {
    try {
      const Anthropic = require('@anthropic-ai/sdk');
      const client = new Anthropic({ apiKey: anthropicKey });
      const response = await client.messages.create({
        model: 'claude-haiku-4-5',
        max_tokens: 800,
        system: buildSystemPrompt(),
        messages: history.map(m => ({ role: m.role, content: m.content })),
      });
      const reply = response.content[0].text;
      addToSession(chatId, 'assistant', reply);
      return reply;
    } catch (e) {
      console.error('[TelegramBot] Claude error:', e.message);
    }
  }

  // Fallback OpenAI
  if (openaiKey) {
    try {
      const response = await axios.post(
        'https://api.openai.com/v1/chat/completions',
        {
          model: 'gpt-4o-mini',
          max_tokens: 800,
          messages: [
            { role: 'system', content: buildSystemPrompt() },
            ...history.map(m => ({ role: m.role, content: m.content })),
          ],
        },
        { headers: { Authorization: `Bearer ${openaiKey}` } }
      );
      const reply = response.data.choices[0].message.content;
      addToSession(chatId, 'assistant', reply);
      return reply;
    } catch (e) {
      console.error('[TelegramBot] OpenAI error:', e.message);
    }
  }

  // Fallback statique
  return fallbackResponse(userMessage);
}

// ─── RÉPONSES DE FALLBACK ─────────────────────────────────────────────────────

function fallbackResponse(text) {
  const t = text.toLowerCase();
  if (/rdv|rendez|réserv|book/.test(t))
    return `📅 Pour prendre rendez-vous :\n\n🌐 En ligne : ${SALON_INFO.booking_url}\n📞 Par téléphone : ${SALON_INFO.phone}`;
  if (/prix|tarif|coût|combien/.test(t))
    return `💰 Nos tarifs varient selon le service. Écrivez le service qui vous intéresse et je vous donnerai les détails !`;
  if (/horaire|heure|ouvert|fermé/.test(t))
    return formatHoraires();
  if (/adresse|où|localisation|trouver/.test(t))
    return formatAdresse();
  return `Bonjour ! 🌺 Je suis l'assistante de Kadio Coiffure.\n\nJe peux vous renseigner sur nos services, tarifs, horaires, et vous aider à prendre rendez-vous.\n\nQue puis-je faire pour vous ? 😊`;
}

// ─── FORMATTERS ──────────────────────────────────────────────────────────────

function formatWelcome(firstName) {
  return `Bonjour ${firstName || ''} ! 🌺

Bienvenue chez *Kadio Coiffure* — votre salon afro à Longueuil !

Je suis votre assistante IA. Je peux vous aider avec :

📅 /rdv — Prendre un rendez-vous
💈 /services — Nos services & tarifs
⏰ /horaires — Nos heures d'ouverture
📍 /adresse — Nous trouver
📞 /contact — Nous contacter

Ou posez-moi directement votre question ! 😊`;
}

function formatHoraires() {
  return `⏰ *Horaires de Kadio Coiffure :*

🗓 Lundi – Jeudi : 10h00 – 19h00
🗓 Vendredi : 10h00 – 20h00
🗓 Samedi : 09h00 – 18h00
🔴 Dimanche : Fermé

📍 ${SALON_INFO.address}`;
}

function formatAdresse() {
  return `📍 *Kadio Coiffure*

615 Antoinette-Robidoux, local 100
Longueuil, QC J4J 2V8

🚌 Accessible en transport en commun
🅿️ Stationnement disponible

📞 ${SALON_INFO.phone}
🌐 ${SALON_INFO.website}`;
}

function formatContact() {
  return `📞 *Nous contacter :*

☎️ Téléphone : ${SALON_INFO.phone}
🌐 Site web : ${SALON_INFO.website}
📅 Réservation en ligne : ${SALON_INFO.booking_url}

📍 ${SALON_INFO.address}
⏰ Lun–Jeu: 10h-19h | Ven: 10h-20h | Sam: 9h-18h`;
}

function formatRDV() {
  return `📅 *Prendre un rendez-vous*

Vous pouvez réserver de 3 façons :

🌐 *En ligne (24/7) :*
${SALON_INFO.booking_url}

📞 *Par téléphone :*
${SALON_INFO.phone}
(Lun-Ven 10h-18h, Sam 9h-17h)

💬 *En direct ici :*
Dites-moi le service souhaité et je vous guide !`;
}

function formatServicesMenu() {
  return `💈 *Nos services — Kadio Coiffure*

Choisissez une catégorie :`;
}

function formatServiceCategory(catIndex) {
  if (catIndex < 0 || catIndex >= SERVICES_CATALOG.length) return null;
  const cat = SERVICES_CATALOG[catIndex];
  const items = cat.items.map(i => `• ${i}`).join('\n');
  return `${cat.cat}\n\n${items}\n\n_Note : prix de base, variables selon longueur & complexité_\n📅 Réserver : ${SALON_INFO.booking_url}`;
}

// ─── KEYBOARDS ───────────────────────────────────────────────────────────────

function mainMenuKeyboard() {
  return {
    inline_keyboard: [
      [
        { text: '📅 Prendre RDV', callback_data: 'cmd_rdv' },
        { text: '💈 Services', callback_data: 'cmd_services' },
      ],
      [
        { text: '⏰ Horaires', callback_data: 'cmd_horaires' },
        { text: '📍 Adresse', callback_data: 'cmd_adresse' },
      ],
      [
        { text: '📞 Contact', callback_data: 'cmd_contact' },
      ],
    ],
  };
}

function servicesKeyboard() {
  const rows = [];
  SERVICES_CATALOG.forEach((cat, i) => {
    const label = cat.cat.replace(/[^\w\s&éèêàùû/\-]/g, '').trim();
    // Bouton par catégorie
    if (i % 2 === 0) rows.push([]);
    rows[rows.length - 1].push({ text: cat.cat, callback_data: `svc_${i}` });
  });
  rows.push([{ text: '⬅️ Retour au menu', callback_data: 'cmd_menu' }]);
  return { inline_keyboard: rows };
}

function backKeyboard() {
  return {
    inline_keyboard: [
      [
        { text: '📅 Prendre RDV', callback_data: 'cmd_rdv' },
        { text: '💈 Services', callback_data: 'cmd_services' },
      ],
      [{ text: '🏠 Menu principal', callback_data: 'cmd_menu' }],
    ],
  };
}

// ─── ENVOI TELEGRAM ───────────────────────────────────────────────────────────

async function sendMessage(chatId, text, keyboard = null, parseMode = 'Markdown') {
  const payload = {
    chat_id: chatId,
    text,
    parse_mode: parseMode,
  };
  if (keyboard) payload.reply_markup = keyboard;

  try {
    await axios.post(`${TELEGRAM_API}/sendMessage`, payload);
  } catch (e) {
    console.error('[TelegramBot] sendMessage error:', e.response?.data || e.message);
    // Retry without markdown if parsing fails
    if (parseMode === 'Markdown') {
      try {
        await axios.post(`${TELEGRAM_API}/sendMessage`, {
          chat_id: chatId,
          text: text.replace(/[*_`\[\]]/g, ''),
          reply_markup: keyboard,
        });
      } catch (e2) {
        console.error('[TelegramBot] sendMessage retry error:', e2.message);
      }
    }
  }
}

async function answerCallbackQuery(callbackQueryId, text = '') {
  try {
    await axios.post(`${TELEGRAM_API}/answerCallbackQuery`, {
      callback_query_id: callbackQueryId,
      text,
    });
  } catch (e) {
    // non-critical
  }
}

async function sendTyping(chatId) {
  try {
    await axios.post(`${TELEGRAM_API}/sendChatAction`, {
      chat_id: chatId,
      action: 'typing',
    });
  } catch (e) {
    // non-critical
  }
}

// ─── HANDLER PRINCIPAL ────────────────────────────────────────────────────────

async function handleUpdate(update) {
  // Message texte
  if (update.message) {
    const msg = update.message;
    const chatId = msg.chat.id;
    const text = msg.text || '';
    const firstName = msg.from?.first_name || '';

    // Commandes
    if (text.startsWith('/start')) {
      return sendMessage(chatId, formatWelcome(firstName), mainMenuKeyboard());
    }
    if (text.startsWith('/rdv')) {
      return sendMessage(chatId, formatRDV(), backKeyboard());
    }
    if (text.startsWith('/services')) {
      return sendMessage(chatId, formatServicesMenu(), servicesKeyboard());
    }
    if (text.startsWith('/horaires')) {
      return sendMessage(chatId, formatHoraires(), backKeyboard());
    }
    if (text.startsWith('/adresse')) {
      return sendMessage(chatId, formatAdresse(), backKeyboard());
    }
    if (text.startsWith('/contact')) {
      return sendMessage(chatId, formatContact(), backKeyboard());
    }
    if (text.startsWith('/aide')) {
      return sendMessage(chatId, formatWelcome(firstName), mainMenuKeyboard());
    }
    if (text.startsWith('/promotions')) {
      await sendTyping(chatId);
      const reply = await askAI(chatId, 'Quelles sont les promotions et offres spéciales actuelles du salon ?');
      return sendMessage(chatId, reply, backKeyboard());
    }

    // Message naturel → IA
    await sendTyping(chatId);
    const reply = await askAI(chatId, text);
    return sendMessage(chatId, reply, backKeyboard());
  }

  // Callback query (boutons inline)
  if (update.callback_query) {
    const cb = update.callback_query;
    const chatId = cb.message.chat.id;
    const data = cb.data;

    await answerCallbackQuery(cb.id);

    if (data === 'cmd_menu') {
      return sendMessage(chatId, formatWelcome(cb.from?.first_name), mainMenuKeyboard());
    }
    if (data === 'cmd_rdv') {
      return sendMessage(chatId, formatRDV(), backKeyboard());
    }
    if (data === 'cmd_services') {
      return sendMessage(chatId, formatServicesMenu(), servicesKeyboard());
    }
    if (data === 'cmd_horaires') {
      return sendMessage(chatId, formatHoraires(), backKeyboard());
    }
    if (data === 'cmd_adresse') {
      return sendMessage(chatId, formatAdresse(), backKeyboard());
    }
    if (data === 'cmd_contact') {
      return sendMessage(chatId, formatContact(), backKeyboard());
    }
    if (data.startsWith('svc_')) {
      const idx = parseInt(data.replace('svc_', ''), 10);
      const text = formatServiceCategory(idx);
      if (text) {
        return sendMessage(chatId, text, {
          inline_keyboard: [
            [{ text: '📅 Prendre RDV', callback_data: 'cmd_rdv' }],
            [{ text: '⬅️ Retour aux services', callback_data: 'cmd_services' }],
          ],
        });
      }
    }
  }
}

// ─── SETUP WEBHOOK ────────────────────────────────────────────────────────────

async function setWebhook(baseUrl) {
  const webhookUrl = `${baseUrl}/api/webhook/telegram/salon`;
  try {
    const res = await axios.post(`${TELEGRAM_API}/setWebhook`, {
      url: webhookUrl,
      allowed_updates: ['message', 'callback_query'],
      drop_pending_updates: true,
    });
    console.log('[TelegramBot] Webhook set:', webhookUrl, res.data);
    return res.data;
  } catch (e) {
    console.error('[TelegramBot] setWebhook error:', e.message);
  }
}

module.exports = { handleUpdate, setWebhook, sendMessage, BOT_TOKEN };
