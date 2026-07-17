'use strict';
/**
 * KADIO RH — Listes de tâches ménagères (cahier des charges Section 6)
 * Source unique pour rh-admin-routes.js (lecture dashboard) et
 * rh-taches-routes.js (cocher + vérifications automatiques).
 */

const TACHES_QUOTIDIENNES = [
  'Laver les assiettes et verres utilisés',
  'Vider les poubelles',
  "Passer l'aspirateur dans tout le salon",
  'Vérifier l\'apparence et propreté générale',
  "S'assurer du bon parfum d'ambiance",
  'Allumer la musique ou la télévision avant le premier client',
  'Préparer les boissons et grignotines disponibles',
];

const TACHES_HEBDOMADAIRES = [
  'Passer la moppe sur tout le plancher',
  'Laver la salle de bain complètement',
  'Laver les portes et les fenêtres',
  'Laver les chaises lavabo',
  'Laver les chaises de coiffure',
  'Nettoyer et sécher les tapis de fatigue',
];

module.exports = { TACHES_QUOTIDIENNES, TACHES_HEBDOMADAIRES };
