/**
 * DALEBA V29 — Moteur d'Images d'Élite
 * Orchestrateur multi-modèles : Flux.1 Pro → DALL-E 3 → Imagen 3
 * Routing automatique selon cas d'usage + enrichissement prompt Claude
 *
 * Modèles supportés:
 *  - flux-pro      : Flux.1 Pro via Replicate (REPLICATE_API_TOKEN)
 *  - dalle3        : DALL-E 3 via OpenAI SDK (OPENAI_API_KEY) ← déjà configuré
 *  - imagen3       : Imagen 3 via Google Vertex AI (GOOGLE_API_KEY)
 *  - flux-schnell  : Flux Schnell via Replicate (rapide, moins cher)
 */

const bus  = require('./event-bus');
const path = require('path');
const fs   = require('fs');
const os   = require('os');

// ─── STYLES TENANT ───────────────────────────────────────────────────────────

const TENANT_STYLES = {
  beauty: {
    label:   'Salon de beauté haut de gamme',
    suffix:  'editorial beauty photography, soft bokeh, warm golden hour lighting, ' +
             '85mm portrait lens, skin texture visible, luxury salon atmosphere, ' +
             'pastel tones, professional studio setup',
    negPrompt: 'amateur, blurry, low quality, cartoon, illustration, fake, stock photo',
  },
  botanique: {
    label:   'Science botanique & soins naturels',
    suffix:  'botanical science photography, macro lens 100mm, natural daylight, ' +
             'green foliage background, glass bottles, minimalist white studio, ' +
             'organic textures, high-end skincare aesthetic',
    negPrompt: 'digital art, cartoon, fake plants, cluttered background',
  },
  promo: {
    label:   'Contenu promotionnel impactant',
    suffix:  'commercial photography, bold colors, high contrast, magazine cover quality, ' +
             'professional retouching, lifestyle photography, aspirational aesthetic',
    negPrompt: 'amateur, generic, stock photo watermark, low resolution',
  },
  portrait: {
    label:   'Portrait client / coiffure',
    suffix:  'professional portrait photography, 50mm lens, studio lighting 3-point, ' +
             'hair texture sharply in focus, natural skin tones, clean white background, ' +
             'fashion magazine quality',
    negPrompt: 'bad anatomy, blurry face, distorted hair, overexposed',
  },
  social: {
    label:   'Contenu réseaux sociaux',
    suffix:  'Instagram-worthy photography, vibrant colors, perfect composition rule-of-thirds, ' +
             'trendy aesthetic, bright and airy, flat lay or lifestyle shot',
    negPrompt: 'dark, gloomy, cluttered, amateur composition',
  },
};

// ─── ROUTING AUTOMATIQUE ─────────────────────────────────────────────────────

function selectModel(useCase, tenantStyle) {
  const hasReplicate = !!process.env.REPLICATE_API_TOKEN;
  const hasOpenAI    = !!process.env.OPENAI_API_KEY;
  const hasGoogle    = !!process.env.GOOGLE_API_KEY;

  // Logique de routing par cas d'usage
  if (useCase === 'portrait' || useCase === 'beauty') {
    if (hasReplicate) return 'flux-pro';   // Meilleur pour portraits réalistes
    if (hasOpenAI)    return 'dalle3';
  }
  if (useCase === 'botanique' || useCase === 'macro') {
    if (hasOpenAI)    return 'dalle3';     // DALL-E 3 excellent pour détails botaniques
    if (hasReplicate) return 'flux-pro';
  }
  if (useCase === 'social' || useCase === 'promo') {
    if (hasReplicate) return 'flux-schnell'; // Rapide + qualité suffisante pour social
    if (hasOpenAI)    return 'dalle3';
  }
  // Fallback cascade
  if (hasReplicate) return 'flux-pro';
  if (hasOpenAI)    return 'dalle3';
  if (hasGoogle)    return 'imagen3';
  return 'mock'; // Mode démo si aucune clé
}

// ─── ENRICHISSEMENT PROMPT (CLAUDE) ──────────────────────────────────────────

/**
 * Claude intercepte le prompt brut et y greffe des directives photo pro
 */
async function enrichVisualPrompt(rawPrompt, style = 'beauty', tenantName = 'Kadio Coiffure') {
  const styleProfile = TENANT_STYLES[style] || TENANT_STYLES.beauty;

  // Injection directe si pas de clé Anthropic
  if (!process.env.ANTHROPIC_API_KEY) {
    return `${rawPrompt}, ${styleProfile.suffix}`;
  }

  try {
    const claude = require('../agents/claude');
    const meta = `Tu es le directeur artistique de ${tenantName}. \
Enrichis ce prompt de génération d'image en y ajoutant des directives techniques de photographie professionnelle. \
Style cible: ${styleProfile.label}. \
Retourne UNIQUEMENT le prompt enrichi (une seule ligne, max 300 chars), sans explication ni ponctuation finale.`;

    const result  = await claude.query(rawPrompt, meta, []);
    const content = typeof result === 'string' ? result : (result.content || '');
    const enriched = content.trim().split('\n')[0].slice(0, 300);

    // Toujours ajouter le suffix style technique
    return `${enriched}, ${styleProfile.suffix}`;
  } catch (err) {
    bus.system(`[IMAGE] Enrichissement fallback: ${err.message}`);
    return `${rawPrompt}, ${styleProfile.suffix}`;
  }
}

// ─── GÉNÉRATEURS PAR MODÈLE ──────────────────────────────────────────────────

async function generateFlux(prompt, model = 'flux-pro', options = {}) {
  const Replicate = require('replicate');
  const replicate = new Replicate({ auth: process.env.REPLICATE_API_TOKEN });

  const modelIds = {
    'flux-pro':     'black-forest-labs/flux-1.1-pro',
    'flux-schnell': 'black-forest-labs/flux-schnell',
    'flux-dev':     'black-forest-labs/flux-dev',
  };

  const modelId = modelIds[model] || modelIds['flux-pro'];

  const output = await replicate.run(modelId, {
    input: {
      prompt,
      width:              options.width              || 1024,
      height:             options.height             || 1024,
      num_inference_steps: options.steps             || (model === 'flux-schnell' ? 4 : 25),
      guidance_scale:     options.guidanceScale      || 3.5,
      output_format:      options.format             || 'webp',
      output_quality:     options.quality            || 90,
    },
  });

  // Replicate retourne une URL ou un tableau d'URLs
  const url = Array.isArray(output) ? output[0] : output;
  return { url: url?.toString(), model, provider: 'replicate' };
}

async function generateDALLE3(prompt, options = {}) {
  const OpenAI = require('openai');
  const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

  const response = await openai.images.generate({
    model:          'dall-e-3',
    prompt:         prompt.slice(0, 4000),
    n:              1,
    size:           options.size   || '1024x1024',
    quality:        options.quality || 'hd',
    style:          options.style  || 'natural',
    response_format: 'url',
  });

  return {
    url:      response.data[0].url,
    revised:  response.data[0].revised_prompt,
    model:    'dalle3',
    provider: 'openai',
  };
}

async function generateImagen3(prompt, options = {}) {
  // Google Imagen 3 via REST API (Vertex AI)
  const { GoogleGenerativeAI } = require('@google/generative-ai');
  const genAI = new GoogleGenerativeAI(process.env.GOOGLE_API_KEY);
  const model = genAI.getGenerativeModel({ model: 'imagen-3.0-generate-001' });

  const result = await model.generateImages({
    prompt,
    number_of_images: 1,
    aspect_ratio: options.aspectRatio || '1:1',
  });

  return {
    url:      result.images[0].imageBytes, // base64
    model:    'imagen3',
    provider: 'google',
  };
}

async function generateMock(prompt) {
  // Mode démo: retourne une URL placeholder avec le prompt encodé
  const encoded = encodeURIComponent(prompt.slice(0, 80));
  return {
    url:      `https://placehold.co/1024x1024/000000/00FF9F?text=${encoded}`,
    model:    'mock',
    provider: 'demo',
    note:     'Mode démo — configurer REPLICATE_API_TOKEN ou OPENAI_API_KEY pour activer',
  };
}

// ─── FONCTION PRINCIPALE ─────────────────────────────────────────────────────

/**
 * Génère un visuel d'élite
 * @param {string} rawPrompt     — description du visuel souhaité
 * @param {string} styleTenant   — 'beauty' | 'botanique' | 'promo' | 'portrait' | 'social'
 * @param {object} options       — { model, width, height, quality, tenantName, saveLocal }
 */
async function generateEliteVisual(rawPrompt, styleTenant = 'beauty', options = {}) {
  const startMs    = Date.now();
  const tenantName = options.tenantName || 'Kadio Coiffure';
  const useCase    = styleTenant;

  bus.system(`[IMAGE] Génération élite — style: ${styleTenant} | prompt: ${rawPrompt.slice(0, 60)}…`);

  // 1. Enrichissement prompt
  const enrichedPrompt = await enrichVisualPrompt(rawPrompt, styleTenant, tenantName);
  bus.system(`[IMAGE] Prompt enrichi (${enrichedPrompt.length} chars)`);

  // 2. Sélection modèle
  const modelKey = options.model || selectModel(useCase, styleTenant);
  bus.system(`[IMAGE] Modèle sélectionné: ${modelKey}`);

  // 3. Génération
  let imageResult;
  try {
    switch (modelKey) {
      case 'flux-pro':
      case 'flux-schnell':
      case 'flux-dev':
        imageResult = await generateFlux(enrichedPrompt, modelKey, options);
        break;
      case 'dalle3':
        imageResult = await generateDALLE3(enrichedPrompt, options);
        break;
      case 'imagen3':
        imageResult = await generateImagen3(enrichedPrompt, options);
        break;
      default:
        imageResult = await generateMock(enrichedPrompt);
    }
  } catch (err) {
    bus.system(`[IMAGE] ${modelKey} échoué: ${err.message} — fallback`);
    // Cascade vers le modèle suivant disponible
    if (modelKey !== 'dalle3' && process.env.OPENAI_API_KEY) {
      imageResult = await generateDALLE3(enrichedPrompt, options);
    } else if (modelKey !== 'mock') {
      imageResult = await generateMock(enrichedPrompt);
    } else {
      throw err;
    }
  }

  const latencyMs = Date.now() - startMs;
  bus.system(`[IMAGE] ✅ Généré en ${latencyMs}ms — ${imageResult.model} — ${imageResult.url?.slice(0, 60)}`);

  return {
    url:            imageResult.url,
    revisedPrompt:  imageResult.revised,
    originalPrompt: rawPrompt,
    enrichedPrompt,
    model:          imageResult.model,
    provider:       imageResult.provider,
    style:          styleTenant,
    note:           imageResult.note,
    latencyMs,
    generatedAt:    new Date().toISOString(),
  };
}

// ─── GÉNÉRATION BATCH ─────────────────────────────────────────────────────────

/**
 * Génère plusieurs variantes d'un même visuel (A/B testing)
 * @param {string} prompt
 * @param {string} style
 * @param {number} count       — nombre de variantes (max 4)
 */
async function generateVisualVariants(prompt, style = 'social', count = 2) {
  const n       = Math.min(count, 4);
  const results = [];

  for (let i = 0; i < n; i++) {
    try {
      // Légère variation du prompt pour chaque variante
      const variantPrompt = i === 0 ? prompt : `${prompt}, variation ${i + 1}, slightly different angle and composition`;
      const result = await generateEliteVisual(variantPrompt, style);
      results.push({ variant: i + 1, ...result });
    } catch (err) {
      results.push({ variant: i + 1, error: err.message });
    }
  }

  return { variants: results, count: n, style };
}

module.exports = {
  generateEliteVisual,
  generateVisualVariants,
  enrichVisualPrompt,
  selectModel,
  TENANT_STYLES,
};
