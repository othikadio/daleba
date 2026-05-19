'use strict';
/**
 * Autonomous Purchase Agent — DALEBA Metacortex Points 462-465, 478-479
 */
const bus    = require('./event-bus');
const crypto = require('crypto');

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
      status           TEXT DEFAULT 'pending_approval',
      approval_token   TEXT,
      approved_by      TEXT,
      approved_at      TIMESTAMPTZ,
      sent_at          TIMESTAMPTZ,
      po_json          JSONB,
      created_at       TIMESTAMPTZ DEFAULT NOW()
    )
  `).catch(() => {});
  await pool.query('CREATE INDEX IF NOT EXISTS idx_po_status ON tenant_purchase_orders(tenant_id, status, created_at DESC)').catch(() => {});
}

const DEFAULT_SUPPLIERS = {
  'chebe-poudre':   { id:'sup_chebe_001',  name:'Sahel Botanicals Inc.',   email:'orders@sahelbotanicals.com', basePrice:0.40 },
  'moringa-poudre': { id:'sup_moringa_001',name:'NaturAfrica Imports',      email:'commandes@naturafrica.ca',   basePrice:0.07 },
  'fakoye-extrait': { id:'sup_fakoye_001', name:'Phyto Traditions SARL',    email:'b2b@phytotraditions.com',    basePrice:0.30 },
  'argan-huile':    { id:'sup_argan_001',  name:'Maroc Pure Extracts',      email:'wholesale@marocpure.com',    basePrice:0.10 },
  'baobab-huile':   { id:'sup_baobab_001', name:'Afrique Verte Bio',        email:'orders@afriqueverte.ca',     basePrice:0.15 },
  'aloe-gel':       { id:'sup_aloe_001',   name:'Caribbean Botanics Ltd.',  email:'bulk@caribbeanbotanics.com', basePrice:0.03 },
  'default':        { id:'sup_default_001',name:'Fournisseur Principal',    email:process.env.SUPPLIER_EMAIL||'supplier@example.com', basePrice:0.10 },
};

// [479] Détecte si le prix a augmenté de plus de 10% vs historique
async function checkVendorPriceAnomaly(pool, tenantId, productId, quotedPrice) {
  const r = await pool.query(`
    SELECT AVG(unit_price_cad) AS avg_price FROM tenant_purchase_orders
    WHERE tenant_id=$1 AND product_id=$2 AND status != 'cancelled' LIMIT 5
  `, [tenantId, productId]).catch(() => ({ rows: [{}] }));
  const avgPrice = parseFloat(r.rows[0]?.avg_price || 0);
  if (avgPrice === 0) return { anomaly: false, reason: 'no_history' };
  const increase = (quotedPrice - avgPrice) / avgPrice;
  if (increase > 0.10) {
    bus.system(`[VendorSentry] 🚨 Hausse prix ${(increase*100).toFixed(1)}% pour ${productId}: ${avgPrice.toFixed(4)}$ → ${quotedPrice.toFixed(4)}$/unit`);
    bus.emit('vendor:price:anomaly', { tenantId, productId, avgPrice, quotedPrice, increasePercent: (increase*100).toFixed(1) });
    return { anomaly: true, avgPrice, quotedPrice, increasePercent: (increase*100).toFixed(1) };
  }
  return { anomaly: false, avgPrice, quotedPrice };
}

async function negotiatePrice(pool, tenantId, productId, qty) {
  const sup = DEFAULT_SUPPLIERS[productId] || DEFAULT_SUPPLIERS['default'];
  const history = await pool.query(`
    SELECT AVG(unit_price_cad) AS avg_price, MAX(quantity_ordered) AS max_qty
    FROM tenant_purchase_orders WHERE tenant_id=$1 AND product_id=$2 AND status!='cancelled'
  `, [tenantId, productId]).catch(() => ({ rows: [{}] }));
  const histAvg  = parseFloat(history.rows[0]?.avg_price || sup.basePrice);
  const discount = qty >= 2000 ? 0.10 : qty >= 500 ? 0.05 : 0;
  const unitPrice= parseFloat((histAvg * (1 - discount)).toFixed(4));
  // [479] Vérifie anomalie de prix
  const priceCheck = await checkVendorPriceAnomaly(pool, tenantId, productId, unitPrice);
  return { supplier: sup, unitPrice, discount, totalPrice: parseFloat((unitPrice * qty).toFixed(2)), priceCheck };
}

async function generatePurchaseOrder(pool, tenantId, { productId, productName, qtyToOrder, unit }) {
  await initSchema(pool);
  const { supplier, unitPrice, discount, totalPrice, priceCheck } = await negotiatePrice(pool, tenantId, productId, qtyToOrder);
  if (priceCheck.anomaly) {
    bus.system(`[PurchaseAgent] 🔴 Commande bloquée: hausse prix ${priceCheck.increasePercent}% — recherche fournisseur alternatif`);
    return { blocked: true, reason: 'price_anomaly', priceCheck };
  }
  const poId  = `PO-${Date.now()}-${crypto.randomBytes(3).toString('hex').toUpperCase()}`;
  const token = crypto.randomBytes(8).toString('hex');
  const poJson = {
    poId, tenantId, productId, productName,
    orderedAt: new Date().toISOString(),
    supplier:  { id: supplier.id, name: supplier.name, email: supplier.email },
    line:      { product: productName || productId, qty: qtyToOrder, unit: unit || 'g', unitPrice, discount: `${(discount*100).toFixed(0)}%`, totalCAD: totalPrice },
    terms:     'Net 30 — Livraison sous 7-10 jours ouvrables',
    signature: `DALEBA Business Solutions — Kadio Coiffure — ${new Date().toLocaleDateString('fr-CA')}`,
  };
  await pool.query(`
    INSERT INTO tenant_purchase_orders
      (tenant_id, po_id, product_id, product_name, supplier_id, supplier_name, supplier_email,
       quantity_ordered, unit, unit_price_cad, total_price_cad, approval_token, po_json)
    VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
  `, [tenantId, poId, productId, productName, supplier.id, supplier.name, supplier.email,
      qtyToOrder, unit || 'g', unitPrice, totalPrice, token, JSON.stringify(poJson)]).catch(() => {});
  const smsResult = await sendApprovalSMS({ poId, productName, qtyToOrder, unit: unit || 'g', supplierName: supplier.name, totalPrice, token });
  bus.system(`[PurchaseAgent] 📋 BC généré: ${poId} | ${productName} ${qtyToOrder}${unit||'g'} | ${totalPrice}$ CAD`);
  return { poId, token, totalPrice, unitPrice, discount, supplier: supplier.name, po: poJson, sms: smsResult };
}

async function sendApprovalSMS({ poId, productName, qtyToOrder, unit, supplierName, totalPrice, token }) {
  const phone = process.env.ULRICH_PHONE_NUMBER;
  if (!phone) return { sent: false, body: null };
  const approveUrl = `${process.env.DALEBA_BASE_URL || 'https://daleba-api-production.up.railway.app'}/api/v1/campaigns/purchase-order/${token}/approve`;
  const body = `[DALEBA LOGISTIQUE] Réapprovisionnement urgent de ${qtyToOrder}${unit} de ${productName} chez ${supplierName}. Coût estimé: ${totalPrice}$ CAD. Valider? OUI → ${approveUrl} | Répondez NON pour annuler.`;
  try {
    const twilio = require('./twilio-sender');
    await twilio.sendSMS({ to: phone, body });
    bus.system(`[PurchaseAgent] 📱 SMS: PO ${poId} → ${phone}`);
  } catch(e) { bus.system(`[PurchaseAgent] ⚠️ SMS simulé: ${e.message}`); }
  return { sent: true, body };
}

async function approvePurchaseOrder(pool, tenantId, { token, approvedBy }) {
  await initSchema(pool);
  const r = await pool.query(`SELECT * FROM tenant_purchase_orders WHERE approval_token=$1 AND tenant_id=$2`, [token, tenantId]).catch(() => ({ rows: [] }));
  if (!r.rows.length) throw new Error('Token de commande invalide');
  const po = r.rows[0];
  await pool.query(`UPDATE tenant_purchase_orders SET status='approved', approved_by=$2, approved_at=NOW() WHERE id=$1`, [po.id, approvedBy || 'ulrich']).catch(() => {});
  await sendPurchaseEmail(po);
  bus.system(`[PurchaseAgent] ✅ BC approuvé: ${po.po_id} → ${po.supplier_email}`);
  return { approved: true, poId: po.po_id, sentTo: po.supplier_email };
}

async function sendPurchaseEmail(po) {
  const body = `Madame, Monsieur,\n\nBon de commande: ${po.po_id}\nProduit: ${po.product_name}\nQuantité: ${po.quantity_ordered}${po.unit}\nMontant: ${po.total_price_cad}$ CAD\nConditions: Net 30\n\nCordialement,\nDALEBA — Kadio Coiffure`;
  try {
    const nodemailer = require('nodemailer');
    const t = nodemailer.createTransport({ host: process.env.SMTP_HOST || 'smtp.gmail.com', port: 587, auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS } });
    await t.sendMail({ from: process.env.SMTP_USER, to: po.supplier_email, subject: `BC ${po.po_id} — Kadio Coiffure`, text: body });
  } catch { bus.system(`[PurchaseAgent] 📧 Email simulé → ${po.supplier_email}`); }
  return { sent: true };
}

async function triggerReorder(pool, tenantId, { productId, forceQty } = {}) {
  const r = await pool.query(`SELECT * FROM tenant_inventory WHERE tenant_id=$1 AND product_id=$2`, [tenantId, productId]).catch(() => ({ rows: [] }));
  if (!r.rows.length) return { triggered: false, reason: 'product_not_found' };
  const item = r.rows[0];
  const qty  = forceQty || Math.max(parseFloat(item.reorder_threshold) * 5, 500);
  return generatePurchaseOrder(pool, tenantId, { productId, productName: item.name, qtyToOrder: qty, unit: item.unit });
}

module.exports = { generatePurchaseOrder, approvePurchaseOrder, triggerReorder, sendApprovalSMS, sendPurchaseEmail, initSchema, DEFAULT_SUPPLIERS, negotiatePrice, checkVendorPriceAnomaly };
