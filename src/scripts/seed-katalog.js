/**
 * DALEBA — Seed Officiel : Équipe + Catalogue Kadio Coiffure
 * Source de vérité : feuille de route Ulrich, 25 mai 2026
 * Exécuter : node src/scripts/seed-katalog.js
 *
 * Ce script :
 *  1. Désactive TOUS les anciens membres Square (status → INACTIVE)
 *  2. Crée les 6 collaborateurs officiels
 *  3. Supprime les anciens items du catalogue
 *  4. Injecte le catalogue complet (3 catégories, 30 services)
 *
 * ATTRIBUTION AUTOMATIQUE (pas de sélection par le client) :
 *  - LOCKS & TRESSES & NATTES → Mariane | Raquel | Brenda | Ange
 *  - COUPE & BARBIER          → Wilfried | Mariel
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
// Attribution automatique :
//   LOCKS & TRESSES → Mariane, Raquel, Brenda, Ange
//   COUPE & BARBIER → Wilfried, Mariel

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

// ─── CATALOGUE OFFICIEL ───────────────────────────────────────────────────────
// Durées en minutes | Prix en centimes CAD
// Variable = true → tarif sur devis / prix variable

const SERVICES = {

  // ════════════════════════════════════════════════════════════════════
  // LOCKS — Attribution : Mariane, Raquel, Brenda, Ange
  // ════════════════════════════════════════════════════════════════════
  'Locks': [
    {
      name:      'Repousses locks retwist au gel tête complète (avec style au choix)',
      duration:  120,         // 2h
      price_min: 15000,       // 150$ + taxes
    },
    {
      name:      'Repousses locks retwist-interlock au gel demi tête (avec style au choix)',
      duration:  90,          // 1h30
      price_min: 13000,       // 130$ + taxes
    },
    {
      name:      'Repousses locks interlock au crochet tête complète',
      duration:  150,         // 2h30
      price_min: 15000,       // 150$ + taxes
    },
    {
      name:      'Repousses locks interlock au crochet demi tête',
      duration:  105,         // 1h45
      price_min: 12500,       // 125$ + taxes
    },
    {
      name:      'Repiquer les racines — plusieurs mois de repousses (racine uniquement)',
      duration:  60,          // 1h à 3h (min bookable)
      price_min: 6000,        // 60$
      price_max: 10000,       // 100$ + taxes
    },
    {
      name:      'Départ de locks instantané au crochet tête complète',
      duration:  240,         // 4h+
      price_min: 35000,       // À partir de 350$ + taxes
    },
    {
      name:      'Départ de locks instantané au crochet demi tête',
      duration:  180,         // 3h+
      price_min: 25000,       // À partir de 250$ + taxes
    },
    {
      name:      'Installation des locks (sans extensions fournies)',
      duration:  180,         // 3h+
      price_min: 25000,       // À partir de 250$ + taxes
    },
    {
      name:      'Coiffure locks long',
      duration:  60,          // 1h
      price_min: 6000,        // 60$ + taxes
    },
    {
      name:      'Tresser vos dreads / locks',
      duration:  30,          // 30min
      price_min: 4500,        // 45$ + taxes
    },
    {
      name:      'Réparation de dreads / locks',
      duration:  60,
      variable:  true,        // Prix en fonction des réparations
    },
    {
      name:      'Défaire des locks (en gardant le plus de cheveux possible)',
      duration:  300,         // Min. 5h
      price_min: 20000,       // À partir de 200$ + taxes
    },
    {
      name:      'Défaire une coiffure',
      duration:  30,
      variable:  true,        // Prix selon la coiffure à défaire
    },
    {
      name:      'Installation Sisterlocks',
      duration:  600,         // 10h+
      price_min: 85000,       // 850$+ + taxes
    },
    {
      name:      'Entretien Sisterlocks',
      duration:  270,         // 4h30
      variable:  true,        // Sur RDV + taxes
    },
  ],

  // ════════════════════════════════════════════════════════════════════
  // TRESSES & NATTES — Attribution : Mariane, Raquel, Brenda, Ange
  // ════════════════════════════════════════════════════════════════════
  'Tresses & Nattes': [
    {
      name:      'Nattes Américaines',
      duration:  240,         // min. 4h
      price_min: 14000,       // À partir de 140$+ + taxes
    },
    {
      name:      'Nattes collées / barrel twist — 2 à 6 nattes',
      duration:  60,          // À partir de 1h
      price_min: 2000,        // À partir de 20$+ + taxes
    },
    {
      name:      'Nattes collées / barrel twist — 7 nattes et plus',
      duration:  120,         // À partir de 2h
      price_min: 8000,        // À partir de 80$+ + taxes
    },
    {
      name:      'Twist demi tête',
      duration:  150,         // 2h30
      price_min: 7000,        // À partir de 70$ + taxes
    },
    {
      name:      'Twist tête complète',
      duration:  180,         // min. 3h
      price_min: 12000,       // À partir de 120$ + taxes
    },
    {
      name:      'Crochet braids',
      duration:  120,         // min. 2h
      price_min: 17000,       // À partir de 170$+ + taxes
    },
    {
      name:      'Knotless Braids court',
      duration:  360,         // min. 6h
      price_min: 12000,       // À partir de 120$ + taxes
    },
    {
      name:      'Knotless Gros',
      duration:  300,         // 5h
      price_min: 12000,       // 120$+ + taxes
    },
    {
      name:      'Knotless Moyen',
      duration:  300,         // 5h
      price_min: 15000,       // 150$+ + taxes
    },
    {
      name:      'Knotless Petit',
      duration:  480,         // 8h
      price_min: 30000,       // 300$+ + taxes
    },
  ],

  // ════════════════════════════════════════════════════════════════════
  // COUPE & BARBIER — Attribution : Wilfried, Mariel (exclusivement)
  // Acompte : 0$ (exonéré)
  // ════════════════════════════════════════════════════════════════════
  'Coupe & Barbier': [
    {
      name:      'Coupe barbier sans barbe',
      duration:  35,          // 35 min
      price_min: 3500,        // 35$+ + taxes
    },
    {
      name:      'Coupe barbier avec barbe',
      duration:  45,          // 45 min
      price_min: 4000,        // 40$ + taxes
    },
    {
      name:      'Coupe barbier enfant (12 ans et moins)',
      duration:  40,          // 40 min
      price_min: 3000,        // 30$ + taxes
    },
    {
      name:      'Contours',
      duration:  60,          // 1h
      price_min: 2000,        // 20$+ + taxes
    },
    {
      name:      'Barbe',
      duration:  30,          // 30 min
      price_min: 2000,        // 20$ + taxes
    },
  ],
};

// ─── Suppression ancien catalogue ────────────────────────────────────────────

async function deleteOldCatalog() {
  console.log('\n── Suppression de l\'ancien catalogue ──');
  const data = await sq('GET', '/v2/catalog/list?types=ITEM,CATEGORY');
  const items = data.objects || [];
  if (!items.length) { console.log('  Catalogue vide, rien à supprimer'); return; }

  const ids = items.map(o => o.id);
  console.log(`  ${ids.length} objet(s) à supprimer`);

  for (let i = 0; i < ids.length; i += 200) {
    await sq('POST', '/v2/catalog/batch-delete', {
      object_ids: ids.slice(i, i + 200),
    });
  }
  console.log('  ✅ Catalogue purgé');
}

// ─── Injection catalogue ──────────────────────────────────────────────────────

async function injectCatalog() {
  console.log('\n── Injection du catalogue officiel ──');

  const objects = [];

  for (const [catName, services] of Object.entries(SERVICES)) {
    const catId = `#${catName.replace(/[\s&]+/g, '_').toUpperCase()}`;

    // Catégorie Square
    objects.push({
      type: 'CATEGORY',
      id:   catId,
      category_data: { name: catName },
    });

    // Items
    for (const svc of services) {
      const variationData = {
        name:               'Tarif',
        pricing_type:       svc.variable ? 'VARIABLE_PRICING' : 'FIXED_PRICING',
        service_duration:   svc.duration * 60 * 1000, // ms
        available_for_booking: true,
      };

      if (!svc.variable && svc.price_min) {
        variationData.price_money = { amount: svc.price_min, currency: 'CAD' };
      }

      objects.push({
        type: 'ITEM',
        id:   `#ITEM_${randomId()}`,
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

  const cats  = objects.filter(o => o.type === 'CATEGORY').length;
  const items = objects.filter(o => o.type === 'ITEM').length;
  console.log(`  ✅ ${cats} catégories + ${items} services injectés`);
  return result;
}

// ─── MAIN ─────────────────────────────────────────────────────────────────────

async function main() {
  console.log('🚀 DALEBA — Seed Kadio Coiffure (v2 — 25 mai 2026)\n');
  console.log(`Token:    ${TOKEN.slice(0,8)}...`);
  console.log(`Location: ${LOCATION_ID}`);

  try {
    await disableOldTeam();
    const team = await createTeam();

    await deleteOldCatalog();
    await injectCatalog();

    const totalSvcs = Object.values(SERVICES).reduce((a, b) => a + b.length, 0);

    console.log('\n╔══════════════════════════════════════════════════╗');
    console.log('║  ✅ SEED COMPLET — Kadio Coiffure                ║');
    console.log('╠══════════════════════════════════════════════════╣');
    console.log(`║  Équipe : ${team.length} collaborateurs actifs                 ║`);
    team.forEach(m => {
      const line = `║    • ${m.given_name.padEnd(10)} [${m.role.padEnd(8)}] id: ${m.id.slice(0,8)}  ║`;
      console.log(line);
    });
    console.log(`║  Catalogue : ${totalSvcs} services en 3 catégories             ║`);
    console.log('╠══════════════════════════════════════════════════╣');
    console.log('║  Attribution automatique :                       ║');
    console.log('║    Locks & Tresses → Mariane|Raquel|Brenda|Ange  ║');
    console.log('║    Coupe & Barbier → Wilfried|Mariel             ║');
    console.log('╠══════════════════════════════════════════════════╣');
    console.log('║  Acomptes :                                      ║');
    console.log('║    Locks & Tresses → 20% du prix HT              ║');
    console.log('║    Coupe & Barbier → 0$ (exonéré)                ║');
    console.log('╠══════════════════════════════════════════════════╣');
    console.log('║  Abonnements :                                   ║');
    console.log('║    3 mois = 5%  |  6 mois et + = 10%            ║');
    console.log('╚══════════════════════════════════════════════════╝');

  } catch (err) {
    console.error('\n🔥 ERREUR:', err.message);
    process.exit(1);
  }
}

main();
