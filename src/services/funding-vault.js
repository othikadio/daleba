'use strict';
/**
 * Funding Vault — DALEBA [509]
 * Coffre-fort chiffré AES-256-GCM pour documents d'entreprise
 * NEQ, statuts de constitution, états financiers, pièces d'identité masquées
 */
const bus    = require('./event-bus');
const crypto = require('crypto');

const ALGO     = 'aes-256-gcm';
const KEY_LEN  = 32;

// Clé dérivée de la variable Railway VAULT_ENCRYPTION_KEY (doit être 32 chars)
function getVaultKey() {
  const raw = process.env.VAULT_ENCRYPTION_KEY || 'daleba-vault-key-32-chars-pad!xx';
  return Buffer.alloc(KEY_LEN, raw.padEnd(KEY_LEN, '!').slice(0, KEY_LEN));
}

// [509] Chiffrement AES-256-GCM
function encrypt(plaintext) {
  const iv     = crypto.randomBytes(12);
  const key    = getVaultKey();
  const cipher = crypto.createCipheriv(ALGO, key, iv);
  const enc    = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const tag    = cipher.getAuthTag();
  return `${iv.toString('hex')}:${enc.toString('hex')}:${tag.toString('hex')}`;
}

function decrypt(ciphertext) {
  const [ivHex, encHex, tagHex] = ciphertext.split(':');
  const key    = getVaultKey();
  const iv     = Buffer.from(ivHex, 'hex');
  const enc    = Buffer.from(encHex, 'hex');
  const tag    = Buffer.from(tagHex, 'hex');
  const decipher = crypto.createDecipheriv(ALGO, key, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(enc), decipher.final()]).toString('utf8');
}

// Masque les données d'identité dans les logs [509]
function maskIdentityData(content) {
  return content
    .replace(/\b\d{9}\b/g, '***NEQ***')        // NEQ 9 chiffres
    .replace(/\b\d{3}-\d{2}-\d{4}\b/g, '***') // SIN
    .replace(/(?<=\d{3})\d{4}(?=\d{4})/g, '****'); // numéros de cartes
}

async function initSchema(pool) {
  if (!pool?.query) return;
  await pool.query(`
    CREATE TABLE IF NOT EXISTS tenant_funding_documents (
      id            SERIAL PRIMARY KEY,
      tenant_id     TEXT NOT NULL,
      doc_id        TEXT UNIQUE NOT NULL,
      doc_type      TEXT NOT NULL,  -- neq | statuts | etats_financiers | identite | autre
      filename      TEXT,
      encrypted_content TEXT,      -- AES-256-GCM chiffré
      size_bytes    INTEGER,
      checksum      TEXT,
      created_at    TIMESTAMPTZ DEFAULT NOW()
    )
  `).catch(() => {});
  await pool.query('CREATE INDEX IF NOT EXISTS idx_vault_tenant ON tenant_funding_documents(tenant_id, doc_type)').catch(() => {});
}

/**
 * [509] Stocke un document chiffré dans le coffre-fort
 */
async function storeDocument(pool, tenantId, { docType, filename, content }) {
  await initSchema(pool);
  const docId   = `DOC-${Date.now()}-${crypto.randomBytes(3).toString('hex').toUpperCase()}`;
  const masked  = maskIdentityData(content);
  const encrypted = encrypt(content);
  const checksum  = crypto.createHash('sha256').update(content).digest('hex').slice(0, 16);

  await pool.query(`
    INSERT INTO tenant_funding_documents (tenant_id, doc_id, doc_type, filename, encrypted_content, size_bytes, checksum)
    VALUES ($1,$2,$3,$4,$5,$6,$7)
  `, [tenantId, docId, docType, filename, encrypted, content.length, checksum]).catch(() => {});

  bus.system(`[Vault] 🔒 Document stocké: ${docType}/${filename} (${content.length} chars, checksum: ${checksum})`);
  return { docId, docType, filename, checksum, sizeBytes: content.length };
}

/**
 * [509] Récupère et déchiffre un document
 */
async function retrieveDocument(pool, tenantId, docId) {
  await initSchema(pool);
  const r = await pool.query(
    `SELECT * FROM tenant_funding_documents WHERE tenant_id=$1 AND doc_id=$2`,
    [tenantId, docId]
  ).catch(() => ({ rows: [] }));

  if (!r.rows[0]) throw new Error(`Document ${docId} introuvable`);
  const doc = r.rows[0];
  const content = decrypt(doc.encrypted_content);
  bus.system(`[Vault] 🔓 Document récupéré: ${doc.doc_type}/${doc.filename}`);
  return { docId, docType: doc.doc_type, filename: doc.filename, content, checksum: doc.checksum };
}

/**
 * Liste les documents sans déchiffrement (métadonnées uniquement)
 */
async function listDocuments(pool, tenantId) {
  await initSchema(pool);
  const r = await pool.query(
    `SELECT doc_id, doc_type, filename, size_bytes, checksum, created_at FROM tenant_funding_documents WHERE tenant_id=$1 ORDER BY created_at DESC`,
    [tenantId]
  ).catch(() => ({ rows: [] }));
  return r.rows;
}

module.exports = { storeDocument, retrieveDocument, listDocuments, encrypt, decrypt, maskIdentityData, initSchema };
