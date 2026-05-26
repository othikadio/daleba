/**
 * DALEBA — Agent Développeur Backend (Usine de Production, Étape 3)
 *
 * Génère du code Node.js/Express/Socket.io de production à partir
 * de l'architecture technique (Étape 2).
 *
 * Livrables :
 *   models/     — Pool PostgreSQL + requêtes SQL (PostGIS)
 *   controllers/ — Auth, statuts, reprogrammation
 *   sockets/    — Serveur Socket.io GPS livestream
 *
 * Moteur : DeepSeek-Coder (principal) → Claude (fallback)
 */
'use strict';

const https = require('https');

const DEEPSEEK_KEY  = process.env.DEEPSEEK_API_KEY || 'sk-cca2191225a9417cb589dab3c7172015';
const ANTHROPIC_KEY = process.env.ANTHROPIC_API_KEY;

console.log(`[dev-agent] Moteur: deepseek-coder → fallback: ${ANTHROPIC_KEY ? 'claude' : 'none'}`);

// ── Prompt Système — Optimisé tokens, code pur ──────────────────────────────
const SYSTEM_PROMPT = `Tu es un développeur backend Node.js/Express et Socket.io senior.
Ton unique but est de générer du code de production propre, modulaire et documenté en te basant sur l'architecture fournie.
Ne génère aucune explication textuelle ou bavardage avant ou après le code.
Produis uniquement la structure des fichiers de manière brute et optimisée pour économiser les tokens.

FORMAT DE RÉPONSE OBLIGATOIRE — respecte exactement cette structure :

=== FILE: models/db.js ===
[contenu fichier]

=== FILE: models/users.js ===
[contenu fichier]

=== FILE: models/orders.js ===
[contenu fichier]

=== FILE: models/deliveries.js ===
[contenu fichier]

=== FILE: models/gps_logs.js ===
[contenu fichier]

=== FILE: controllers/auth.controller.js ===
[contenu fichier]

=== FILE: controllers/delivery.controller.js ===
[contenu fichier]

=== FILE: controllers/schedule.controller.js ===
[contenu fichier]

=== FILE: sockets/location.socket.js ===
[contenu fichier]

Contraintes de code :
- CommonJS (require/module.exports), pas d'ESM
- Async/await partout, try/catch systématique
- JSDoc sur chaque fonction exportée
- Variables d'env via process.env (pas de valeurs hardcodées)
- Sécurité : validation input, pas d'injection SQL (requêtes paramétrées $1,$2...)
- PostGIS : ST_SetSRID(ST_MakePoint(lng, lat), 4326) pour les coordonnées GPS`;

// ── Prompt utilisateur — contexte + livrables ───────────────────────────────
function buildUserPrompt(clientNeed, functionalSpec, architectureSpec) {
  return `PROJET : ${clientNeed.slice(0, 200)}

ARCHITECTURE TECHNIQUE (référence) :
${architectureSpec.slice(0, 6000)}

LIVRABLES ATTENDUS :

models/db.js
- Pool PostgreSQL (pg) avec config depuis env vars
- Fonction query(text, params) wrappée + logging
- Export pool + query

models/users.js
- createUser({email, password_hash, role}) → INSERT
- findByEmail(email) → SELECT
- findById(id) → SELECT
- updateDeviceToken(userId, token) → UPDATE (FCM)

models/orders.js
- findByOrderNumberAndPostal(orderNumber, postalCode) → SELECT + JOIN deliveries
- findByClientId(clientId) → SELECT list
- updateStatus(orderId, status) → UPDATE

models/deliveries.js
- createDelivery({orderId, driverId, scheduledAt, address}) → INSERT
- getActiveDelivery(orderId) → SELECT + JOIN gps_logs latest position
- markDelivered(deliveryId, photoUrl) → UPDATE
- markFailed(deliveryId, reason) → UPDATE
- reschedule(deliveryId, newSlot, newAddress) → UPDATE (max 1 fois)
- getDriverDeliveries(driverId, date) → SELECT list pour journée livreur

models/gps_logs.js
- insertGpsLog({deliveryId, lat, lng, speed, heading}) → INSERT PostGIS point
- getLatestPosition(deliveryId) → SELECT dernière position
- getTrack(deliveryId) → SELECT historique positions ordonnées

controllers/auth.controller.js
- POST /api/auth/track — Auth client par n° commande + code postal → JWT court (24h)
- POST /api/auth/driver/login — Auth livreur email+password → JWT (8h)
- GET /api/auth/me — Profil depuis token

controllers/delivery.controller.js
- GET /api/deliveries/:orderId — Détail livraison + position live + ETA
- PUT /api/deliveries/:deliveryId/status — Changer statut (livreur seulement)
- GET /api/deliveries/driver/today — Liste du jour pour livreur connecté

controllers/schedule.controller.js
- PUT /api/deliveries/:deliveryId/reschedule — Reprogrammer (client) avec validation 1 seul reschedule, plage J+1 à J+7, même ville
- GET /api/deliveries/:deliveryId/slots — Créneaux disponibles J+1 à J+7

sockets/location.socket.js
- Namespace /tracking
- Événement CLIENT: driver:location:update {deliveryId, lat, lng, speed, heading, timestamp}
  → Valider JWT livreur → INSERT gps_log → Broadcast à room delivery:{deliveryId}
- Événement CLIENT: client:subscribe {orderId, token}
  → Valider JWT client → join room delivery:{deliveryId} → emit position actuelle
- Événement CLIENT: client:unsubscribe {orderId}
  → leave room
- Événement SERVEUR: server:location {lat, lng, speed, heading, eta, timestamp}
- Événement SERVEUR: server:status {status, message, timestamp}
- Événement SERVEUR: server:error {code, message}
- Heartbeat ping/pong 30s pour détecter déconnexions livreur

Génère maintenant les 9 fichiers complets.`;
}

// ── Parseur de fichiers ─────────────────────────────────────────────────────
function parseGeneratedFiles(rawOutput) {
  const files = {};
  const regex = /=== FILE: ([^\s=]+) ===([\s\S]*?)(?==== FILE:|$)/g;
  let match;
  while ((match = regex.exec(rawOutput)) !== null) {
    const path    = match[1].trim();
    const content = match[2].trim();
    if (path && content) files[path] = content;
  }
  return files;
}

// ── Appel DeepSeek-Coder ────────────────────────────────────────────────────
function callDeepSeek(userPrompt) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify({
      model:       'deepseek-coder',
      temperature: 0.1,        // Température basse = code déterministe
      max_tokens:  8000,
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'user',   content: userPrompt },
      ],
    });

    const req = https.request({
      hostname: 'api.deepseek.com',
      path:     '/chat/completions',
      method:   'POST',
      headers: {
        'Authorization':  `Bearer ${DEEPSEEK_KEY}`,
        'Content-Type':   'application/json',
        'Content-Length': Buffer.byteLength(body),
      },
      timeout: 120000,
    }, (res) => {
      let data = '';
      res.on('data', c => { data += c; });
      res.on('end', () => {
        try {
          const json = JSON.parse(data);
          if (json.error) throw new Error(json.error.message);
          resolve(json.choices?.[0]?.message?.content || '');
        } catch (e) { reject(new Error('DeepSeek: ' + e.message)); }
      });
    });
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error('DeepSeek timeout 120s')); });
    req.write(body);
    req.end();
  });
}

// ── Appel Claude (fallback) ─────────────────────────────────────────────────
function callClaude(userPrompt) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify({
      model:      'claude-opus-4-5',
      max_tokens: 8000,
      system:     SYSTEM_PROMPT,
      messages:   [{ role: 'user', content: userPrompt }],
    });

    const req = https.request({
      hostname: 'api.anthropic.com',
      path:     '/v1/messages',
      method:   'POST',
      headers: {
        'x-api-key':         ANTHROPIC_KEY,
        'anthropic-version': '2023-06-01',
        'content-type':      'application/json',
        'Content-Length':    Buffer.byteLength(body),
      },
      timeout: 120000,
    }, (res) => {
      let data = '';
      res.on('data', c => { data += c; });
      res.on('end', () => {
        try {
          const json = JSON.parse(data);
          if (json.error) throw new Error(json.error.message);
          resolve(json.content?.[0]?.text || '');
        } catch (e) { reject(new Error('Claude: ' + e.message)); }
      });
    });
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error('Claude timeout')); });
    req.write(body);
    req.end();
  });
}

// ── Fonction principale ─────────────────────────────────────────────────────
/**
 * Génère les fichiers de code backend à partir de l'architecture technique.
 * @param {string} clientNeedRaw        — Besoin original
 * @param {string} functionalSpec       — Cahier des charges (Étape 1)
 * @param {string} technicalArchSpec    — Architecture technique (Étape 2)
 * @returns {Promise<{files: Object, rawOutput: string, engine: string, fileCount: number}>}
 */
async function generateCode(clientNeedRaw, functionalSpec, technicalArchSpec) {
  const userPrompt = buildUserPrompt(clientNeedRaw, functionalSpec, technicalArchSpec);

  console.log(`[dev-agent] Génération code backend — arch: ${technicalArchSpec.length} chars`);

  let rawOutput, engine;
  try {
    rawOutput = await callDeepSeek(userPrompt);
    engine    = 'deepseek-coder';
  } catch (err) {
    console.warn('[dev-agent] DeepSeek échoué, fallback Claude:', err.message);
    if (!ANTHROPIC_KEY) throw new Error('DeepSeek KO et pas de ANTHROPIC_API_KEY pour fallback');
    rawOutput = await callClaude(userPrompt);
    engine    = 'claude-fallback';
  }

  const files = parseGeneratedFiles(rawOutput);
  const fileCount = Object.keys(files).length;
  console.log(`[dev-agent] ${fileCount} fichiers générés via ${engine} (${rawOutput.length} chars raw)`);

  return { files, rawOutput, engine, fileCount };
}

module.exports = { generateCode, parseGeneratedFiles };
