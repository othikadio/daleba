/**
 * DALEBA — Event Bus (Pilier Logs Temps Réel)
 * Broadcast SSE vers /api/zenith/stream
 * Toutes les routes + services poussent ici
 */

// Circular buffer de 200 événements
const MAX_EVENTS = 200;
const events = [];
let eventSeq = 0;

// Abonnés SSE actifs
const subscribers = new Set();

/**
 * Émet un événement dans le bus
 * @param {string} type   — 'chat'|'booking'|'payment'|'sms'|'system'|'finance'|'error'
 * @param {string} msg    — Message court (< 80 chars)
 * @param {object} data   — Données additionnelles optionnelles
 */
function emit(type, msg, data = {}) {
  const entry = {
    seq: ++eventSeq,
    ts: new Date().toISOString(),
    type,
    msg,
    data,
  };

  events.push(entry);
  if (events.length > MAX_EVENTS) events.shift();

  const payload = `data: ${JSON.stringify(entry)}\n\n`;
  subscribers.forEach(res => {
    try { res.write(payload); }
    catch (_) { subscribers.delete(res); }
  });

  // Console color-coded
  const colors = { chat:'36', booking:'32', payment:'33', sms:'34', system:'35', finance:'33', error:'31' };
  const code = colors[type] || '37';
  console.log(`\x1b[${code}m[BUS:${type.toUpperCase()}]\x1b[0m ${msg}`);
}

/**
 * Abonne un res Express SSE au bus
 * Envoie les 20 derniers événements en rafale initiale
 */
function subscribe(req, res) {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');
  res.flushHeaders();

  // Replay des 20 derniers events pour hydratation initiale
  const replay = events.slice(-20);
  replay.forEach(e => {
    res.write(`data: ${JSON.stringify(e)}\n\n`);
  });

  // Keepalive ping toutes les 25s
  const keepalive = setInterval(() => {
    try { res.write(': ping\n\n'); }
    catch (_) { clearInterval(keepalive); subscribers.delete(res); }
  }, 25000);

  subscribers.add(res);

  req.on('close', () => {
    clearInterval(keepalive);
    subscribers.delete(res);
  });
}

/**
 * Récupère les N derniers événements
 */
function getRecent(n = 50) {
  return events.slice(-n);
}

// Helpers par type
const chat    = (msg, data) => emit('chat', msg, data);
const booking = (msg, data) => emit('booking', msg, data);
const payment = (msg, data) => emit('payment', msg, data);
const sms     = (msg, data) => emit('sms', msg, data);
const system  = (msg, data) => emit('system', msg, data);
const finance = (msg, data) => emit('finance', msg, data);
const error   = (msg, data) => emit('error', msg, data);

// Émet un événement système au démarrage
emit('system', 'DALEBA Event Bus initialisé', { version: '1.0', subscribers: 0 });

module.exports = { emit, subscribe, getRecent, chat, booking, payment, sms, system, finance, error };
