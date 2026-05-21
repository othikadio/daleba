'use strict';

/**
 * DALEBA — Routes OAuth Meta
 * 
 * GET  /api/oauth/meta/start?tenantId=XXX  → Redirige vers Facebook login
 * GET  /api/oauth/meta/callback             → Callback automatique Meta
 * GET  /api/oauth/meta/status/:tenantId     → Vérifie si connecté
 */

const express = require('express');
const router  = express.Router();
const metaOAuth = require('../services/meta-oauth');
const bus       = require('../services/event-bus');

// ─── DÉMARRER LE FLUX OAUTH ───────────────────────────────────────────────────
// Le client clique ce lien → il est redirigé vers Facebook pour autoriser.
router.get('/start', (req, res) => {
  try {
    const { tenantId } = req.query;
    if (!tenantId) return res.status(400).json({ error: 'tenantId requis' });

    const baseUrl = process.env.API_BASE_URL || `https://${req.headers.host}`;
    const authUrl = metaOAuth.buildAuthUrl(tenantId, baseUrl);

    // Redirection directe ou retourner l'URL selon le contexte
    if (req.query.redirect === 'false') {
      return res.json({ url: authUrl });
    }
    res.redirect(authUrl);
  } catch (err) {
    bus.emit('error', `[MetaOAuth] Start error: ${err.message}`);
    res.status(500).json({ error: err.message });
  }
});

// ─── CALLBACK META (automatique après autorisation) ───────────────────────────
router.get('/callback', async (req, res) => {
  const { code, state, error, error_description } = req.query;

  // Meta renvoie une erreur si le client refuse
  if (error) {
    bus.emit('warn', `[MetaOAuth] Refus client: ${error_description}`);
    return res.redirect('/onboarding?meta=denied');
  }

  if (!code || !state) {
    return res.status(400).json({ error: 'Paramètres manquants' });
  }

  try {
    const baseUrl  = process.env.API_BASE_URL || `https://${req.headers.host}`;
    const pageData = await metaOAuth.handleCallback(code, state, baseUrl);

    bus.chat(`✅ [META OAUTH] Connecté: ${pageData.pageName} (Page: ${pageData.pageId}${pageData.igUserId ? ` | IG: ${pageData.igUserId}` : ' | IG non lié'})`);

    // Redirection vers le tableau de bord avec succès
    const igParam = pageData.igUserId ? `&ig=${pageData.igUserId}` : '';
    res.redirect(`/onboarding?meta=success&page=${pageData.pageId}${igParam}`);
  } catch (err) {
    bus.emit('error', `[MetaOAuth] Callback error: ${err.message}`);
    res.redirect(`/onboarding?meta=error&reason=${encodeURIComponent(err.message)}`);
  }
});

// ─── VÉRIFIER STATUT CONNEXION ────────────────────────────────────────────────
router.get('/status/:tenantId', async (req, res) => {
  try {
    const creds = await metaOAuth.getTenantMetaCredentials(req.params.tenantId);
    if (!creds) return res.json({ connected: false });
    res.json({
      connected: true,
      pageId:    creds.pageId,
      pageName:  creds.pageName,
      instagram: !!creds.igUserId,
      igUserId:  creds.igUserId,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
