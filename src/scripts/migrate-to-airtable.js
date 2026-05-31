/**
 * DALEBA — Script de migration Stripe + Square → Airtable
 * Usage : node src/scripts/migrate-to-airtable.js
 *
 * Migre :
 * - Tous les abonnés Stripe actifs/annulés
 * - Migration spéciale Fils Matondo (matondofils0@gmail.com)
 * - Les 50 derniers paiements Square
 */

require('dotenv').config();

const airtable = require('../services/airtable');

// ─── CONFIG ───────────────────────────────────────────────────────────────────

const STRIPE_KEY = process.env.STRIPE_SECRET_KEY;
const SQUARE_TOKEN = process.env.SQUARE_ACCESS_TOKEN;
const SQUARE_LOCATION_ID = process.env.SQUARE_LOCATION_ID || 'LTDE9RP9PSHX7';

if (!airtable.isConfigured()) {
  console.error('❌ Airtable non configuré. Définissez AIRTABLE_API_KEY et AIRTABLE_BASE_ID.');
  process.exit(1);
}

if (!STRIPE_KEY) {
  console.warn('⚠️  STRIPE_SECRET_KEY manquant — migration Stripe ignorée.');
}

console.log('🚀 Migration DALEBA → Airtable démarrée\n');

// ─── STRIPE ───────────────────────────────────────────────────────────────────

async function migrateStripeSubscribers() {
  if (!STRIPE_KEY) {
    console.log('⏩ Stripe : clé manquante, ignoré.');
    return { synced: 0, errors: 0 };
  }

  console.log('📦 Récupération des abonnements Stripe...');
  const stripeService = require('../services/stripe');

  let synced = 0;
  let errors = 0;
  const FILS_EMAIL = 'matondofils0@gmail.com';

  try {
    const subs = await stripeService.listSubscriptions({ status: 'all', limit: 100 });
    console.log(`   → ${subs.length} abonnement(s) trouvé(s)`);

    for (const sub of subs) {
      try {
        // Migration spéciale Fils Matondo
        const isFilsMatondo = sub.customerEmail === FILS_EMAIL;
        if (isFilsMatondo) {
          console.log(`   🌟 Migration spéciale : Fils Matondo (${FILS_EMAIL})`);
        }

        await airtable.upsertSubscriber({
          email: sub.customerEmail,
          name: sub.customerName || (isFilsMatondo ? 'Fils Matondo' : ''),
          customerId: sub.customerId,
          subscriptionId: sub.id,
          plan: sub.plan,
          status: sub.status,
          amount: parseFloat(sub.amount || 0),
          currentPeriodEnd: sub.currentPeriodEnd,
          createdAt: sub.createdAt,
          notes: isFilsMatondo ? 'Client migré depuis Stripe — Fils Matondo' : '',
        });

        synced++;
        const label = sub.customerEmail || sub.customerId;
        console.log(`   ✅ ${label} → ${sub.status}`);
        await airtable.delay(200);
      } catch (e) {
        errors++;
        console.error(`   ❌ Erreur ${sub.customerEmail || sub.id}:`, e.message);
      }
    }
  } catch (e) {
    console.error('❌ Stripe listSubscriptions error:', e.message);
  }

  return { synced, errors };
}

// ─── SQUARE PAYMENTS ─────────────────────────────────────────────────────────

async function migrateSquarePayments() {
  if (!SQUARE_TOKEN) {
    console.log('⏩ Square : token manquant, ignoré.');
    return { synced: 0, errors: 0 };
  }

  console.log('\n📦 Récupération des paiements Square (50 derniers)...');
  let synced = 0;
  let errors = 0;

  try {
    const startTime = new Date(Date.now() - 180 * 24 * 60 * 60 * 1000).toISOString();
    const params = new URLSearchParams({
      location_id: SQUARE_LOCATION_ID,
      begin_time: startTime,
      limit: '50',
      sort_order: 'DESC',
    });

    const res = await fetch(`https://connect.squareup.com/v2/payments?${params}`, {
      headers: {
        Authorization: `Bearer ${SQUARE_TOKEN}`,
        'Content-Type': 'application/json',
        'Square-Version': '2024-02-22',
      },
    });

    if (!res.ok) {
      const err = await res.text();
      console.warn('⚠️  Square payments:', err.slice(0, 200));
      return { synced: 0, errors: 1 };
    }

    const data = await res.json();
    const payments = data.payments || [];
    console.log(`   → ${payments.length} paiement(s) trouvé(s)`);

    for (const payment of payments) {
      try {
        const email = payment.buyer_email_address || payment.receipt_email || '';
        const amount = payment.amount_money?.amount
          ? payment.amount_money.amount / 100
          : 0;

        await airtable.upsertPayment({
          paymentId: payment.id,
          customerEmail: email,
          customerName: payment.shipping_address?.first_name
            ? `${payment.shipping_address.first_name} ${payment.shipping_address.last_name || ''}`
            : '',
          amount,
          source: 'Square',
          status: payment.status?.toLowerCase() === 'completed' ? 'complété' : 'en_attente',
          description: payment.note || 'Paiement Square',
          date: payment.created_at,
          squarePaymentId: payment.id,
        });

        synced++;
        console.log(`   ✅ Square payment ${payment.id} — ${amount} CAD`);
        await airtable.delay(200);
      } catch (e) {
        errors++;
        console.error(`   ❌ Erreur payment ${payment.id}:`, e.message);
      }
    }
  } catch (e) {
    console.error('❌ Square payments error:', e.message);
  }

  return { synced, errors };
}

// ─── MAIN ─────────────────────────────────────────────────────────────────────

async function main() {
  const start = Date.now();

  // 1. Migration Stripe
  const stripe = await migrateStripeSubscribers();
  console.log(`\n📊 Stripe : ${stripe.synced} synchronisés, ${stripe.errors} erreurs`);

  // 2. Migration Square
  const square = await migrateSquarePayments();
  console.log(`📊 Square : ${square.synced} synchronisés, ${square.errors} erreurs`);

  const elapsed = ((Date.now() - start) / 1000).toFixed(1);
  console.log(`\n✅ Migration terminée en ${elapsed}s`);
  console.log(`   Total : ${stripe.synced + square.synced} enregistrements dans Airtable`);

  if (stripe.errors + square.errors > 0) {
    console.warn(`   ⚠️  ${stripe.errors + square.errors} erreur(s) — vérifiez les logs ci-dessus`);
  }
}

main().catch(e => {
  console.error('💀 Migration échouée:', e.message);
  process.exit(1);
});
