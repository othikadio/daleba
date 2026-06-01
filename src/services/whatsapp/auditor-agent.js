'use strict';
/**
 * DALEBA WhatsApp Salon — Agent Auditeur (Superviseur Qualité)
 * Tourne en arrière-plan, analyse les conversations, ajuste le ton
 */
const { pool } = require('../../memory/db');
const fetch = (...args) => import('node-fetch').then(m => m.default(...args)).catch(() => global.fetch(...args));

const DEEPSEEK_KEY = process.env.DEEPSEEK_API_KEY || process.env.DEEPSEEK_KEY;

// Cache mémoire des ajustements (recharge depuis DB toutes les 2h)
let _toneGuidelines = null;
let _lastLoad = 0;

const INIT_SQL = `
  CREATE TABLE IF NOT EXISTS daleba_wa_audit_logs (
    id          SERIAL PRIMARY KEY,
    phone       TEXT,
    score       INT NOT NULL DEFAULT 0,
    tone_rating TEXT,
    issues      JSONB DEFAULT '[]',
    suggestions TEXT,
    created_at  TIMESTAMPTZ DEFAULT NOW()
  );
  CREATE TABLE IF NOT EXISTS daleba_wa_tone_guidelines (
    key         TEXT PRIMARY KEY,
    value       TEXT,
    updated_at  TIMESTAMPTZ DEFAULT NOW()
  );
`;

async function init() {
  try { await pool.query(INIT_SQL); } catch(e) { console.error('[WA-Auditor] init:', e.message); }
}
init();

// Charge les directives de ton depuis la DB
async function loadToneGuidelines() {
  if (_toneGuidelines && Date.now() - _lastLoad < 2 * 60 * 60 * 1000) return _toneGuidelines;
  try {
    const r = await pool.query('SELECT key, value FROM daleba_wa_tone_guidelines');
    _toneGuidelines = Object.fromEntries(r.rows.map(row => [row.key, row.value]));
    _lastLoad = Date.now();
    return _toneGuidelines;
  } catch(_) { return {}; }
}

// Analyse une conversation et retourne un score + suggestions
async function auditConversation(history, phone) {
  if (!DEEPSEEK_KEY || !history?.length) return null;

  const guidelines = await loadToneGuidelines();
  const guideText = Object.entries(guidelines).map(([k, v]) => `- ${k}: ${v}`).join('\n') || '(aucune directive spécifique)';

  const dialog = history.slice(-20).map(h =>
    `[${h.role === 'client' ? 'CLIENT' : 'AMARA/IA'}]: ${h.text}`
  ).join('\n');

  const prompt = `Tu es un superviseur qualité pour Kadio Coiffure. Analyse cette conversation WhatsApp et évalue :

1. Naturalité du ton (0-10) — est-ce que ça sonne humain ?
2. Chaleur/empathie (0-10)
3. Efficacité (0-10) — le client a-t-il obtenu ce qu'il voulait ?
4. Problèmes détectés (liste)
5. Suggestions d'amélioration (max 3 lignes)

Directives actuelles du salon :
${guideText}

Conversation :
${dialog}

Réponds en JSON strict : {"naturalite":N,"chaleur":N,"efficacite":N,"score_global":N,"problemes":["..."],"suggestions":"...","ton":"chaleureux|neutre|froid|robotique"}`;

  try {
    const res = await fetch('https://api.deepseek.com/v1/chat/completions', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${DEEPSEEK_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: 'deepseek-chat',
        messages: [{ role: 'user', content: prompt }],
        max_tokens: 400,
        temperature: 0.3,
        response_format: { type: 'json_object' },
      }),
    });
    const data = await res.json();
    const audit = JSON.parse(data.choices[0].message.content);

    // Sauvegarde en DB
    await pool.query(
      `INSERT INTO daleba_wa_audit_logs (phone, score, tone_rating, issues, suggestions)
       VALUES ($1, $2, $3, $4, $5)`,
      [phone, audit.score_global || 0, audit.ton || 'neutre', JSON.stringify(audit.problemes || []), audit.suggestions || '']
    );

    // Si des problèmes critiques, mettre à jour les directives
    if (audit.score_global < 6 && audit.suggestions) {
      await updateGuidelines('derniere_correction', audit.suggestions);
    }

    return audit;
  } catch(e) {
    console.error('[WA-Auditor]', e.message);
    return null;
  }
}

// Met à jour une directive de ton
async function updateGuidelines(key, value) {
  try {
    await pool.query(
      `INSERT INTO daleba_wa_tone_guidelines (key, value, updated_at)
       VALUES ($1, $2, NOW())
       ON CONFLICT (key) DO UPDATE SET value=$2, updated_at=NOW()`,
      [key, value]
    );
    _toneGuidelines = null; // invalider le cache
  } catch(e) { console.error('[WA-Auditor] updateGuidelines:', e.message); }
}

// Construit un contexte de ton dynamique pour les agents (injecté dans les prompts)
async function getToneContext() {
  const g = await loadToneGuidelines();
  if (!Object.keys(g).length) return '';
  return '\n\nDirectives de ton (Superviseur Qualité) :\n' +
    Object.entries(g).map(([k, v]) => `• ${k}: ${v}`).join('\n');
}

// Récupère les stats d'audit
async function getAuditStats(limit = 20) {
  try {
    const r = await pool.query(
      `SELECT phone, score, tone_rating, issues, suggestions, created_at
       FROM daleba_wa_audit_logs ORDER BY created_at DESC LIMIT $1`,
      [limit]
    );
    return r.rows;
  } catch(_) { return []; }
}

// Lance une analyse périodique en arrière-plan (toutes les 30 min)
let _auditorInterval = null;
function startAuditorDaemon(getRecentConversations) {
  if (_auditorInterval) return;
  _auditorInterval = setInterval(async () => {
    try {
      const conversations = await getRecentConversations(5); // 5 dernières conv
      for (const conv of conversations) {
        if (conv.history?.length >= 4) {
          await auditConversation(conv.history, conv.phone);
        }
      }
    } catch(e) { console.error('[WA-Auditor] daemon:', e.message); }
  }, 30 * 60 * 1000);
  console.log('[WA-Auditor] 🔍 Daemon démarré — audit toutes les 30 min');
}

module.exports = { auditConversation, getToneContext, getAuditStats, startAuditorDaemon, updateGuidelines };
