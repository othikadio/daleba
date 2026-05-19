'use strict';
/**
 * Ad Pixel Cleaner — DALEBA [487]
 * Purge les pixels de tracking obsolètes après 90 jours (RGPD/Loi 25)
 */
const bus = require('./event-bus');
const RETENTION_DAYS = 90;

async function purgeExpiredPixels(pool) {
  const r = await pool.query(`
    DELETE FROM tenant_attribution_pixels
    WHERE created_at < NOW() - INTERVAL '${RETENTION_DAYS} days'
      AND converted = false
    RETURNING id, tenant_id, pixel_id
  `).catch(() => ({ rows: [], rowCount: 0 }));
  const count = r.rowCount || r.rows?.length || 0;
  if (count > 0) bus.system(`[PixelCleaner] 🗑️ ${count} pixel(s) de tracking purgés (>${RETENTION_DAYS}j)`);
  return { purged: count };
}

async function purgeConvertedPixels(pool) {
  const r = await pool.query(`
    DELETE FROM tenant_attribution_pixels
    WHERE converted = true AND converted_at < NOW() - INTERVAL '${RETENTION_DAYS} days'
    RETURNING id
  `).catch(() => ({ rows: [], rowCount: 0 }));
  return { purged: r.rowCount || 0 };
}

module.exports = { purgeExpiredPixels, purgeConvertedPixels, RETENTION_DAYS };
