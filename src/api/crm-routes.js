/**
 * DALEBA — CRM Routes (V47)
 * Square Customers + historique RDV/paiements + fidélité
 */

const express = require('express');
const router = express.Router();

const SQUARE_BASE = 'https://connect.squareup.com';
const SQUARE_TOKEN = process.env.SQUARE_ACCESS_TOKEN;
const LOCATION_ID  = process.env.SQUARE_LOCATION_ID;

function sqHeaders() {
  return {
    'Authorization': `Bearer ${SQUARE_TOKEN}`,
    'Content-Type': 'application/json',
    'Square-Version': '2024-02-22',
  };
}

// ─── GET /api/crm/clients ─────────────────────────────────────────────────
// Liste tous les clients Square (paginé, param search)
router.get('/clients', async (req, res) => {
  try {
    const { search, cursor, limit = 50 } = req.query;

    let body = { limit: parseInt(limit) };
    if (cursor) body.cursor = cursor;
    if (search) {
      body.query = {
        filter: {
          text_filter: {
            fuzzy: search
          }
        }
      };
    }

    const sqRes = await fetch(`${SQUARE_BASE}/v2/customers/search`, {
      method: 'POST',
      headers: sqHeaders(),
      body: JSON.stringify(body)
    });

    if (!sqRes.ok) {
      const err = await sqRes.text();
      return res.status(sqRes.status).json({ error: `Square [${sqRes.status}]: ${err.slice(0, 200)}` });
    }

    const data = await sqRes.json();
    const customers = data.customers || [];

    // Enrichir avec points fidélité si dispo
    let db;
    try { db = require('../memory/db'); } catch(e) { db = null; }

    const enriched = await Promise.all(customers.map(async (c) => {
      let points = 0;
      if (db) {
        try {
          const row = await db.query(
            'SELECT points FROM daleba_loyalty WHERE square_customer_id = $1 LIMIT 1',
            [c.id]
          );
          if (row.rows.length > 0) points = row.rows[0].points;
        } catch(e) {}
      }
      return { ...c, loyalty_points: points };
    }));

    res.json({
      customers: enriched,
      cursor: data.cursor || null,
      total: enriched.length
    });
  } catch (err) {
    console.error('[CRM] GET /clients error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ─── GET /api/crm/clients/:id ─────────────────────────────────────────────
// Fiche complète : infos Square + points fidélité + profil capillaire
router.get('/clients/:id', async (req, res) => {
  try {
    const { id } = req.params;

    // Infos client Square
    const sqRes = await fetch(`${SQUARE_BASE}/v2/customers/${id}`, {
      headers: sqHeaders()
    });
    if (!sqRes.ok) {
      const err = await sqRes.text();
      return res.status(sqRes.status).json({ error: `Square [${sqRes.status}]: ${err.slice(0, 200)}` });
    }
    const { customer } = await sqRes.json();

    // Points fidélité + profil capillaire
    let loyalty_points = 0;
    let hair_profile = null;
    let notes = customer.note || '';

    let db;
    try { db = require('../memory/db'); } catch(e) { db = null; }

    if (db) {
      // Fidélité
      try {
        const lRow = await db.query(
          'SELECT points, tier FROM daleba_loyalty WHERE square_customer_id = $1 LIMIT 1',
          [id]
        );
        if (lRow.rows.length > 0) {
          loyalty_points = lRow.rows[0].points;
        }
      } catch(e) {}

      // Profil capillaire
      try {
        const hRow = await db.query(
          'SELECT * FROM daleba_hair_profiles WHERE square_customer_id = $1 LIMIT 1',
          [id]
        );
        if (hRow.rows.length > 0) hair_profile = hRow.rows[0];
      } catch(e) {}
    }

    res.json({
      customer: { ...customer, loyalty_points, hair_profile, notes }
    });
  } catch (err) {
    console.error('[CRM] GET /clients/:id error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ─── GET /api/crm/clients/:id/appointments ──────────────────────────────
// Historique RDV Square
router.get('/clients/:id/appointments', async (req, res) => {
  try {
    const { id } = req.params;
    const params = new URLSearchParams({ customer_id: id, limit: '100' });
    if (LOCATION_ID) params.set('location_id', LOCATION_ID);

    const sqRes = await fetch(`${SQUARE_BASE}/v2/bookings?${params}`, {
      headers: sqHeaders()
    });
    if (!sqRes.ok) {
      const err = await sqRes.text();
      return res.status(sqRes.status).json({ error: `Square [${sqRes.status}]: ${err.slice(0, 200)}` });
    }
    const data = await sqRes.json();
    res.json({ appointments: data.bookings || [], cursor: data.cursor || null });
  } catch (err) {
    console.error('[CRM] GET /clients/:id/appointments error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ─── GET /api/crm/clients/:id/payments ──────────────────────────────────
// Historique paiements Square
router.get('/clients/:id/payments', async (req, res) => {
  try {
    const { id } = req.params;
    const params = new URLSearchParams({ customer_id: id, limit: '100' });
    if (LOCATION_ID) params.set('location_id', LOCATION_ID);

    const sqRes = await fetch(`${SQUARE_BASE}/v2/payments?${params}`, {
      headers: sqHeaders()
    });
    if (!sqRes.ok) {
      const err = await sqRes.text();
      return res.status(sqRes.status).json({ error: `Square [${sqRes.status}]: ${err.slice(0, 200)}` });
    }
    const data = await sqRes.json();
    res.json({ payments: data.payments || [], cursor: data.cursor || null });
  } catch (err) {
    console.error('[CRM] GET /clients/:id/payments error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ─── PATCH /api/crm/clients/:id/notes ────────────────────────────────────
// Sauvegarder notes via Square
router.patch('/clients/:id/notes', async (req, res) => {
  try {
    const { id } = req.params;
    const { note } = req.body;

    const sqRes = await fetch(`${SQUARE_BASE}/v2/customers/${id}`, {
      method: 'PUT',
      headers: sqHeaders(),
      body: JSON.stringify({ note })
    });
    if (!sqRes.ok) {
      const err = await sqRes.text();
      return res.status(sqRes.status).json({ error: `Square [${sqRes.status}]: ${err.slice(0, 200)}` });
    }
    const data = await sqRes.json();
    res.json({ ok: true, customer: data.customer });
  } catch (err) {
    console.error('[CRM] PATCH /clients/:id/notes error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
