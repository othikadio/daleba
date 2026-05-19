'use strict';
/**
 * Ad Aspect Ratio — DALEBA [485]
 * Ratio idéal par plateforme: 1:1 flux, 9:16 Stories/Reels
 */
const PLATFORM_SPECS = {
  meta_feed:    { ratio:'1:1',   w:1080, h:1080, label:'Meta Feed',          format:'square'    },
  meta_story:   { ratio:'9:16',  w:1080, h:1920, label:'Meta Story/Reels',   format:'vertical'  },
  meta_banner:  { ratio:'1.91:1',w:1200, h:628,  label:'Meta Link/Banner',   format:'horizontal'},
  google_display:{ratio:'16:9',  w:1200, h:628,  label:'Google Display',     format:'horizontal'},
  google_square: {ratio:'1:1',   w:1080, h:1080, label:'Google Square',      format:'square'    },
};

function getSpec(platform) { return PLATFORM_SPECS[platform] || PLATFORM_SPECS['meta_feed']; }
function getAllSpecs()      { return PLATFORM_SPECS; }

/**
 * Vérifie si une image respecte le ratio requis (±5% tolérance)
 */
function validateRatio(width, height, platform) {
  const spec = getSpec(platform);
  const [rw, rh] = spec.ratio.split(':').map(Number);
  const expected = rw / rh;
  const actual   = width / height;
  const valid    = Math.abs(actual - expected) / expected < 0.05;
  return { valid, expected: spec.ratio, actual: `${width}:${height}`, spec };
}

/**
 * Retourne les dimensions à demander à Flux.1 Pro / DALL-E selon la plateforme
 */
function getGenerationDimensions(platform) {
  const spec = getSpec(platform);
  return { width: spec.w, height: spec.h, ratio: spec.ratio };
}

module.exports = { getSpec, getAllSpecs, validateRatio, getGenerationDimensions, PLATFORM_SPECS };
