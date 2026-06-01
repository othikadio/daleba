'use strict';
/**
 * DALEBA WhatsApp Salon — Agent Expert Locks
 * Spécialité : dreadlocks, tresses africaines, twists, nattage
 * Analyse photos/vidéos, guide le client, recommande AVANT le tarif
 */
const fetch = (...args) => import('node-fetch').then(m => m.default(...args)).catch(() => global.fetch(...args));

const DEEPSEEK_KEY = process.env.DEEPSEEK_API_KEY || process.env.DEEPSEEK_KEY;
const KIMI_KEY     = process.env.KIMI_API_KEY;
const OPENAI_KEY   = process.env.OPENAI_API_KEY;

const LOCKS_SYSTEM_PROMPT = `Tu es Amara, l'Experte Locks de Kadio Coiffure à Longueuil, Québec.
Tu es passionnée, chaleureuse, et tu traites chaque client comme une personne unique.

Tes spécialités : dreadlocks (starters, resserrage, rallonges), tresses africaines (box braids, knotless, Ghana braids), twists, nattage traditionnel, coiffures protectrices.

Ta manière de travailler :
1. Tu écoutes et tu demandes des détails sur la texture des cheveux, la longueur, l'objectif final
2. Tu demandes une photo si ce n'est pas déjà fourni
3. Tu expliques la technique adaptée en termes simples et enthousiasme
4. Tu parles du temps de séchage, des soins à domicile, de la durée du style
5. Tu mentionnes le tarif et la durée SEULEMENT quand le client est prêt
6. Tu es honnête si quelque chose n'est pas possible ou si un rendez-vous de consultation est préférable

Langues : tu réponds en français par défaut, anglais si le client écrit en anglais.
Ton : chaleureux, expert, rassurant, jamais pressé de conclure une vente.
Format : messages courts et conversationnels (max 3-4 lignes par réponse).`;

// Appelle DeepSeek puis Kimi en fallback
async function callDeepSeek(messages) {
  if (DEEPSEEK_KEY) {
    try {
      const res = await fetch('https://api.deepseek.com/v1/chat/completions', {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${DEEPSEEK_KEY}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ model: 'deepseek-chat', messages, max_tokens: 300, temperature: 0.75 }),
      });
      const data = await res.json();
      if (res.ok) return data.choices[0].message.content.trim();
    } catch(_) {}
  }
  // Fallback Kimi
  if (KIMI_KEY) {
    const OpenAI = require('openai');
    const kimi = new OpenAI({ apiKey: KIMI_KEY, baseURL: 'https://api.moonshot.cn/v1' });
    const r = await kimi.chat.completions.create({ model: 'moonshot-v1-8k', messages, max_tokens: 300, temperature: 0.75 });
    return r.choices[0].message.content.trim();
  }
  throw new Error('Aucun provider IA disponible (DEEPSEEK_API_KEY ou KIMI_API_KEY requis)');
}

// Analyse une image via GPT-4o Vision (open-source Whisper pour audio, GPT-4o pour vision)
async function analyzeHairImage(imageUrl) {
  if (!OPENAI_KEY) return 'Je ne peux pas analyser l\'image pour le moment, mais décrivez-moi vos cheveux et je ferai de mon mieux ! 😊';

  const res = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${OPENAI_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: 'gpt-4o',
      messages: [{
        role: 'user',
        content: [
          {
            type: 'text',
            text: `Tu es Amara, experte locks chez Kadio Coiffure Longueuil. Analyse cette photo de cheveux et fournis une évaluation professionnelle courte (3-4 lignes) : texture visible, état actuel, techniques de locks/tresses/twists possibles, et une recommandation pour le prochain rendez-vous. Sois chaleureuse et encourageante. Réponds en français.`,
          },
          { type: 'image_url', image_url: { url: imageUrl, detail: 'low' } },
        ],
      }],
      max_tokens: 250,
    }),
  });
  const data = await res.json();
  if (!res.ok) return 'Belle photo ! Pouvez-vous me décrire l\'état de vos cheveux en ce moment et votre objectif ?';
  return data.choices[0].message.content.trim();
}

// Flow principal de l'Agent Locks
async function handleLocksDialog({ phone, text, history, mediaUrl, mediaType, session }) {
  const ctx = session.context || {};
  const msgs = [];

  // Prompt système
  msgs.push({ role: 'system', content: LOCKS_SYSTEM_PROMPT });

  // Historique (max 10 derniers)
  for (const h of (history || []).slice(-10)) {
    msgs.push({ role: h.role === 'client' ? 'user' : 'assistant', content: h.text });
  }

  // Si l'utilisateur envoie une image ou vidéo
  if (mediaUrl && (mediaType === 'image' || mediaType === 'sticker')) {
    let imageAnalysis = '';
    try {
      imageAnalysis = await analyzeHairImage(mediaUrl);
    } catch(_) {
      imageAnalysis = 'J\'adore ! Parlez-moi de votre objectif pour ce style.';
    }
    msgs.push({ role: 'user', content: `[Le client a envoyé une photo de ses cheveux. Analyse : "${imageAnalysis}"]` });
    msgs.push({ role: 'user', content: text || '' });
  } else {
    msgs.push({ role: 'user', content: text || '' });
  }

  // Détecter si le client est prêt pour la réservation
  const readyKeywords = /rendez-vous|rdv|réserver|book|prendre|disponib|quand|horaire|tarif|prix|combien/i;
  const isReadyToBook = readyKeywords.test(text || '') && (ctx.consultationDone || history?.length > 4);

  let reply = '';

  if (isReadyToBook && !ctx.consultationDone) {
    // Marquer consultation faite, préparer passage au booking
    ctx.consultationDone = true;
    ctx.agentType = 'locks';
    reply = await callDeepSeek(msgs);
    reply += '\n\n📅 Super ! Laissez-moi vérifier les disponibilités pour vous. Un instant…';
    return { reply, nextState: 'checking_availability', context: ctx };
  }

  reply = await callDeepSeek(msgs);

  // Si c'est la première réponse Locks, demander une photo si pas encore fournie
  if (!ctx.photoRequested && !mediaUrl && history?.length <= 2) {
    ctx.photoRequested = true;
    reply += '\n\n📸 Pour mieux vous conseiller, auriez-vous une photo de vos cheveux actuels ?';
  }

  return { reply, nextState: 'locks_dialog', context: ctx };
}

module.exports = { handleLocksDialog, analyzeHairImage };
