'use strict';
/**
 * KADIO RH — Module 4 : Tâches ménagères par équipe
 * Cahier des charges Kadio Coiffure & Esthétique — Section 6
 *
 * Les tâches sont collectives — n'importe quel employé connecté peut cocher
 * n'importe quelle tâche. Vérification automatique 30 min avant fermeture
 * (quotidiennes) et le vendredi (hebdomadaires), avec comptage mensuel des
 * manquements collectifs : 1er = avertissement à toute l'équipe,
 * 2e = compte comme sanction individuelle pour chaque membre (réutilise le
 * moteur à 3 paliers du Module 3/9), 3e = descente d'échelon pour toute l'équipe.
 */

const express = require('express');
const router  = express.Router();
const { requireEmployeRH } = require('../middleware/auth');
const { TACHES_QUOTIDIENNES, TACHES_HEBDOMADAIRES } = require('./rh-taches-constants');

const LOG = '[RH-TACHES]';
const SALON_HEURE_FERMETURE = process.env.SALON_HEURE_FERMETURE || '18:00';

let pool = null, DEMO_MODE = true;
try { const db = require('../memory/db'); pool = db.pool; DEMO_MODE = db.DEMO_MODE; } catch (e) {}

let creerSanction = null, descendreEchelon = (e) => e, sendOwnerSMS = async () => {};
try {
  const core = require('./rh-sanctions-core');
  creerSanction = core.creerSanction;
  descendreEchelon = core.descendreEchelon || descendreEchelon;
  sendOwnerSMS = core.alertOwner;
} catch (e) {}

async function alertOwner(message, niveau = 'attention', employeId = null, type = 'tache_manquante') {
  await sendOwnerSMS(message);
  if (pool && !DEMO_MODE) {
    try { await pool.query(`INSERT INTO kadio_rh_alertes (niveau, message, employe_id, type) VALUES ($1,$2,$3,$4)`, [niveau, message, employeId, type]); }
    catch (e) { console.warn(`${LOG} alerte insert: ${e.message}`); }
  }
}

// ── Init tables ───────────────────────────────────────────────────────────
async function initTables() {
  if (!pool) return;
  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS kadio_rh_manquements (
        id                 SERIAL PRIMARY KEY,
        type               VARCHAR(20) NOT NULL,
        date_constat       DATE NOT NULL DEFAULT CURRENT_DATE,
        taches_manquantes  TEXT[],
        consequence        VARCHAR(80),
        created_at         TIMESTAMP DEFAULT NOW()
      );
      CREATE TABLE IF NOT EXISTS kadio_rh_verifications_taches (
        date_constat  DATE NOT NULL,
        type          VARCHAR(20) NOT NULL,
        PRIMARY KEY (date_constat, type)
      );
    `);
    console.log(`${LOG} Tables OK`);
  } catch (e) { console.warn(`${LOG} initTables: ${e.message}`); }
}
const dbReady = initTables();

// ── Middleware : session employé (n'importe quel employé peut cocher) ─────
const requireEmploye = requireEmployeRH;

// ── Listes + statut ──────────────────────────────────────────────────────
router.get('/aujourdhui', requireEmploye, async (req, res) => {
  if (!pool || DEMO_MODE) return res.json({ taches: TACHES_QUOTIDIENNES.map(nom => ({ nom, faite: false })), demo: true });
  try {
    const doneRes = await pool.query(`
      SELECT t.tache_nom, t.coche_at, e.prenom FROM kadio_rh_taches_log t
      JOIN kadio_rh_employes e ON e.id = t.coche_par_employe_id
      WHERE t.date_tache = CURRENT_DATE AND t.frequence = 'quotidienne'
    `);
    const doneMap = {};
    doneRes.rows.forEach(r => { doneMap[r.tache_nom] = r; });
    res.json({ taches: TACHES_QUOTIDIENNES.map(nom => ({
      nom, faite: !!doneMap[nom], par: doneMap[nom]?.prenom || null, heure: doneMap[nom]?.coche_at || null,
    })) });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.get('/semaine', requireEmploye, async (req, res) => {
  if (!pool || DEMO_MODE) return res.json({ taches: TACHES_HEBDOMADAIRES.map(nom => ({ nom, faite: false })), demo: true });
  try {
    const doneRes = await pool.query(`
      SELECT t.tache_nom, t.coche_at, e.prenom FROM kadio_rh_taches_log t
      JOIN kadio_rh_employes e ON e.id = t.coche_par_employe_id
      WHERE t.frequence = 'hebdomadaire' AND date_trunc('week', t.date_tache) = date_trunc('week', CURRENT_DATE)
    `);
    const doneMap = {};
    doneRes.rows.forEach(r => { doneMap[r.tache_nom] = r; });
    res.json({ taches: TACHES_HEBDOMADAIRES.map(nom => ({
      nom, faite: !!doneMap[nom], par: doneMap[nom]?.prenom || null, heure: doneMap[nom]?.coche_at || null,
    })) });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── Cocher comme fait ────────────────────────────────────────────────────
router.post('/cocher', requireEmploye, async (req, res) => {
  const { tacheNom, frequence } = req.body || {};
  if (!tacheNom || !['quotidienne', 'hebdomadaire'].includes(frequence)) {
    return res.status(400).json({ error: 'tacheNom et frequence (quotidienne|hebdomadaire) requis' });
  }
  const listeValide = frequence === 'quotidienne' ? TACHES_QUOTIDIENNES : TACHES_HEBDOMADAIRES;
  if (!listeValide.includes(tacheNom)) return res.status(400).json({ error: 'Tâche inconnue' });
  if (!pool || DEMO_MODE) return res.json({ success: true, demo: true });

  try {
    const dejaFait = frequence === 'quotidienne'
      ? await pool.query(`SELECT 1 FROM kadio_rh_taches_log WHERE tache_nom=$1 AND frequence='quotidienne' AND date_tache = CURRENT_DATE`, [tacheNom])
      : await pool.query(`SELECT 1 FROM kadio_rh_taches_log WHERE tache_nom=$1 AND frequence='hebdomadaire' AND date_trunc('week', date_tache) = date_trunc('week', CURRENT_DATE)`, [tacheNom]);
    if (dejaFait.rows.length) return res.status(409).json({ error: 'Cette tâche a déjà été cochée pour la période en cours' });

    const r = await pool.query(`
      INSERT INTO kadio_rh_taches_log (tache_nom, frequence, date_tache, coche_par_employe_id, coche_at)
      VALUES ($1,$2,CURRENT_DATE,$3,NOW()) RETURNING *
    `, [tacheNom, frequence, req.employeId]);
    res.status(201).json({ success: true, tache: r.rows[0] });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── Manquements collectifs : 1er=avertissement équipe, 2e=sanction pour
// chaque membre (moteur 3 paliers), 3e=descente d'échelon pour toute l'équipe.
async function appliquerManquementCollectif(type, manquantes) {
  const countRes = await pool.query(`
    SELECT COUNT(*) FROM kadio_rh_manquements
    WHERE date_trunc('month', date_constat) = date_trunc('month', CURRENT_DATE)
  `);
  const n = parseInt(countRes.rows[0].count, 10) + 1;
  const consequence = n === 1 ? 'avertissement_collectif' : n === 2 ? 'sanction_individuelle_equipe' : 'descente_echelon_equipe';

  await pool.query(`INSERT INTO kadio_rh_manquements (type, taches_manquantes, consequence) VALUES ($1,$2,$3)`,
    [type, manquantes, consequence]);

  const employesRes = await pool.query(`SELECT id, prenom, echelon FROM kadio_rh_employes WHERE actif=TRUE`);

  if (n === 1) {
    for (const e of employesRes.rows) {
      await pool.query(`INSERT INTO kadio_rh_alertes (niveau, message, employe_id, type) VALUES ('attention',$1,$2,'manquement_collectif')`,
        [`Avertissement collectif — tâches non complétées : ${manquantes.join(', ')}. 1er manquement du mois pour l'équipe.`, e.id]);
    }
    await alertOwner(`1er manquement collectif du mois — avertissement envoyé à toute l'équipe (${manquantes.join(', ')}).`, 'attention', null, 'manquement_collectif');
  } else if (n === 2 && creerSanction) {
    for (const e of employesRes.rows) {
      await creerSanction(e.id, `Manquement collectif aux tâches ménagères (2e du mois) : ${manquantes.join(', ')}`, 'manquement_collectif');
    }
  } else {
    for (const e of employesRes.rows) {
      const nouvel = descendreEchelon(e.echelon, 1);
      await pool.query(`UPDATE kadio_rh_employes SET echelon=$1, date_echelon_depuis=NOW() WHERE id=$2`, [nouvel, e.id]);
      await pool.query(`INSERT INTO kadio_rh_alertes (niveau, message, employe_id, type) VALUES ('urgent',$1,$2,'manquement_collectif')`,
        [`3e manquement collectif du mois — descente d'échelon (${e.echelon} → ${nouvel}) pour toute l'équipe.`, e.id]);
    }
    await alertOwner(`🔴 3e manquement collectif du mois — descente d'échelon appliquée à toute l'équipe (${manquantes.join(', ')}).`, 'urgent', null, 'manquement_collectif');
  }
}

async function checkTachesQuotidiennes() {
  if (!pool || DEMO_MODE) return;
  try {
    const [h, m] = SALON_HEURE_FERMETURE.split(':').map(Number);
    const fermeture = new Date(); fermeture.setHours(h, m, 0, 0);
    const seuil = new Date(fermeture.getTime() - 30 * 60000);
    if (new Date() < seuil) return;

    const already = await pool.query(`SELECT 1 FROM kadio_rh_verifications_taches WHERE date_constat=CURRENT_DATE AND type='quotidien'`);
    if (already.rows.length) return;
    await pool.query(`INSERT INTO kadio_rh_verifications_taches (date_constat, type) VALUES (CURRENT_DATE, 'quotidien') ON CONFLICT DO NOTHING`);

    const doneRes = await pool.query(`SELECT tache_nom FROM kadio_rh_taches_log WHERE frequence='quotidienne' AND date_tache=CURRENT_DATE`);
    const doneSet = new Set(doneRes.rows.map(r => r.tache_nom));
    const manquantes = TACHES_QUOTIDIENNES.filter(t => !doneSet.has(t));
    if (!manquantes.length) return;

    await alertOwner(`Tâche(s) non complétée(s) : ${manquantes.join(', ')}. Fermeture dans 30 min.`, 'attention', null, 'tache_manquante');
    await appliquerManquementCollectif('quotidien', manquantes);
  } catch (e) { console.warn(`${LOG} checkTachesQuotidiennes: ${e.message}`); }
}

async function checkTachesHebdomadaires() {
  if (!pool || DEMO_MODE) return;
  try {
    const now = new Date();
    if (now.getDay() !== 5) return; // vendredi

    const [h, m] = SALON_HEURE_FERMETURE.split(':').map(Number);
    const fermeture = new Date(); fermeture.setHours(h, m, 0, 0);
    const seuil = new Date(fermeture.getTime() - 30 * 60000);
    if (now < seuil) return;

    const already = await pool.query(`SELECT 1 FROM kadio_rh_verifications_taches WHERE date_constat=CURRENT_DATE AND type='hebdomadaire'`);
    if (already.rows.length) return;
    await pool.query(`INSERT INTO kadio_rh_verifications_taches (date_constat, type) VALUES (CURRENT_DATE, 'hebdomadaire') ON CONFLICT DO NOTHING`);

    const doneRes = await pool.query(`
      SELECT tache_nom FROM kadio_rh_taches_log
      WHERE frequence='hebdomadaire' AND date_trunc('week', date_tache) = date_trunc('week', CURRENT_DATE)
    `);
    const doneSet = new Set(doneRes.rows.map(r => r.tache_nom));
    const manquantes = TACHES_HEBDOMADAIRES.filter(t => !doneSet.has(t));
    if (!manquantes.length) return;

    await alertOwner(`Tâche(s) hebdomadaire(s) non complétée(s) : ${manquantes.join(', ')}.`, 'attention', null, 'tache_manquante');
    await appliquerManquementCollectif('hebdomadaire', manquantes);
  } catch (e) { console.warn(`${LOG} checkTachesHebdomadaires: ${e.message}`); }
}

let cronStarted = false;
function startCron() {
  if (cronStarted || !pool) return;
  cronStarted = true;
  setInterval(() => { checkTachesQuotidiennes(); checkTachesHebdomadaires(); }, 5 * 60 * 1000);
  console.log(`${LOG} Cron vérification tâches démarré (scan 5 min, fermeture=${SALON_HEURE_FERMETURE})`);
}
startCron();

module.exports = router;
module.exports.dbReady = dbReady;
module.exports.checkTachesQuotidiennes = checkTachesQuotidiennes;
module.exports.checkTachesHebdomadaires = checkTachesHebdomadaires;
