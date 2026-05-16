/**
 * DALEBA — Agent de Prospection & Cold Outreach (Point 36)
 * Génère des stratégies de vente hyper-personnalisées
 * basées sur les faiblesses détectées chez chaque prospect
 */

const claude = require('../agents/claude');
const { logEntry, ENTRY_TYPES } = require('./journal');

/**
 * Génère un message de cold outreach personnalisé pour un prospect
 * @param {Object} prospect - Données du prospect (de gmb-scanner)
 * @param {Object} options
 * @param {string} options.channel - 'sms' | 'email' | 'whatsapp' | 'phone_script'
 * @param {string} options.sender - Ton identité (ex: "Ulrich de Kadio Coiffure")
 * @param {string} options.offer - Ton offre principale
 */
async function generateOutreach(prospect, options = {}) {
  const { channel = 'sms', sender = 'Ulrich', offer = 'système de gestion IA pour salon' } = options;

  const weaknessSummary = prospect.weaknesses
    ?.map(w => `- ${w.label}`)
    .join('\n') || 'Données limitées';

  const opportunitySummary = prospect.opportunities
    ?.join(', ') || '';

  const systemPrompt = `Tu es DALEBA, expert en vente B2B pour PME au Québec.
Tu rédiges des messages de prospection COURTS, PERCUTANTS et ULTRA-PERSONNALISÉS.
Style: professionnel mais humain, jamais robotique, jamais générique.
Langue: français québécois naturel.`;

  const templates = {
    sms: `Rédige un SMS de prospection (max 160 caractères) pour contacter ce prospect.
Mets en évidence UN seul problème concret détecté et propose une solution directe.
Inclus un appel à l'action clair.`,

    email: `Rédige un email de prospection (objet + corps, max 150 mots).
Structure: accroche basée sur un problème spécifique → solution → preuve → CTA.
Personnalise avec le nom de l'entreprise et ses faiblesses réelles.`,

    whatsapp: `Rédige un message WhatsApp de prospection (max 300 caractères, ton conversationnel).
Démarre avec une observation spécifique sur leur business.`,

    phone_script: `Rédige un script d'appel téléphonique (30 secondes max).
Structure: accroche → problème observé → solution → demande de rendez-vous.
Naturel, pas robotique.`,
  };

  const userPrompt = `
Prospect:
- Nom: ${prospect.name}
- Adresse: ${prospect.address}
- Note Google: ${prospect.rating || 'N/A'}/5 (${prospect.reviewCount || 0} avis)
- Site web: ${prospect.website || 'AUCUN'}
- Téléphone: ${prospect.phone || 'N/A'}
- Score de vulnérabilité: ${prospect.prospectScore || 0}/100

Faiblesses détectées:
${weaknessSummary}

Opportunités:
${opportunitySummary}

Expéditeur: ${sender}
Offre: ${offer}

${templates[channel] || templates.sms}

Génère UNIQUEMENT le message final, sans commentaire ni explication.`;

  const result = await claude.query(userPrompt, systemPrompt);

  await logEntry(
    ENTRY_TYPES.ACHIEVED,
    `Outreach généré pour: ${prospect.name} (${channel})`,
    '',
    { prospectId: prospect.placeId, channel, score: prospect.prospectScore }
  ).catch(() => {});

  return {
    prospect: { name: prospect.name, placeId: prospect.placeId },
    channel,
    message: result.content,
    prospectScore: prospect.prospectScore,
  };
}

/**
 * Génère une stratégie de vente complète pour un prospect
 * @param {Object} prospect
 */
async function generateStrategy(prospect) {
  const systemPrompt = `Tu es DALEBA, stratège commercial senior spécialisé PME québécoises.
Tu identifies les angles d'attaque précis et génères des plans de vente actionnables.`;

  const weaknessList = prospect.weaknesses?.map(w => `${w.severity.toUpperCase()}: ${w.label}`).join('\n') || '';

  const userPrompt = `
Analyse ce prospect et génère une stratégie de vente complète:

Entreprise: ${prospect.name}
Secteur: ${prospect.types?.join(', ')}
Localisation: ${prospect.address}
Note: ${prospect.rating}/5 — ${prospect.reviewCount} avis
Site: ${prospect.website || 'AUCUN'}
Score vulnérabilité: ${prospect.prospectScore}/100

Faiblesses:
${weaknessList}

Génère:
1. **Angle d'attaque principal** (le problème le plus douloureux)
2. **Message clé** (ce qu'ils ont besoin d'entendre)
3. **Séquence de contact** (quand, comment, combien de fois)
4. **Objection principale** (et comment la contrer)
5. **Proposition de valeur** (résultat concret en 30 jours)`;

  const result = await claude.query(userPrompt, systemPrompt);

  return {
    prospect: { name: prospect.name, placeId: prospect.placeId },
    strategy: result.content,
    prospectScore: prospect.prospectScore,
  };
}

/**
 * Priorise et classe une liste de prospects par potentiel commercial
 * @param {Array} prospects - Liste des prospects de scanProspects()
 */
function prioritizeProspects(prospects) {
  return prospects
    .filter(p => !p.error)
    .map(p => ({
      name: p.name,
      placeId: p.placeId,
      phone: p.phone,
      website: p.website || null,
      rating: p.rating,
      reviewCount: p.reviewCount,
      prospectScore: p.prospectScore,
      topWeakness: p.weaknesses?.[0]?.label || 'N/A',
      priority: p.prospectScore >= 60 ? '🔴 CHAUD' : p.prospectScore >= 30 ? '🟡 TIÈDE' : '🟢 FROID',
    }))
    .sort((a, b) => b.prospectScore - a.prospectScore);
}

module.exports = {
  generateOutreach,
  generateStrategy,
  prioritizeProspects,
};
