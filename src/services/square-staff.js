/**
 * DALEBA — Helper Square Staff
 * Récupère la liste des membres d'équipe actifs depuis Square.
 * Partagé entre square-calendar-routes.js et public-booking-routes.js.
 */

const SQUARE_BASE = 'https://connect.squareup.com';

/**
 * Récupère tous les membres actifs via POST /v2/team-members/search
 * @returns {Array} tableau de membres normalisés
 */
async function getSquareStaff() {
  const token = process.env.SQUARE_ACCESS_TOKEN;
  if (!token) throw new Error('SQUARE_ACCESS_TOKEN manquant');

  const res  = await fetch(`${SQUARE_BASE}/v2/team-members/search`, {
    method:  'POST',
    headers: {
      'Authorization':  `Bearer ${token}`,
      'Content-Type':   'application/json',
      'Square-Version': '2024-02-22',
    },
    body: JSON.stringify({ query: { filter: { status: 'ACTIVE' } } }),
  });
  const data = await res.json();
  if (!res.ok) {
    const msg = data.errors?.[0]?.detail || `Square ${res.status}`;
    throw new Error(msg);
  }
  return data.team_members || [];
}

module.exports = { getSquareStaff };
