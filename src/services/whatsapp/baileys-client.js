'use strict';
/**
 * DALEBA WhatsApp Salon — Baileys Client
 * Connexion WhatsApp Web via Baileys (open-source)
 * Session persistée en PostgreSQL (survit aux redémarrages Railway)
 */
const { default: makeWASocket, DisconnectReason, useMultiFileAuthState, fetchLatestBaileysVersion } = require('@whiskeysockets/baileys');
const { Boom } = require('@hapi/boom');
const pino  = require('pino');
const fs    = require('fs');
const path  = require('path');
const { pool } = require('../../memory/db');
const EventEmitter = require('events');

const emitter = new EventEmitter();
const SESSION_DIR = '/tmp/daleba-wa-session';
fs.mkdirSync(SESSION_DIR, { recursive: true });

let _sock      = null;
let _qrCode    = null;
let _connected = false;
let _reconnectTimer = null;

// ─── PERSISTANCE SESSION DB ───────────────────────────────────────────────────
const SESSION_INIT_SQL = `
  CREATE TABLE IF NOT EXISTS daleba_wa_auth (
    key   TEXT PRIMARY KEY,
    value JSONB NOT NULL,
    updated_at TIMESTAMPTZ DEFAULT NOW()
  );
`;

async function dbAuthState() {
  try { await pool.query(SESSION_INIT_SQL); } catch(_) {}

  const readFile = async (file) => {
    try {
      const r = await pool.query('SELECT value FROM daleba_wa_auth WHERE key=$1', [file]);
      return r.rows[0]?.value || null;
    } catch(_) { return null; }
  };

  const writeFile = async (file, data) => {
    try {
      await pool.query(
        `INSERT INTO daleba_wa_auth (key, value, updated_at) VALUES ($1,$2,NOW())
         ON CONFLICT (key) DO UPDATE SET value=$2, updated_at=NOW()`,
        [file, JSON.stringify(data)]
      );
    } catch(_) {}
  };

  const removeFile = async (file) => {
    try { await pool.query('DELETE FROM daleba_wa_auth WHERE key=$1', [file]); } catch(_) {}
  };

  // Compatibilité avec useMultiFileAuthState (stockage en DB simulé)
  // Baileys écrit ses fichiers dans SESSION_DIR — on sync après
  const { state, saveCreds } = await useMultiFileAuthState(SESSION_DIR);

  // Surcharge de saveCreds pour persister aussi en DB
  const persistCreds = async () => {
    try {
      const files = fs.readdirSync(SESSION_DIR);
      for (const f of files) {
        const content = fs.readFileSync(path.join(SESSION_DIR, f), 'utf8');
        await writeFile(`session:${f}`, JSON.parse(content));
      }
    } catch(_) {}
    return saveCreds();
  };

  // Restaurer depuis DB au démarrage si SESSION_DIR est vide
  try {
    const existing = fs.readdirSync(SESSION_DIR);
    if (!existing.length) {
      const r = await pool.query("SELECT key, value FROM daleba_wa_auth WHERE key LIKE 'session:%'");
      for (const row of r.rows) {
        const filename = row.key.replace('session:', '');
        fs.writeFileSync(path.join(SESSION_DIR, filename), JSON.stringify(row.value));
      }
    }
  } catch(_) {}

  return { state, saveCreds: persistCreds };
}

// ─── CONNEXION PRINCIPALE ─────────────────────────────────────────────────────
async function connect(onMessage) {
  if (_reconnectTimer) { clearTimeout(_reconnectTimer); _reconnectTimer = null; }

  const { version } = await fetchLatestBaileysVersion();
  const { state, saveCreds } = await dbAuthState();

  _sock = makeWASocket({
    version,
    auth: state,
    logger: pino({ level: 'silent' }),
    printQRInTerminal: true,
    browser: ['Kadio Coiffure', 'Safari', '1.0.0'],
    generateHighQualityLinkPreview: false,
    syncFullHistory: false,
    markOnlineOnConnect: false,
  });

  // ── QR Code ───────────────────────────────────────────────────────────────
  _sock.ev.on('connection.update', (update) => {
    const { connection, lastDisconnect, qr } = update;

    if (qr) {
      _qrCode = qr;
      _connected = false;
      emitter.emit('qr', qr);
      console.log('[WA-Baileys] 📱 QR Code généré — scannez avec le téléphone du salon');
    }

    if (connection === 'open') {
      _qrCode = null;
      _connected = true;
      emitter.emit('connected', _sock.user);
      console.log('[WA-Baileys] ✅ WhatsApp connecté :', _sock.user?.id);
    }

    if (connection === 'close') {
      _connected = false;
      emitter.emit('disconnected');
      const code = (lastDisconnect?.error instanceof Boom)
        ? lastDisconnect.error.output.statusCode
        : null;
      const shouldReconnect = code !== DisconnectReason.loggedOut;
      console.log('[WA-Baileys] ⚠️ Déconnecté (code:', code, ') — reconnexion:', shouldReconnect);
      if (shouldReconnect) {
        _reconnectTimer = setTimeout(() => connect(onMessage), 8000);
      }
    }
  });

  // ── Sauvegarde credentials ──────────────────────────────────────────────
  _sock.ev.on('creds.update', saveCreds);

  // ── Messages entrants ────────────────────────────────────────────────────
  _sock.ev.on('messages.upsert', async ({ messages, type }) => {
    if (type !== 'notify') return;
    for (const msg of messages) {
      if (msg.key.fromMe) continue; // ignorer nos propres messages
      if (msg.key.remoteJid?.endsWith('@g.us')) continue; // ignorer les groupes

      const phone       = msg.key.remoteJid.replace('@s.whatsapp.net', '');
      const displayName = msg.pushName || phone;
      const msgData     = msg.message || {};

      // Extraire le contenu
      let text = '';
      let mediaUrl  = null;
      let mediaType = null;

      if (msgData.conversation) {
        text = msgData.conversation;
      } else if (msgData.extendedTextMessage) {
        text = msgData.extendedTextMessage.text;
      } else if (msgData.imageMessage) {
        text = msgData.imageMessage.caption || '';
        mediaType = 'image';
        try { mediaUrl = await _sock.downloadMediaMessage(msg, 'buffer').then(buf => `data:image/jpeg;base64,${buf.toString('base64')}`); } catch(_) {}
      } else if (msgData.videoMessage) {
        text = msgData.videoMessage.caption || '';
        mediaType = 'video';
      } else if (msgData.audioMessage || msgData.pttMessage) {
        mediaType = 'audio';
        text = '[vocal]';
        // Télécharger l'audio pour transcription
        try {
          const buf = await _sock.downloadMediaMessage(msg, 'buffer');
          const tmpPath = `/tmp/daleba-wa/audio_${Date.now()}.ogg`;
          require('fs').writeFileSync(tmpPath, buf);
          mediaUrl = tmpPath; // path local pour transcription Whisper
        } catch(_) {}
      } else if (msgData.documentMessage) {
        text = msgData.documentMessage.caption || '';
        mediaType = 'document';
      }

      if (!text && !mediaType) continue; // message vide

      try {
        await onMessage({ phone, displayName, text, mediaUrl, mediaType, rawMsg: msg });
      } catch(e) {
        console.error('[WA-Baileys] handler error:', e.message);
      }
    }
  });

  return _sock;
}

// ─── ENVOI MESSAGES ───────────────────────────────────────────────────────────
async function sendText(phone, text) {
  if (!_sock || !_connected) throw new Error('WhatsApp non connecté');
  const jid = phone.includes('@') ? phone : `${phone}@s.whatsapp.net`;
  return _sock.sendMessage(jid, { text });
}

async function sendAudio(phone, audioPath) {
  if (!_sock || !_connected) throw new Error('WhatsApp non connecté');
  const jid  = phone.includes('@') ? phone : `${phone}@s.whatsapp.net`;
  const data = require('fs').readFileSync(audioPath);
  return _sock.sendMessage(jid, { audio: data, mimetype: 'audio/mp4', ptt: true });
}

async function sendImage(phone, imageBuffer, caption = '') {
  if (!_sock || !_connected) throw new Error('WhatsApp non connecté');
  const jid = phone.includes('@') ? phone : `${phone}@s.whatsapp.net`;
  return _sock.sendMessage(jid, { image: imageBuffer, caption });
}

// ─── STATUS ──────────────────────────────────────────────────────────────────
function getStatus() {
  return {
    connected:  _connected,
    hasQR:      !!_qrCode,
    qr:         _qrCode,
    phoneNumber: _sock?.user?.id?.split(':')[0] || null,
  };
}

module.exports = { connect, sendText, sendAudio, sendImage, getStatus, emitter };
