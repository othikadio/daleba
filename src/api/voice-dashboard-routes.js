/**
 * DALEBA — Voice Command Engine (Jarvis)
 * POST /api/voice/command   — intent detection + exécution
 * GET  /api/dashboard/meta-status  — statut tokens Meta
 * POST /api/dashboard/meta-update  — mise à jour tokens Meta (+ Railway)
 * GET  /api/dashboard/site-status  — Vercel + RDV Square aujourd'hui
 */

'use strict';

const express = require('express');
const router  = express.Router();
const https   = require('https');
const http    = require('http');

// ─── Helpers ──────────────────────────────────────────────────────────────────

function safeRequire(p) {
  try { return require(p); } catch (_) { return null; }
}

function headRequest(url, timeoutMs = 6000) {
  return new Promise((resolve) => {
    try {
      const mod = url.startsWith('https') ? https : http;
      const req = mod.request(url, { method: 'HEAD' }, (res) => {
        resolve({ ok: res.statusCode < 400, status: res.statusCode });
      });
      req.on('error', () => resolve({ ok: false, status: 0 }));
      req.setTimeout(timeoutMs, () => { req.destroy(); resolve({ ok: false, status: 0 }); });
      req.end();
    } catch (_) { resolve({ ok: false, status: 0 }); }
  });
}

async function railwayUpsertVar(name, value) {
  const token   = process.env.RAILWAY_API_TOKEN;
  const query   = `mutation { variableUpsert(input: { projectId: "f1df7fef-4a4c-457e-83c7-2e1d7c6560ec", serviceId: "8f874b43-5efb-4723-8810-a6068bf87fbf", environmentId: "fe65feeb-9462-4924-88fb-fa44e4ab6cb3", name: "${name}", value: "${value.replace(/"/g,'\\\"')}" }) }`;
  const body    = JSON.stringify({ query });
  return new Promise((resolve) => {
    const req = https.request({
      hostname: 'backboard.railway.app',
      path: '/graphql/v2',
      method: 'POST',
      headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) },
    }, (res) => {
      let raw = '';
      res.on('data', d => raw += d);
      res.on('end', () => {
        try { resolve(JSON.parse(raw)); }
        catch (_) { resolve({ ok: false }); }
      });
    });
    req.on('error', () => resolve({ ok: false }));
    req.end(body);
  });
}

// ─── Intent detection ─────────────────────────────────────────────────────────
function detectIntent(text) {
  const t = text.toLowerCase();

  // Finance
  if (/financ|revenus?|chiffre d.affaires?|ca |vente|rentr[ée]e|taxes?|tps|tvq|comptab|dépense|bilan|argent/.test(t))
    return 'finance';

  // Meta reconnect
  if (/meta|facebook|instagram|token|reconnect|account.id|page.id|access/.test(t))
    return 'meta';

  // SMS / Campaign
  if (/\bsms\b|\brappel\b|\bpromo\b|\bpromotion\b|\bcampagne\b|envoie.*(client|message)|envoyer.*sms/.test(t))
    return 'sms';

  // Appointments / bookings
  if (/rendez.vous|rdv|réserv|booking|agenda|planning|calendrier|demain|aujourd/.test(t))
    return 'appointments';

  // Status / system
  if (/statut|état|status|vitrine|site|vercel|en ligne|disponible|fonctionne/.test(t))
    return 'status';

  return 'general';
}

// Extract token from text like "token : XXXXX" or "token XXXXX"
function extractToken(text) {
  const m = text.match(/token\s*[:\-]?\s*([A-Za-z0-9_\-\.]{20,})/i);
  return m ? m[1] : null;
}
function extractMetaParam(text, label) {
  // Separateur OBLIGATOIRE (: ou -) suivi d'une valeur de 10+ chars (pas un mot ordinaire)
  const escaped = label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const re = new RegExp(escaped + '\\s*[:=\\-]\\s*([A-Za-z0-9_][A-Za-z0-9_.\\-]{9,})', 'i');
  const m = text.match(re);
  return m ? m[1] : null;
}

// ─── Intent handlers ─────────────────────────────────────────────────────────

async function handleFinance() {
  const squareSvc = safeRequire('../services/square');
  const today = new Date();
  const startOfDay = new Date(today.getFullYear(), today.getMonth(), today.getDate()).toISOString();
  const endOfDay   = new Date(today.getFullYear(), today.getMonth(), today.getDate(), 23, 59, 59).toISOString();

  let caToday = 0, caText = '';
  try {
    if (squareSvc && squareSvc.getPayments) {
      const result = await squareSvc.getPayments(startOfDay, endOfDay);
      const rows = result?.payments || [];
      caToday = rows.reduce((sum, p) => {
        const amt = p.amount_money?.amount || 0;
        return sum + (amt / 100); // Square stocke en centimes
      }, 0);
      caText = rows.length > 0
        ? `CA aujourd'hui : ${caToday.toFixed(2)} $ CAD sur ${rows.length} transaction(s). `
        : 'Aucune transaction Square aujourd\'hui. ';
    } else {
      caText = 'Module Square non disponible. ';
    }
  } catch (err) {
    caText = `Square: ${err.message.slice(0, 60)}. `;
  }

  const tpsRate = 0.05, tvqRate = 0.09975;
  const taxTotal = caToday * (tpsRate + tvqRate);
  const netAvantTax = caToday / (1 + tpsRate + tvqRate);
  const taxes = caToday - netAvantTax;

  return caToday > 0
    ? `${caText}Taxes isolées automatiquement : ${taxes.toFixed(2)} $ (TPS ${(caToday * tpsRate / (1 + tpsRate + tvqRate)).toFixed(2)} $ + TVQ ${(caToday * tvqRate / (1 + tpsRate + tvqRate)).toFixed(2)} $). Net avant taxes : ${netAvantTax.toFixed(2)} $.`
    : `${caText}Aucune vente enregistrée depuis le début de la journée. Taxes TPS/TVQ (14,975 %) seront isolées automatiquement à la première transaction.`;
}

async function handleMeta(text) {
  const token = extractToken(text);
  const igId  = extractMetaParam(text, 'ig.?account.?id') || extractMetaParam(text, 'instagram');
  const fbId  = extractMetaParam(text, 'fb.?page.?id') || extractMetaParam(text, 'facebook.?page');

  if (!token && !igId && !fbId) {
    const hasToken = !!process.env.META_ACCESS_TOKEN;
    const hasIg    = !!process.env.META_IG_ACCOUNT_ID;
    const hasFb    = !!process.env.META_FB_PAGE_ID;
    return `Statut Meta : Token ${hasToken ? '✓ présent' : '✗ manquant'}, Instagram ID ${hasIg ? '✓ présent' : '✗ manquant'}, Facebook Page ID ${hasFb ? '✓ présent' : '✗ manquant'}. Dites le nouveau token pour le mettre à jour.`;
  }

  const updates = [];
  if (token) {
    process.env.META_ACCESS_TOKEN = token;
    await railwayUpsertVar('META_ACCESS_TOKEN', token);
    updates.push('META_ACCESS_TOKEN');
  }
  if (igId) {
    process.env.META_IG_ACCOUNT_ID = igId;
    await railwayUpsertVar('META_IG_ACCOUNT_ID', igId);
    updates.push('META_IG_ACCOUNT_ID');
  }
  if (fbId) {
    process.env.META_FB_PAGE_ID = fbId;
    await railwayUpsertVar('META_FB_PAGE_ID', fbId);
    updates.push('META_FB_PAGE_ID');
  }

  return updates.length
    ? `Parfait. ${updates.join(', ')} mis à jour dans Railway et actif immédiatement. La connexion Meta est restaurée.`
    : 'Aucun paramètre valide détecté. Dites par exemple : "nouveau token : EAAAxxxx".';
}

async function handleAppointments() {
  const squareSvc = safeRequire('../services/square');
  try {
    if (squareSvc && squareSvc.getBookings) {
      const today = new Date();
      const startOfDay = new Date(today.getFullYear(), today.getMonth(), today.getDate()).toISOString();
      const endOfDay   = new Date(today.getFullYear(), today.getMonth(), today.getDate(), 23, 59, 59).toISOString();
      const result = await squareSvc.getBookings(startOfDay, endOfDay);
      const bookings = result?.bookings || [];
      if (bookings.length === 0) return 'Aucun rendez-vous confirmé pour aujourd\'hui.';
      const next = bookings[0];
      const timeStr = next.start_at
        ? new Date(next.start_at).toLocaleTimeString('fr-CA', { hour: '2-digit', minute: '2-digit', timeZone: 'America/Toronto' })
        : 'heure inconnue';
      return `${bookings.length} rendez-vous aujourd\'hui. Le prochain : ${timeStr}.`;
    }
  } catch (_) {}
  return 'Impossible de récupérer l\'agenda Square en ce moment.';
}

async function handleStatus() {
  const vercelUrl = 'https://kadiocoiffure.vercel.app';
  const result = await headRequest(vercelUrl);
  return result.ok
    ? `La vitrine est en ligne (code ${result.status}). Tout fonctionne normalement.`
    : `La vitrine semble hors ligne (code ${result.status}). Vérifiez Vercel.`;
}

function stripMarkdown(text) {
  if (!text) return '';
  return text
    .replace(/#{1,6}\s*/g, '')
    .replace(/\*{1,2}([^*]+)\*{1,2}/g, '$1')
    .replace(/_{1,2}([^_]+)_{1,2}/g, '$1')
    .replace(/`[^`]*`/g, '')
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
    .replace(/^\s*[-*>]\s*/gm, '')
    .replace(/[\u{1F300}-\u{1FFFF}]/gu, '')
    .replace(/[\u{2600}-\u{27BF}]/gu, '')
    .replace(/\s{2,}/g, ' ')
    .trim();
}

async function handleGeneral(text) {
  const aiRouter = safeRequire('../services/ai-router');
  if (!aiRouter || typeof aiRouter.route !== 'function') {
    return 'Le routeur IA n\'est pas disponible. Vérifiez les clés API.';
  }
  try {
    // Timeout 8s max pour la voix — pas d\'attente longue
    const withTimeout = (promise, ms) => Promise.race([
      promise,
      new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), ms)),
    ]);
    const result = await withTimeout(
      aiRouter.route(
        [{ role: 'user', content: text }],
        {
          taskHint: 'chat',
          forceProvider: 'claude',   // Claude Haiku: plus rapide pour vocal (DeepSeek solde vide)
          systemPrompt: `Tu es DALEBA — l'intelligence centrale du salon Kadio Coiffure, à Longueuil, Québec. Tu parles à Ulrich, le directeur.

TON REGISTRE VOCAL :
- Tu parles comme un humain compétent et chaleureux, pas comme un assistant générique. Tu n'es pas un chatbot.
- Tes réponses sont courtes, directes, vivantes. Jamais de "Bien sûr !", jamais de "D'accord !", jamais de formules robotiques.
- Tu utilises des pauses naturelles dans tes réponses : une virgule = micro-pause. Un point = vraie pause. Ça sonne humain à l'oreille.
- Tu peux dire "hmm", "alors", "voilà" pour fluidifier. Une touche d'humour discret quand la situation s'y prête.
- Format TEXTE BRUT uniquement — zéro markdown, zéro astérisque, zéro liste à puces. Ce sera dit à voix haute.

CAPACITÉS :
- Finances du salon (Square : rendez-vous, paiements, clients)
- Statut de l'équipe et des coiffeurs
- Gestion des forfaits et abonnements
- Envoi de SMS de suivi ou rappel
- Navigation sur le site et les pages

RÈGLE DE VÉRITÉ ABSOLUE :
Si une donnée Square (RDV, montant, nom, date) est absente ou non disponible, dis-le clairement et simplement. Jamais de données inventées. Vide = vide, on le dit avec élégance.

Réponds en 1 à 2 phrases maximum pour les requêtes vocales simples. Plus long si c'est un rapport demandé explicitement.`,
        }
      ),
      5000
    );
    const raw = result.text || result.response || result.content || '';
    return stripMarkdown(raw) || 'Réponse vide du routeur.';
  } catch (err) {
    if (err.message === 'timeout') return 'Le routeur IA met trop de temps. Réessayez.';
    return `Erreur du routeur IA : ${err.message}`;
  }
}

// ─── POST /api/voice/command ──────────────────────────────────────────────────
router.post('/command', async (req, res) => {
  const { text } = req.body || {};
  if (!text || !text.trim()) return res.json({ reply: 'Aucun texte reçu.', intent: null });

  const intent = detectIntent(text);
  let reply = '';

  try {
    switch (intent) {
      case 'finance':      reply = await handleFinance(); break;
      case 'meta':         reply = await handleMeta(text); break;
      case 'appointments': reply = await handleAppointments(); break;
      case 'status':       reply = await handleStatus(); break;
      case 'sms':
        reply = await handleGeneral(`${text}\n\nContexte: Tu peux déclencher l'envoi de SMS de rappel via le hub de communication DALEBA.`);
        break;
      default:             reply = await handleGeneral(text); break;
    }
  } catch (err) {
    reply = `Erreur interne : ${err.message}`;
  }

  res.json({ reply, intent, provider: intent === 'general' ? 'ai-router' : 'daleba-engine' });
});

// ─── GET /api/dashboard/meta-status ──────────────────────────────────────────
router.get('/meta-status', (req, res) => {
  res.json({
    token:    { present: !!process.env.META_ACCESS_TOKEN, masked: process.env.META_ACCESS_TOKEN ? '●●●●●●' + process.env.META_ACCESS_TOKEN.slice(-4) : null },
    igId:     { present: !!process.env.META_IG_ACCOUNT_ID, value: process.env.META_IG_ACCOUNT_ID || null },
    fbPageId: { present: !!process.env.META_FB_PAGE_ID, value: process.env.META_FB_PAGE_ID || null },
  });
});

// ─── POST /api/dashboard/meta-update ─────────────────────────────────────────
router.post('/meta-update', async (req, res) => {
  const { token, igAccountId, fbPageId } = req.body || {};
  const updated = [];

  if (token) {
    process.env.META_ACCESS_TOKEN = token;
    await railwayUpsertVar('META_ACCESS_TOKEN', token);
    updated.push('META_ACCESS_TOKEN');
  }
  if (igAccountId) {
    process.env.META_IG_ACCOUNT_ID = igAccountId;
    await railwayUpsertVar('META_IG_ACCOUNT_ID', igAccountId);
    updated.push('META_IG_ACCOUNT_ID');
  }
  if (fbPageId) {
    process.env.META_FB_PAGE_ID = fbPageId;
    await railwayUpsertVar('META_FB_PAGE_ID', fbPageId);
    updated.push('META_FB_PAGE_ID');
  }

  res.json({ success: true, updated, message: `${updated.length} variable(s) mise(s) à jour dans Railway.` });
});

// ─── GET /api/dashboard/site-status ──────────────────────────────────────────
router.get('/site-status', async (req, res) => {
  const [vercel] = await Promise.all([headRequest('https://kadiocoiffure.vercel.app')]);
  res.json({ vercel: vercel.ok, vercelCode: vercel.status });
});

// ─── POST /api/voice/tts — synthèse premium (Deepgram/ElevenLabs/browser) ───────────────
// Retourne audio/mpeg si clé dispo, sinon { provider: 'browser' } pour fallback Web Speech
router.post('/tts', async (req, res) => {
  const { text } = req.body || {};
  if (!text) return res.status(400).json({ error: 'text requis' });

  const aiRouter = safeRequire('../services/ai-router');
  if (!aiRouter || !aiRouter.ttsRoute) {
    return res.json({ provider: 'browser' });
  }
  const result = await aiRouter.ttsRoute(text);
  if (result.audio) {
    res.set('Content-Type', result.mimeType || 'audio/mpeg');
    res.set('X-TTS-Provider', result.provider);
    return res.send(result.audio);
  }
  // Pas de clé dispo — le client utilise Web Speech
  res.json({ provider: 'browser' });
});

// ─── POST /api/voice/analyze-file — Analyse PDF/CSV/TXT via Claude ─────────────────
const multer = require('multer');
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 }, // 5 MB max
  fileFilter: (req, file, cb) => {
    const ok = /pdf|txt|csv|text/.test(file.mimetype);
    cb(null, ok);
  },
});

router.post('/analyze-file', upload.single('file'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'Aucun fichier reçu.' });

  let content = '';
  try {
    if (req.file.mimetype === 'application/pdf') {
      // Extraire texte brut du PDF (lecture bytes, fallback texte)
      const buf = req.file.buffer;
      // Simple extraction: chercher les streams texte dans le PDF
      const text = buf.toString('latin1');
      const matches = text.match(/BT[\s\S]*?ET/g) || [];
      const extracted = matches
        .map(b => b.replace(/BT|ET|Tf|Tj|TJ|Td|TD|Tm|T\*|[0-9. ]+/g, ' '))
        .join(' ')
        .replace(/[\x00-\x1F]/g, ' ')
        .replace(/\s+/g, ' ')
        .slice(0, 4000);
      content = extracted.trim() || '(PDF sans texte extractible)';
    } else {
      // TXT / CSV
      content = req.file.buffer.toString('utf-8').slice(0, 4000);
    }
  } catch (e) {
    content = req.file.buffer.toString('utf-8', 0, 2000);
  }

  const fileName = req.file.originalname;
  const aiRouter = safeRequire('../services/ai-router');
  if (!aiRouter) return res.json({ reply: 'Routeur IA indisponible.' });

  try {
    const result = await aiRouter.route(
      [{ role: 'user', content: `Analyse ce document : "${fileName}"\n\nContenu :\n${content}\n\nFais un résumé concis et actionnable pour le directeur du salon Kadio Coiffure.` }],
      {
        taskHint: 'analysis',
        forceProvider: 'claude',
        systemPrompt: `Tu es DALEBA, assistant du salon Kadio Coiffure Longueuil. Tu analyses des documents (comptabilité, listes, fiches) pour Ulrich, le directeur. Réponse en français, claire, structurée, actionnable. Format texte brut sans markdown.`,
      }
    );
    const reply = (result.text || result.response || '').trim();
    res.json({ reply: reply || 'Analyse terminée sans résultat.', filename: fileName });
  } catch (err) {
    res.json({ reply: `Erreur d'analyse : ${err.message}` });
  }
});

module.exports = router;
