/**
 * VoiceAgent — DALEBA Metacortex Points 201-218
 *
 * [201] Hérite de BaseAgent — scope strict téléphonie/TwiML/Square Appointments
 * [210] Couplage DARE pour Intent Extraction < 800ms
 * [211] 5 profils d'intention: BOOKING, MODIFICATION, CANCELLATION, INQUIRY, ESCALATION
 * [212-215] Square Appointments — disponibilités + format fr-CA
 * [216-218] Identification client + création + CreateBooking autonome
 */

'use strict';

const { BaseAgent } = require('./base-agent');
const dare       = require('./dare');
const twiml      = require('../services/twiml-generator');
const appts      = require('../services/square-appointments');
const bus        = require('../services/event-bus');

// ─── CONSTANTES [211] ─────────────────────────────────────────────────────────

const INTENTS = {
  BOOKING:       'BOOKING',
  MODIFICATION:  'MODIFICATION',
  CANCELLATION:  'CANCELLATION',
  INQUIRY:       'INQUIRY',
  ESCALATION:    'ESCALATION',
};

const ESCALATION_TRIGGERS = [
  'urgence','urgent','directeur','propriétaire','patron','ulrich','plainte',
  'avocat','police','blessé','accident','responsable','insatisfait','remboursement',
];

// ─── VOICE AGENT [201] ────────────────────────────────────────────────────────

class VoiceAgent extends BaseAgent {

  constructor(config = {}) {
    super({
      type:         'VOICE',
      name:         'VoiceAgent',
      // [201] Scope strictement limité
      scope: [
        'telephony:read',
        'telephony:respond',
        'square:appointments:read',
        'square:appointments:write',
        'square:customers:read',
        'square:customers:write',
        'square:catalog:read',
        'twiml:generate',
      ],
      capabilities: [
        'intent_extraction',
        'booking_flow',
        'customer_identification',
        'twiml_generation',
        'escalation',
      ],
      config: {
        maxRetries:  2,
        timeoutMs:   800,   // [210] < 800ms pour l'extraction d'intention
        budgetUSD:   0.005,
        ...config,
      },
    });

    // État de session par CallSid
    this._sessions = new Map();
  }

  // ─── EXECUTE [201] ──────────────────────────────────────────────────────────

  async execute(payload) {
    const { callSid, speechText, from, to, tenantId, customerName, step } = payload;

    this._log('info', `Appel ${callSid} | From: ${from} | Step: ${step || 'welcome'}`);

    // Router selon l'étape du flux
    switch (step) {
      case 'gather':    return this.handleGather(payload);
      case 'identity':  return this.handleIdentityCapture(payload);
      case 'booking_confirm': return this.handleBookingConfirm(payload);
      default:          return this.handleWelcome(payload);
    }
  }

  // ─── [216] ACCUEIL PERSONNALISÉ ───────────────────────────────────────────

  async handleWelcome({ callSid, from, to, tenantId, tenantName }) {
    // Identifier le client par son numéro [216]
    let customer = null;
    try {
      customer = await appts.findCustomerByPhone(from);
    } catch {}

    const customerName = customer?.given_name || null;

    // Initialiser la session
    this._sessions.set(callSid, {
      callSid, from, to, tenantId,
      customer,
      intent:      null,
      selectedSlot: null,
      pendingName:  null,
      step:         'gather',
    });

    const twimlStr = twiml.buildWelcomeTwiML({
      callSid,
      tenantName:    tenantName || 'Kadio Coiffure',
      customerName,
      callbackPath:  '/api/webhook/voice/gather',
    });

    return { twiml: twimlStr, customerName, step: 'welcome', callSid };
  }

  // ─── [210-211] ANALYSE INTENTION ──────────────────────────────────────────

  /**
   * Classifie l'intention via DARE en < 800ms [210]
   * 5 profils stricts [211]
   */
  async extractIntent(speechText) {
    const t0 = Date.now();

    // Détection rapide en local pour les cas évidents (< 50ms)
    const localIntent = this._quickIntentDetect(speechText);
    if (localIntent !== null) {
      this._log('info', `Intent local: ${localIntent} | ${Date.now()-t0}ms`);
      return { intent: localIntent, latencyMs: Date.now()-t0, source: 'local' };
    }

    // Classification LLM via DARE [210]
    const systemPrompt = `Tu es le classificateur d'intention vocal de DALEBA pour un salon de coiffure fr-CA.
Classifie le texte en exactement un de ces 5 intents:
- BOOKING: réserver un rendez-vous
- MODIFICATION: changer/déplacer un rendez-vous existant
- CANCELLATION: annuler un rendez-vous
- INQUIRY: renseignement (prix, horaires, services, botanique)
- ESCALATION: urgence, plainte, demande de responsable

Réponds UNIQUEMENT avec un objet JSON: {"intent":"BOOKING","confidence":0.95}`;

    try {
      const result = await dare.executeWithFailover(
        speechText, systemPrompt, [], { task: 'extraction', timeoutMs: 750 }
      );

      const raw     = result?.content || result?.text || '';
      const match   = raw.match(/\{[^}]+\}/);
      const parsed  = match ? JSON.parse(match[0]) : null;
      const intent  = parsed?.intent && INTENTS[parsed.intent] ? parsed.intent : 'INQUIRY';

      const latency = Date.now() - t0;
      this._log('info', `Intent DARE: ${intent} | confidence: ${parsed?.confidence} | ${latency}ms`);

      return { intent, confidence: parsed?.confidence, latencyMs: latency, source: 'dare' };

    } catch (e) {
      this._log('warn', `extractIntent fallback: ${e.message}`);
      return { intent: 'INQUIRY', latencyMs: Date.now()-t0, source: 'fallback' };
    }
  }

  /**
   * Détection locale ultra-rapide — cas non-ambigus [211]
   */
  _quickIntentDetect(text) {
    if (!text) return 'INQUIRY';
    const t = text.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');

    // ESCALATION prioritaire [211]
    if (ESCALATION_TRIGGERS.some(w => t.includes(w))) return INTENTS.ESCALATION;

    // CANCELLATION avant BOOKING [211] — 'annuler' > 'rdv'
    if (/(annuler|cancel|supprimer|ne viendrai pas|plus besoin|ne peux pas venir)/.test(t)) return INTENTS.CANCELLATION;

    // MODIFICATION [211]
    if (/(changer|deplacer|reporter|modifier|repousser|avancer|deplacer).*(rendez|heure|date|rdv)/.test(t)) return INTENTS.MODIFICATION;

    // BOOKING [211]
    if (/(reserv|rendez.?vous|appointment|prendre|booker|prend|voudrais|je veux).*(rendez|place|heure|samedi|lundi|mardi|mercredi|jeudi|vendredi|semaine)/.test(t)) return INTENTS.BOOKING;
    if (/\brdv\b/.test(t) && !/(annuler|cancel|modifier|changer)/.test(t)) return INTENTS.BOOKING;
    if (/(reserver|book|cr.neau|disponib)/.test(t)) return INTENTS.BOOKING;

    return null; // Déléguer à DARE
  }

  // ─── [207-218] HANDLER GATHER ─────────────────────────────────────────────

  async handleGather({ callSid, speechText, from, timeout }) {
    const session = this._sessions.get(callSid) || { from, step: 'gather', customer: null };

    if (timeout || !speechText?.trim()) {
      const msg = session.customer?.given_name
        ? `Désolé ${session.customer.given_name}, je n'ai pas entendu. Vous pouvez répéter?`
        : 'Je n\'ai pas bien entendu. Pouvez-vous répéter votre demande?';
      return { twiml: twiml.buildGenericTwiML(msg, { callbackPath: '/api/webhook/voice/gather' }), intent: null };
    }

    // [210] Extraction intention < 800ms
    const { intent, latencyMs, source } = await this.extractIntent(speechText);
    session.intent = intent;
    session.lastSpeech = speechText;

    bus.system(`[VoiceAgent] ${callSid} | Intent: ${intent} (${latencyMs}ms via ${source}) | "${speechText.slice(0,50)}"`);

    // [211] Router selon les 5 profils
    switch (intent) {
      case INTENTS.BOOKING:      return this._handleBookingIntent(session);
      case INTENTS.MODIFICATION: return this._handleModificationIntent(session);
      case INTENTS.CANCELLATION: return this._handleCancellationIntent(session);
      case INTENTS.INQUIRY:      return this._handleInquiryIntent(session, speechText);
      case INTENTS.ESCALATION:   return this._handleEscalationIntent(session);
      default:                   return this._handleInquiryIntent(session, speechText);
    }
  }

  // ─── [212-215] BOOKING FLOW ───────────────────────────────────────────────

  async _handleBookingIntent(session) {
    // [212] Interroger Square Appointments
    const services = await appts.getCatalogServices().catch(() => []);

    // Service par défaut ou premier du catalogue
    const defaultService = services[0];
    const serviceVariationId = defaultService?.variations?.[0]?.id || null;

    // [213] SearchAvailability
    const { slots } = await appts.searchAvailability({
      serviceVariationId,
      startAt: new Date().toISOString(),
      endAt:   new Date(Date.now() + 7 * 86400000).toISOString(),
    });

    // Sauvegarder les slots disponibles dans la session
    session.availableSlots = slots;

    // [214] Max 3 créneaux + [215] format fr-CA
    return {
      twiml:   twiml.buildAvailabilityTwiML(slots, '/api/webhook/voice/gather'),
      intent:  INTENTS.BOOKING,
      slots,
      step:    'slot_selection',
    };
  }

  async _handleModificationIntent(session) {
    const msg = 'Je vais chercher votre rendez-vous actuel. Quel est l\'identifiant ou la date de votre rendez-vous?';
    return { twiml: twiml.buildGenericTwiML(msg), intent: INTENTS.MODIFICATION };
  }

  async _handleCancellationIntent(session) {
    const name = session.customer?.given_name;
    const msg  = name
      ? `${name}, vous souhaitez annuler un rendez-vous. Puis-je avoir la date ou l'heure de ce rendez-vous?`
      : 'Vous souhaitez annuler un rendez-vous. Puis-je avoir votre numéro de confirmation ou la date?';
    return { twiml: twiml.buildGenericTwiML(msg), intent: INTENTS.CANCELLATION };
  }

  async _handleInquiryIntent(session, speechText) {
    // Déléguer au DARE pour une réponse naturelle fr-CA
    try {
      const voiceConfig = require('../services/voice-config');
      const ctx = `Salon: ${voiceConfig.SALON_NAME || 'Kadio Coiffure'} | Adresse: ${voiceConfig.SALON_ADDRESS || ''} | Horaires: ${voiceConfig.HOURS || 'Lun-Sam 9h-18h'}`;
      const result = await dare.executeWithFailover(
        `${speechText}\n\n${ctx}`,
        'Tu es l\'assistant vocal fr-CA de Kadio Coiffure. Réponds en 1-2 phrases max, de manière naturelle et conversationnelle. Pas de listes, pas de markdown.',
        [], { task: 'conversation', timeoutMs: 2000 }
      );
      const response = result?.content || result?.text || 'Je suis désolé, pourriez-vous reformuler votre question?';
      return { twiml: twiml.buildGenericTwiML(response), intent: INTENTS.INQUIRY };
    } catch (e) {
      return { twiml: twiml.buildGenericTwiML('Je suis désolé, je n\'ai pas compris. Pourriez-vous reformuler?'), intent: INTENTS.INQUIRY };
    }
  }

  async _handleEscalationIntent(session) {
    const voiceAgent = require('../services/voice-agent');
    // Déléguer à l'escaladie V22
    const result = await voiceAgent.handleCall({
      callSid: session.callSid, speechResult: session.lastSpeech || 'urgence',
      callerNumber: session.from,
    }).catch(() => null);
    return { twiml: result?.twiml || twiml.buildGenericTwiML('Je vous transfère immédiatement.', { hangup: false }), intent: INTENTS.ESCALATION, escalated: true };
  }

  // ─── [217] CAPTURE IDENTITÉ CLIENT INCONNU ────────────────────────────────

  async handleIdentityCapture({ callSid, speechText, from, identityStep = 'firstname' }) {
    const session = this._sessions.get(callSid) || { from, pendingName: {} };

    if (identityStep === 'firstname') {
      session.pendingName = { firstName: speechText?.trim() };
      this._sessions.set(callSid, session);
      return {
        twiml:        twiml.buildIdentityCapturesTwiML('lastname', '/api/webhook/voice/identity?step=lastname'),
        identityStep: 'lastname',
      };
    }

    if (identityStep === 'lastname') {
      session.pendingName.lastName = speechText?.trim();
      const fullName = `${session.pendingName.firstName} ${session.pendingName.lastName}`;
      const confirmMsg = `Pour confirmer, vous êtes bien ${fullName}? Dites oui pour confirmer, ou non pour recommencer.`;
      this._sessions.set(callSid, session);
      return {
        twiml:        twiml.buildIdentityCapturesTwiML('confirm', '/api/webhook/voice/identity?step=confirm'),
        identityStep: 'confirm',
        pendingName:  fullName,
      };
    }

    if (identityStep === 'confirm') {
      const confirmed = /oui|yes|correct|exactement|c'est ça/.test((speechText||'').toLowerCase());
      if (confirmed && session.pendingName) {
        // [217] Créer le client Square
        const newCustomer = await appts.createCustomerFromVoice({
          firstName:   session.pendingName.firstName,
          lastName:    session.pendingName.lastName,
          phoneNumber: from,
        });
        session.customer = newCustomer;
        this._sessions.set(callSid, session);
        const msg = `Parfait, je vous ai enregistré sous le nom ${session.pendingName.firstName}. Comment puis-je vous aider?`;
        return { twiml: twiml.buildGenericTwiML(msg, { callbackPath: '/api/webhook/voice/gather' }), customer: newCustomer };
      } else {
        // Recommencer
        return {
          twiml:        twiml.buildIdentityCapturesTwiML('firstname', '/api/webhook/voice/identity?step=firstname'),
          identityStep: 'firstname',
        };
      }
    }
  }

  // ─── [218] CONFIRMATION RÉSERVATION ──────────────────────────────────────

  async handleBookingConfirm({ callSid, speechText, from }) {
    const session = this._sessions.get(callSid);
    if (!session?.availableSlots?.length) {
      return { twiml: twiml.buildGenericTwiML('Je suis désolé, je n\'ai plus les disponibilités en mémoire. Voulez-vous recommencer?'), confirmed: false };
    }

    const confirmed = /oui|ok|parfait|d'accord|vendredi|jeudi|samedi|lundi|mardi|mercredi|ce|oui.*pour|confirm/.test((speechText||'').toLowerCase());
    if (!confirmed) {
      return { twiml: twiml.buildGenericTwiML('D\'accord. Souhaitez-vous choisir un autre créneau ou autre chose?'), confirmed: false };
    }

    // Identifier le créneau confirmé par similarité avec le texte
    let selectedSlot = session.availableSlots[0]; // défaut: premier
    for (const slot of session.availableSlots) {
      if (slot.label && speechText.toLowerCase().includes(slot.label.split(' ')[1])) {
        selectedSlot = slot; break;
      }
    }

    session.selectedSlot = selectedSlot;

    // [218] Créer le RDV Square
    const customer = session.customer;
    const services = await appts.getCatalogServices().catch(() => []);
    const serviceVariationId = services[0]?.variations?.[0]?.id;

    const booking = await appts.createBooking({
      customerId:         customer?.id || null,
      serviceVariationId: serviceVariationId || 'DEFAULT',
      startAt:            selectedSlot.startAt,
      teamMemberId:       selectedSlot.teamMember || null,
      durationMinutes:    60,
    });

    const slotLabel = selectedSlot.label;

    if (booking?.error) {
      const msg = `J'ai un problème technique pour confirmer la réservation ${slotLabel}. Un de nos représentants vous rappellera. Désolé pour le dérangement.`;
      return { twiml: twiml.buildGenericTwiML(msg, { hangup: true }), confirmed: false, error: booking.error };
    }

    const confirmTwiml = twiml.buildConfirmationTwiML({
      customerName: customer?.given_name,
      slotLabel,
      serviceName: services[0]?.name || 'votre service',
    });

    bus.system(`[VoiceAgent] ✅ Réservation confirmée: ${booking.id} | ${slotLabel} | ${from}`);
    return { twiml: confirmTwiml, confirmed: true, booking, slotLabel };
  }

  // ─── NETTOYAGE SESSION ────────────────────────────────────────────────────

  cleanupSession(callSid) {
    this._sessions.delete(callSid);
  }
}

// Singleton
module.exports = new VoiceAgent();
module.exports.VoiceAgent = VoiceAgent;
module.exports.INTENTS    = INTENTS;
