'use strict';
/**
 * KADIO RH — Moteur de sanctions à 3 paliers (Section 5)
 *
 * Module de logique pure, volontairement sans dépendance sur les fichiers
 * *-routes.js : pointage-routes.js, rh-notations-routes.js et
 * rh-admin-routes.js en ont tous besoin pour déclencher des sanctions
 * automatiques, et rh-employe-routes.js dépend déjà de pointage-routes.js —
 * le placer ici évite tout risque de require circulaire.
 */

const LOG = '[RH-SANCTIONS]';

let pool = null, DEMO_MODE = true;
try { const db = require('../memory/db'); pool = db.pool; DEMO_MODE = db.DEMO_MODE; } catch (e) {}

let sendSMS = null;
try { sendSMS = require('../services/twilio').sendSMS; } catch (e) {}
const OWNER_PHONE = process.env.OWNER_PHONE_NUMBER || '+15149195970';

async function alertOwner(message) {
  if (sendSMS) { try { await sendSMS(OWNER_PHONE, message); } catch (e) { console.error(`${LOG} SMS échec: ${e.message}`); } }
  else console.log(`${LOG} [SMS-DEMO] → propriétaire: ${message}`);
}

const ECHELON_ORDER = ['bronze', 'argent', 'or', 'platine'];
function descendreEchelon(echelon, niveaux = 1) {
  const idx = ECHELON_ORDER.indexOf(echelon);
  return ECHELON_ORDER[Math.max(0, (idx === -1 ? 0 : idx) - niveaux)];
}

// Palier dérivé du nombre de sanctions déjà au dossier (1re/2e/3e), pas choisi
// à la main — conforme à la Section 5 (système progressif à 3 paliers).
async function creerSanction(employeId, motif, type = 'manuelle') {
  const empRes = await pool.query(`SELECT * FROM kadio_rh_employes WHERE id=$1`, [employeId]);
  const employe = empRes.rows[0];
  if (!employe) throw new Error('Employé introuvable');

  const countRes = await pool.query(`SELECT COUNT(*) FROM kadio_rh_sanctions WHERE employe_id=$1`, [employeId]);
  const palier = parseInt(countRes.rows[0].count, 10) + 1;

  let echelonApres, consequence;
  if (palier === 1) { echelonApres = descendreEchelon(employe.echelon, 1); consequence = 'Avertissement écrit'; }
  else if (palier === 2) { echelonApres = descendreEchelon(employe.echelon, 1); consequence = '1 journée sans salaire + avertissement écrit'; }
  else { echelonApres = 'bronze'; consequence = "Fin d'emploi — rapport final généré"; }

  await pool.query(`UPDATE kadio_rh_employes SET echelon=$1, date_echelon_depuis=NOW() WHERE id=$2`, [echelonApres, employeId]);

  const r = await pool.query(`
    INSERT INTO kadio_rh_sanctions (employe_id, palier, motif, type, echelon_avant, echelon_apres)
    VALUES ($1,$2,$3,$4,$5,$6) RETURNING *
  `, [employeId, palier, motif, type, employe.echelon, echelonApres]);

  const niveau = palier >= 3 ? 'urgent' : 'attention';
  const recap = `${employe.prenom} — ${palier}e sanction. ${consequence}. Motif : ${motif}.`;
  await pool.query(`INSERT INTO kadio_rh_alertes (niveau, message, employe_id, type) VALUES ($1,$2,$3,'sanction')`,
    [niveau, recap, employeId]);
  await alertOwner(`${palier >= 3 ? '🔴 URGENT' : '🟠'} ${recap}${palier >= 3 ? ' Séparation à confirmer.' : ''}`);

  return { ...r.rows[0], consequence };
}

module.exports = { creerSanction, descendreEchelon, alertOwner, pool, DEMO_MODE };
