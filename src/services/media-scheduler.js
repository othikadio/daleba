/**
 * Media Scheduler Engine — DALEBA Metacortex Points 126, 129
 *
 * [126] 3 créneaux/jour: 08h00 · 12h30 · 19h00 (heure salon America/Toronto)
 * [129] Publication 100% autonome dès le créneau atteint
 */

'use strict';

// ─── CRÉNEAUX DE PUBLICATION [126] ────────────────────────────────────────────

const TZ_SALON = 'America/Toronto';

const SLOTS = [
  { id: 'morning', hour: 8,  minute: 0,  platforms: ['instagram', 'tiktok'] },
  { id: 'noon',    hour: 12, minute: 30, platforms: ['instagram'] },
  { id: 'evening', hour: 19, minute: 0,  platforms: ['instagram', 'tiktok'] },
];

// ─── CALCUL PROCHAIN CRÉNEAU ─────────────────────────────────────────────────

function getNextSlotTime(slotId = null) {
  const now    = new Date();
  const nowTZ  = _toSalonTime(now);

  const candidates = (slotId ? SLOTS.filter(s => s.id === slotId) : SLOTS)
    .map(slot => {
      const next = new Date(nowTZ);
      next.setHours(slot.hour, slot.minute, 0, 0);
      if (next <= nowTZ) next.setDate(next.getDate() + 1); // demain si passé
      return { slot, nextUTC: _salonToUTC(next) };
    })
    .sort((a, b) => a.nextUTC - b.nextUTC);

  return candidates[0] || null;
}

/**
 * Assigne automatiquement les slots aux contenus en attente [126]
 */
async function scheduleQueue() {
  const queue = require('./content-queue');
  const pending = await queue.getNextPending(null, new Date('2100-01-01'));
  if (!pending) return { scheduled: 0 };

  let count = 0;
  for (const slot of SLOTS) {
    const { nextUTC } = getNextSlotTime(slot.id);

    // Vérifie qu'aucun contenu n'est déjà schedulé à ce créneau
    const pool = require('./maintenance').getPool();
    if (!pool) continue;

    const existing = await pool.query(
      `SELECT id FROM daleba_content_queue WHERE scheduled_at = $1 AND status='pending' LIMIT 1`,
      [nextUTC]
    );
    if (existing.rows.length > 0) continue;

    // Récupère le prochain contenu non schedulé
    const item = await queue.getNextPending(null, new Date('2100-01-01'));
    if (!item || item.scheduled_at) continue;

    await queue.markScheduled(item.id, nextUTC);
    count++;
  }

  return { scheduled: count };
}

// ─── SCHEDULER PRINCIPAL [129] ───────────────────────────────────────────────

let _schedulerInterval = null;

function start() {
  if (_schedulerInterval) return;

  // Vérifie toutes les minutes si un créneau est atteint [129]
  _schedulerInterval = setInterval(_checkSlots, 60 * 1000);
  _checkSlots(); // Check immédiat au démarrage
  console.log('[MediaScheduler] ✅ Scheduler démarré — 3 créneaux/jour (08h00 · 12h30 · 19h00 ET)');
}

function stop() {
  if (_schedulerInterval) { clearInterval(_schedulerInterval); _schedulerInterval = null; }
}

async function _checkSlots() {
  try {
    const queue     = require('./content-queue');
    const publisher = require('./social-publisher');
    const bus       = (() => { try { return require('./event-bus'); } catch { return null; } })();

    const now = new Date();
    const item = await queue.getNextPending(null, now);
    if (!item) return;

    console.log(`[MediaScheduler] 🕐 Créneau atteint — publication: ${item.platform}`);
    bus?.system(`📅 MediaScheduler: publication autonome ${item.platform}`);

    // [129] Publication 100% autonome
    const result = await publisher.publishItem(item);
    console.log(`[MediaScheduler] Résultat: ${result.status}`);

  } catch (err) {
    console.error('[MediaScheduler] Erreur:', err.message);
  }
}

// ─── UTILITAIRES TIMEZONE ─────────────────────────────────────────────────────

function _toSalonTime(date) {
  // Crée une Date représentant l'heure locale du salon
  const str = date.toLocaleString('en-US', { timeZone: TZ_SALON });
  return new Date(str);
}

function _salonToUTC(localDate) {
  // Convertit une heure locale salon → UTC
  const offset = _getTimezoneOffset(TZ_SALON);
  return new Date(localDate.getTime() - offset * 60 * 1000);
}

function _getTimezoneOffset(tz) {
  const now = new Date();
  const utcStr   = now.toLocaleString('en-US', { timeZone: 'UTC' });
  const localStr = now.toLocaleString('en-US', { timeZone: tz });
  return (new Date(localStr) - new Date(utcStr)) / 60000;
}

// ─── EXPORTS ─────────────────────────────────────────────────────────────────

module.exports = { start, stop, scheduleQueue, getNextSlotTime, SLOTS, TZ_SALON };
