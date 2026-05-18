/**
 * DALEBA V24 — Configuration centralisée de l'Agent Vocal
 * Source unique de vérité pour les constantes vocales
 */

module.exports = {
  SALON_NAME: process.env.SALON_NAME || 'Kadio Coiffure et Esthétique',
  SALON_ADDRESS: process.env.SALON_ADDRESS || '615 Antoinette Robidoux, Local 100, Longueuil, QC',
  SALON_WEBSITE: process.env.SALON_WEBSITE || 'kadiocoiffure.com',
  HOURS: {
    weekdays: '9h à 19h',
    saturday: '8h à 17h',
    sunday: 'Fermé',
  },
  ESCALATION_KEYWORDS: [
    'urgence', 'urgent', 'ulrich', 'directeur', 'propriétaire', 'patron',
    'responsable', 'plainte', 'avocat', 'police', 'blessé', 'accident',
    'remboursement', 'scandale', 'honte',
  ],
  FRUSTRATION_THRESHOLD: 70,
  WELCOME_MESSAGE: (salonName) =>
    `Bonjour et bienvenue chez ${salonName}. Je suis Béatrice, l'assistante du salon. ` +
    `Je peux vous aider à prendre un rendez-vous, vous donner nos horaires ou annuler une réservation. ` +
    `Dites-moi en quelques mots comment je peux vous aider.`,
};
