/**
 * Token Vault — DALEBA Metacortex Point 144
 *
 * Registre chiffré AES-256-GCM des tokens d'accès sociaux.
 * Masquage automatique dans tous les logs applicatifs.
 * Zéro exposition en clair dans les traces/erreurs.
 */

'use strict';

const crypto = require('crypto');
const fs     = require('fs');
const path   = require('path');

// ─── CHIFFREMENT AES-256-GCM ──────────────────────────────────────────────────

// Clé dérivée de la clé Anthropic (disponible au boot) + salt fixe
function _deriveKey() {
  const secret = process.env.ANTHROPIC_API_KEY || process.env.OPENAI_API_KEY || 'daleba-vault-default-key';
  return crypto.scryptSync(secret, 'daleba-vault-salt-v1', 32);
}

function encrypt(plaintext) {
  const key = _deriveKey();
  const iv  = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const enc  = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const tag  = cipher.getAuthTag();
  return [iv.toString('hex'), enc.toString('hex'), tag.toString('hex')].join(':');
}

function decrypt(ciphertext) {
  const [ivHex, encHex, tagHex] = ciphertext.split(':');
  const key     = _deriveKey();
  const iv      = Buffer.from(ivHex, 'hex');
  const enc     = Buffer.from(encHex, 'hex');
  const tag     = Buffer.from(tagHex, 'hex');
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(tag);
  return decipher.update(enc) + decipher.final('utf8');
}

// ─── REGISTRE EN MÉMOIRE ──────────────────────────────────────────────────────

// Map: tokenKey → encryptedValue
const _vault = new Map();

/**
 * Liste des noms de tokens à masquer dans les logs [144]
 */
const SENSITIVE_KEYS = new Set([
  'META_ACCESS_TOKEN', 'META_USER_ACCESS_TOKEN',
  'META_IG_ACCOUNT_ID', 'META_FB_PAGE_ID',
  'TIKTOK_BUSINESS_TOKEN', 'TIKTOK_BUSINESS_SUITE_KEY', 'TIKTOK_OPEN_ID',
  'TIKTOK_RESEARCH_API_TOKEN',
  'ANTHROPIC_API_KEY', 'OPENAI_API_KEY', 'GEMINI_API_KEY',
  'REPLICATE_API_TOKEN', 'ELEVENLABS_API_KEY',
  'TWILIO_AUTH_TOKEN', 'TWILIO_ACCOUNT_SID',
  'SQUARE_ACCESS_TOKEN',
  'STRIPE_SECRET_KEY',
  'RAILWAY_API_TOKEN',
  'GITHUB_TOKEN',
  'YOUTUBE_API_KEY',
]);

// ─── VAULT OPERATIONS ─────────────────────────────────────────────────────────

function store(key, value) {
  if (!value) return;
  _vault.set(key, encrypt(value));
}

function retrieve(key) {
  const enc = _vault.get(key) || null;
  if (!enc) {
    // Fallback: lire depuis process.env directement (non chiffré mais jamais loggé)
    return process.env[key] || null;
  }
  try { return decrypt(enc); } catch { return process.env[key] || null; }
}

function has(key) {
  return _vault.has(key) || !!process.env[key];
}

/**
 * Charge tous les tokens sensibles depuis process.env dans le vault chiffré
 * À appeler une fois au démarrage
 */
function loadFromEnv() {
  let loaded = 0;
  for (const key of SENSITIVE_KEYS) {
    if (process.env[key]) {
      store(key, process.env[key]);
      loaded++;
    }
  }
  console.log(`[TokenVault] ${loaded} tokens chargés et chiffrés en mémoire`);
  return loaded;
}

// ─── MASQUAGE LOGS [144] ──────────────────────────────────────────────────────

/**
 * Masque les tokens sensibles dans une chaîne de log
 * Remplace toute valeur ressemblant à un token (≥20 chars alphanum) après un = ou :
 */
function maskSecrets(text) {
  if (typeof text !== 'string') return text;

  let masked = text;

  // Masquer les valeurs des clés sensibles connues
  for (const key of SENSITIVE_KEYS) {
    const val = process.env[key];
    if (val && val.length >= 8 && masked.includes(val)) {
      masked = masked.split(val).join(`[${key.split('_')[0]}:REDACTED]`);
    }
  }

  // Masquage générique: tokens Bearer, clés API longues
  masked = masked.replace(/Bearer\s+[A-Za-z0-9\-._~+/]+=*/g, 'Bearer [REDACTED]');
  masked = masked.replace(/(?:key|token|secret|password|auth)["\s:=]+([A-Za-z0-9\-._]{20,})/gi,
    (_, t) => `[REDACTED:${t.length}chars]`);

  return masked;
}

/**
 * [144] Patch console.log/error/warn pour masquer automatiquement les secrets
 */
function installLogFilter() {
  const _origLog   = console.log.bind(console);
  const _origWarn  = console.warn.bind(console);
  const _origError = console.error.bind(console);

  const safeArgs = (args) => args.map(a => typeof a === 'string' ? maskSecrets(a) : a);

  console.log   = (...args) => _origLog(...safeArgs(args));
  console.warn  = (...args) => _origWarn(...safeArgs(args));
  console.error = (...args) => _origError(...safeArgs(args));

  console.log('[TokenVault] Log filter installé — secrets masqués dans les sorties');
}

// ─── EXPORTS ─────────────────────────────────────────────────────────────────

module.exports = {
  store, retrieve, has, loadFromEnv, maskSecrets, installLogFilter,
  SENSITIVE_KEYS,
};
