'use strict';
/**
 * Image Compressor — DALEBA Metacortex Point 377
 * Compression côté serveur: max 1200px, WebP 80%, purge auto [386].
 */
const bus  = require('./event-bus');
const path = require('path');
const fs   = require('fs');

const UPLOAD_TMP_DIR  = '/tmp/daleba-skin-uploads';
const MAX_PX          = 1200;
const WEBP_QUALITY    = 80;

function ensureDir(dir) { if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true }); }

/**
 * [377] Compresse et redimensionne une image base64 → Buffer WebP
 * Utilise Sharp si disponible, sinon retourne l'image originale.
 */
async function compressImage(imageBase64) {
  const raw = imageBase64.replace(/^data:image\/\w+;base64,/, '');
  const buf = Buffer.from(raw, 'base64');

  try {
    const sharp = require('sharp');
    const result = await sharp(buf)
      .resize(MAX_PX, MAX_PX, { fit: 'inside', withoutEnlargement: true })
      .webp({ quality: WEBP_QUALITY })
      .toBuffer();

    const originalKb  = buf.length     / 1024;
    const compressedKb = result.length / 1024;
    const reduction    = Math.round((1 - compressedKb / originalKb) * 100);
    bus.system(`[ImageCompressor] ✅ Compression: ${originalKb.toFixed(0)}Ko → ${compressedKb.toFixed(0)}Ko (${reduction}% réduit, WebP ${WEBP_QUALITY}%)`);

    return { buffer: result, mimeType: 'image/webp', originalKb, compressedKb, reduction };
  } catch {
    // Sharp non disponible — retourne original (mode dégradé)
    bus.system('[ImageCompressor] ⚠️ Sharp non disponible — image non compressée');
    return { buffer: buf, mimeType: 'image/jpeg', originalKb: buf.length / 1024, compressedKb: buf.length / 1024, reduction: 0 };
  }
}

/**
 * [377] Sauvegarde temporaire d'une image uploadée
 */
function saveTmp(buffer, mimeType, clientId) {
  ensureDir(UPLOAD_TMP_DIR);
  const ext      = mimeType === 'image/webp' ? 'webp' : 'jpg';
  const filename = `${clientId || 'anon'}_${Date.now()}.${ext}`;
  const filepath = path.join(UPLOAD_TMP_DIR, filename);
  fs.writeFileSync(filepath, buffer);
  return { filepath, filename };
}

/**
 * [386] Purge les images brutes temporaires après traitement réussi
 */
function purgeTmpImages(olderThanMs = 3600000) { // 1h par défaut
  ensureDir(UPLOAD_TMP_DIR);
  const now   = Date.now();
  let purged  = 0;
  for (const file of fs.readdirSync(UPLOAD_TMP_DIR)) {
    const fp   = path.join(UPLOAD_TMP_DIR, file);
    const stat = fs.statSync(fp);
    if (now - stat.mtimeMs > olderThanMs) {
      fs.unlinkSync(fp);
      purged++;
    }
  }
  if (purged) bus.system(`[ImageCompressor] 🗑️ Purge: ${purged} image(s) temporaire(s) supprimée(s)`);
  return purged;
}

module.exports = { compressImage, saveTmp, purgeTmpImages, MAX_PX, WEBP_QUALITY };
