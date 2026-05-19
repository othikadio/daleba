'use strict';
/**
 * Widget i18n — DALEBA Metacortex Point 390
 * Gestion multilingue FR/EN automatique selon navigator.language.
 */

const TRANSLATIONS = {
  fr: {
    title:          'Prendre rendez-vous',
    chooseService:  'Choisissez votre soin :',
    chooseSlot:     'Choisissez un créneau :',
    yourDetails:    'Vos coordonnées :',
    yourName:       'Votre prénom',
    yourPhone:      'Téléphone',
    confirm:        'Confirmer le rendez-vous',
    confirmed:      '✅ Rendez-vous confirmé ! Un SMS vous sera envoyé.',
    back:           '← Retour',
    loading:        'Chargement...',
    noSlots:        'Aucun créneau disponible aujourd\'hui.',
    poweredBy:      'Propulsé par DALEBA',
    errorConnect:   'Connexion impossible. Veuillez réessayer.',
    sandboxMode:    '🧪 Mode démo',
  },
  en: {
    title:          'Book an appointment',
    chooseService:  'Choose your service:',
    chooseSlot:     'Choose a time slot:',
    yourDetails:    'Your details:',
    yourName:       'Your first name',
    yourPhone:      'Phone number',
    confirm:        'Confirm appointment',
    confirmed:      '✅ Appointment confirmed! You will receive an SMS.',
    back:           '← Back',
    loading:        'Loading...',
    noSlots:        'No slots available today.',
    poweredBy:      'Powered by DALEBA',
    errorConnect:   'Connection failed. Please try again.',
    sandboxMode:    '🧪 Demo mode',
  },
};

/**
 * [390] Retourne les traductions pour une locale donnée
 * Détecte automatiquement FR/EN depuis navigator.language (client)
 * ou Accept-Language HTTP header (serveur)
 */
function getTranslations(localeOrHeader = 'fr') {
  const locale = (localeOrHeader || 'fr').toLowerCase().slice(0, 2);
  return TRANSLATIONS[locale] || TRANSLATIONS.fr;
}

/**
 * [390] Génère le JS d'auto-détection de langue pour le widget
 */
function buildI18nSnippet() {
  return `
var _lang=(navigator.language||navigator.userLanguage||'fr').slice(0,2).toLowerCase();
var _t=${JSON.stringify(TRANSLATIONS)};
var t=_t[_lang]||_t['fr'];
`.trim();
}

module.exports = { TRANSLATIONS, getTranslations, buildI18nSnippet };
