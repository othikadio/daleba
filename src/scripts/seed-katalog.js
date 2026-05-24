/**
 * DALEBA — Seed Officiel : Équipe + Catalogue Kadio Coiffure
 * Exécuter : node src/scripts/seed-katalog.js
 *
 * Ce script :
 *  1. Désactive TOUS les anciens membres Square (status → INACTIVE)
 *  2. Crée les 6 collaborateurs officiels
 *  3. Supprime les anciens items du catalogue
 *  4. Injecte le catalogue complet (3 catégories, 29 services)
 */

require('dotenv').config();

const TOKEN       = process.env.SQUARE_ACCESS_TOKEN || 'EAAAl621sVKBGg0JYZaOIMRv7iHe8aOPxX5Ub6-Rfnrr5J9ovhf4dRC-i1WZrgC3';
const LOCATION_ID = process.env.SQUARE_LOCATION_ID  || 'LTDE9RP9PSHX7';
const BASE        = 'https://connect.squareup.com';
const HDR         = {
  'Authorization':  `Bearer ${TOKEN}`,
  'Content-Type':   'application/json',
  'Square-Version': '2024-02-22',
};

function randomId(prefix = '') {
  return `${prefix}${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

async function sq(method, path, body) {
  const r = await fetch(`${BASE}${path}`, {
    method,
    headers: HDR,
    body: body ? JSON.stringify(body) : undefined,
  });
  const d = await r.json();
  if (!r.ok) {
    console.error(`❌ Square ${method} ${path}`, d.errors || d);
    throw new Error(d.errors?.[0]?.detail || `HTTP ${r.status}`);
  }
  return d;
}

// ─── ÉQUIPE ──────────────────────────────────────────────────────────────────

const TEAM = [
  { given_name: 'Wilfried', family_name: 'Kadio',  role: 'barbier'   },
  { given_name: 'Mariel',   family_name: 'Kadio',  role: 'barbier'   },
  { given_name: 'Mariane',  family_name: 'Kadio',  role: 'coiffeure' },
  { given_name: 'Raquel',   family_name: 'Kadio',  role: 'coiffeure' },
  { given_name: 'Brenda',   family_name: 'Kadio',  role: 'coiffeure' },
  { given_name: 'Ange',     family_name: 'Kadio',  role: 'coiffeur'  },
];

async function disableOldTeam() {
  console.log('\n── Désactivation des anciens membres ──');
  const data = await sq('POST', '/v2/team-members/search', {
    query: { filter: { status: 'ACTIVE' } },
  });
  const old = data.team_members || [];
  console.log(`  ${old.length} membre(s) actif(s) trouvé(s)`);
  for (const m of old) {
    // Nettoyer les champs que Square n'accepte pas en PUT
    const payload = {
      given_name:  m.given_name,
      family_name: m.family_name,
      status:      'INACTIVE',
      version:     m.version,
    };
    if (m.email_address) payload.email_address = m.email_address;
    if (m.phone_number)  payload.phone_number  = m.phone_number;
    if (m.assigned_locations) payload.assigned_locations = m.assigned_locations;
    try {
      await sq('PUT', `/v2/team-members/${m.id}`, { team_member: payload });
      console.log(`  ✂️  ${m.given_name} ${m.family_name} → INACTIVE`);
    } catch (e) {
      // Ignorer le propriétaire du compte (ne peut pas être désactivé)
      console.log(`  ⚠️  ${m.given_name} ${m.family_name} ignoré (${e.message.slice(0,50)})`);
    }
  }
}

async function createTeam() {
  console.log('\n── Création de l\'équipe officielle ──');
  const created = [];
  for (const t of TEAM) {
    const data = await sq('POST', '/v2/team-members', {
      idempotency_key: randomId('team_'),
      team_member: {
        given_name:   t.given_name,
        family_name:  t.family_name,
        status:       'ACTIVE',
        assigned_locations: {
          assignment_type:  'EXPLICIT_LOCATIONS',
          location_ids:     [LOCATION_ID],
        },
      },
    });
    const m = data.team_member;
    console.log(`  ✅ ${m.given_name} [${t.role}] — id: ${m.id}`);
    created.push({ ...m, role: t.role });
  }
  return created;
}

// ─── CATALOGUE ───────────────────────────────────────────────────────────────

// Durées en minutes
const SERVICES = {
  'Locks': [
    { name: 'Repousses locks retwist au gel — tête complète (avec style)',      duration: 120, price_min: 13500,  price_max: null  },
    { name: 'Repousses locks retwist-interlock au gel — demi tête (avec style)',duration:  90, price_min: 11000,  price_max: null  },
    { name: 'Repousses locks interlock au crochet — tête complète',             duration: 150, price_min: 15000,  price_max: null  },
    { name: 'Repousses locks interlock au crochet — demi tête',                 duration: 105, price_min: 12500,  price_max: null  },
    { name: 'Repiquer les racines — plusieurs mois de repousses (racine seule)',duration:  60, price_min:  6000,  price_max: 10000 },
    { name: 'Départ de locks instantané au crochet — tête complète',            duration: 240, price_min: 35000,  price_max: null  },
    { name: 'Départ de locks instantané au crochet — demi tête',                duration: 180, price_min: 25000,  price_max: null  },
    { name: 'Installation des locks (sans extensions fournies)',                 duration: 180, price_min: 25000,  price_max: null  },
    { name: 'Coiffure locks long',                                              duration:  60, price_min:  6000,  price_max: null  },
    { name: 'Tresser vos dreads / locks',                                       duration:  30, price_min:  4500,  price_max: null  },
    { name: 'Réparation de dreads / locks',                                     duration:  60, price_min:  null,  price_max: null, variable: true },
    { name: 'Défaire des locks (maximum de cheveux conservé)',                  duration: 300, price_min: 20000,  price_max: null  },
    { name: 'Défaire une coiffure',                                             duration:  30, price_min:  null,  price_max: null, variable: true },
    { name: 'Installation Sisterlocks',                                         duration: 600, price_min: 85000,  price_max: null  },
    { name: 'Entretien Sisterlocks',                                            duration: 270, price_min:  null,  price_max: null, variable: true },
  ],
  'Tresses & Nattes': [
    { name: 'Nattes Américaines',                                               duration: 240, price_min: 14000,  price_max: null  },
    { name: 'Nattes collées / barrel twist — 2 à 6 nattes',                    duration:  60, price_min:  2000,  price_max: null  },
    { name: 'Nattes collées / barrel twist — 7 nattes et plus',                duration: 120, price_min:  8000,  price_max: null  },
    { name: 'Twist demi tête',                                                  duration: 150, price_min:  7000,  price_max: null  },
    { name: 'Twist tête complète',                                              duration: 180, price_min: 12000,  price_max: null  },
    { name: 'Crochet braids',                                                   duration: 120, price_min: 17000,  price_max: null  },
    { name: 'Knotless Braids court',                                            duration: 360, price_min: 12000,  price_max: null  },
    { name: 'Knotless Gros',                                                    duration: 300, price_min: 12000,  price_max: null  },
    { name: 'Knotless Moyen',                                                   duration: 300, price_min: 15000,  price_max: null  },
    { name: 'Knotless Petit',                                                   duration: 480, price_min: 30000,  price_max: null  },
  ],
  'Coupe & Barbier': [
    { name: 'Coupe barbier sans barbe',        duration: 35, price_min:  3500, price_max: null, staff: ['Wilfried', 'Mariel'] },
    { name: 'Coupe barbier avec barbe',        duration: 45, price_min:  4000, price_max: null, staff: ['Wilfried', 'Mariel'] },
    { name: 'Coupe barbier enfant (≤12 ans)',  duration: 40, price_min:  3000, price_max: null, staff: ['Wilfried', 'Mariel'] },
    { name: 'Contours',                        duration: 60, price_min:  2000, price_max: null, staff: ['Wilfried', 'Mariel'] },
    { name: 'Barbe',                           duration: 30, price_min:  2000, price_max: null, staff: ['Wilfried', 'Mariel'] },
  ],
};

async function deleteOldCatalog() {
  console.log('\n── Suppression de l\'ancien catalogue ──');
  const data = await sq('GET', '/v2/catalog/list?types=ITEM,CATEGORY');
  const items = data.objects || [];
  if (!items.length) { console.log('  Catalogue vide, rien à supprimer'); return; }

  const ids = items.map(o => o.id);
  console.log(`  ${ids.length} objet(s) à supprimer`);

  // Batch delete par chunks de 200
  for (let i = 0; i < ids.length; i += 200) {
    await sq('POST', '/v2/catalog/batch-delete', {
      object_ids: ids.slice(i, i + 200),
    });
  }
  console.log('  ✅ Catalogue purgé');
}

async function injectCatalog() {
  console.log('\n── Injection du catalogue officiel ──');

  const objects = [];

  // Créer les catégories et items
  for (const [catName, services] of Object.entries(SERVICES)) {
    const catId = `#${catName.replace(/\s+/g, '_').toUpperCase()}`;

    // Catégorie
    objects.push({
      type: 'CATEGORY',
      id:   catId,
      category_data: { name: catName },
    });

    // Items
    for (const svc of services) {
      const itemId = `#ITEM_${randomId()}`;

      // Prix : fixe ou variable
      const variationData = {
        name:               'Tarif',
        pricing_type:       svc.variable ? 'VARIABLE_PRICING' : 'FIXED_PRICING',
        service_duration:   svc.duration * 60 * 1000, // ms
        available_for_booking: true,
        team_member_ids:    [],   // rempli plus bas si barbier-only
      };

      if (!svc.variable && svc.price_min) {
        variationData.price_money = { amount: svc.price_min, currency: 'CAD' };
      }

      objects.push({
        type: 'ITEM',
        id:   itemId,
        item_data: {
          name:              svc.name,
          category_id:       catId,
          product_type:      'APPOINTMENTS_SERVICE',
          available_for_booking: true,
          variations: [{
            type: 'ITEM_VARIATION',
            id:   `#VAR_${randomId()}`,
            item_variation_data: variationData,
          }],
        },
      });
    }
  }

  const result = await sq('POST', '/v2/catalog/batch-upsert', {
    idempotency_key: randomId('cat_'),
    batches: [{ objects }],
  });

  const created = result.objects || result.id_mappings || [];
  console.log(`  ✅ ${objects.filter(o => o.type === 'CATEGORY').length} catégories + ${objects.filter(o => o.type === 'ITEM').length} services injectés`);
  return result;
}

// ─── MAIN ─────────────────────────────────────────────────────────────────────

async function main() {
  console.log('🚀 DALEBA — Seed Kadio Coiffure\n');
  console.log(`Token: ${TOKEN.slice(0,8)}...`);
  console.log(`Location: ${LOCATION_ID}`);

  try {
    await disableOldTeam();
    const team = await createTeam();

    await deleteOldCatalog();
    await injectCatalog();

    console.log('\n╔════════════════════════════════════════╗');
    console.log('║  ✅ ÉTAPE 1 COMPLÈTE                   ║');
    console.log('╠════════════════════════════════════════╣');
    console.log(`║  Équipe : ${team.length} collaborateurs actifs      ║`);
    team.forEach(m => console.log(`║    • ${m.given_name.padEnd(10)} [${m.role}]${' '.repeat(12)}║`));
    const totalSvcs = Object.values(SERVICES).reduce((a, b) => a + b.length, 0);
    console.log(`║  Catalogue : ${totalSvcs} services en 3 catégories  ║`);
    console.log('╚════════════════════════════════════════╝');

    console.log('\nProchaine étape : logique de calcul des prix variables + assignation barbiers');

  } catch (err) {
    console.error('\n🔥 ERREUR:', err.message);
    process.exit(1);
  }
}

main();
