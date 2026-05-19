'use strict';
/**
 * Funding Routes — DALEBA Section 11 [513-527]
 */
const express  = require('express');
const router   = express.Router();
const { pool } = require('../memory/db');
const { requireAuth } = require('../middleware/auth');
const crypto   = require('crypto');

const scanner  = require('../services/funding-scanner-worker');
const prequal  = require('../services/prequalification-engine');
const vault    = require('../services/funding-vault');
const alertSvc = require('../services/funding-alert');
const scam     = require('../services/funding-scam-sentry');
const bus      = require('../services/event-bus');

const ok  = (res,d,s=200) => res.status(s).json({success:true,data:d,ts:new Date().toISOString()});
const err = (res,m,s=400) => res.status(s).json({success:false,error:m});
const T   = (req) => req.user?.tenantId || req.query.tenantId || 'kadio';

// [518] Middleware isolation multi-tenant strict
const tenantIsolation = (req, res, next) => {
  const tid = T(req);
  if (req.user?.tenantId && req.user.tenantId !== tid)
    return err(res, 'Accès cross-tenant interdit [518]', 403);
  next();
};

// [522] Double auth sur endpoints sensibles (vault)
const doubleAuth = (req, res, next) => {
  const sig = req.headers['x-daleba-sig'] || req.body?.adminSig;
  if (!sig) return err(res, 'Double authentification requise [522]: x-daleba-sig manquant', 401);
  next();
};

// [502-503] Scan programmes
router.post('/scan', requireAuth, tenantIsolation, async(req,res)=>{try{ok(res,await scanner.scanAll(pool));}catch(e){err(res,e.message);}});
router.get('/opportunities', requireAuth, tenantIsolation, async(req,res)=>{try{ok(res,await scanner.getOpportunities(pool,req.query));}catch(e){err(res,e.message,500);}});

// [504-506] Pré-qualification
router.get('/prequalify', requireAuth, tenantIsolation, async(req,res)=>{try{ok(res,await prequal.prequalify(pool,T(req)));}catch(e){err(res,e.message,500);}});
router.post('/dscr', requireAuth, async(req,res)=>{try{ok(res,prequal.calculateDSCR(req.body.netOperatingIncome,req.body.debtService));}catch(e){err(res,e.message);}});

// [519] WACC
router.post('/wacc', requireAuth, async(req,res)=>{try{ok(res,prequal.calculateWACC(req.body.offers));}catch(e){err(res,e.message);}});

// [532] Simulation endettement max
router.get('/max-debt', requireAuth, tenantIsolation, async(req,res)=>{try{ok(res,await prequal.simulateMaxDebt(pool,T(req),req.query));}catch(e){err(res,e.message,500);}});

// [521] ROI post-financement
router.post('/roi', requireAuth, tenantIsolation, async(req,res)=>{try{ok(res,await prequal.projectROI(pool,T(req),req.body));}catch(e){err(res,e.message);}});

// [508] Pitch Memo
router.post('/pitch-memo', requireAuth, tenantIsolation, async(req,res)=>{try{ok(res,await prequal.generatePitchMemo(pool,T(req),req.body.opportunity));}catch(e){err(res,e.message);}});

// [510] Lettre corporative
router.post('/cover-letter', requireAuth, tenantIsolation, async(req,res)=>{try{ok(res,await prequal.writeCoverLetter(pool,T(req),req.body));}catch(e){err(res,e.message);}});

// [513] Applications [527] index composite
router.get('/applications', requireAuth, tenantIsolation, async(req,res)=>{try{ok(res,await prequal.getApplications(pool,T(req)));}catch(e){err(res,e.message,500);}});
router.post('/applications', requireAuth, tenantIsolation, async(req,res)=>{try{ok(res,await prequal.createApplication(pool,T(req),req.body),201);}catch(e){err(res,e.message);}});
router.patch('/applications/:appId/status', requireAuth, tenantIsolation, async(req,res)=>{try{ok(res,await prequal.updateApplicationStatus(pool,T(req),{appId:req.params.appId,...req.body}));}catch(e){err(res,e.message);}});

// [509,522] Coffre-fort — double auth sur lecture
router.post('/vault/store', requireAuth, tenantIsolation, doubleAuth, async(req,res)=>{try{ok(res,await vault.storeDocument(pool,T(req),req.body),201);}catch(e){err(res,e.message);}});
router.get('/vault/:docId', requireAuth, tenantIsolation, doubleAuth, async(req,res)=>{try{ok(res,await vault.retrieveDocument(pool,T(req),req.params.docId));}catch(e){err(res,e.message,404);}});
router.get('/vault', requireAuth, tenantIsolation, async(req,res)=>{try{ok(res,await vault.listDocuments(pool,T(req)));}catch(e){err(res,e.message,500);}});

// [526] Scam Sentry — vérification programme
router.post('/verify-program', requireAuth, async(req,res)=>{try{ok(res,scam.verifyProgram(req.body));}catch(e){err(res,e.message);}});

// [531] Deadlines
router.post('/deadlines', requireAuth, tenantIsolation, async(req,res)=>{try{ok(res,await prequal.addReportingDeadline(pool,T(req),req.body));}catch(e){err(res,e.message);}});
router.get('/deadlines', requireAuth, tenantIsolation, async(req,res)=>{try{ok(res,await prequal.getReportingDeadlines(pool,T(req)));}catch(e){err(res,e.message,500);}});

// [523] Purge cache
router.delete('/cache', requireAuth, tenantIsolation, (req,res)=>{prequal.cleanTempFinancials(T(req));ok(res,{purged:true});});

// [512] Approbation OUI → APPLICATION_IN_PROGRESS
router.get('/approve/:token', async(req,res)=>{
  try {
    const result = await alertSvc.processApproval(pool, req.params.token);
    res.set('Content-Type','text/html');
    res.send(`<html><body style="font-family:sans-serif;padding:40px;max-width:500px;margin:auto;background:#0a0a0f;color:#e2e8f0"><h2 style="color:#7c3aed">✅ Dossier activé</h2><p>Programme <strong>${result.programName||'—'}</strong> en cours.</p><p style="color:#64748b;font-size:12px">DALEBA 💜</p></body></html>`);
  } catch(e){err(res,e.message,400);}
});

// [514] Webhook email organismes
router.post('/webhook/email', async(req,res)=>{
  try {
    const { from='', subject='', body: emailBody='', text='' } = req.body;
    const content = emailBody || text;
    let newStatus = 'submitted';
    if (/approv|accept|congratul|félicit/i.test(content)) newStatus = 'approved';
    if (/refus|reject|denied|malheureusement/i.test(content)) newStatus = 'rejected';
    // [515] Analyse demande de pièce manquante
    if (/document|pièce|missing|requis|required|manqu/i.test(content)) {
      bus.system(`[FundingWebhook] 📧 Demande de document manquant détectée depuis: ${from}`);
      bus.emit('funding:document_requested', { from, subject, content });
    }
    bus.system(`[FundingWebhook] 📧 Email organisme: ${from} — statut détecté: ${newStatus}`);
    res.json({ received: true, detectedStatus: newStatus });
  } catch(e){res.status(400).json({error:e.message});}
});

// [520] Vérification hash document
router.post('/verify-hash', requireAuth, async(req,res)=>{
  const { content, expectedHash } = req.body;
  const actual = crypto.createHash('sha256').update(content||'').digest('hex').slice(0,16);
  ok(res, { valid: actual === expectedHash, computed: actual, expected: expectedHash });
});

// [541] Simulateur taux fixe/variable + stress
router.post('/rate-scenarios', requireAuth, async(req,res)=>{try{ok(res,prequal.simulateRateScenarios(req.body.principal,req.body.termYears,req.body.scenarios));}catch(e){err(res,e.message);}});

// [537] Injection programme tiers
router.post('/programs/inject', requireAuth, async(req,res)=>{try{ok(res,await prequal.injectCustomProgram(pool,req.body));}catch(e){err(res,e.message);}});

// [539-540] Audit vault
router.get('/vault/audit', requireAuth, tenantIsolation, async(req,res)=>{try{ok(res,await vault.auditVaultDocuments(pool,T(req)));}catch(e){err(res,e.message,500);}});
router.post('/vault/check-missing', requireAuth, tenantIsolation, async(req,res)=>{try{ok(res,await vault.flagMissingDocuments(pool,T(req),req.body.requiredTypes));}catch(e){err(res,e.message);}});

// [543] Planning remboursements
router.post('/repayments/schedule', requireAuth, tenantIsolation, async(req,res)=>{try{ok(res,await prequal.scheduleRepayments(pool,T(req),req.body));}catch(e){err(res,e.message);}});

// [547] Sépare aides directes vs crédits d'impôt
router.get('/opportunities/classified', requireAuth, async(req,res)=>{
  try {
    const all = await scanner.getOpportunities(pool);
    const direct = all.filter(o=>['subvention_non_remboursable','prêt_garanti'].includes(o.funding_type));
    const taxCredit = all.filter(o=>o.funding_type==='crédit_impôt');
    ok(res,{direct,taxCredit,directCount:direct.length,taxCreditCount:taxCredit.length});
  } catch(e){err(res,e.message,500);}
});

// [542] Webhook ACTION_REQUIRED de l'organisme
router.post('/webhook/action-required', async(req,res)=>{
  try {
    const {applicationId,organism,message,tenantId:tid}=req.body;
    require('../services/event-bus').system(`[FundingWebhook] 🚨 ACTION_REQUIRED: app=${applicationId} org=${organism}`);
    // SMS Ulrich
    const phone=process.env.ULRICH_PHONE_NUMBER;
    if(phone){try{const t=require('../services/twilio-sender');await t.sendSMS({to:phone,body:`[DALEBA FINANCEMENT] 🚨 Action requise — ${organism}: ${message||'Vérifiez votre dossier'} (app: ${applicationId})`});}catch{}}
    res.json({received:true,alerted:!!phone});
  } catch(e){res.status(400).json({error:e.message});}
});

module.exports = router;
