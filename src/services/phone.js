'use strict';
/**
 * Normalisation E.164 des numéros nord-américains (Kadio / DALEBA).
 * Source unique — précédemment copié dans 6 fichiers de routes ; toute
 * évolution du format (international, extensions) doit se faire ici.
 */
function normalizePhone(phone = '') {
  let p = phone.replace(/[^\d+]/g, '');
  if (!p.startsWith('+') && p.length === 10) p = '+1' + p;
  else if (!p.startsWith('+') && p.length === 11 && p.startsWith('1')) p = '+' + p;
  return p;
}

module.exports = { normalizePhone };
