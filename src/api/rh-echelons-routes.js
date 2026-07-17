'use strict';
/**
 * KADIO RH — Module 2 : Échelons et probation (montée automatique)
 * Cahier des charges Kadio Coiffure & Esthétique — Section 4
 *
 * La descente d'échelon existe déjà (Module 9 : creerSanction ; Module 4 :
 * manquement collectif). Ce module ajoute la MONTÉE automatique :
 * Bronze → Argent → Or → Platine, un palier à la fois (pas de saut).
 *
 * Note sur les fenêtres de calcul, non précisées au chiffre près dans le
 * cahier des charges : la moyenne des notes clients utilisée pour valider
 * une promotion est calculée depuis la dernière sanction (ou l'embauche si
 * aucune) — c'est-à-dire sur exactement la période de "constance" exigée.
 * Sans note reçue durant cette période, l'employé n'est pas promu (on ne
 * peut pas confirmer la barre de qualité sans données).
 */

const express = require('express');
const router  = express.Router();
const { requireAuth, requireRole, ROLES } = require('../middleware/auth');

const LOG = '[RH-ECHELONS]';
const JOUR_MS = 24 * 3600 * 1000;

let pool = null, DEMO_MODE = true;
try { const db = require('../memory/db'); pool = db.pool; DEMO_MODE = db.DEMO_MODE; } catch (e) {}

// SMS propriétaire : source unique dans rh-sanctions-core (OWNER_PHONE inclus)
const { alertOwner } = require('./rh-sanctions-core');

let pointageDbReady = Promise.resolve();
try { pointageDbReady = require('./pointage-routes').dbReady || Promise.resolve(); } catch (e) {}

async function initTables() {
  if (!pool) return;
  await pointageDbReady.catch(() => {});
  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS kadio_rh_verif_promotions (
        date_constat DATE PRIMARY KEY
      );
    `);
    console.log(`${LOG} Table OK`);
  } catch (e) { console.warn(`${LOG} initTables: ${e.message}`); }
}
const dbReady = initTables();

const RECOMPENSE_PALIER = {
  argent: { montant: null, description: 'Promotion Argent — reconnaissance + badge affiché' },
  or: { montant: 20, description: 'Promotion Or' },
  platine: { montant: 50, description: 'Promotion Platine' },
};

async function verifierPromotionEmploye(emp) {
  const derniereSanctionRes = await pool.query(`SELECT MAX(created_at) AS d FROM kadio_rh_sanctions WHERE employe_id=$1`, [emp.id]);
  const depart = derniereSanctionRes.rows[0].d || emp.date_embauche;
  const semainesSansSanction = (Date.now() - new Date(depart).getTime()) / (7 * JOUR_MS);

  const notesRes = await pool.query(`
    SELECT AVG((accueil+qualite+proprete+ambiance)/4.0) AS avg, COUNT(*) AS n
    FROM kadio_rh_notations_client WHERE employe_id=$1 AND soumis_at > $2
  `, [emp.id, depart]);
  const noteAvg = parseInt(notesRes.rows[0].n, 10) > 0 ? parseFloat(notesRes.rows[0].avg) : null;
  const noteOk = noteAvg !== null && noteAvg >= 4;

  let nouvelEchelon = null;
  if (emp.echelon === 'bronze' && semainesSansSanction >= 3 && noteOk) nouvelEchelon = 'argent';
  else if (emp.echelon === 'argent' && semainesSansSanction >= 6 && noteOk) nouvelEchelon = 'or';
  else if (emp.echelon === 'or') {
    const depuisOr = emp.date_echelon_depuis || emp.date_embauche;
    const moisDepuisOr = (Date.now() - new Date(depuisOr).getTime()) / (30 * JOUR_MS);
    const aEteEmployeDuMois = await pool.query(`SELECT 1 FROM kadio_rh_recompenses WHERE employe_id=$1 AND type='employe_du_mois' LIMIT 1`, [emp.id]);
    if (moisDepuisOr >= 2 && aEteEmployeDuMois.rows.length) nouvelEchelon = 'platine';
  }

  if (nouvelEchelon) {
    await pool.query(`UPDATE kadio_rh_employes SET echelon=$1, date_echelon_depuis=NOW() WHERE id=$2`, [nouvelEchelon, emp.id]);
    const rec = RECOMPENSE_PALIER[nouvelEchelon];
    await pool.query(`INSERT INTO kadio_rh_recompenses (employe_id, type, montant, description) VALUES ($1,$2,$3,$4)`,
      [emp.id, 'promotion_' + nouvelEchelon, rec.montant, rec.description]);
    await pool.query(`INSERT INTO kadio_rh_alertes (niveau, message, employe_id, type) VALUES ('info',$1,$2,'promotion_echelon')`,
      [`Félicitations ! Vous avez atteint le niveau ${nouvelEchelon}.`, emp.id]);
    await alertOwner(`🟢 ${emp.prenom} vient d'atteindre le niveau ${nouvelEchelon}.`);
  }

  // Bonus trimestriel tant que le Platine est maintenu
  if (emp.echelon === 'platine' || nouvelEchelon === 'platine') {
    const dernierBonus = await pool.query(`
      SELECT MAX(created_at) AS d FROM kadio_rh_recompenses WHERE employe_id=$1 AND type IN ('promotion_platine','bonus_platine_trimestriel')
    `, [emp.id]);
    if (dernierBonus.rows[0].d) {
      const moisDepuisBonus = (Date.now() - new Date(dernierBonus.rows[0].d).getTime()) / (30 * JOUR_MS);
      if (moisDepuisBonus >= 3) {
        await pool.query(`INSERT INTO kadio_rh_recompenses (employe_id, type, montant, description) VALUES ($1,'bonus_platine_trimestriel',50,'Bonus trimestriel Platine')`, [emp.id]);
        await alertOwner(`💎 ${emp.prenom} maintient le Platine — bonus trimestriel de 50$ accordé.`);
      }
    }
  }
}

async function verifierPromotions() {
  if (!pool || DEMO_MODE) return;
  try {
    const employesRes = await pool.query(`SELECT * FROM kadio_rh_employes WHERE actif=TRUE`);
    for (const emp of employesRes.rows) await verifierPromotionEmploye(emp);
  } catch (e) { console.warn(`${LOG} verifierPromotions: ${e.message}`); }
}

async function checkQuotidien() {
  if (!pool || DEMO_MODE) return;
  try {
    const already = await pool.query(`SELECT 1 FROM kadio_rh_verif_promotions WHERE date_constat=CURRENT_DATE`);
    if (already.rows.length) return;
    await pool.query(`INSERT INTO kadio_rh_verif_promotions (date_constat) VALUES (CURRENT_DATE) ON CONFLICT DO NOTHING`);
    await verifierPromotions();
  } catch (e) { console.warn(`${LOG} checkQuotidien: ${e.message}`); }
}

let cronStarted = false;
function startCron() {
  if (cronStarted || !pool) return;
  cronStarted = true;
  setInterval(checkQuotidien, 5 * 60 * 1000);
  console.log(`${LOG} Cron vérification promotions démarré (1x/jour, scan 5 min)`);
}
startCron();

// ── Déclenchement manuel (admin) — utile pour tests/démonstration ─────────
router.post('/verifier-maintenant', requireAuth, requireRole(ROLES.BUSINESS_ADMIN), async (req, res) => {
  if (!pool || DEMO_MODE) return res.json({ success: true, demo: true });
  try {
    await verifierPromotions();
    res.json({ success: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

module.exports = router;
module.exports.dbReady = dbReady;
module.exports.verifierPromotions = verifierPromotions;
