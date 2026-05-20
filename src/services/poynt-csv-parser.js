'use strict';
/**
 * Poynt CSV Parser — DALEBA Section 14 [Option A]
 * ──────────────────────────────────────────────────────────────
 * Ingère les exports CSV du dashboard marchand Poynt/GoDaddy Payments.
 * Normalise chaque ligne → tenant_ledgers (amount_net, amount_gross, etc.)
 * Supporte 3 formats Poynt connus (v1, v2, GoDaddy Payments 2024).
 *
 * Utilisation:
 *   POST /api/v1/godaddy/upload-csv  (multipart/form-data, champ: csvFile)
 *   → Retourne { imported, skipped, duplicates, totalNet, report[] }
 */
const crypto = require('crypto');
const bus    = require('./event-bus');

// ── Formats CSV Poynt connus ─────────────────────────────────
const COLUMN_MAPS = {
  // Format Poynt classique (terminal physique)
  poynt_v1: {
    detect:    h => h.includes('Transaction ID') && h.includes('Net Amount'),
    id:        ['Transaction ID', 'transaction id', 'txn_id'],
    date:      ['Date', 'Transaction Date', 'date'],
    time:      ['Time', 'Transaction Time', 'time'],
    type:      ['Type', 'Transaction Type', 'type'],
    status:    ['Status', 'status'],
    gross:     ['Amount', 'Total Amount', 'amount'],
    tip:       ['Tip', 'Tip Amount', 'tip'],
    tax:       ['Tax', 'Tax Amount', 'tax'],
    net:       ['Net Amount', 'net_amount', 'net'],
    cardBrand: ['Card Brand', 'card_brand', 'Card Type'],
    last4:     ['Last 4', 'last_four', 'Card Last 4'],
    employee:  ['Employee', 'Cashier', 'employee'],
    note:      ['Note', 'Description', 'notes'],
  },
  // Format GoDaddy Payments 2023-2024
  godaddy_payments: {
    detect:    h => h.includes('Payment ID') || h.includes('GoDaddy'),
    id:        ['Payment ID', 'payment_id', 'Order ID'],
    date:      ['Date', 'Payment Date', 'Created Date'],
    time:      ['Time', 'Created Time'],
    type:      ['Type', 'Payment Type'],
    status:    ['Status', 'Payment Status'],
    gross:     ['Gross Amount', 'Amount', 'Total'],
    tip:       ['Tip', 'Gratuity'],
    tax:       ['Tax', 'Tax Amount'],
    net:       ['Net Amount', 'Settlement Amount'],
    cardBrand: ['Card Network', 'Card Type'],
    last4:     ['Last 4 Digits', 'Card Last 4'],
    employee:  ['Staff', 'Employee'],
    note:      ['Description', 'Item', 'Notes'],
  },
  // Format simplifié (export manuel)
  simple: {
    detect:    h => h.includes('amount') || h.includes('Amount'),
    id:        ['id', 'ID', 'ref', 'Ref'],
    date:      ['date', 'Date'],
    time:      ['time', 'Time'],
    type:      ['type', 'Type'],
    status:    ['status', 'Status'],
    gross:     ['amount', 'Amount', 'total', 'Total'],
    tip:       ['tip', 'Tip'],
    tax:       ['tax', 'Tax'],
    net:       ['net', 'Net', 'net_amount'],
    cardBrand: ['card', 'Card', 'payment_method'],
    last4:     ['last4', 'last_4'],
    employee:  ['employee', 'staff'],
    note:      ['note', 'description', 'service'],
  },
};

// ── Helpers ──────────────────────────────────────────────────

/**
 * Nettoie une valeur monétaire CSV → float
 * Gère: "$1,575.00", "1575", "-$45.00", "1 575,00 $" (fr-CA)
 */
function parseMoney(raw) {
  if (!raw && raw !== 0) return 0;
  const s = String(raw).replace(/[$\s€£]/g, '').replace(/,(?=\d{3})/g, '').replace(',', '.');
  const n = parseFloat(s);
  return isNaN(n) ? 0 : Math.round(n * 100) / 100;
}

/** Trouve la valeur d'une colonne par liste de noms candidats */
function getCol(row, candidates) {
  for (const c of candidates) {
    if (row[c] !== undefined && row[c] !== null && row[c] !== '') return row[c];
  }
  return null;
}

/** Détecte le format CSV à partir des headers */
function detectFormat(headers) {
  const hStr = headers.join(',');
  for (const [fmt, map] of Object.entries(COLUMN_MAPS)) {
    if (map.detect(hStr)) return { fmt, map };
  }
  return { fmt: 'simple', map: COLUMN_MAPS.simple };
}

/** Parse le CSV brut → tableau de lignes objet */
function parseCSVLines(csvText) {
  const lines   = csvText.replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n');
  const headers = [];
  let headerIdx = -1;

  // Trouver la ligne d'en-tête (cherche 'Amount' ou 'Date' dans les 5 premières lignes)
  for (let i = 0; i < Math.min(5, lines.length); i++) {
    const cols = splitCSVLine(lines[i]);
    if (cols.some(c => /amount|date|transaction|payment/i.test(c))) {
      headers.push(...cols.map(c => c.trim().replace(/^"(.*)"$/, '$1')));
      headerIdx = i;
      break;
    }
  }

  if (headerIdx === -1) throw new Error('Format CSV non reconnu — aucun en-tête trouvé dans les 5 premières lignes');

  const rows = [];
  for (let i = headerIdx + 1; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;
    const values = splitCSVLine(line).map(v => v.trim().replace(/^"(.*)"$/, '$1'));
    if (values.length < 2) continue;
    const row = {};
    headers.forEach((h, idx) => { row[h] = values[idx] || ''; });
    rows.push(row);
  }

  return { headers, rows };
}

/** Gère les virgules dans les valeurs entre guillemets */
function splitCSVLine(line) {
  const result = [];
  let current  = '';
  let inQuote  = false;
  for (const ch of line) {
    if (ch === '"') { inQuote = !inQuote; continue; }
    if (ch === ',' && !inQuote) { result.push(current); current = ''; continue; }
    current += ch;
  }
  result.push(current);
  return result;
}

// ── Parseur principal ─────────────────────────────────────────

/**
 * Parse un fichier CSV Poynt complet
 * @param {string} csvText  — Contenu brut du fichier CSV
 * @param {object} options  — { tenantId, source, deduplicate }
 * @returns {object} { transactions[], stats }
 */
function parsePoyntCSV(csvText, options = {}) {
  const { tenantId = 'default', source = 'poynt_csv' } = options;

  const { headers, rows } = parseCSVLines(csvText);
  const { fmt, map }      = detectFormat(headers);
  bus.system(`[PoyntCSV] Format détecté: ${fmt} — ${rows.length} lignes`);

  const transactions = [];
  const errors       = [];

  for (const [idx, row] of rows.entries()) {
    try {
      const rawId    = getCol(row, map.id)     || `csv-${crypto.randomBytes(4).toString('hex')}`;
      const rawDate  = getCol(row, map.date)   || '';
      const rawTime  = getCol(row, map.time)   || '00:00:00';
      const type     = (getCol(row, map.type)  || 'SALE').toUpperCase();
      const status   = (getCol(row, map.status)|| 'CAPTURED').toUpperCase();
      const gross    = parseMoney(getCol(row, map.gross));
      const tip      = parseMoney(getCol(row, map.tip));
      const tax      = parseMoney(getCol(row, map.tax));
      const rawNet   = parseMoney(getCol(row, map.net));

      // Net = valeur CSV si dispo, sinon calculé (gross - tip - tax)
      // Commission sur amount_net (HT) — jamais sur brut TTC
      const net = rawNet !== 0 ? rawNet : Math.round((gross - tip - tax) * 100) / 100;

      // Ignorer les lignes vides ou sans montant
      if (gross === 0 && net === 0) continue;

      // Générer un hash déterministe pour déduplication
      const dedupeHash = crypto.createHash('sha256')
        .update(`${tenantId}:${rawId}:${rawDate}:${gross}`)
        .digest('hex').slice(0, 16);

      const employee    = getCol(row, map.employee) || '';
      const note        = getCol(row, map.note)     || '';
      const cardBrand   = getCol(row, map.cardBrand)|| '';
      const last4       = getCol(row, map.last4)    || '';

      // Date ISO
      let txDate = null;
      if (rawDate) {
        const d = new Date(`${rawDate} ${rawTime}`);
        txDate = isNaN(d) ? new Date().toISOString() : d.toISOString();
      } else {
        txDate = new Date().toISOString();
      }

      const description = [note, employee, cardBrand ? `${cardBrand} ****${last4}` : '']
        .filter(Boolean).join(' — ') || 'Poynt Transaction';

      transactions.push({
        tenantId,
        externalId:   rawId,
        dedupeHash,
        source,
        format:       fmt,
        type,          // SALE | REFUND | VOID
        status,        // CAPTURED | REFUNDED | VOIDED
        amountGross:   gross,
        amountTip:     tip,
        amountTax:     tax,
        amountNet:     net,   // ← utilisé pour commissions (jamais brut)
        currency:     'CAD',
        txDate,
        description,
        employee,
        cardBrand,
        last4,
        rawRow:        row,
      });

    } catch(e) {
      errors.push({ line: idx + 2, error: e.message });
    }
  }

  const stats = buildStats(transactions);
  bus.system(`[PoyntCSV] ✅ ${transactions.length} transactions parsées | Net total: ${stats.totalNet.toFixed(2)} $CAD`);

  return { transactions, stats, errors, format: fmt };
}

function buildStats(txs) {
  const sales   = txs.filter(t => t.type !== 'REFUND' && t.type !== 'VOID' && t.amountGross >= 0);
  const refunds = txs.filter(t => t.type === 'REFUND'  || t.amountGross < 0);

  return {
    total:          txs.length,
    salesCount:     sales.length,
    refundsCount:   refunds.length,
    totalGross:     Math.round(sales.reduce((s, t) => s + t.amountGross, 0) * 100) / 100,
    totalNet:       Math.round(sales.reduce((s, t) => s + t.amountNet,   0) * 100) / 100,
    totalTips:      Math.round(sales.reduce((s, t) => s + t.amountTip,   0) * 100) / 100,
    totalTax:       Math.round(sales.reduce((s, t) => s + t.amountTax,   0) * 100) / 100,
    totalRefunds:   Math.round(refunds.reduce((s, t) => s + Math.abs(t.amountGross), 0) * 100) / 100,
    avgTransaction: sales.length ? Math.round(sales.reduce((s,t)=>s+t.amountGross,0)/sales.length*100)/100 : 0,
    byEmployee:     groupBy(sales, 'employee'),
  };
}

function groupBy(arr, key) {
  return arr.reduce((acc, t) => {
    const k = t[key] || 'N/A';
    if (!acc[k]) acc[k] = { count: 0, net: 0 };
    acc[k].count++;
    acc[k].net = Math.round((acc[k].net + t.amountNet) * 100) / 100;
    return acc;
  }, {});
}

// ── Persistance PostgreSQL ────────────────────────────────────

/**
 * Insère les transactions parsées dans tenant_ledgers
 * @returns { imported, duplicates, errors }
 */
async function persistTransactions(pool, transactions) {
  if (!pool?.query || !transactions?.length) return { imported: 0, duplicates: 0, errors: 0 };

  let imported = 0, duplicates = 0, errors = 0;

  for (const tx of transactions) {
    try {
      const result = await pool.query(`
        INSERT INTO tenant_ledgers
          (tenant_id, external_id, source, amount_gross, amount_net,
           currency, description, status, tx_date)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
        ON CONFLICT (tenant_id, external_id) DO NOTHING
      `, [
        tx.tenantId, tx.externalId, tx.source,
        tx.amountGross, tx.amountNet,
        tx.currency, tx.description,
        tx.status.toLowerCase(), tx.txDate,
      ]);

      if (result.rowCount > 0) {
        imported++;
        bus.emit('poynt:transaction:imported', {
          tenantId: tx.tenantId, id: tx.externalId,
          net: tx.amountNet, gross: tx.amountGross, date: tx.txDate,
        });
      } else {
        duplicates++;
      }
    } catch(e) {
      errors++;
      bus.system(`[PoyntCSV] ⚠️ Erreur persist ${tx.externalId}: ${e.message}`);
    }
  }

  bus.system(`[PoyntCSV] DB: ${imported} importées | ${duplicates} doublons ignorés | ${errors} erreurs`);
  return { imported, duplicates, errors };
}

module.exports = { parsePoyntCSV, persistTransactions, parseMoney, buildStats };
