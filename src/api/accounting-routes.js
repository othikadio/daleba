'use strict';
const express  = require('express');
const router   = express.Router();
const { pool } = require('../memory/db');
const { requireAuth } = require('../middleware/auth');
const tax  = require('../services/tax-formulator');
const stmt = require('../services/financial-statements');
const gov  = require('../services/gov-filing-connector');
const ok  = (res,d,s=200) => res.status(s).json({success:true,data:d,ts:new Date().toISOString()});
const err = (res,m,s=400) => res.status(s).json({success:false,error:m});
const T   = req => req.user?.tenantId || req.query.tenantId || 'kadio';

router.post('/taxes/quarterly', requireAuth, async(req,res)=>{try{ok(res,await tax.computeQuarterlyTaxes(pool,T(req),req.body));}catch(e){err(res,e.message);}});
router.post('/taxes/extract-net', requireAuth, async(req,res)=>{try{ok(res,tax.extractNetFromTTC(req.body.amountTTC||0));}catch(e){err(res,e.message);}});
router.get('/balance-sheet', requireAuth, async(req,res)=>{try{ok(res,await stmt.generateBalanceSheet(pool,T(req)));}catch(e){err(res,e.message,500);}});
router.get('/income-statement', requireAuth, async(req,res)=>{try{ok(res,await stmt.generateIncomeStatement(pool,T(req),{periodMonths:parseInt(req.query.months||12)}));}catch(e){err(res,e.message,500);}});
router.get('/filings', requireAuth, async(req,res)=>{try{ok(res,await gov.listFilings(pool,T(req)));}catch(e){err(res,e.message,500);}});
router.get('/filings/:id', requireAuth, async(req,res)=>{try{const f=await gov.getFiling(pool,T(req),req.params.id);ok(res,f);}catch(e){err(res,e.message,404);}});
router.post('/filings/stage-gst', requireAuth, async(req,res)=>{try{ok(res,await gov.stageGSTReturn(pool,T(req),req.body),201);}catch(e){err(res,e.message);}});
router.post('/filings/stage-qst', requireAuth, async(req,res)=>{try{ok(res,await gov.stageQSTReturn(pool,T(req),req.body),201);}catch(e){err(res,e.message);}});
router.post('/filings/stage-pad', requireAuth, async(req,res)=>{try{ok(res,await gov.stagePADPayment(pool,T(req),req.body),201);}catch(e){err(res,e.message);}});
router.post('/filings/confirm', requireAuth, async(req,res)=>{try{if(!req.body.confirmationToken)return err(res,'confirmationToken requis [556]',401);ok(res,await gov.confirmAndTransmit(pool,T(req),req.body));}catch(e){err(res,e.message);}});
router.post('/filings/stage-and-confirm', requireAuth, async(req,res)=>{
  try {
    if(!req.body.confirmationToken) return err(res,'confirmationToken requis [556]',401);
    const taxes = await tax.computeQuarterlyTaxes(pool,T(req),req.body);
    const gst   = await gov.stageGSTReturn(pool,T(req),{...taxes.remittance,...taxes.sales,...req.body});
    const qst   = await gov.stageQSTReturn(pool,T(req),{...taxes.remittance,...taxes.sales,...req.body});
    ok(res,{taxes,gstFiling:gst,qstFiling:qst,status:'staged_draft',note:'Confirmation humaine requise [556]'});
  } catch(e){err(res,e.message);}
});
router.post('/expenses/categorize', requireAuth, async(req,res)=>{try{ok(res,await tax.categorizeExpenses(pool,T(req),req.body));}catch(e){err(res,e.message);}});
module.exports = router;
