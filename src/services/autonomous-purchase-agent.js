'use strict';
/**
 * Autonomous Purchase Agent — DALEBA Metacortex Points 462-465
 * [462] Génère un bon de commande professionnel pour les ingrédients REORDER_REQUIRED
 * [463] Négociation automatique de volume (seuils: 250g=3%, 500g=5%, 1000g=8%)
 * [464] SMS Ulrich avec token approbation 1-clic
 * [465] Approbation en DB + confirmation
 */
const bus    = require('./event-bus');
const crypto = require('crypto');

// Fournisseurs par défaut par ingrédient botanique
const DEFAULT_SUPPLIERS = {
  'chebe-poudre':    { name: 'Sahel Botanicals Inc.',    email: 'orders@sahel-botanicals.com',    basePrice: 0.45, minOrder: 100,  unit: 'g'  },
  'moringa-poudre':  { name: 'AfriNature Export Ltd.',   email: 'supply@afrinature.com',          basePrice: 0.08, minOrder: 500,  unit: 'g'  },
  'fakoye-extrait':  { name: 'Sahel Botanicals Inc.',    email: 'orders@sahel-botanicals.com',    basePrice: 0.35, minOrder: 100,  unit: 'ml' },
  'argan-huile':     { name: 'Maroc Premium Oils',       email: 'export@marocpremium.ma',         basePrice: 0.12, minOrder: 500,  unit: 'ml' },
  'aloe-gel':        { name: 'Tropicals Direct Canada',  email: 'b2b@tropicalsdirect.ca',         basePrice: 0.04, minOrder: 1000, unit: 'ml' },
  'baobab-huile':    { name: 'West Africa Naturals',     email: 'wholesale@wanaturals.com',       basePrice: 0.18, minOrder: 250,  unit: 'ml' },
  'hibiscus-poudre': { name: 'AfriNature Export Ltd.',   email: 'supply@afrinature.com',          basePrice: 0.06, minOrder: 500,  unit: 'g'  },
  'jojoba-huile':    { name: 'Maroc Premium Oils',       email: 'export@marocpremium.ma',         basePrice: 0.14, minOrder: 500,  unit: 'ml' },
  '_default':        { name: 'Botanical Supply Co.',     email: 'orders@botanicalsupply.ca',      basePrice: 0.10, minOrder: 200,  unit: 'g'  },
};

// [463] Barème remises volume
const VOLUME_DISCOUNTS = [
  { minQty: 1000, discount: 0.08 },
  { minQty: 500,  discount: 0.05 },
  { minQty: 250,  discount: 0.03 },
];

async function initSchema(pool) {
  if (!pool?.query) return;
  await pool.query(`
    CREATE TABLE IF NOT EXISTS tenant_purchase_orders (
      id               SERIAL PRIMARY KEY,
      tenant_id        TEXT NOT NULL,
      po_id            TEXT UNIQUE,
      product_id       TEXT,
      product_name     TEXT,
      supplier_id      TEXT,
      supplier_name    TEXT,
      supplier_email   TEXT,
      quantity_ordered NUMERIC(10,2),
      unit             TEXT,
      unit_price_cad   NUMERIC(10,4),
      total_price_cad  NUMERIC(10,2),
      approval_token   TEXT UNIQUE,
      status           TEXT DEFAULT 'pending_approval', -- pending_approval | approved | rejected | sent
      approved_by      TEXT,
      po_json          JSONB,
      created_at       TIMESTAMPTZ DEFAULT NOW(),
      approved_at      TIMESTAMPTZ
    )
  `).catch(() => {});
  await pool.query('CREATE INDEX IF NOT EXISTS idx_po_tenant ON tenant_purchase_orders(tenant_id, status)').catch(() => {});
  await pool.query('CREATE INDEX IF NOT EXISTS idx_po_token  ON tenant_purchase_orders(approval_token)').catch(() => {});
}

/**
 * [463] Calcule le prix unitaire négocié selon le volume commandé
 */
function negotiatePrice(basePrice, qty) {
  const tier = VOLUME_DISCOUNTS.find(t => qty >= t.minQty);
  const discount = tier ? tier.discount : 0;
  const unitPrice = parseFloat((basePrice * (1 - discount)).toFixed(4));
  return { unitPrice, discount, basePrice };
}

/**
 * [462-463] Génère un bon de commande professionnel
 */
async function generatePurchaseOrder(pool, tenantId, { productId, productName, qtyToOrder, unit }) {
  await initSchema(pool);

  const supplier = DEFAULT_SUPPLIERS[productId] || { ...DEFAULT_SUPPLIERS['_default'], unit: unit || 'g' };
  const { unitPrice, discount } = negotiatePrice(supplier.basePrice, qtyToOrder);
  const totalPrice = parseFloat((unitPrice * qtyToOrder).toFixed(2));
  const poId       = `PO-${Date.now()}-${crypto.randomBytes(3).toString('hex').toUpperCase()}`;
  const token      = crypto.randomBytes(16).toString('hex');
  const supplierId = supplier.name.toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '');

  const poObj = {
    poId,
    tenantId,
    productId,
    productName: productName || productId,
    supplier:    supplier.name,
    supplierEmail: supplier.email,
    qtyToOrder,
    unit:        unit || supplier.unit,
    unitPrice,
    totalPrice,
    discount,
    currency:    'CAD',
    createdAt:   new Date().toISOString(),
    status:      'pending_approval',
  };

  await pool.query(`
    INSERT INTO tenant_purchase_orders
    (tenant_id, po_id, product_id, product_name, supplier_id, supplier_name, supplier_email,
     quantity_ordered, unit, unit_price_cad, total_price_cad, approval_token, status, po_json)
    VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,'pending_approval',$13)
    ON CONFLICT (po_id) DO NOTHING
  `, [tenantId, poId, productId, poObj.productName, supplierId, supplier.name, supplier.email,
      qtyToOrder, unit || supplier.unit, unitPrice, totalPrice, token, JSON.stringify(poObj)]
  ).catch(() => {});

  bus.system(`[PurchaseAgent] 📋 PO généré: ${poId} | ${productName} × ${qtyToOrder}${unit} | ${totalPrice}$ CAD (remise ${(discount*100).toFixed(0)}%)`);

  return {
    poId,
    supplier: supplier.name,
    supplierEmail: supplier.email,
    qtyToOrder,
    unitPrice,
    totalPrice,
    discount,
    token,
    po: poObj,
    status: 'pending_approval',
  };
}

/**
 * [464] Envoie SMS Ulrich pour approbation 1-clic
 * Construit le corps du SMS (envoi réel via Twilio si configuré)
 */
async function sendApprovalSMS({ poId, productName, qtyToOrder, unit, supplierName, totalPrice, token }) {
  const approvalUrl = `${process.env.BASE_URL || 'https://daleba.app'}/api/v1/purchase-order/approve/${token}`;
  const body = `[DALEBA LOGISTIQUE] 📦 BC #${poId}\n${qtyToOrder}${unit} ${productName}\nFournisseur: ${supplierName}\nTotal: ${totalPrice}$ CAD\n\nValider: ${approvalUrl}\nRépondre OUI pour approuver.`;

  bus.system(`[PurchaseAgent] 📱 SMS approbation → Ulrich: ${poId}`);

  // Envoi Twilio si configuré
  if (process.env.TWILIO_ACCOUNT_SID && process.env.TWILIO_AUTH_TOKEN && process.env.ULRICH_PHONE_NUMBER) {
    try {
      const twilio = require('twilio')(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN);
      await twilio.messages.create({
        body,
        from: process.env.TWILIO_PHONE_NUMBER || '+13022328291',
        to:   process.env.ULRICH_PHONE_NUMBER,
      });
      return { sent: true, body, via: 'twilio' };
    } catch (e) {
      bus.system(`[PurchaseAgent] ⚠️ Twilio error: ${e.message}`);
    }
  }

  return { sent: false, body, via: 'simulated' };
}

/**
 * [465] Approuve un bon de commande via token
 */
async function approvePurchaseOrder(pool, tenantId, { token, approvedBy = 'ulrich' }) {
  await initSchema(pool);
  const r = await pool.query(
    `SELECT * FROM tenant_purchase_orders WHERE approval_token=$1 AND tenant_id=$2`,
    [token, tenantId]
  ).catch(() => ({ rows: [] }));

  if (!r.rows[0]) return { approved: false, reason: 'Token introuvable ou expiré' };
  const po = r.rows[0];

  await pool.query(
    `UPDATE tenant_purchase_orders SET status='approved', approved_by=$2, approved_at=NOW() WHERE id=$1`,
    [po.id, approvedBy]
  ).catch(() => {});

  bus.system(`[PurchaseAgent] ✅ BC approuvé: ${po.po_id} par ${approvedBy}`);
  bus.emit('purchase_order:approved', { tenantId, poId: po.po_id, productId: po.product_id, approvedBy });

  return { approved: true, poId: po.po_id, productId: po.product_id, totalPrice: po.total_price_cad, approvedBy };
}

/**
 * [461-462] Déclenche automatiquement un réapprovisionnement pour un produit REORDER_REQUIRED
 */
async function triggerReorder(pool, tenantId, { productId }) {
  const stock = require('./dynamic-stock-tracker');
  await stock.initSchema(pool);

  const r = await pool.query(
    `SELECT * FROM tenant_inventory WHERE tenant_id=$1 AND product_id=$2`,
    [tenantId, productId]
  ).catch(() => ({ rows: [] }));

  if (!r.rows[0]) return { triggered: false, reason: 'Produit introuvable' };
  const item = r.rows[0];

  if (!['REORDER_REQUIRED', 'low', 'out_of_stock'].includes(item.status)) {
    return { triggered: false, reason: `Statut actuel: ${item.status} (pas de réapprovisionnement requis)` };
  }

  const supplier = DEFAULT_SUPPLIERS[productId] || DEFAULT_SUPPLIERS['_default'];
  const qtyToOrder = Math.max(supplier.minOrder, parseFloat(item.reorder_threshold) * 5);
  const po = await generatePurchaseOrder(pool, tenantId, {
    productId,
    productName: item.name,
    qtyToOrder,
    unit: item.unit || supplier.unit,
  });

  // Envoie SMS si Ulrich est configuré
  await sendApprovalSMS({
    poId:         po.poId,
    productName:  item.name,
    qtyToOrder,
    unit:         item.unit || supplier.unit,
    supplierName: po.supplier,
    totalPrice:   po.totalPrice,
    token:        po.token,
  }).catch(() => {});

  bus.system(`[PurchaseAgent] 🔁 triggerReorder: ${productId} → ${po.poId}`);
  return { triggered: true, poId: po.poId, productId, qtyOrdered: qtyToOrder, totalPrice: po.totalPrice };
}

module.exports = {
  generatePurchaseOrder,
  sendApprovalSMS,
  approvePurchaseOrder,
  triggerReorder,
  negotiatePrice,
  DEFAULT_SUPPLIERS,
  VOLUME_DISCOUNTS,
  initSchema,
};
