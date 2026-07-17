'use strict';
/**
 * KADIO RH — Module 3 : Déclenchement automatique des sanctions
 * Cahier des charges Kadio Coiffure & Esthétique — Section 5
 *
 * "Sanctions spécifiques aux retards" suit sa PROPRE progression basée sur
 * le nombre de retards du mois civil (remis à zéro le 1er de chaque mois),
 * distincte du compteur "lifetime" générique de rh-sanctions-core.js :
 *   1er retard du mois → 1re sanction (avertissement + descente d'échelon)
 *   2e retard du mois  → 2e sanction (1 jour sans salaire + descente d'échelon)
 *   3e retard du mois  → 2 jours sans salaire (pas de descente supplémentaire —
 *                         non précisée pour ce palier, contrairement aux 2 premiers)
 *   Récidive (3 retards) le mois suivant → séparation
 *
 * "3 mauvaises notes clients en un mois" (note ≤3) compte elle comme une
 * sanction ordinaire — donc via le moteur générique (creerSanction).
 */

const { creerSanction, descendreEchelon, alertOwner } = require('./rh-sanctions-core');

const LOG = '[RH-SANCTIONS-AUTO]';

let pool = null, DEMO_MODE = true;
try { const db = require('../memory/db'); pool = db.pool; DEMO_MODE = db.DEMO_MODE; } catch (e) {}

// ── Retards : progression mensuelle spécifique ─────────────────────────────
async function declencherSanctionRetard(employe, nRetardsMois) {
  if (!pool || DEMO_MODE) return;
  try {
    let palier = null, consequence = null, descend = false, finEmploi = false;

    if (nRetardsMois === 1) { palier = 1; consequence = 'Avertissement écrit'; descend = true; }
    else if (nRetardsMois === 2) { palier = 2; consequence = '1 journée sans salaire + avertissement écrit'; descend = true; }
    else if (nRetardsMois >= 3) {
      // Récidive : l'employé avait déjà atteint 3 retards le mois civil précédent
      const moisPrecedentRes = await pool.query(`
        SELECT COUNT(*) FROM kadio_rh_pointages
        WHERE employe_id=$1 AND type='arrivee' AND retard_minutes>0
          AND date_trunc('month', heure_reelle) = date_trunc('month', NOW() - INTERVAL '1 month')
      `, [employe.id]);
      const nMoisPrecedent = parseInt(moisPrecedentRes.rows[0].count, 10);
      // Ne redéclenche pas à chaque retard au-delà de 3 le même mois — seulement au moment où le seuil est franchi.
      if (nRetardsMois > 3) return;
      if (nMoisPrecedent >= 3) { palier = 'recidive'; consequence = "Fin d'emploi — récidive du 3e retard mensuel"; finEmploi = true; }
      else { palier = 3; consequence = '2 jours sans salaire'; }
    } else return;

    const echelonAvant = employe.echelon;
    const echelonApres = descend ? descendreEchelon(echelonAvant, 1) : (finEmploi ? 'bronze' : echelonAvant);
    if (descend || finEmploi) {
      await pool.query(`UPDATE kadio_rh_employes SET echelon=$1, date_echelon_depuis=NOW() WHERE id=$2`, [echelonApres, employe.id]);
    }

    const motif = `${nRetardsMois}e retard du mois`;
    const r = await pool.query(`
      INSERT INTO kadio_rh_sanctions (employe_id, palier, motif, type, echelon_avant, echelon_apres)
      VALUES ($1,$2,$3,'retard',$4,$5) RETURNING *
    `, [employe.id, typeof palier === 'number' ? palier : 99, motif, echelonAvant, echelonApres]);

    const niveau = finEmploi ? 'urgent' : 'attention';
    const recap = `${employe.prenom} — ${motif}. ${consequence}.`;
    await pool.query(`INSERT INTO kadio_rh_alertes (niveau, message, employe_id, type) VALUES ($1,$2,$3,'sanction_retard')`,
      [niveau, recap, employe.id]);
    await alertOwner(`${finEmploi ? '🔴 URGENT' : '🟠'} ${recap}${finEmploi ? ' Séparation à confirmer.' : ''}`);

    return { ...r.rows[0], consequence };
  } catch (e) { console.warn(`${LOG} declencherSanctionRetard: ${e.message}`); }
}

// ── Mauvaises notes clients : 3 dans le mois = sanction générique ─────────
// "Mauvaise note" = note arrondie ≤3 (seuil déjà utilisé pour l'alerte Section 7).
async function declencherSanctionNotesBasses(employeId, employePrenom) {
  if (!pool || DEMO_MODE) return;
  try {
    const r = await pool.query(`
      SELECT accueil, qualite, proprete, ambiance FROM kadio_rh_notations_client
      WHERE employe_id=$1 AND soumis_at IS NOT NULL
        AND date_trunc('month', soumis_at) = date_trunc('month', NOW())
    `, [employeId]);
    const mauvaises = r.rows.filter(n => Math.round((n.accueil + n.qualite + n.proprete + n.ambiance) / 4) <= 3);
    if (mauvaises.length !== 3) return; // ne déclenche qu'au moment exact où le seuil est atteint
    await creerSanction(employeId, `3 mauvaises notes clients (≤3/5) ce mois-ci`, 'mauvaises_notes');
  } catch (e) { console.warn(`${LOG} declencherSanctionNotesBasses: ${e.message}`); }
}

// ── Pause > 70 min sans autorisation : avertissement écrit (Section 5) ────
async function declencherSanctionPauseLongue(employeId, motif) {
  if (!pool || DEMO_MODE || !creerSanction) return;
  try { await creerSanction(employeId, motif, 'pause_longue'); }
  catch (e) { console.warn(`${LOG} declencherSanctionPauseLongue: ${e.message}`); }
}

module.exports = { declencherSanctionRetard, declencherSanctionNotesBasses, declencherSanctionPauseLongue };
