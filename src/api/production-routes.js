/**
 * DALEBA — Production Routes (Usine de Production)
 *
 * POST /api/production/tasks           → créer + générer spec
 * GET  /api/production/tasks           → lister tâches
 * GET  /api/production/tasks/:id       → détail
 * POST /api/production/tasks/:id/regen → regénérer spec
 * PUT  /api/production/tasks/:id/status → changer statut
 * DELETE /api/production/tasks/:id     → supprimer
 */
'use strict';

const express = require('express');
const router  = express.Router();

let pool = null, DEMO_MODE = true;
try { const db = require('../memory/db'); pool = db.pool; DEMO_MODE = db.DEMO_MODE; } catch (e) {}

// ── Auto-migration ────────────────────────────────────────────────────────────
async function initTable() {
  if (DEMO_MODE || !pool) return;
  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS daleba_production_tasks (
        id                        SERIAL PRIMARY KEY,
        client_need_raw           TEXT    NOT NULL,
        context_additional        TEXT,
        specifications_functional TEXT,
        engine_used               VARCHAR(30),
        status                    VARCHAR(30) DEFAULT 'spec_pending_ulrich',
        technical_architecture_spec TEXT,
        arch_engine_used          VARCHAR(30),
        arch_status               VARCHAR(30) DEFAULT 'arch_pending',
        created_at                TIMESTAMPTZ DEFAULT NOW(),
        updated_at                TIMESTAMPTZ DEFAULT NOW(),
        notes                     TEXT
      );
      CREATE INDEX IF NOT EXISTS idx_prod_status ON daleba_production_tasks(status);
      CREATE INDEX IF NOT EXISTS idx_prod_created ON daleba_production_tasks(created_at DESC);
    `);
    // Migration douce : ajouter colonnes si la table existait déjà
    await pool.query(`ALTER TABLE daleba_production_tasks ADD COLUMN IF NOT EXISTS technical_architecture_spec TEXT;`);
    await pool.query(`ALTER TABLE daleba_production_tasks ADD COLUMN IF NOT EXISTS arch_engine_used VARCHAR(30);`);
    await pool.query(`ALTER TABLE daleba_production_tasks ADD COLUMN IF NOT EXISTS arch_status VARCHAR(30) DEFAULT 'arch_pending';`);
    // Étape 3 — Agent Dev
    await pool.query(`ALTER TABLE daleba_production_tasks ADD COLUMN IF NOT EXISTS generated_code_files JSONB;`);
    await pool.query(`ALTER TABLE daleba_production_tasks ADD COLUMN IF NOT EXISTS generated_code_raw TEXT;`);
    await pool.query(`ALTER TABLE daleba_production_tasks ADD COLUMN IF NOT EXISTS dev_engine_used VARCHAR(30);`);
    await pool.query(`ALTER TABLE daleba_production_tasks ADD COLUMN IF NOT EXISTS dev_status VARCHAR(30) DEFAULT 'code_pending';`);
    console.log('[production] Table daleba_production_tasks OK (Étape 1+2+3)');
  } catch (e) {
    if (!e.message.includes('already exists')) console.error('[production] initTable:', e.message);
  }
}
initTable();


// ── Auto-injection socket manquant au démarrage ────────────────────────────────
async function injectMissingSocketFile() {
  if (DEMO_MODE || !pool) return;
  try {
    const socketCode = `'use strict';

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
    await redis.set(\`pos:\${deliveryId}\`, JSON.stringify(pos), 'EX', POS_TTL_SECONDS);
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
    const raw = await redis.get(\`pos:\${deliveryId}\`);
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
      \`SELECT d.id FROM deliveries d
       JOIN orders o ON o.id = d.order_id
       WHERE o.id = $1
         AND d.status NOT IN ('delivered', 'failed', 'rescheduled')
       ORDER BY d.created_at DESC LIMIT 1\`,
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
    console.log(\`[location.socket] Connexion: \${socket.id}\`);

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
          \`INSERT INTO gps_logs (delivery_id, position, speed, heading)
           VALUES ($1, ST_SetSRID(ST_MakePoint($2, $3), 4326), $4, $5)\`,
          [dId, lng, lat, speed, heading]
        );

        // 4. Mettre à jour le cache Redis
        const pos = { lat, lng, speed, heading, ts: timestamp || Date.now() };
        await cachePosition(dId, pos);

        // 5. Broadcast à tous les clients de la room
        const room = \`delivery:\${dId}\`;
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
        const room = \`delivery:\${deliveryId}\`;
        socket.join(room);
        socket.clientDeliveryId = deliveryId;
        console.log(\`[location.socket] Client \${socket.id} subscribe → \${room}\`);

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
        socket.leave(\`delivery:\${deliveryId}\`);
        console.log(\`[location.socket] Client \${socket.id} unsubscribe delivery:\${deliveryId}\`);
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
      console.log(\`[location.socket] Déconnexion: \${socket.id} (\${reason})\`);

      // Cleanup heartbeat
      const hbInterval = heartbeatMap.get(socket.id);
      if (hbInterval) { clearInterval(hbInterval); heartbeatMap.delete(socket.id); }

      // Si c'était un livreur avec une livraison active → notifier les clients
      if (socket.driverDeliveryId) {
        const room = \`delivery:\${socket.driverDeliveryId}\`;
        tracking.to(room).emit('server:status', {
          status: 'driver_offline',
          message: 'Le livreur est temporairement hors ligne',
          timestamp: new Date().toISOString(),
        });
        console.log(\`[location.socket] Livreur hors ligne → broadcast driver_offline → \${room}\`);
      }
    });
  });

  console.log('[location.socket] Namespace /tracking initialisé');
  return tracking;
}

module.exports = initLocationSocket;
`;
    // Injecter dans toutes les tâches avec generated_code_files sans le socket
    const { rows } = await pool.query(`
      SELECT id, generated_code_files FROM daleba_production_tasks
      WHERE generated_code_files IS NOT NULL
        AND NOT (generated_code_files ? 'sockets/location.socket.js')
    `);
    for (const row of rows) {
      const files = row.generated_code_files || {};
      files['sockets/location.socket.js'] = socketCode;
      await pool.query(
        `UPDATE daleba_production_tasks SET generated_code_files = $1, updated_at = NOW() WHERE id = $2`,
        [JSON.stringify(files), row.id]
      );
      console.log(`[production] Socket injecté automatiquement → task #${row.id} (9/9 fichiers)`);
    }
  } catch (e) {
    if (!e.message.includes('does not exist')) console.error('[production] injectMissingSocketFile:', e.message);
  }
}
setTimeout(injectMissingSocketFile, 3000); // 3s après le démarrage

// ── POST /api/production/tasks — créer + générer en arrière-plan ───────────────
router.post('/tasks', async (req, res) => {
  try {
    const { client_need_raw, context_additional = '' } = req.body;
    if (!client_need_raw?.trim()) {
      return res.status(400).json({ error: 'client_need_raw est requis' });
    }

    // Insérer d'abord avec status "generating"
    const { rows } = await pool.query(`
      INSERT INTO daleba_production_tasks
        (client_need_raw, context_additional, status)
      VALUES ($1, $2, 'generating')
      RETURNING *
    `, [client_need_raw.trim(), context_additional.trim()]);

    const task = rows[0];
    res.json({ task, message: 'Cahier des charges en cours de génération…' });

    // Générer la spec en arrière-plan
    setImmediate(async () => {
      try {
        const { generateSpec } = require('../services/product-owner-agent');
        const { spec, engine } = await generateSpec(client_need_raw, context_additional);

        await pool.query(`
          UPDATE daleba_production_tasks
          SET specifications_functional = $1,
              engine_used = $2,
              status = 'spec_pending_ulrich',
              updated_at = NOW()
          WHERE id = $3
        `, [spec, engine, task.id]);

        console.log(`[production] Spec générée — task #${task.id} (${engine})`);
      } catch (err) {
        await pool.query(
          `UPDATE daleba_production_tasks SET status = 'error', notes = $1, updated_at = NOW() WHERE id = $2`,
          [err.message, task.id]
        ).catch(() => {});
        console.error(`[production] Erreur génération task #${task.id}:`, err.message);
      }
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── GET /api/production/tasks ──────────────────────────────────────────────────
router.get('/tasks', async (req, res) => {
  try {
    const { status, limit = 50, offset = 0 } = req.query;
    const where  = status ? 'WHERE status = $1' : '';
    const params = status
      ? [status, parseInt(limit), parseInt(offset)]
      : [parseInt(limit), parseInt(offset)];
    const limitIdx = status ? 2 : 1;

    const { rows } = await pool.query(`
      SELECT id, client_need_raw, context_additional, engine_used,
             status, created_at, updated_at, notes,
             arch_status, arch_engine_used,
             dev_status, dev_engine_used,
             LEFT(specifications_functional, 300) AS spec_preview
      FROM daleba_production_tasks
      ${where}
      ORDER BY created_at DESC
      LIMIT $${limitIdx} OFFSET $${limitIdx + 1}
    `, params);

    const count = await pool.query(
      `SELECT COUNT(*) FROM daleba_production_tasks ${where}`,
      status ? [status] : []
    );

    res.json({ tasks: rows, total: parseInt(count.rows[0].count) });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── GET /api/production/tasks/:id ─────────────────────────────────────────────
router.get('/tasks/:id', async (req, res) => {
  try {
    const { rows } = await pool.query(
      'SELECT * FROM daleba_production_tasks WHERE id = $1', [req.params.id]
    );
    if (!rows.length) return res.status(404).json({ error: 'Not found' });
    res.json(rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── POST /api/production/tasks/:id/regen ──────────────────────────────────────
router.post('/tasks/:id/regen', async (req, res) => {
  try {
    const { rows } = await pool.query(
      'SELECT * FROM daleba_production_tasks WHERE id = $1', [req.params.id]
    );
    if (!rows.length) return res.status(404).json({ error: 'Not found' });
    const task = rows[0];

    await pool.query(
      `UPDATE daleba_production_tasks SET status = 'generating', updated_at = NOW() WHERE id = $1`,
      [task.id]
    );
    res.json({ message: 'Regénération lancée', task_id: task.id });

    setImmediate(async () => {
      try {
        const { generateSpec } = require('../services/product-owner-agent');
        const { spec, engine } = await generateSpec(task.client_need_raw, task.context_additional || '');
        await pool.query(`
          UPDATE daleba_production_tasks
          SET specifications_functional = $1, engine_used = $2,
              status = 'spec_pending_ulrich', updated_at = NOW()
          WHERE id = $3
        `, [spec, engine, task.id]);
      } catch (err) {
        await pool.query(
          `UPDATE daleba_production_tasks SET status = 'error', notes = $1, updated_at = NOW() WHERE id = $2`,
          [err.message, task.id]
        ).catch(() => {});
      }
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── PUT /api/production/tasks/:id/status ──────────────────────────────────────
router.put('/tasks/:id/status', async (req, res) => {
  try {
    const { status, notes } = req.body;
    const allowed = ['spec_pending_ulrich', 'spec_approved', 'in_development', 'delivered', 'archived'];
    if (!allowed.includes(status)) {
      return res.status(400).json({ error: `Statuts valides: ${allowed.join(', ')}` });
    }
    const { rows } = await pool.query(
      `UPDATE daleba_production_tasks
       SET status = $1, notes = COALESCE($2, notes), updated_at = NOW()
       WHERE id = $3 RETURNING *`,
      [status, notes || null, req.params.id]
    );
    if (!rows.length) return res.status(404).json({ error: 'Not found' });
    res.json(rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── POST /api/production/tasks/:id/architect — Étape 2 ──────────────────────
router.post('/tasks/:id/architect', async (req, res) => {
  try {
    const { rows } = await pool.query(
      'SELECT * FROM daleba_production_tasks WHERE id = $1', [req.params.id]
    );
    if (!rows.length) return res.status(404).json({ error: 'Not found' });
    const task = rows[0];

    if (!task.specifications_functional) {
      return res.status(400).json({ error: 'Le cahier des charges fonctionnel (Étape 1) doit être généré avant l\'architecture.' });
    }

    // Passer en mode generating
    await pool.query(
      `UPDATE daleba_production_tasks SET arch_status = 'arch_generating', updated_at = NOW() WHERE id = $1`,
      [task.id]
    );
    res.json({ message: 'Agent Architecte lancé — architecture en cours…', task_id: task.id });

    // Générer en arrière-plan
    setImmediate(async () => {
      try {
        const { generateArchitecture } = require('../services/architect-agent');
        const { arch, engine } = await generateArchitecture(
          task.specifications_functional,
          task.client_need_raw
        );

        await pool.query(`
          UPDATE daleba_production_tasks
          SET technical_architecture_spec = $1,
              arch_engine_used = $2,
              arch_status = 'arch_pending_ulrich',
              updated_at = NOW()
          WHERE id = $3
        `, [arch, engine, task.id]);

        console.log(`[production] Architecture générée — task #${task.id} (${engine})`);
      } catch (err) {
        await pool.query(
          `UPDATE daleba_production_tasks SET arch_status = 'arch_error', notes = $1, updated_at = NOW() WHERE id = $2`,
          [err.message, task.id]
        ).catch(() => {});
        console.error(`[production] Erreur architecture task #${task.id}:`, err.message);
      }
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});


// ── POST /api/production/tasks/:id/dev — Étape 3 ─────────────────────────────
router.post('/tasks/:id/dev', async (req, res) => {
  try {
    const { rows } = await pool.query(
      'SELECT * FROM daleba_production_tasks WHERE id = $1', [req.params.id]
    );
    if (!rows.length) return res.status(404).json({ error: 'Not found' });
    const task = rows[0];

    if (!task.technical_architecture_spec) {
      return res.status(400).json({ error: 'L\'architecture technique (Étape 2) doit être générée avant de coder.' });
    }

    await pool.query(
      `UPDATE daleba_production_tasks SET dev_status = 'code_generating', updated_at = NOW() WHERE id = $1`,
      [task.id]
    );
    res.json({ message: 'Agent Développeur lancé — code en production (60-120s)…', task_id: task.id });

    setImmediate(async () => {
      try {
        const { generateCode } = require('../services/dev-agent');
        const { files, rawOutput, engine, fileCount } = await generateCode(
          task.client_need_raw,
          task.specifications_functional || '',
          task.technical_architecture_spec
        );

        await pool.query(`
          UPDATE daleba_production_tasks
          SET generated_code_files = $1,
              generated_code_raw   = $2,
              dev_engine_used      = $3,
              dev_status           = 'code_pending_ulrich',
              updated_at           = NOW()
          WHERE id = $4
        `, [JSON.stringify(files), rawOutput, engine, task.id]);

        console.log(`[production] Code généré — task #${task.id} — ${fileCount} fichiers (${engine})`);
      } catch (err) {
        await pool.query(
          `UPDATE daleba_production_tasks SET dev_status = 'code_error', notes = $1, updated_at = NOW() WHERE id = $2`,
          [err.message, task.id]
        ).catch(() => {});
        console.error(`[production] Erreur dev task #${task.id}:`, err.message);
      }
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── PUT /api/production/tasks/:id/dev-approve ─────────────────────────────────
router.put('/tasks/:id/dev-approve', async (req, res) => {
  try {
    const { rows } = await pool.query(
      `UPDATE daleba_production_tasks
       SET dev_status = 'code_approved', updated_at = NOW()
       WHERE id = $1 RETURNING *`,
      [req.params.id]
    );
    if (!rows.length) return res.status(404).json({ error: 'Not found' });
    res.json(rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── GET /api/production/tasks/:id/code — télécharger les fichiers ─────────────
router.get('/tasks/:id/code', async (req, res) => {
  try {
    const { rows } = await pool.query(
      'SELECT id, generated_code_files, dev_status, dev_engine_used FROM daleba_production_tasks WHERE id = $1',
      [req.params.id]
    );
    if (!rows.length) return res.status(404).json({ error: 'Not found' });
    const t = rows[0];
    if (!t.generated_code_files) return res.status(404).json({ error: 'Code pas encore généré' });
    res.json({
      files: t.generated_code_files,
      engine: t.dev_engine_used,
      status: t.dev_status,
      fileCount: Object.keys(t.generated_code_files).length,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});


// ── PUT /api/production/tasks/:id/arch-approve ────────────────────────────────
router.put('/tasks/:id/arch-approve', async (req, res) => {
  try {
    const { rows } = await pool.query(
      `UPDATE daleba_production_tasks
       SET arch_status = 'arch_approved', updated_at = NOW()
       WHERE id = $1 RETURNING *`,
      [req.params.id]
    );
    if (!rows.length) return res.status(404).json({ error: 'Not found' });
    res.json(rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});


// ── POST /api/production/tasks/:id/inject-file — injecter un fichier dans le JSONB ──
router.post('/tasks/:id/inject-file', async (req, res) => {
  try {
    const { path, content } = req.body;
    if (!path || !content) return res.status(400).json({ error: 'path et content requis' });

    const { rows } = await pool.query(
      'SELECT generated_code_files FROM daleba_production_tasks WHERE id = $1', [req.params.id]
    );
    if (!rows.length) return res.status(404).json({ error: 'Not found' });

    const files = rows[0].generated_code_files || {};
    files[path] = content;

    await pool.query(
      `UPDATE daleba_production_tasks
       SET generated_code_files = $1, updated_at = NOW()
       WHERE id = $2`,
      [JSON.stringify(files), req.params.id]
    );

    res.json({ ok: true, path, totalFiles: Object.keys(files).length });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── DELETE /api/production/tasks/:id ──────────────────────────────────────────
router.delete('/tasks/:id', async (req, res) => {
  try {
    const { rowCount } = await pool.query(
      'DELETE FROM daleba_production_tasks WHERE id = $1', [req.params.id]
    );
    if (!rowCount) return res.status(404).json({ error: 'Not found' });
    res.json({ deleted: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
