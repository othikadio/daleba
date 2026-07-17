'use strict';
/**
 * KADIO — Programme de parrainage cash (clients + employés)
 * Cahier des charges Kadio Network — clarifications de fin de document :
 * "machine à parrainage avec Code QR unique et code à chiffres, barème de
 * gains progressifs en argent virtuel (10$ à 100$ pour la coiffure, 100$ à
 * 200$ pour les formations) et gestion des retraits de cash en main propre
 * au salon" + "alignement du staff sur le même barème... prime de 15$ par
 * abonnement mensuel vendu."
 *
 * NOTE — barème non chiffré précisément dans le document (contrairement au
 * barème de déplacement du cahier Kadio Network, donné poste par poste) :
 * seuls le minimum, le maximum et le fait que ce soit "progressif" sont
 * spécifiés. Interprétation retenue ici, ajustable via variables d'env :
 * le montant augmente d'un palier fixe à chaque conversion réussie du même
 * parrain, plafonné au maximum. À corriger si un barème exact existe.
 *
 * Un "parrain" peut être un client (kadio_gestion_clients) ou un employé
 * (kadio_rh_employes) — même mécanique, même table de codes.
 */

const express = require('express');
const { normalizePhone } = require('../services/phone');
const router  = express.Router();
const crypto  = require('crypto');
const QRCode  = require('qrcode');
const { requireAuth, requireRole, ROLES } = require('../middleware/auth');

const LOG = '[PARRAINAGE]';
const APP_URL = process.env.APP_URL || 'https://daleba.vercel.app';

const BAREME = {
  coiffure:  { min: parseFloat(process.env.PARRAINAGE_COIFFURE_MIN)  || 10,  max: parseFloat(process.env.PARRAINAGE_COIFFURE_MAX)  || 100, palier: parseFloat(process.env.PARRAINAGE_COIFFURE_PALIER)  || 10 },
  formation: { min: parseFloat(process.env.PARRAINAGE_FORMATION_MIN) || 100, max: parseFloat(process.env.PARRAINAGE_FORMATION_MAX) || 200, palier: parseFloat(process.env.PARRAINAGE_FORMATION_PALIER) || 20 },
};
const PRIME_ABONNEMENT = parseFloat(process.env.PARRAINAGE_PRIME_ABONNEMENT) || 15;

let pool = null, DEMO_MODE = true;
try { const db = require('../memory/db'); pool = db.pool; DEMO_MODE = db.DEMO_MODE; } catch (e) {}

let sendSMS = null;
try { sendSMS = require('../services/twilio').sendSMS; } catch (e) {}
async function sms(to, body) {
  if (!to) return;
  if (sendSMS) { try { await sendSMS(to, body); } catch (e) { console.error(`${LOG} SMS échec: ${e.message}`); } }
  else console.log(`${LOG} [SMS-DEMO] → ${to}: ${body}`);
}

let gestionDbReady = Promise.resolve(), pointageDbReady = Promise.resolve();
try { gestionDbReady = require('./gestion-routes').dbReady || Promise.resolve(); } catch (e) {}
try { pointageDbReady = require('./pointage-routes').dbReady || Promise.resolve(); } catch (e) {}


// ── Init tables ───────────────────────────────────────────────────────────
async function initTables() {
  if (!pool) return;
  // kadio_gestion_clients et kadio_rh_employes doivent exister avant les FK ci-dessous.
  await Promise.all([gestionDbReady.catch(() => {}), pointageDbReady.catch(() => {})]);
  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS kadio_parrainage_codes (
        id                 SERIAL PRIMARY KEY,
        proprietaire_type  VARCHAR(10) NOT NULL CHECK (proprietaire_type IN ('client','employe')),
        proprietaire_id    INT NOT NULL,
        code               VARCHAR(20) UNIQUE NOT NULL,
        created_at         TIMESTAMP DEFAULT NOW(),
        UNIQUE (proprietaire_type, proprietaire_id)
      );
      CREATE TABLE IF NOT EXISTS kadio_parrainage_referrals (
        id                SERIAL PRIMARY KEY,
        code_id           INT REFERENCES kadio_parrainage_codes(id) ON DELETE CASCADE,
        filleul_nom       VARCHAR(150),
        filleul_telephone VARCHAR(20),
        type              VARCHAR(20) NOT NULL CHECK (type IN ('coiffure','formation')),
        statut            VARCHAR(20) DEFAULT 'en_attente',
        montant_bonus     NUMERIC(8,2),
        created_at        TIMESTAMP DEFAULT NOW(),
        converti_at       TIMESTAMP,
        UNIQUE (code_id, filleul_telephone)
      );
      CREATE TABLE IF NOT EXISTS kadio_parrainage_retraits (
        id                 SERIAL PRIMARY KEY,
        proprietaire_type  VARCHAR(10) NOT NULL,
        proprietaire_id    INT NOT NULL,
        montant            NUMERIC(8,2) NOT NULL,
        statut             VARCHAR(20) DEFAULT 'demande',
        created_at         TIMESTAMP DEFAULT NOW(),
        paye_at            TIMESTAMP
      );
      CREATE TABLE IF NOT EXISTS kadio_parrainage_primes_employe (
        id          SERIAL PRIMARY KEY,
        employe_id  INT REFERENCES kadio_rh_employes(id) ON DELETE CASCADE,
        client_nom  VARCHAR(150),
        montant     NUMERIC(8,2) DEFAULT ${PRIME_ABONNEMENT},
        created_at  TIMESTAMP DEFAULT NOW()
      );
    `);
    console.log(`${LOG} Tables OK`);
  } catch (e) { console.warn(`${LOG} initTables: ${e.message}`); }
}
const dbReady = initTables();

// ── Code + QR ────────────────────────────────────────────────────────────
async function getOrCreateCode(proprietaireType, proprietaireId, nomPourCode) {
  const existing = await pool.query(`SELECT * FROM kadio_parrainage_codes WHERE proprietaire_type=$1 AND proprietaire_id=$2`,
    [proprietaireType, proprietaireId]);
  if (existing.rows[0]) return existing.rows[0];

  const prefix = (nomPourCode || 'KADIO').split(' ')[0].toUpperCase().slice(0, 5).replace(/[^A-Z]/g, '') || 'KADIO';
  let code, tries = 0, dup;
  do {
    const suffix = crypto.randomInt(1000, 9999);
    code = `${prefix}-${suffix}`;
    tries++;
    dup = await pool.query(`SELECT 1 FROM kadio_parrainage_codes WHERE code=$1`, [code]);
  } while (dup.rows.length && tries < 30);

  const r = await pool.query(`
    INSERT INTO kadio_parrainage_codes (proprietaire_type, proprietaire_id, code) VALUES ($1,$2,$3) RETURNING *
  `, [proprietaireType, proprietaireId, code]);
  return r.rows[0];
}

async function buildCodePayload(row) {
  const shareUrl = `${APP_URL}/parrainage?code=${row.code}`;
  const qrDataUrl = await QRCode.toDataURL(shareUrl).catch(() => null);
  return { code: row.code, shareUrl, qrDataUrl };
}

// ── Solde disponible = bonus convertis + primes employé - retraits payés ──
async function calculerSolde(proprietaireType, proprietaireId) {
  const codeRes = await pool.query(`SELECT id FROM kadio_parrainage_codes WHERE proprietaire_type=$1 AND proprietaire_id=$2`,
    [proprietaireType, proprietaireId]);
  const codeId = codeRes.rows[0]?.id;

  const bonusRes = codeId
    ? await pool.query(`SELECT COALESCE(SUM(montant_bonus),0) AS total FROM kadio_parrainage_referrals WHERE code_id=$1 AND statut='converti'`, [codeId])
    : { rows: [{ total: 0 }] };

  let primesRes = { rows: [{ total: 0 }] };
  if (proprietaireType === 'employe') {
    primesRes = await pool.query(`SELECT COALESCE(SUM(montant),0) AS total FROM kadio_parrainage_primes_employe WHERE employe_id=$1`, [proprietaireId]);
  }

  // Les demandes en attente réservent le montant — sinon deux demandes
  // simultanées sur le même solde seraient toutes deux payables (double dépense).
  const retraitsRes = await pool.query(`
    SELECT
      COALESCE(SUM(montant) FILTER (WHERE statut='paye'), 0)    AS paye,
      COALESCE(SUM(montant) FILTER (WHERE statut='demande'), 0) AS en_attente
    FROM kadio_parrainage_retraits
    WHERE proprietaire_type=$1 AND proprietaire_id=$2
  `, [proprietaireType, proprietaireId]);

  const gagne = parseFloat(bonusRes.rows[0].total) + parseFloat(primesRes.rows[0].total);
  const paye = parseFloat(retraitsRes.rows[0].paye);
  const enAttente = parseFloat(retraitsRes.rows[0].en_attente);
  return { gagne, paye, enAttente, disponible: Math.round((gagne - paye - enAttente) * 100) / 100 };
}

// ═══════════════════════ ADMIN ═════════════════════════════════════════════
const adminRouter = express.Router();
adminRouter.use(requireAuth, requireRole(ROLES.BUSINESS_ADMIN));

adminRouter.get('/referrals', async (req, res) => {
  if (!pool || DEMO_MODE) return res.json({ referrals: [], demo: true });
  try {
    const r = await pool.query(`
      SELECT r.*, c.code, c.proprietaire_type, c.proprietaire_id FROM kadio_parrainage_referrals r
      JOIN kadio_parrainage_codes c ON c.id = r.code_id ORDER BY r.created_at DESC LIMIT 200
    `);
    res.json({ referrals: r.rows });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Convertit un parrainage en attente (le filleul a complété sa 1re prestation/formation)
adminRouter.post('/referrals/:id/convertir', async (req, res) => {
  if (!pool || DEMO_MODE) return res.json({ success: true, demo: true });
  try {
    const refRes = await pool.query(`SELECT * FROM kadio_parrainage_referrals WHERE id=$1`, [req.params.id]);
    const referral = refRes.rows[0];
    if (!referral) return res.status(404).json({ error: 'Parrainage introuvable' });
    if (referral.statut === 'converti') return res.status(409).json({ error: 'Déjà converti' });

    const bareme = BAREME[referral.type];
    const nConversionsRes = await pool.query(`
      SELECT COUNT(*) FROM kadio_parrainage_referrals WHERE code_id=$1 AND type=$2 AND statut='converti'
    `, [referral.code_id, referral.type]);
    const n = parseInt(nConversionsRes.rows[0].count, 10);
    const montant = Math.min(bareme.max, bareme.min + n * bareme.palier);

    await pool.query(`
      UPDATE kadio_parrainage_referrals SET statut='converti', montant_bonus=$1, converti_at=NOW() WHERE id=$2
    `, [montant, req.params.id]);

    const codeRes = await pool.query(`SELECT * FROM kadio_parrainage_codes WHERE id=$1`, [referral.code_id]);
    const codeRow = codeRes.rows[0];
    let phone = null, nom = null;
    if (codeRow.proprietaire_type === 'client') {
      const c = await pool.query(`SELECT nom, telephone FROM kadio_gestion_clients WHERE id=$1`, [codeRow.proprietaire_id]);
      phone = c.rows[0]?.telephone; nom = c.rows[0]?.nom;
    } else {
      const e = await pool.query(`SELECT prenom, telephone FROM kadio_rh_employes WHERE id=$1`, [codeRow.proprietaire_id]);
      phone = e.rows[0]?.telephone; nom = e.rows[0]?.prenom;
    }
    await sms(phone, `🎉 Bravo ${nom || ''} ! Votre filleul ${referral.filleul_nom || ''} a été confirmé — vous gagnez ${montant}$ ! Demandez votre retrait en salon quand vous le souhaitez.`);

    res.json({ success: true, montant });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Retrait initié par l'admin (ex: demande téléphonique) — sans risque IDOR car admin-gated
adminRouter.post('/retraits', async (req, res) => {
  const { proprietaireType, proprietaireId, montant } = req.body || {};
  if (!['client', 'employe'].includes(proprietaireType) || !proprietaireId || !montant || montant <= 0) {
    return res.status(400).json({ error: 'proprietaireType, proprietaireId et montant (>0) requis' });
  }
  if (!pool || DEMO_MODE) return res.json({ success: true, demo: true });
  try {
    const solde = await calculerSolde(proprietaireType, proprietaireId);
    if (montant > solde.disponible) return res.status(400).json({ error: `Solde insuffisant (disponible: ${solde.disponible}$)` });
    const r = await pool.query(`
      INSERT INTO kadio_parrainage_retraits (proprietaire_type, proprietaire_id, montant) VALUES ($1,$2,$3) RETURNING *
    `, [proprietaireType, proprietaireId, montant]);
    res.status(201).json({ success: true, retrait: r.rows[0] });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

adminRouter.get('/retraits', async (req, res) => {
  if (!pool || DEMO_MODE) return res.json({ retraits: [], demo: true });
  try {
    const { statut } = req.query;
    let q = `SELECT * FROM kadio_parrainage_retraits`;
    const params = [];
    if (statut) { q += ` WHERE statut=$1`; params.push(statut); }
    q += ` ORDER BY created_at DESC LIMIT 200`;
    const r = await pool.query(q, params);
    res.json({ retraits: r.rows });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Marque un retrait comme payé en main propre au salon
adminRouter.post('/retraits/:id/payer', async (req, res) => {
  if (!pool || DEMO_MODE) return res.json({ success: true, demo: true });
  try {
    const r = await pool.query(`UPDATE kadio_parrainage_retraits SET statut='paye', paye_at=NOW() WHERE id=$1 AND statut='demande' RETURNING *`, [req.params.id]);
    if (!r.rows[0]) return res.status(404).json({ error: 'Retrait introuvable ou déjà payé' });
    res.json({ success: true, retrait: r.rows[0] });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Prime employé — 15$ par abonnement mensuel vendu
adminRouter.post('/prime-abonnement', async (req, res) => {
  const { employeId, clientNom } = req.body || {};
  if (!employeId) return res.status(400).json({ error: 'employeId requis' });
  if (!pool || DEMO_MODE) return res.json({ success: true, demo: true });
  try {
    const r = await pool.query(`
      INSERT INTO kadio_parrainage_primes_employe (employe_id, client_nom) VALUES ($1,$2) RETURNING *
    `, [employeId, clientNom || null]);
    res.status(201).json({ success: true, prime: r.rows[0] });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

adminRouter.get('/solde/:type/:id', async (req, res) => {
  if (!pool || DEMO_MODE) return res.json({ demo: true });
  if (!['client', 'employe'].includes(req.params.type)) return res.status(400).json({ error: 'type invalide' });
  try {
    res.json(await calculerSolde(req.params.type, parseInt(req.params.id, 10)));
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ═══════════════════════ PUBLIC (client) ════════════════════════════════════
// Même compromis de sécurité que fidelite-routes.js / noter-coiffeur.html :
// accès par numéro de téléphone, pas de compte client complet.
const publicRouter = express.Router();

publicRouter.get('/mon-code', async (req, res) => {
  const { telephone } = req.query;
  if (!telephone) return res.status(400).json({ error: 'telephone requis' });
  if (!pool || DEMO_MODE) return res.json({ demo: true });
  try {
    const c = await pool.query(`SELECT id, nom FROM kadio_gestion_clients WHERE telephone=$1`, [normalizePhone(telephone)]);
    if (!c.rows[0]) return res.status(404).json({ error: 'Aucun profil client trouvé pour ce numéro' });
    const codeRow = await getOrCreateCode('client', c.rows[0].id, c.rows[0].nom);
    const payload = await buildCodePayload(codeRow);
    const solde = await calculerSolde('client', c.rows[0].id);
    res.json({ ...payload, ...solde });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

publicRouter.post('/soumettre', async (req, res) => {
  const { code, filleulNom, filleulTelephone, type } = req.body || {};
  if (!code || !filleulNom || !['coiffure', 'formation'].includes(type)) {
    return res.status(400).json({ error: 'code, filleulNom et type (coiffure|formation) requis' });
  }
  if (!pool || DEMO_MODE) return res.json({ success: true, demo: true });
  try {
    const codeRes = await pool.query(`SELECT * FROM kadio_parrainage_codes WHERE code=$1`, [code.toUpperCase()]);
    if (!codeRes.rows[0]) return res.status(404).json({ error: 'Code de parrainage invalide' });
    const codeRow = codeRes.rows[0];

    const filleulTel = filleulTelephone ? normalizePhone(filleulTelephone) : null;
    // Anti-fraude simple : un parrain ne peut pas se parrainer lui-même (même téléphone)
    if (filleulTel && codeRow.proprietaire_type === 'client') {
      const parrain = await pool.query(`SELECT telephone FROM kadio_gestion_clients WHERE id=$1`, [codeRow.proprietaire_id]);
      if (parrain.rows[0]?.telephone === filleulTel) return res.status(400).json({ error: 'Auto-parrainage non autorisé' });
    }

    const r = await pool.query(`
      INSERT INTO kadio_parrainage_referrals (code_id, filleul_nom, filleul_telephone, type)
      VALUES ($1,$2,$3,$4) RETURNING *
    `, [codeRow.id, filleulNom, filleulTel, type]);
    res.status(201).json({ success: true, referral: r.rows[0] });
  } catch (e) {
    if (e.code === '23505') return res.status(409).json({ error: 'Ce filleul a déjà été soumis avec ce code' });
    res.status(500).json({ error: e.message });
  }
});

// Le client s'identifie par téléphone (comme /mon-code), jamais par ID brut —
// éviter qu'on puisse demander un retrait au nom de n'importe quel ID deviné.
publicRouter.post('/retrait/demander', async (req, res) => {
  const { telephone, montant } = req.body || {};
  if (!telephone || !montant || montant <= 0) return res.status(400).json({ error: 'telephone et montant (>0) requis' });
  if (!pool || DEMO_MODE) return res.json({ success: true, demo: true });
  try {
    const c = await pool.query(`SELECT id FROM kadio_gestion_clients WHERE telephone=$1`, [normalizePhone(telephone)]);
    if (!c.rows[0]) return res.status(404).json({ error: 'Aucun profil client trouvé pour ce numéro' });
    const solde = await calculerSolde('client', c.rows[0].id);
    if (montant > solde.disponible) return res.status(400).json({ error: `Solde insuffisant (disponible: ${solde.disponible}$)` });
    const r = await pool.query(`
      INSERT INTO kadio_parrainage_retraits (proprietaire_type, proprietaire_id, montant) VALUES ('client',$1,$2) RETURNING *
    `, [c.rows[0].id, montant]);
    res.status(201).json({ success: true, retrait: r.rows[0] });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

module.exports = adminRouter;
module.exports.publicRouter = publicRouter;
module.exports.dbReady = dbReady;
module.exports.getOrCreateCode = getOrCreateCode;
module.exports.calculerSolde = calculerSolde;
module.exports.BAREME = BAREME;
