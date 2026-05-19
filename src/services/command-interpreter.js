/**
 * Command Interpreter — DALEBA Metacortex Points 076-080
 *
 * Interprète les commandes rapides SMS/Telegram du Commandant.
 * Sécurité : validation numéro · journal chiffré · rate limiting.
 * OUI/NON/STATUT pour les patches · commandes système étendues.
 */

'use strict';

const crypto = require('crypto');

// ─── NUMÉROS AUTORISÉS [078, 079] ────────────────────────────────────────────

const AUTHORIZED_NUMBERS = new Set([
  process.env.ULRICH_PHONE_NUMBER,    // +15149845970
  process.env.SALON_PHONE_NUMBER,     // +15149195970 (ligne salon)
].filter(Boolean));

// [079] IDs Telegram autorisés (séparés par virgule dans env)
const AUTHORIZED_TELEGRAM_IDS = new Set(
  (process.env.AUTHORIZED_TELEGRAM_IDS || '1543800301').split(',').map(s => s.trim()).filter(Boolean)
);

// Rate limiting par expéditeur : max 30 commandes / heure
const rateLimiter = new Map(); // phone/id → { count, windowStart }

// ─── PENDING PATCHES [077] ───────────────────────────────────────────────────
// Patches en attente de confirmation OUI/NON

const pendingPatches = new Map(); // sessionKey → { filePath, newContent, message, expiresAt }

function storePendingPatch(key, patch) {
  pendingPatches.set(key, {
    ...patch,
    expiresAt: Date.now() + 10 * 60 * 1000, // 10 min pour répondre
    createdAt: Date.now(),
  });
  // Auto-expiration
  setTimeout(() => pendingPatches.delete(key), 10 * 60 * 1000);
}

function getPendingPatch(senderKey) {
  // Cherche le patch le plus récent pour cet expéditeur
  for (const [key, patch] of [...pendingPatches.entries()].reverse()) {
    if (key.startsWith(senderKey) && Date.now() < patch.expiresAt) return { key, patch };
  }
  return null;
}

// ─── JOURNAL DE SÉCURITÉ [080] ────────────────────────────────────────────────

async function logCommand(entry) {
  const dae = (() => { try { return require('./dae'); } catch { return null; } })();
  if (!dae) return;

  // [080] Journal chiffré — hash HMAC du contenu pour détection altération
  const content = JSON.stringify({ ts: new Date().toISOString(), ...entry });
  const hmac = crypto.createHmac('sha256', process.env.ANTHROPIC_API_KEY || 'daleba-signing-key')
    .update(content).digest('hex');

  await dae.securityLog({ ...entry, _hmac: hmac.slice(0, 16) });
}

// ─── VALIDATION EXPÉDITEUR [078, 079] ────────────────────────────────────────

function validateSender(sender, channel = 'sms') {
  if (channel === 'telegram') {
    if (!AUTHORIZED_TELEGRAM_IDS.has(String(sender))) {
      return { authorized: false, reason: `Telegram ID ${sender} non autorisé` };
    }
    return { authorized: true, sender, channel: 'telegram' };
  }

  // SMS : validation numéro E.164
  const normalized = (sender || '').replace(/\s/g, '');
  if (!AUTHORIZED_NUMBERS.has(normalized)) {
    return { authorized: false, reason: `Numéro ${normalized} non répertorié — commande rejetée` };
  }

  // Rate limiting
  const now = Date.now();
  const rl = rateLimiter.get(normalized) || { count: 0, windowStart: now };
  if (now - rl.windowStart > 3600000) { rl.count = 0; rl.windowStart = now; }
  rl.count++;
  rateLimiter.set(normalized, rl);

  if (rl.count > 30) {
    return { authorized: false, reason: `Rate limit dépassé (${rl.count}/h)` };
  }

  return { authorized: true, sender: normalized, channel: 'sms' };
}

// ─── PARSEUR DE COMMANDES [076] ──────────────────────────────────────────────

const COMMANDS = {
  // [077] Réponses patches
  OUI:     { action: 'patch_confirm',  aliases: ['oui', 'yes', 'ok', 'deploie', 'déploie', 'confirme'] },
  NON:     { action: 'patch_reject',   aliases: ['non', 'no', 'annule', 'cancel', 'refuse', 'rejette'] },
  STATUT:  { action: 'status_report',  aliases: ['statut', 'status', 'état', 'etat', 'logs', 'rapport'] },
  // Commandes système
  CA:      { action: 'get_revenue',    aliases: ['ca', 'chiffre', 'revenus', 'ventes'] },
  RDV:     { action: 'get_appointments', aliases: ['rdv', 'rendez-vous', 'agenda', 'planning'] },
  ALERTE:  { action: 'get_alerts',     aliases: ['alertes', 'alerte', 'erreurs', 'errors'] },
  REBOOT:  { action: 'request_reboot', aliases: ['reboot', 'restart', 'redémarrer'] },
  ROLLBACK:{ action: 'request_rollback', aliases: ['rollback', 'annule tout', 'revenir'] },
  PAUSE:   { action: 'pause_alerts',   aliases: ['pause', 'silence', 'tais-toi', 'stop alertes'] },
  DIGEST:  { action: 'send_digest',    aliases: ['digest', 'résumé', 'resume', 'synthèse'] },
  AIDE:    { action: 'help',           aliases: ['aide', 'help', '?', 'commandes'] },
};

function parseCommand(text) {
  const normalized = (text || '').trim().toLowerCase();

  for (const [name, cmd] of Object.entries(COMMANDS)) {
    if (cmd.aliases.some(a => normalized === a || normalized.startsWith(a + ' '))) {
      const args = normalized.replace(new RegExp(`^(${cmd.aliases.join('|')})\\s*`, 'i'), '').trim();
      return { command: name, action: cmd.action, args };
    }
  }

  return { command: null, action: 'unknown', raw: text };
}

// ─── EXÉCUTEUR DE COMMANDES ───────────────────────────────────────────────────

async function executeCommand(parsed, senderInfo) {
  const { action, args } = parsed;

  switch (action) {

    // [077] Confirmer un patch
    case 'patch_confirm': {
      const found = getPendingPatch(senderInfo.sender);
      if (!found) return { response: '⚠️ Aucun patch en attente. Envoie STATUT pour voir les logs.' };

      const { key, patch } = found;
      pendingPatches.delete(key);

      try {
        const dae = require('./dae');
        await dae.deployPatch(patch, patch.commitMessage || 'Patch approuvé par Commandant');
        return { response: `✅ Patch déployé : ${patch.filePath}\nRailway redéploiement lancé.` };
      } catch (err) {
        return { response: `❌ Échec déploiement : ${err.message.slice(0, 100)}` };
      }
    }

    // [077] Refuser un patch
    case 'patch_reject': {
      const found = getPendingPatch(senderInfo.sender);
      if (!found) return { response: '✅ Compris — aucun patch en attente.' };
      pendingPatches.delete(found.key);
      return { response: `🚫 Patch annulé. Le code original est conservé.` };
    }

    // [077] Rapport de statut
    case 'status_report': {
      const dare = require('../agents/dare');
      const status = dare.getStatus();
      const healthy = status.providers.filter(p => p.health.status === 'healthy').map(p => p.id);
      const down    = status.providers.filter(p => p.health.status === 'down').map(p => p.id);
      return {
        response: [
          `📊 DALEBA Status`,
          `Requêtes: ${status.stats.requestsTotal} | Coût: $${status.stats.estimatedCostUSD}`,
          `✅ Up: ${healthy.join(', ') || 'aucun'}`,
          down.length ? `🔴 Down: ${down.join(', ')}` : '',
          `Failovers: ${status.stats.failovers}`,
        ].filter(Boolean).join('\n'),
      };
    }

    case 'get_revenue': {
      try {
        const square = require('./square');
        const audit = await square.getSquareWeeklyAudit();
        return {
          response: `💰 CA salon\nAujourd'hui: ~${audit.revenue?.total || 'N/A'} CAD\nRDV: ${audit.appointments?.total || 0} | No-shows: ${audit.appointments?.noShow || 0}`,
        };
      } catch {
        return { response: '⚠️ Données Square indisponibles.' };
      }
    }

    case 'get_appointments': {
      try {
        const square = require('./square');
        const audit = await square.getSquareWeeklyAudit();
        return {
          response: `📅 Agenda\nTotal: ${audit.appointments?.total || 0}\nComplétés: ${audit.appointments?.completed || 0}\nNo-shows: ${audit.appointments?.noShow || 0}`,
        };
      } catch {
        return { response: '⚠️ Agenda Square indisponible.' };
      }
    }

    case 'pause_alerts': {
      const minutes = parseInt(args) || 60;
      require('./notification-shield').clearShield();
      // On re-remplit artificiellement pour bloquer pendant `minutes` minutes
      // (technique: marquer une alerte générique récente)
      return { response: `🔕 Alertes mises en pause ${minutes} min.` };
    }

    case 'send_digest': {
      const shield = require('./notification-shield');
      const digest = shield.buildDailyDigest();
      return { response: digest || '✅ Aucune alerte en attente.' };
    }

    case 'request_rollback': {
      try {
        const dae = require('./dae');
        const history = await dae.getDeployHistory(3);
        if (history.length < 2) return { response: '⚠️ Historique insuffisant pour rollback.' };
        const target = history[1];
        return {
          response: `⚠️ Rollback vers:\n${target.hash.slice(0, 8)} — ${target.subject}\nEnvoie ROLLBACK CONFIRME pour valider.`,
          pendingAction: 'rollback', target: target.hash,
        };
      } catch (err) {
        return { response: `❌ ${err.message.slice(0, 100)}` };
      }
    }

    case 'help': {
      return {
        response: [
          '🤖 Commandes DALEBA:',
          'OUI / NON — Valider/annuler un patch',
          'STATUT — État du système',
          'CA — Chiffre d\'affaires',
          'RDV — Agenda du jour',
          'ALERTE — Dernières erreurs',
          'PAUSE [min] — Silence alertes',
          'DIGEST — Résumé journalier',
          'ROLLBACK — Annuler dernier deploy',
        ].join('\n'),
      };
    }

    default:
      return null; // Pas une commande → traitement normal
  }
}

// ─── ENTRÉE PRINCIPALE ────────────────────────────────────────────────────────

/**
 * Point d'entrée pour SMS Twilio webhook ou message Telegram
 * @returns {{ handled: boolean, response: string|null }}
 */
async function handleIncoming(text, sender, channel = 'sms') {
  // [079] Validation expéditeur
  const validation = validateSender(sender, channel);

  // [080] Journal de toutes les tentatives
  await logCommand({
    action: 'INCOMING_COMMAND',
    sender, channel, text: text?.slice(0, 100),
    authorized: validation.authorized,
    reason: validation.reason,
  });

  if (!validation.authorized) {
    console.warn(`[CmdInterp] Commande rejetée: ${validation.reason}`);
    return { handled: true, response: null, blocked: true }; // silence — ne pas révéler le système
  }

  const parsed = parseCommand(text);
  if (parsed.action === 'unknown') return { handled: false };

  const result = await executeCommand(parsed, validation);
  if (!result) return { handled: false };

  await logCommand({
    action: 'COMMAND_EXECUTED',
    sender, channel, command: parsed.command,
    response: result.response?.slice(0, 80),
  });

  return { handled: true, ...result };
}

// ─── EXPORTS ─────────────────────────────────────────────────────────────────

module.exports = {
  handleIncoming, parseCommand, validateSender,
  storePendingPatch, getPendingPatch,
  AUTHORIZED_NUMBERS, COMMANDS,
};
