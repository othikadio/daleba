'use strict';
/**
 * KADIO RH — Module 8 : Calcul automatique de l'employé du mois
 * Cahier des charges Kadio Coiffure & Esthétique — Section 10
 *
 * "Le dernier jour du mois à 23h59, le système calcule les scores finaux.
 * L'employé avec le score le plus élevé est sélectionné. Notification au
 * propriétaire pour confirmation." — la récompense elle-même n'est JAMAIS
 * créée automatiquement : seule la proposition l'est. La confirmation reste
 * un geste volontaire du propriétaire via POST /api/rh/employe-du-mois/confirmer
 * (déjà existant, Module 9), qui déclenche alors l'annonce à l'équipe.
 */

const LOG = '[RH-EMPLOYE-MOIS]';

let pool = null, DEMO_MODE = true;
try { const db = require('../memory/db'); pool = db.pool; DEMO_MODE = db.DEMO_MODE; } catch (e) {}

const { alertOwner } = require('./rh-sanctions-core');

let computeScoreMensuel = async () => ({ total: 0 });
try { computeScoreMensuel = require('./rh-employe-routes').computeScoreMensuel; } catch (e) {}

async function initTables() {
  if (!pool) return;
  try {
    await pool.query(`CREATE TABLE IF NOT EXISTS kadio_rh_verif_employe_mois (date_constat DATE PRIMARY KEY);`);
    console.log(`${LOG} Table OK`);
  } catch (e) { console.warn(`${LOG} initTables: ${e.message}`); }
}
const dbReady = initTables();

function estDernierJourDuMois(d) {
  const demain = new Date(d); demain.setDate(demain.getDate() + 1);
  return demain.getMonth() !== d.getMonth();
}

async function proposerEmployeDuMois() {
  if (!pool || DEMO_MODE) return;
  try {
    const now = new Date();
    if (!estDernierJourDuMois(now) || now.getHours() < 23) return; // proche de 23h59, dernier jour du mois

    const already = await pool.query(`SELECT 1 FROM kadio_rh_verif_employe_mois WHERE date_constat=CURRENT_DATE`);
    if (already.rows.length) return;
    await pool.query(`INSERT INTO kadio_rh_verif_employe_mois (date_constat) VALUES (CURRENT_DATE) ON CONFLICT DO NOTHING`);

    const employesRes = await pool.query(`SELECT id, prenom FROM kadio_rh_employes WHERE actif=TRUE`);
    if (!employesRes.rows.length) return;

    const classement = [];
    for (const e of employesRes.rows) {
      const score = await computeScoreMensuel(e.id);
      classement.push({ employeId: e.id, prenom: e.prenom, score: score.total });
    }
    classement.sort((a, b) => b.score - a.score);
    const gagnant = classement[0];
    if (!gagnant || gagnant.score <= 0) return;

    await pool.query(`INSERT INTO kadio_rh_alertes (niveau, message, employe_id, type) VALUES ('info',$1,$2,'proposition_employe_du_mois')`,
      [`🏆 Employé du mois proposé : ${gagnant.prenom} (score ${gagnant.score}/100). Confirmez dans le tableau de bord (onglet Employé du mois).`, gagnant.employeId]);
    await alertOwner(`🏆 Employé du mois proposé pour ce mois-ci : ${gagnant.prenom} (score ${gagnant.score}/100). Confirmez dans le tableau de bord.`);
  } catch (e) { console.warn(`${LOG} proposerEmployeDuMois: ${e.message}`); }
}

let cronStarted = false;
function startCron() {
  if (cronStarted || !pool) return;
  cronStarted = true;
  setInterval(proposerEmployeDuMois, 5 * 60 * 1000);
  console.log(`${LOG} Cron proposition employé du mois démarré (dernier jour du mois, scan 5 min)`);
}
startCron();

module.exports = { dbReady, proposerEmployeDuMois };
