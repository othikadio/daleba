'use strict';

const { query } = require('../memory/db');
const jwt = require('jsonwebtoken');
let Redis = null;
try { Redis = require('ioredis'); } catch (e) { console.warn('[location.socket] ioredis non disponible — cache désactivé'); }

const JWT_SECRET = process.env.JWT_SECRET || 'daleba-secret-change-me';
const HEARTBEAT_INTERVAL_MS = 30000;
const POS_TTL_SECONDS = 300;

let redis = null;
try {
  if (Redis && process.env.REDIS_URL) {
    redis = new Redis(process.env.REDIS_URL, { lazyConnect: true, enableOfflineQueue: false });
    redis.on('error', (e) => console.error('[location.socket] Redis error:', e.message));
    console.log('[location.socket] Redis connecté');
  } else {
    console.warn('[location.socket] REDIS_URL absent ou ioredis manquant — cache positions désactivé');
  }
} catch (e) {
  console.error('[location.socket] Impossible de connecter Redis:', e.message);
}

// ── Helpers ────────────────────────────────────────────────────────────────────

/**
 * Vérifie un JWT et retourne le payload décodé ou null.
 * @param {string} token
 * @returns {object|null}
 */
function verifyToken(token) {
  try { return jwt.verify(token, JWT_SECRET); }
  catch { return null; }
}

/**
 * Valide les coordonnées GPS.
 * @param {number} lat
 * @param {number} lng
 * @returns {boolean}
 */
function isValidCoords(lat, lng) {
  return typeof lat === 'number' && typeof lng === 'number'
    && lat >= -90 && lat <= 90
    && lng >= -180 && lng <= 180;
}

/**
 * Met en cache la position d'une livraison dans Redis.
 * @param {number} deliveryId
 * @param {{lat,lng,speed,heading,ts}} pos
 */
async function cachePosition(deliveryId, pos) {
  if (!redis) return;
  try {
    await redis.set(`pos:${deliveryId}`, JSON.stringify(pos), 'EX', POS_TTL_SECONDS);
  } catch (e) {
    console.error('[location.socket] Redis SET error:', e.message);
  }
}

/**
 * Récupère la dernière position en cache.
 * @param {number} deliveryId
 * @returns {object|null}
 */
async function getCachedPosition(deliveryId) {
  if (!redis) return null;
  try {
    const raw = await redis.get(`pos:${deliveryId}`);
    return raw ? JSON.parse(raw) : null;
  } catch { return null; }
}

/**
 * Résout le deliveryId actif depuis un orderId.
 * @param {number} orderId
 * @returns {number|null}
 */
async function resolveDeliveryId(orderId) {
  try {
    const { rows } = await query(
      `SELECT d.id FROM deliveries d
       JOIN orders o ON o.id = d.order_id
       WHERE o.id = $1
         AND d.status NOT IN ('delivered', 'failed', 'rescheduled')
       ORDER BY d.created_at DESC LIMIT 1`,
      [orderId]
    );
    return rows[0]?.id || null;
  } catch (e) {
    console.error('[location.socket] resolveDeliveryId error:', e.message);
    return null;
  }
}

// ── Initialisation du namespace ────────────────────────────────────────────────

/**
 * Initialise le namespace Socket.io /tracking pour le suivi GPS en temps réel.
 *
 * Événements entrants (client → serveur) :
 *   driver:location:update — Mise à jour position livreur (JWT livreur requis)
 *   client:subscribe       — Abonnement au suivi d'une commande (JWT client requis)
 *   client:unsubscribe     — Désabonnement
 *
 * Événements sortants (serveur → client) :
 *   server:location  — Position livreur diffusée à la room
 *   server:status    — Changement de statut (livreur hors ligne, etc.)
 *   server:error     — Erreur métier (auth, validation)
 *
 * @param {import('socket.io').Server} io
 */
function initLocationSocket(io) {
  const tracking = io.of('/tracking');

  // Map pour tracker les intervalles heartbeat par socket
  const heartbeatMap = new Map();

  tracking.on('connection', (socket) => {
    console.log(`[location.socket] Connexion: ${socket.id}`);

    // ── driver:location:update ───────────────────────────────────────────────
    socket.on('driver:location:update', async (data) => {
      try {
        const { deliveryId, lat, lng, speed = 0, heading = 0, timestamp, token } = data || {};

        // 1. Auth JWT livreur
        const payload = verifyToken(token);
        if (!payload || payload.role !== 'driver') {
          return socket.emit('server:error', { code: 'UNAUTHORIZED', message: 'Token livreur invalide' });
        }

        // 2. Validation des coordonnées
        if (!deliveryId || !Number.isInteger(Number(deliveryId))) {
          return socket.emit('server:error', { code: 'INVALID_DELIVERY', message: 'deliveryId invalide' });
        }
        if (!isValidCoords(lat, lng)) {
          return socket.emit('server:error', { code: 'INVALID_COORDS', message: 'Coordonnées GPS invalides' });
        }

        const dId = Number(deliveryId);

        // 3. Persister dans gps_logs (PostGIS)
        await query(
          `INSERT INTO gps_logs (delivery_id, position, speed, heading)
           VALUES ($1, ST_SetSRID(ST_MakePoint($2, $3), 4326), $4, $5)`,
          [dId, lng, lat, speed, heading]
        );

        // 4. Mettre à jour le cache Redis
        const pos = { lat, lng, speed, heading, ts: timestamp || Date.now() };
        await cachePosition(dId, pos);

        // 5. Broadcast à tous les clients de la room
        const room = `delivery:${dId}`;
        tracking.to(room).emit('server:location', {
          lat, lng, speed, heading, eta: null,
          timestamp: timestamp || new Date().toISOString(),
        });

        // Heartbeat : associer le socket au deliveryId pour cleanup
        socket.driverDeliveryId = dId;

      } catch (err) {
        console.error('[location.socket] driver:location:update error:', err.message);
        socket.emit('server:error', { code: 'SERVER_ERROR', message: 'Erreur serveur' });
      }
    });

    // ── client:subscribe ─────────────────────────────────────────────────────
    socket.on('client:subscribe', async (data) => {
      try {
        const { orderId, token } = data || {};

        // 1. Auth JWT client
        const payload = verifyToken(token);
        if (!payload) {
          return socket.emit('server:error', { code: 'UNAUTHORIZED', message: 'Token client invalide' });
        }

        if (!orderId || !Number.isInteger(Number(orderId))) {
          return socket.emit('server:error', { code: 'INVALID_ORDER', message: 'orderId invalide' });
        }

        // 2. Résoudre deliveryId depuis la DB
        const deliveryId = await resolveDeliveryId(Number(orderId));
        if (!deliveryId) {
          return socket.emit('server:error', { code: 'NO_ACTIVE_DELIVERY', message: 'Aucune livraison active pour cette commande' });
        }

        // 3. Rejoindre la room
        const room = `delivery:${deliveryId}`;
        socket.join(room);
        socket.clientDeliveryId = deliveryId;
        console.log(`[location.socket] Client ${socket.id} subscribe → ${room}`);

        // 4. Envoyer la dernière position connue immédiatement
        const cached = await getCachedPosition(deliveryId);
        if (cached) {
          socket.emit('server:location', {
            lat: cached.lat, lng: cached.lng,
            speed: cached.speed, heading: cached.heading,
            eta: null, timestamp: new Date(cached.ts).toISOString(),
          });
        }

      } catch (err) {
        console.error('[location.socket] client:subscribe error:', err.message);
        socket.emit('server:error', { code: 'SERVER_ERROR', message: 'Erreur serveur' });
      }
    });

    // ── client:unsubscribe ───────────────────────────────────────────────────
    socket.on('client:unsubscribe', (data) => {
      const deliveryId = data?.orderId ? socket.clientDeliveryId : null;
      if (deliveryId) {
        socket.leave(`delivery:${deliveryId}`);
        console.log(`[location.socket] Client ${socket.id} unsubscribe delivery:${deliveryId}`);
      }
    });

    // ── Heartbeat (livreur) ──────────────────────────────────────────────────
    const hb = setInterval(() => {
      socket.emit('server:ping', { ts: Date.now() });
    }, HEARTBEAT_INTERVAL_MS);
    heartbeatMap.set(socket.id, hb);

    socket.on('client:pong', () => {
      // Livreur toujours connecté — rien à faire
    });

    // ── Déconnexion ──────────────────────────────────────────────────────────
    socket.on('disconnect', (reason) => {
      console.log(`[location.socket] Déconnexion: ${socket.id} (${reason})`);

      // Cleanup heartbeat
      const hbInterval = heartbeatMap.get(socket.id);
      if (hbInterval) { clearInterval(hbInterval); heartbeatMap.delete(socket.id); }

      // Si c'était un livreur avec une livraison active → notifier les clients
      if (socket.driverDeliveryId) {
        const room = `delivery:${socket.driverDeliveryId}`;
        tracking.to(room).emit('server:status', {
          status: 'driver_offline',
          message: 'Le livreur est temporairement hors ligne',
          timestamp: new Date().toISOString(),
        });
        console.log(`[location.socket] Livreur hors ligne → broadcast driver_offline → ${room}`);
      }
    });
  });

  console.log('[location.socket] Namespace /tracking initialisé');
  return tracking;
}

module.exports = initLocationSocket;
