'use strict';
/**
 * Funding Routes — DALEBA [513-514]
 * Endpoints financement, coffre-fort, applications, webhook email
 */
const express  = require('express');
const router   = express.Router();
const { pool } = require('../memory/db');
const { requireAuth } = require('../middleware/auth');

const scanner  = require('../services/funding-scanner-worker');
const prequal  = require('../services/prequalification-engine');
const vault    = require('../services/funding-vault');
const alertSvc = require('../services/funding-alert');

const ok  = (res,d,s=200) => res.status(s).json({success:true,data:d,ts:new Date().toISOString()});
const err = (res,m,s=400) => res.status(s).json({success:false,error:m});
const T   = (req) => req.user?.tenantId || req.query.tenantId || 'kadio';

// [502-503] Scan programmes
router.post('/scan', requireAuth, async(req,res)=>{try{ok(res,await scanner.scanAll(pool));}catch(e){err(res,e.message);}});
router.get('/opportunities', requireAuth, async(req,res)=>{try{ok(res,await scanner.getOpportunities(pool,req.query));}catch(e){err(res,e.message,500);}});

// [504-506] Pré-qualification
router.get('/prequalify', requireAuth, async(req,res)=>{try{ok(res,await prequal.prequalify(pool,T(req)));}catch(e){err(res,e.message,500);}});
router.post('/dscr', requireAuth, async(req,res)=>{try{ok(res,prequal.calculateDSCR(req.body.netOperatingIncome,req.body.debtService));}catch(e){err(res,e.message);}});

// [508] Pitch Memo
router.post('/pitch-memo', requireAuth, async(req,res)=>{try{ok(res,await prequal.generatePitchMemo(pool,T(req),req.body.opportunity));}catch(e){err(res,e.message);}});

// [510] Lettre corporative
router.post('/cover-letter', requireAuth, async(req,res)=>{try{ok(res,await prequal.writeCoverLetter(pool,T(req),req.body));}catch(e){err(res,e.message);}});

// [513] Applications
router.get('/applications', requireAuth, async(req,res)=>{try{ok(res,await prequal.getApplications(pool,T(req)));}catch(e){err(res,e.message,500);}});
router.post('/applications', requireAuth, async(req,res)=>{try{ok(res,await prequal.createApplication(pool,T(req),req.body),201);}catch(e){err(res,e.message);}});
router.patch('/applications/:appId/status', requireAuth, async(req,res)=>{try{ok(res,await prequal.updateApplicationStatus(pool,T(req),{appId:req.params.appId,...req.body}));}catch(e){err(res,e.message);}});

// [509] Coffre-fort documents
router.post('/vault/store', requireAuth, async(req,res)=>{try{ok(res,await vault.storeDocument(pool,T(req),req.body),201);}catch(e){err(res,e.message);}});
router.get('/vault/:docId', requireAuth, async(req,res)=>{try{ok(res,await vault.retrieveDocument(pool,T(req),req.params.docId));}catch(e){err(res,e.message,404);}});
router.get('/vault', requireAuth, async(req,res)=>{try{ok(res,await vault.listDocuments(pool,T(req)));}catch(e){err(res,e.message,500);}});

// [512] Approbation OUI → APPLICATION_IN_PROGRESS
router.get('/approve/:token', async(req,res)=>{
  try {
    const result = await alertSvc.processApproval(pool, req.params.token);
    res.set('Content-Type','text/html');
    res.send(`<html><body style="font-family:sans-serif;padding:40px;max-width:500px;margin:auto;background:#0a0a0f;color:#e2e8f0"><h2 style="color:#7c3aed">✅ Dossier activé</h2><p>Programme <strong>${result.programName}</strong> passé en statut <strong>APPLICATION IN PROGRESS</strong>.</p><p>DALEBA commence à remplir les sections du dossier. Vous recevrez les mises à jour sur votre téléphone.</p><p style="margin-top:30px;color:#64748b;font-size:12px">DALEBA Business Intelligence 💜</p></body></html>`);
  } catch(e){err(res,e.message,400);}
});

// [514] Webhook email retours organismes
router.post('/webhook/email', async(req,res)=>{
  try {
    const { from, subject, body: emailBody, text } = req.body;
    const content = emailBody || text || '';
    // Détecte statut dans le contenu de l'email
    let newStatus = 'submitted';
    if (/approv|accept|congratul|félicit/i.test(content)) newStatus = 'approved';
    if (/refus|reject|denied|malheureusement/i.test(content)) newStatus = 'rejected';
    require('./event-bus').system(`[FundingWebhook] 📧 Email organisme: from=${from} subject="${subject}" → statut=${newStatus}`);
    res.json({ received: true, detectedStatus: newStatus });
  } catch(e){ res.status(400).json({error: e.message}); }
});

module.exports = router;
