'use strict';
/**
 * KADIO RH — Administration (admin uniquement)
 * Gestion des employés RH (fiche, horaire, PIN) + consultation pointages/pauses/alertes.
 * Sert de base au futur Module 9 (tableau de bord propriétaire).
 */

const express = require('express');
const router  = express.Router();
const { requireAuth, requireRole, ROLES } = require('../middleware/auth');

const LOG = '[RH-ADMIN]';

let pool = null, DEMO_MODE = true;
try { const db = require('../memory/db'); pool = db.pool; DEMO_MODE = db.DEMO_MODE; } catch (e) {}

router.use(requireAuth, requireRole(ROLES.BUSINESS_ADMIN));

function normalizePhone(phone = '') {
  let p = phone.replace(/[^\d+]/g, '');
  if (!p.startsWith('+') && p.length === 10) p = '+1' + p;
  else if (!p.startsWith('+') && p.length === 11 && p.startsWith('1')) p = '+' + p;
  return p;
}

// ═══════════════════════ EMPLOYÉS RH ═══════════════════════════════════════
router.get('/employes', async (req, res) => {
  if (!pool || DEMO_MODE) return res.json({ employes: [], demo: true });
  try {
    const r = await pool.query(`
      SELECT id, prenom, nom, telephone, poste, heure_debut_quart, heure_fin_quart,
             echelon, date_embauche, date_probation_fin, actif, video_vue_at, reglement_signe_at, created_at
      FROM kadio_rh_employes ORDER BY created_at DESC
    `);
    res.json({ employes: r.rows });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.post('/employes', async (req, res) => {
  const { prenom, nom, telephone, pin, poste, heureDebutQuart, heureFinQuart } = req.body || {};
  if (!prenom || !telephone || !pin) return res.status(400).json({ error: 'prenom, telephone et pin requis' });
  if (!/^\d{4}$/.test(pin)) return res.status(400).json({ error: 'pin doit être 4 chiffres' });
  if (!pool || DEMO_MODE) return res.json({ success: true, demo: true });
  try {
    const r = await pool.query(`
      INSERT INTO kadio_rh_employes (prenom, nom, telephone, pin, poste, heure_debut_quart, heure_fin_quart)
      VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id, prenom, nom, telephone, poste, heure_debut_quart, heure_fin_quart, echelon, actif
    `, [prenom, nom || null, normalizePhone(telephone), pin, poste || null,
        heureDebutQuart || '09:00', heureFinQuart || '17:00']);
    res.status(201).json({ success: true, employe: r.rows[0] });
  } catch (e) {
    if (e.code === '23505') return res.status(409).json({ error: 'Ce numéro de téléphone est déjà utilisé' });
    res.status(500).json({ error: e.message });
  }
});

router.put('/employes/:id', async (req, res) => {
  const { prenom, nom, telephone, pin, poste, heureDebutQuart, heureFinQuart, echelon, actif } = req.body || {};
  if (pin && !/^\d{4}$/.test(pin)) return res.status(400).json({ error: 'pin doit être 4 chiffres' });
  if (!pool || DEMO_MODE) return res.json({ success: true, demo: true });
  try {
    const r = await pool.query(`
      UPDATE kadio_rh_employes SET
        prenom=COALESCE($1,prenom), nom=COALESCE($2,nom),
        telephone=COALESCE($3,telephone), pin=COALESCE($4,pin), poste=COALESCE($5,poste),
        heure_debut_quart=COALESCE($6,heure_debut_quart), heure_fin_quart=COALESCE($7,heure_fin_quart),
        echelon=COALESCE($8,echelon), actif=COALESCE($9,actif)
      WHERE id=$10 RETURNING id, prenom, nom, telephone, poste, heure_debut_quart, heure_fin_quart, echelon, actif
    `, [prenom, nom, telephone ? normalizePhone(telephone) : null, pin, poste,
        heureDebutQuart, heureFinQuart, echelon, actif, req.params.id]);
    if (!r.rows[0]) return res.status(404).json({ error: 'Employé introuvable' });
    res.json({ success: true, employe: r.rows[0] });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ═══════════════════════ POINTAGES / PAUSES / ALERTES ══════════════════════
router.get('/pointages', async (req, res) => {
  if (!pool || DEMO_MODE) return res.json({ pointages: [], demo: true });
  try {
    const { employeId, limit = 100 } = req.query;
    let q = `SELECT p.*, e.prenom FROM kadio_rh_pointages p JOIN kadio_rh_employes e ON e.id=p.employe_id`;
    const params = [];
    if (employeId) { q += ` WHERE p.employe_id=$1`; params.push(employeId); }
    q += ` ORDER BY p.heure_reelle DESC LIMIT $${params.length + 1}`;
    params.push(parseInt(limit, 10));
    const r = await pool.query(q, params);
    res.json({ pointages: r.rows });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.get('/pauses', async (req, res) => {
  if (!pool || DEMO_MODE) return res.json({ pauses: [], demo: true });
  try {
    const r = await pool.query(`
      SELECT p.*, e.prenom FROM kadio_rh_pauses p JOIN kadio_rh_employes e ON e.id=p.employe_id
      ORDER BY p.debut DESC LIMIT 100
    `);
    res.json({ pauses: r.rows });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.get('/alertes', async (req, res) => {
  if (!pool || DEMO_MODE) return res.json({ alertes: [], demo: true });
  try {
    const { traitee } = req.query;
    let q = `SELECT a.*, e.prenom FROM kadio_rh_alertes a LEFT JOIN kadio_rh_employes e ON e.id=a.employe_id`;
    const params = [];
    if (traitee !== undefined) { q += ` WHERE a.traitee=$1`; params.push(traitee === 'true'); }
    q += ` ORDER BY a.created_at DESC LIMIT 200`;
    const r = await pool.query(q, params);
    res.json({ alertes: r.rows });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.patch('/alertes/:id', async (req, res) => {
  if (!pool || DEMO_MODE) return res.json({ success: true, demo: true });
  try {
    const r = await pool.query(`UPDATE kadio_rh_alertes SET traitee=TRUE WHERE id=$1 RETURNING *`, [req.params.id]);
    if (!r.rows[0]) return res.status(404).json({ error: 'Alerte introuvable' });
    res.json({ success: true, alerte: r.rows[0] });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

module.exports = router;
