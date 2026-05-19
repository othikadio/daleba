'use strict';
/**
 * Aesthetic Access Control — DALEBA Metacortex Point 372
 * [372] Isolation stricte des données cutanées confidentielles.
 * Un employé non autorisé ne peut pas consulter l'historique d'un client.
 */
const bus = require('./event-bus');

const ROLES_WITH_AESTHETIC_ACCESS = new Set([
  'admin',
  'manager',
  'aesthetician', // Esthéticienne
  'owner',
]);

/**
 * [372] Vérifie qu'un employé peut accéder aux données esthétiques d'un client
 */
async function assertAestheticAccess(pool, { tenantId, requestingEmployeeId, requestingRole, clientId }) {
  // Owner/admin/manager → accès complet
  if (ROLES_WITH_AESTHETIC_ACCESS.has(requestingRole)) {
    bus.system(`[AestheticAccess] ✅ Accès autorisé: ${requestingRole} → fiche ${clientId}`);
    return { authorized: true, role: requestingRole };
  }

  // Vérifie si l'employé a une accréditation spécifique
  try {
    const r = await pool.query(`
      SELECT 1 FROM staff_skills
      WHERE tenant_id=$1 AND employee_id=$2 AND skill_id='aesthetics_access' AND active=true
    `, [tenantId, requestingEmployeeId]);

    if (r.rows.length > 0) {
      bus.system(`[AestheticAccess] ✅ Accès via compétence: ${requestingEmployeeId} → fiche ${clientId}`);
      return { authorized: true, via: 'skill_grant' };
    }
  } catch {}

  // Accès refusé
  bus.system(`[AestheticAccess] 🚫 Accès REFUSÉ: ${requestingRole || 'unknown'} (${requestingEmployeeId}) → fiche ${clientId}`);
  throw new Error(`Accès refusé: votre rôle "${requestingRole || 'stylist'}" ne permet pas de consulter les données esthétiques confidentielles. Contactez le gérant.`);
}

/**
 * [379] Masque les détails cutanés sensibles dans les logs
 */
function maskSkinData(logText) {
  return logText
    .replace(/melanin[_\s]level[:\s]+\S+/gi, 'melanin_level:[MASQUÉ]')
    .replace(/allergies?[:\s]+\[.*?\]/gi, 'allergies:[MASQUÉ]')
    .replace(/hydration[_\s]index[:\s]+\S+/gi, 'hydration_index:[MASQUÉ]')
    .replace(/skin_type[:\s]+\S+/gi, 'skin_type:[MASQUÉ]')
    .replace(/client_id[:\s]+\S+/gi, 'client_id:[ID-PROTÉGÉ]');
}

module.exports = { assertAestheticAccess, maskSkinData, ROLES_WITH_AESTHETIC_ACCESS };
