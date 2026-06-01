'use strict';
/**
 * DALEBA WhatsApp Salon — Agent Central & Routage
 * Accueil → Détection service → Barbier / Coiffeur / Locks
 */
const fetch = (...args) => import('node-fetch').then(m => m.default(...args)).catch(() => global.fetch(...args));
const sessionStore  = require('./session-store');
const squareBooking = require('./square-booking');
const stripeDeposit = require('./stripe-deposit');
const locksExpert   = require('./locks-expert');
const { getToneContext } = require('./auditor-agent');

const DEEPSEEK_KEY = process.env.DEEPSEEK_API_KEY || process.env.DEEPSEEK_KEY;
const MISTRAL_KEY  = process.env.MISTRAL_API_KEY;
const KIMI_KEY     = process.env.KIMI_API_KEY; // suspendu — fallback ignoré si quota épuisé

// ─── SALON INFO ────────────────────────────────────────────────────────────────
const SALON = {
  name:    'Kadio Coiffure',
  address: '615 Antoinette Robidoux, local 100, Longueuil, QC J4J 2V8',
  phone:   '+15149195970',
  hours:   'Lun–Sam 9h–19h, Dim fermé',
  deposit: '20% du service (Coiffure/Styliste uniquement)',
};

// ─── SYSTÈME PROMPT AGENT CENTRAL ─────────────────────────────────────────────
function buildSystemPrompt(toneCtx = '') {
  return `Tu es l'IA d'accueil de ${SALON.name}, un salon de coiffure professionnel à Longueuil, Québec.
Tu t'appelles Amara et tu parles comme une vraie réceptionniste — chaleureuse, naturelle, jamais robotique.

Infos du salon :
- Adresse : ${SALON.address}
- Téléphone : ${SALON.phone}
- Horaires : ${SALON.hours}
- Dépôt : ${SALON.deposit}

Règle absolue :
- Services BARBIER (coupe homme, dégradé, rasage, beard) → RDV DIRECT, ZÉRO dépôt
- Tous les autres services (coiffure, styliste, locks, tresses, couleur, etc.) → dépôt de 20% OBLIGATOIRE avant confirmation RDV

Comportement :
- Tu réponds toujours en 2-3 phrases max, jamais de listes à puces dans WhatsApp
- Tu utilises des emojis avec parcimonie (1-2 max par message)
- Tu ne révèles jamais que tu es une IA sauf si on te le demande directement
- Si le client est frustré ou insiste pour parler à un humain, tu promets qu'un membre de l'équipe rappelle dans 30 min
- Langue : français par défaut, anglais si le client écrit en anglais${toneCtx}`;
}

// ─── LLM CALL ─────────────────────────────────────────────────────────────────
// Appel IA avec fallback automatique DeepSeek → Kimi
async function callDeepSeek(messages, temp = 0.7) {
  // Tentative 1 : DeepSeek (rapide, économique)
  if (DEEPSEEK_KEY) {
    try {
      const res = await fetch('https://api.deepseek.com/v1/chat/completions', {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${DEEPSEEK_KEY}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ model: 'deepseek-chat', messages, max_tokens: 250, temperature: temp }),
      });
      const data = await res.json();
      if (res.ok) return data.choices[0].message.content.trim();
    } catch(_) {}
  }

  // Fallback #1 : Mistral AI (tier gratuit, 1 req/s, excellent français)
  if (MISTRAL_KEY) {
    try {
      const res = await fetch('https://api.mistral.ai/v1/chat/completions', {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${MISTRAL_KEY}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ model: 'mistral-small-latest', messages, max_tokens: 250, temperature: temp }),
      });
      const data = await res.json();
      if (res.ok) return data.choices[0].message.content.trim();
    } catch(_) {}
  }

  return 'Bonjour ! Je suis l\'assistante de Kadio Coiffure. Pour prendre rendez-vous, appelez-nous au +1 514-919-5970. 😊';
}

// ─── DÉTECTION SERVICE ─────────────────────────────────────────────────────────
function detectServiceType(text) {
  const t = text.toLowerCase();
  if (/barbier|barber|coupe homme|fade|d[ée]grad[ée]|rasage|shave|beard|barbe|tondeuse/i.test(t)) return 'barbier';
  if (/lock|dreadlock|dread|nattage|tresse africaine|box braid|knotless|twist/i.test(t)) return 'locks';
  if (/coiffure|coiffeur|styliste|couleur|balayage|extension|perm|traitement|soin|lissage|ondulation/i.test(t)) return 'coiffure';
  return null; // indéterminé, demander
}

// ─── FORMAT DISPONIBILITÉS ─────────────────────────────────────────────────────
function formatSlots(avails) {
  if (!avails.length) return '❌ Aucun créneau disponible cette semaine. Voulez-vous que je cherche la semaine prochaine ?';
  return avails.slice(0, 5).map((a, i) => {
    const dt = new Date(a.start_at);
    const label = dt.toLocaleDateString('fr-CA', { weekday: 'long', day: 'numeric', month: 'long' });
    const hour  = dt.toLocaleTimeString('fr-CA', { hour: '2-digit', minute: '2-digit', timeZone: 'America/Toronto' });
    return `*${i + 1}.* ${label} à ${hour}`;
  }).join('\n');
}

// ─── HANDLER PRINCIPAL ─────────────────────────────────────────────────────────
async function handleMessage({ phone, displayName, text, mediaUrl, mediaType }) {
  const session  = await sessionStore.get(phone);
  const state    = session.state || 'idle';
  const ctx      = session.context || {};
  const history  = await sessionStore.getHistory(phone, 20);
  const toneCtx  = await getToneContext();

  await sessionStore.appendHistory(phone, 'client', text || `[media:${mediaType}]`);

  // ── Mots-clés de reset ──────────────────────────────────────────────────────
  if (/^(recommencer|restart|annuler|quitter|stop|menu|bonjour|salut|allo|hello|hi\b)/i.test((text||'').trim())) {
    await sessionStore.set(phone, 'idle', {}, displayName);
    const reply = await callDeepSeek([
      { role: 'system', content: buildSystemPrompt(toneCtx) },
      { role: 'user', content: text },
    ]);
    await sessionStore.appendHistory(phone, 'assistant', reply);
    return { reply };
  }

  // ── État: idle — premier contact ────────────────────────────────────────────
  if (state === 'idle') {
    const serviceType = detectServiceType(text || '');
    const sysPrompt = buildSystemPrompt(toneCtx);
    const msgs = [
      { role: 'system', content: sysPrompt },
      { role: 'user', content: text || 'Bonjour' },
    ];

    if (serviceType) {
      // Service identifié dès le premier message
      await sessionStore.set(phone, 'greet', { serviceType }, displayName);
      msgs.push({ role: 'assistant', content: '' });
      // Ajouter instruction de routing
      msgs[0].content += `\n\nL'utilisateur souhaite un service : ${serviceType}. Accueille-le chaleureusement et confirme le type de service.`;
    } else {
      await sessionStore.set(phone, 'greet', {}, displayName);
    }

    const reply = await callDeepSeek(msgs);
    await sessionStore.appendHistory(phone, 'assistant', reply);
    return { reply, nextState: serviceType ? 'greet' : 'greet' };
  }

  // ── État: greet — identifier le service ─────────────────────────────────────
  if (state === 'greet' || state === 'routing') {
    const serviceType = ctx.serviceType || detectServiceType(text || '');

    if (!serviceType) {
      // Demander le type de service
      const reply = await callDeepSeek([
        { role: 'system', content: buildSystemPrompt(toneCtx) },
        ...history.slice(-4).map(h => ({ role: h.role === 'client' ? 'user' : 'assistant', content: h.text })),
        { role: 'user', content: text },
        { role: 'system', content: 'Le client n\'a pas précisé le service. Demande-lui s\'il souhaite un service BARBIER ou COIFFURE/AUTRE (locks, tresses, couleur, etc.).' },
      ]);
      await sessionStore.set(phone, 'routing', ctx, displayName);
      await sessionStore.appendHistory(phone, 'assistant', reply);
      return { reply };
    }

    ctx.serviceType = serviceType;

    // ─── Routage Expert Locks ──────────────────────────────────────────────
    if (serviceType === 'locks') {
      const intro = `✨ Super ! Je vous mets en contact avec Amara, notre experte en locks et coiffures protectrices. Elle va prendre soin de vous ! \n\nAmara : Bonjour ! Je suis ravie de vous accueillir. Pour bien vous conseiller, pouvez-vous me décrire vos cheveux actuels et l'effet que vous souhaitez ?`;
      await sessionStore.set(phone, 'locks_dialog', { serviceType: 'locks' }, displayName);
      await sessionStore.appendHistory(phone, 'assistant', intro);
      return { reply: intro };
    }

    // ─── Routage Barbier ───────────────────────────────────────────────────
    if (serviceType === 'barbier') {
      await sessionStore.set(phone, 'checking_availability', { serviceType: 'barbier' }, displayName);
      // Chercher les services barbier
      try {
        const services = await squareBooking.getServicesWithPrices();
        const barbierServices = services.filter(s => s.isBarbier);
        ctx.services = barbierServices;
        if (barbierServices.length === 1) {
          ctx.selectedService = barbierServices[0];
        }
        const serviceList = barbierServices.length
          ? barbierServices.slice(0, 4).map((s, i) => `*${i+1}.* ${s.name} — $${s.priceDollars} (${s.durationMin} min)`).join('\n')
          : 'Coupe + dégradé standard';
        const reply = `💈 Pas de problème ! Pour le barbier, aucun dépôt requis.\n\nVoici nos services :\n${serviceList}\n\nQuel service vous intéresse ? Choisissez un numéro ou décrivez.`;
        await sessionStore.set(phone, 'select_service', ctx, displayName);
        await sessionStore.appendHistory(phone, 'assistant', reply);
        return { reply };
      } catch(e) {
        const reply = '💈 Pour le barbier, c\'est sans dépôt ! Quel style souhaitez-vous ? (coupe, dégradé, rasage, beard…)';
        await sessionStore.set(phone, 'select_service', ctx, displayName);
        await sessionStore.appendHistory(phone, 'assistant', reply);
        return { reply };
      }
    }

    // ─── Routage Coiffure/Autre ────────────────────────────────────────────
    if (serviceType === 'coiffure') {
      try {
        const services = await squareBooking.getServicesWithPrices();
        const coiffureServices = services.filter(s => !s.isBarbier && !s.isLocks);
        ctx.services = coiffureServices;
        const serviceList = coiffureServices.length
          ? coiffureServices.slice(0, 5).map((s, i) => `*${i+1}.* ${s.name} — $${s.priceDollars}`).join('\n')
          : 'Services disponibles en salon';
        const reply = `💇‍♀️ Parfait ! Pour les services coiffure, un dépôt de 20% est requis pour confirmer le RDV.\n\nNos services :\n${serviceList}\n\nLequel vous intéresse ? (choisissez un numéro)`;
        await sessionStore.set(phone, 'select_service', ctx, displayName);
        await sessionStore.appendHistory(phone, 'assistant', reply);
        return { reply };
      } catch(e) {
        const reply = '💇‍♀️ Pour les services coiffure, un dépôt de 20% confirme votre RDV. Quel service souhaitez-vous ?';
        await sessionStore.set(phone, 'select_service', ctx, displayName);
        await sessionStore.appendHistory(phone, 'assistant', reply);
        return { reply };
      }
    }
  }

  // ── État: locks_dialog ───────────────────────────────────────────────────────
  if (state === 'locks_dialog') {
    const result = await locksExpert.handleLocksDialog({ phone, text, history, mediaUrl, mediaType, session });
    await sessionStore.set(phone, result.nextState || 'locks_dialog', { ...ctx, ...result.context, serviceType: 'locks' }, displayName);
    await sessionStore.appendHistory(phone, 'assistant', result.reply);
    if (result.nextState === 'checking_availability') {
      // Récupère les services Locks et cherche les dispo
      return await fetchAvailabilityAndReply(phone, ctx, displayName, result.reply);
    }
    return { reply: result.reply };
  }

  // ── État: select_service ─────────────────────────────────────────────────────
  if (state === 'select_service') {
    const services = ctx.services || [];
    const num = parseInt((text || '').match(/\d+/)?.[0] || '0');
    let selected = null;
    if (num >= 1 && num <= services.length) {
      selected = services[num - 1];
    } else {
      // Chercher par nom
      selected = services.find(s => new RegExp(text.replace(/[^a-zA-ZÀ-ÿ]/g, ''), 'i').test(s.name));
    }
    if (selected) {
      ctx.selectedService = selected;
      await sessionStore.set(phone, 'checking_availability', ctx, displayName);
      return await fetchAvailabilityAndReply(phone, ctx, displayName, null);
    }
    const reply = `Je n'ai pas bien compris. Choisissez un numéro de 1 à ${services.length} ou décrivez le service souhaité.`;
    await sessionStore.appendHistory(phone, 'assistant', reply);
    return { reply };
  }

  // ── État: checking_availability ──────────────────────────────────────────────
  if (state === 'checking_availability') {
    return await fetchAvailabilityAndReply(phone, ctx, displayName, null);
  }

  // ── État: select_slot ────────────────────────────────────────────────────────
  if (state === 'select_slot') {
    const avails = ctx.availabilities || [];
    const num = parseInt((text || '').match(/\d+/)?.[0] || '0');
    if (num >= 1 && num <= avails.length) {
      ctx.selectedSlot = avails[num - 1];
      const service = ctx.selectedService;
      const isBarbier = ctx.serviceType === 'barbier';

      if (isBarbier) {
        // RDV DIRECT sans dépôt
        try {
          const booking = await squareBooking.createBooking({
            serviceVariationId: service?.id,
            teamMemberId: ctx.selectedSlot.appointment_segments?.[0]?.team_member_id,
            startAt: ctx.selectedSlot.start_at,
            customerName: displayName || 'Client',
            customerPhone: phone,
          });
          ctx.bookingId = booking.id;
          await sessionStore.set(phone, 'booking_confirmed', ctx, displayName);
          const dt = new Date(ctx.selectedSlot.start_at);
          const dateStr = dt.toLocaleDateString('fr-CA', { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'America/Toronto' });
          const hourStr = dt.toLocaleTimeString('fr-CA', { hour: '2-digit', minute: '2-digit', timeZone: 'America/Toronto' });
          const reply = `✅ Parfait ! Votre RDV est confirmé :\n\n💈 *${service?.name || 'Barbier'}*\n📅 ${dateStr} à ${hourStr}\n📍 615 Antoinette Robidoux, Longueuil\n\nÀ bientôt ! 🙌`;
          await sessionStore.appendHistory(phone, 'assistant', reply);
          return { reply };
        } catch(e) {
          const reply = `J'ai eu une difficulté technique pour confirmer le RDV. Notre équipe vous contacte dans 30 min pour finaliser. Désolé ! 🙏`;
          await sessionStore.appendHistory(phone, 'assistant', reply);
          return { reply };
        }
      } else {
        // COIFFURE — générer le lien Stripe 20%
        try {
          const priceCents = service?.priceCents || 0;
          const depositInfo = await stripeDeposit.createDepositLink({
            servicePriceCents: priceCents,
            serviceName: service?.name || 'Service coiffure',
            phone,
            bookingRef: `wa_${Date.now()}`,
            clientName: displayName || 'Client',
          });
          ctx.depositLink = depositInfo.url;
          ctx.depositCents = depositInfo.depositCents;
          ctx.paymentLinkId = depositInfo.paymentLinkId;
          ctx.bookingPending = true;
          await sessionStore.set(phone, 'deposit_pending', ctx, displayName);

          const dt = new Date(ctx.selectedSlot.start_at);
          const dateStr = dt.toLocaleDateString('fr-CA', { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'America/Toronto' });
          const hourStr = dt.toLocaleTimeString('fr-CA', { hour: '2-digit', minute: '2-digit', timeZone: 'America/Toronto' });
          const reply = `✨ Super choix ! Pour confirmer votre RDV :\n\n💇‍♀️ *${service?.name}*\n📅 ${dateStr} à ${hourStr}\n💳 Dépôt requis : *$${depositInfo.depositDollars} CAD* (20%)\n\nCliquez pour payer :\n${depositInfo.url}\n\n⏳ Ce créneau est réservé 30 min. Le RDV est confirmé automatiquement après le paiement.`;
          await sessionStore.appendHistory(phone, 'assistant', reply);
          return { reply };
        } catch(e) {
          const reply = `J'ai un souci technique pour générer le lien de paiement. Notre équipe vous rappelle dans 30 min. 🙏`;
          await sessionStore.appendHistory(phone, 'assistant', reply);
          return { reply };
        }
      }
    }
    const reply = `Choisissez un numéro de 1 à ${avails.length} pour confirmer votre créneau.`;
    await sessionStore.appendHistory(phone, 'assistant', reply);
    return { reply };
  }

  // ── État: deposit_pending ────────────────────────────────────────────────────
  if (state === 'deposit_pending') {
    const reply = `⏳ Votre créneau est en attente de votre dépôt de $${(ctx.depositCents / 100).toFixed(2)} CAD.\n\nLien de paiement :\n${ctx.depositLink}\n\nDès que le paiement est reçu, votre RDV est automatiquement confirmé ! 💳`;
    await sessionStore.appendHistory(phone, 'assistant', reply);
    return { reply };
  }

  // ── État: booking_confirmed ──────────────────────────────────────────────────
  if (state === 'booking_confirmed') {
    const reply = await callDeepSeek([
      { role: 'system', content: buildSystemPrompt(toneCtx) + '\nLe RDV de ce client est déjà confirmé. Rappelle-lui l\'adresse et demande s\'il a d\'autres questions.' },
      { role: 'user', content: text },
    ]);
    await sessionStore.appendHistory(phone, 'assistant', reply);
    return { reply };
  }

  // ── Fallback ─────────────────────────────────────────────────────────────────
  const reply = await callDeepSeek([
    { role: 'system', content: buildSystemPrompt(toneCtx) },
    ...history.slice(-6).map(h => ({ role: h.role === 'client' ? 'user' : 'assistant', content: h.text })),
    { role: 'user', content: text || '' },
  ]);
  await sessionStore.appendHistory(phone, 'assistant', reply);
  return { reply };
}

// Helper: cherche les dispos et construit la réponse
async function fetchAvailabilityAndReply(phone, ctx, displayName, prefixReply) {
  const service = ctx.selectedService;
  const serviceType = ctx.serviceType;
  let avails = [];
  let avMessage = '';

  try {
    avails = await squareBooking.searchAvailability(service?.id);
    ctx.availabilities = avails;
    avMessage = squareBooking.formatAvailabilities(avails);
  } catch(e) {
    avMessage = 'Je n\'arrive pas à charger les disponibilités. Notre équipe vous rappelle pour trouver un créneau.';
  }

  await sessionStore.set(phone, 'select_slot', ctx, displayName);

  const depositNote = serviceType === 'barbier' ? '(sans dépôt 🎉)' : '(dépôt 20% requis)';
  const intro = prefixReply ? `${prefixReply}\n\n` : '';
  const serviceLine = service ? `*${service.name}* — $${service.priceDollars} ${depositNote}` : depositNote;

  const reply = `${intro}📅 Disponibilités pour ${serviceLine} :\n\n${avMessage}\n\nRépondez avec le numéro de votre choix.`;
  await sessionStore.appendHistory(phone, 'assistant', reply);
  return { reply };
}

module.exports = { handleMessage };
