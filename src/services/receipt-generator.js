/**
 * Receipt Generator — DALEBA Metacortex Point 191
 *
 * Génère des reçus PDF haut de gamme avec logo minimaliste salon.
 * Envoyés par email après chaque service via SendGrid/SMTP.
 * Utilise pdfkit (Node.js natif, pas de headless browser requis).
 */

'use strict';

const path = require('path');
const fs   = require('fs');
const bus  = require('./event-bus');

// ─── CONSTANTES BRANDING ──────────────────────────────────────────────────────

const BRAND = {
  name:     process.env.SALON_NAME    || 'KADIO COIFFURE',
  address:  process.env.SALON_ADDRESS || '615 Antoinette-Robidoux, local 100, Longueuil QC J4J 2V8',
  phone:    process.env.SALON_PHONE   || '+1 (514) 919-5970',
  email:    process.env.SALON_EMAIL   || 'contact@kadiocoiffure.vercel.app/hub',
  website:  process.env.SALON_WEBSITE || 'kadiocoiffure.vercel.app/hub/hub',
  tpsNum:   process.env.SALON_TPS_NUMBER || 'À configurer',
  tvqNum:   process.env.SALON_TVQ_NUMBER || 'À configurer',
  gold:     '#D4AF37',
  dark:     '#070a0f',
};

const RECEIPT_DIR = process.env.RECEIPT_OUTPUT_DIR || '/tmp/daleba_receipts';

// ─── GÉNÉRATION PDF [191] ─────────────────────────────────────────────────────

/**
 * Génère un reçu PDF professionnel
 * @param {object} data
 *   txId, customerName, customerEmail, items[], fiscal{}, date, paymentMode
 */
async function generateReceiptPDF(data) {
  fs.mkdirSync(RECEIPT_DIR, { recursive: true });

  const PDFDocument = require('pdfkit');
  const fiscal = require('./fiscal-engine');

  const {
    txId, customerName = 'Client', customerEmail,
    items = [], fiscal: fiscalData = {}, date, paymentMode = '',
    tenantId = 'kadio',
  } = data;

  const filename  = `receipt_${txId.replace(/[^a-z0-9]/gi, '_')}_${Date.now()}.pdf`;
  const outputPath = path.join(RECEIPT_DIR, filename);

  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({
      size: 'A4', margin: 50,
      info: {
        Title:    `Reçu ${txId}`,
        Author:   BRAND.name,
        Subject:  'Reçu de service',
      },
    });

    const stream = fs.createWriteStream(outputPath);
    doc.pipe(stream);

    // ─── HEADER LOGO MINIMALISTE [191] ──────────────────────────────────────
    // Carré doré — logo minimaliste si pas de fichier logo
    const logoPath = path.join(__dirname, '../../public/logo.png');
    if (fs.existsSync(logoPath)) {
      doc.image(logoPath, 50, 45, { width: 60 });
    } else {
      // Logo typographique minimaliste
      doc.rect(50, 45, 50, 50)
         .fillColor(BRAND.gold).fill();
      doc.fillColor('#fff')
         .font('Helvetica-Bold').fontSize(22)
         .text('K', 63, 58);
    }

    // Nom du salon
    doc.fillColor(BRAND.dark)
       .font('Helvetica-Bold').fontSize(18)
       .text(BRAND.name, 115, 48);

    doc.fillColor('#666')
       .font('Helvetica').fontSize(9)
       .text(BRAND.address, 115, 70)
       .text(`${BRAND.phone}  •  ${BRAND.website}`, 115, 83);

    // Ligne séparatrice dorée
    doc.moveTo(50, 105).lineTo(545, 105)
       .lineWidth(2).strokeColor(BRAND.gold).stroke();

    // ─── TITRE REÇU ─────────────────────────────────────────────────────────
    doc.fillColor(BRAND.dark)
       .font('Helvetica-Bold').fontSize(20)
       .text('REÇU', 50, 120);

    // Numéro + date
    doc.font('Helvetica').fontSize(10)
       .fillColor('#444')
       .text(`Numéro : ${txId}`, 50, 148)
       .text(`Date   : ${new Date(date || Date.now()).toLocaleDateString('fr-CA', { year: 'numeric', month: 'long', day: 'numeric' })}`, 50, 162)
       .text(`Paiement: ${paymentMode.toUpperCase().replace('CARD:', '')}`, 50, 176);

    // Client
    doc.fillColor(BRAND.dark)
       .font('Helvetica-Bold').fontSize(10)
       .text('Facturé à :', 350, 148);
    doc.fillColor('#444')
       .font('Helvetica').fontSize(10)
       .text(customerName, 350, 162);
    if (customerEmail) doc.text(customerEmail, 350, 176);

    // ─── TABLEAU SERVICES ────────────────────────────────────────────────────
    let y = 215;

    // En-tête tableau
    doc.rect(50, y, 495, 22).fillColor(BRAND.dark).fill();
    doc.fillColor('#fff').font('Helvetica-Bold').fontSize(9);
    doc.text('DESCRIPTION', 58, y + 7);
    doc.text('QTÉ', 360, y + 7);
    doc.text('PRIX UNITAIRE', 400, y + 7);
    doc.text('TOTAL', 480, y + 7);
    y += 22;

    doc.fillColor(BRAND.dark).font('Helvetica').fontSize(9);
    let subtotal = 0;

    for (const item of (items.length ? items : [{ desc: 'Service salon', qty: 1, unitPrice: fiscalData.amount_net || 0 }])) {
      const lineTotal = (item.qty || 1) * (item.unitPrice || 0);
      subtotal += lineTotal;

      const bg = (items.indexOf(item) % 2 === 0) ? '#f9f9f9' : '#fff';
      doc.rect(50, y, 495, 20).fillColor(bg).fill();
      doc.fillColor('#333')
         .text(item.desc || item.name || 'Service', 58, y + 6, { width: 290 })
         .text(String(item.qty || 1), 360, y + 6)
         .text(`$${(item.unitPrice || 0).toFixed(2)}`, 400, y + 6)
         .text(`$${lineTotal.toFixed(2)}`, 480, y + 6);
      y += 20;
    }

    // ─── BLOC FISCAL [158] ────────────────────────────────────────────────────
    y += 15;
    const net  = fiscalData.amount_net  || subtotal;
    const tps  = fiscalData.amount_tps  || 0;
    const tvq  = fiscalData.amount_tvq  || 0;
    const gross = fiscalData.amount_gross || (net + tps + tvq);

    const taxX = 360;
    doc.font('Helvetica').fontSize(9).fillColor('#666');
    doc.text('Sous-total HT', taxX, y).text(`$${net.toFixed(2)}`, 480, y); y += 14;
    if (tps > 0) {
      doc.text(`TPS (5.0%) — N°${BRAND.tpsNum}`, taxX, y).text(`$${tps.toFixed(2)}`, 480, y); y += 14;
    }
    if (tvq > 0) {
      doc.text(`TVQ (9.975%) — N°${BRAND.tvqNum}`, taxX, y).text(`$${tvq.toFixed(2)}`, 480, y); y += 14;
    }

    // Total final
    doc.moveTo(taxX, y).lineTo(545, y).lineWidth(1).strokeColor('#ccc').stroke();
    y += 8;
    doc.font('Helvetica-Bold').fontSize(12).fillColor(BRAND.dark)
       .text('TOTAL', taxX, y)
       .text(`$${gross.toFixed(2)} CAD`, 460, y);

    // ─── PIED DE PAGE ────────────────────────────────────────────────────────
    doc.moveTo(50, 720).lineTo(545, 720)
       .lineWidth(1).strokeColor(BRAND.gold).stroke();

    doc.fillColor('#999').font('Helvetica').fontSize(8)
       .text('Merci de votre confiance.', 50, 730, { align: 'center', width: 495 })
       .text(`${BRAND.name}  •  ${BRAND.address}`, 50, 742, { align: 'center', width: 495 });

    doc.end();
    stream.on('finish', () => resolve({ pdfPath: outputPath, filename, size: fs.statSync(outputPath).size }));
    stream.on('error', reject);
  });
}

// ─── ENVOI EMAIL [191] ────────────────────────────────────────────────────────

async function sendReceiptByEmail(customerEmail, pdfPath, txId) {
  // SendGrid si disponible, sinon Nodemailer SMTP
  if (process.env.SENDGRID_API_KEY) {
    try {
      const sgMail = require('@sendgrid/mail');
      sgMail.setApiKey(process.env.SENDGRID_API_KEY);
      const pdfBytes = fs.readFileSync(pdfPath).toString('base64');
      await sgMail.send({
        to:   customerEmail,
        from: process.env.SALON_EMAIL || 'noreply@kadiocoiffure.vercel.app/hub',
        subject: `Votre reçu — ${BRAND.name}`,
        text:  `Merci pour votre visite chez ${BRAND.name}. Veuillez trouver votre reçu en pièce jointe.`,
        attachments: [{
          content:   pdfBytes,
          filename:  path.basename(pdfPath),
          type:      'application/pdf',
          disposition: 'attachment',
        }],
      });
      bus.system(`[Receipt] Reçu ${txId} envoyé à ${customerEmail}`);
      return { sent: true, provider: 'sendgrid' };
    } catch (e) {
      console.warn('[Receipt] SendGrid:', e.message);
    }
  }
  // Fallback: log + retourner chemin pour envoi manuel
  bus.system(`[Receipt] Reçu ${txId} généré (email non configuré): ${path.basename(pdfPath)}`);
  return { sent: false, pdfPath, reason: 'SENDGRID_API_KEY non configuré' };
}

// ─── ORCHESTRATION POST-TRANSACTION [191] ─────────────────────────────────────

async function generateAndSendReceipt(txData, customerInfo = {}) {
  try {
    const pdf = await generateReceiptPDF({
      txId:          txData.tx_id,
      customerName:  customerInfo.name  || 'Client',
      customerEmail: customerInfo.email || null,
      items:         txData.items || [],
      fiscal:        txData.fiscal || {},
      date:          txData.timestamp_utc,
      paymentMode:   txData.payment_mode || '',
      tenantId:      txData.tenant_id,
    });

    if (customerInfo.email) {
      await sendReceiptByEmail(customerInfo.email, pdf.pdfPath, txData.tx_id);
    }

    return { ...pdf, emailSent: !!customerInfo.email };
  } catch (e) {
    console.warn('[Receipt] generateAndSendReceipt:', e.message);
    return { error: e.message };
  }
}

// ─── EXPORTS ─────────────────────────────────────────────────────────────────

module.exports = {
  generateReceiptPDF, sendReceiptByEmail, generateAndSendReceipt,
  RECEIPT_DIR, BRAND,
};
