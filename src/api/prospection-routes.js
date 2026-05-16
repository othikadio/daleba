/**
 * DALEBA — Routes Prospection (Points 35 + 36)
 * GMB Scanner + Cold Outreach IA
 */

const express = require('express');
const router = express.Router();
const gmb = require('../services/gmb-scanner');
const prospection = require('../services/prospection');

// POST /api/prospects/scan — Scan GMB d'une zone
// Body: { query, location, radius, type }
router.post('/scan', async (req, res) => {
  const { query, location, radius, type } = req.body;

  if (!query && !location) {
    return res.status(400).json({ error: 'query ou location requis' });
  }

  try {
    console.log(`🔍 DALEBA Scan GMB: "${query || location}"`);
    const prospects = await gmb.scanProspects(query, { location, radius, type });
    const prioritized = prospection.prioritizeProspects(prospects);

    res.json({
      total: prioritized.length,
      hot: prioritized.filter(p => p.priority.includes('CHAUD')).length,
      prospects: prioritized,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/prospects/details/:placeId — Fiche complète d'un prospect
router.get('/details/:placeId', async (req, res) => {
  try {
    const details = await gmb.getBusinessDetails(req.params.placeId);
    const analysis = gmb.detectWeaknesses(details);
    res.json({ ...details, ...analysis });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/prospects/outreach — Génère un message de cold outreach
// Body: { prospect (objet complet), channel, sender, offer }
router.post('/outreach', async (req, res) => {
  const { prospect, channel, sender, offer } = req.body;

  if (!prospect) {
    return res.status(400).json({ error: 'prospect requis' });
  }

  try {
    const result = await prospection.generateOutreach(prospect, { channel, sender, offer });
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/prospects/strategy — Stratégie de vente complète pour un prospect
router.post('/strategy', async (req, res) => {
  const { prospect } = req.body;

  if (!prospect) {
    return res.status(400).json({ error: 'prospect requis' });
  }

  try {
    const result = await prospection.generateStrategy(prospect);
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/prospects/full — Scan + Outreach en une seule requête
// Pour Ulrich: "Scanne les salons de Longueuil et prépare les messages"
router.post('/full', async (req, res) => {
  const { query, location, radius, channel = 'sms', sender, offer, limit = 5 } = req.body;

  if (!query && !location) {
    return res.status(400).json({ error: 'query ou location requis' });
  }

  try {
    console.log(`🚀 DALEBA Full Prospection: "${query}"`);

    // 1. Scan GMB
    const rawProspects = await gmb.scanProspects(query, { location, radius });
    const prioritized = prospection.prioritizeProspects(rawProspects);
    const hotProspects = prioritized.slice(0, limit); // Top N prospects

    // 2. Génère outreach pour chacun
    const results = [];
    for (const p of hotProspects) {
      const details = rawProspects.find(r => r.placeId === p.placeId) || p;
      try {
        const outreach = await prospection.generateOutreach(details, { channel, sender, offer });
        results.push({ ...p, outreach: outreach.message });
      } catch (err) {
        results.push({ ...p, outreach: null, error: err.message });
      }
    }

    res.json({
      query,
      totalFound: prioritized.length,
      processed: results.length,
      results,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
