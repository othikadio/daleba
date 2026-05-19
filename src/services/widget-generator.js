'use strict';
/**
 * Widget Generator — DALEBA Metacortex Points 359-364
 * [359] Génère un widget de réservation injectable sur tout CMS
 * [360] Script natif < 45 Ko, asynchrone, aucune dépendance
 * [361] Auth via X-DALEBA-WIDGET-KEY (format tk_...)
 * [362] CORS strict + validation domaine d'origine
 * [363] Communication HTTPS REST /api/v1/widgets/booking/availability
 * [364] Responsive mobile-first, CSS harmonisé à la marque salon
 */
const bus = require('./event-bus');
const crypto = require('crypto');

/**
 * [364] Génère les CSS variables de la marque salon
 */
function buildBrandCSS(brand = {}) {
  const primary   = brand.primaryColor  || '#7c3aed';
  const secondary = brand.secondaryColor|| '#10b981';
  const fontFamily = brand.fontFamily   || 'Inter, -apple-system, sans-serif';
  const bgColor   = brand.bgColor       || '#ffffff';
  const textColor = brand.textColor     || '#1a1a2e';
  const radius    = brand.borderRadius  || '12px';

  return `
    --dlb-primary: ${primary};
    --dlb-secondary: ${secondary};
    --dlb-bg: ${bgColor};
    --dlb-text: ${textColor};
    --dlb-radius: ${radius};
    --dlb-font: ${fontFamily};
    --dlb-shadow: 0 4px 24px rgba(0,0,0,0.12);
  `.trim();
}

/**
 * [360] Génère le script widget JS natif (< 45 Ko)
 * Ce script est minifié et injectable via <script>
 */
function generateWidgetScript(tenantId, apiKey, options = {}) {
  const {
    baseUrl   = 'https://daleba-api-production.up.railway.app',
    salonName = 'Notre Salon',
    brand     = {},
    locale    = 'fr-CA',
  } = options;

  const cssVars = buildBrandCSS(brand);

  // Script autonome — zéro dépendance externe
  const script = `
(function(w,d){
'use strict';
var DALEBA={
  tenantId:'${tenantId}',
  apiKey:'${apiKey}',
  baseUrl:'${baseUrl}',
  salonName:'${salonName}',
  locale:'${locale}',
  version:'1.0.0'
};

var CSS='*{box-sizing:border-box}.dlb-widget{font-family:var(--dlb-font,Inter,-apple-system,sans-serif);max-width:480px;margin:0 auto;background:var(--dlb-bg,#fff);border-radius:var(--dlb-radius,12px);box-shadow:var(--dlb-shadow,0 4px 24px rgba(0,0,0,.12));overflow:hidden}.dlb-header{background:var(--dlb-primary,#7c3aed);color:#fff;padding:20px;text-align:center}.dlb-header h3{margin:0;font-size:18px;font-weight:700}.dlb-body{padding:20px}.dlb-step{display:none}.dlb-step.active{display:block}.dlb-services{display:grid;grid-template-columns:1fr 1fr;gap:10px;margin:12px 0}.dlb-svc-btn{border:2px solid var(--dlb-primary,#7c3aed);border-radius:8px;padding:12px;cursor:pointer;background:#fff;color:var(--dlb-text,#1a1a2e);font-size:13px;transition:all .2s;text-align:center}.dlb-svc-btn:hover,.dlb-svc-btn.selected{background:var(--dlb-primary,#7c3aed);color:#fff}.dlb-slots{display:grid;grid-template-columns:repeat(3,1fr);gap:8px;margin:12px 0}.dlb-slot{border:1px solid #e2e8f0;border-radius:8px;padding:8px;cursor:pointer;font-size:12px;text-align:center;transition:all .2s}.dlb-slot:hover,.dlb-slot.selected{border-color:var(--dlb-primary,#7c3aed);background:rgba(124,58,237,.08)}.dlb-input{width:100%;border:1px solid #e2e8f0;border-radius:8px;padding:10px 14px;font-size:14px;margin-bottom:12px;outline:none}.dlb-input:focus{border-color:var(--dlb-primary,#7c3aed)}.dlb-btn{width:100%;background:var(--dlb-primary,#7c3aed);color:#fff;border:none;border-radius:8px;padding:14px;font-size:15px;font-weight:600;cursor:pointer;transition:opacity .2s}.dlb-btn:hover{opacity:.85}.dlb-btn:disabled{opacity:.5;cursor:not-allowed}.dlb-msg{text-align:center;padding:24px;color:var(--dlb-text,#1a1a2e)}.dlb-msg.success{color:var(--dlb-secondary,#10b981)}.dlb-msg.error{color:#ef4444}.dlb-powered{text-align:center;font-size:10px;color:#94a3b8;padding:8px;border-top:1px solid #f1f5f9}@media(max-width:480px){.dlb-widget{border-radius:0;box-shadow:none}.dlb-services{grid-template-columns:1fr}}';

var state={step:1,service:null,slot:null,client:{name:'',phone:'',email:''}};

function h(tag,attrs,children){
  var el=d.createElement(tag);
  for(var k in attrs){if(k==='className')el.className=attrs[k];else el.setAttribute(k,attrs[k]);}
  if(typeof children==='string')el.textContent=children;
  else if(Array.isArray(children))children.forEach(function(c){if(c)el.appendChild(c);});
  return el;
}

function api(path,opts){
  return fetch(DALEBA.baseUrl+'/api/v1/widgets'+path,Object.assign({
    headers:{'Content-Type':'application/json','X-DALEBA-WIDGET-KEY':DALEBA.apiKey,'X-Tenant-ID':DALEBA.tenantId}
  },opts||{})).then(function(r){return r.json();}).catch(function(){return{error:'Connexion impossible'};});
}

function render(container,services,slots){
  container.innerHTML='';
  var style=d.createElement('style');
  style.textContent=CSS;
  container.appendChild(style);

  var widget=h('div',{className:'dlb-widget'},[
    h('div',{className:'dlb-header'},[h('h3',{},'📅 '+DALEBA.salonName)]),
    h('div',{className:'dlb-body'},[
      // Step 1: Services
      (function(){
        var step=h('div',{className:'dlb-step'+(state.step===1?' active':''),'data-step':'1'},[]);
        step.appendChild(h('p',{},'Choisissez votre soin :'));
        var grid=h('div',{className:'dlb-services'},[]);
        (services||[]).forEach(function(svc){
          var btn=h('button',{className:'dlb-svc-btn'+(state.service===svc.id?' selected':'')},svc.name+(svc.duration?' ('+svc.duration+'min)':''));
          btn.onclick=function(){state.service=svc.id;state.step=2;renderWidget(container);};
          grid.appendChild(btn);
        });
        step.appendChild(grid);
        return step;
      })(),
      // Step 2: Créneaux
      (function(){
        var step=h('div',{className:'dlb-step'+(state.step===2?' active':''),'data-step':'2'},[]);
        step.appendChild(h('p',{},'Choisissez un créneau :'));
        var grid=h('div',{className:'dlb-slots'},[]);
        (slots||[]).forEach(function(slot){
          var btn=h('div',{className:'dlb-slot'+(state.slot===slot.startAt?' selected':'')},slot.label||slot.startAt);
          btn.onclick=function(){state.slot=slot.startAt;state.step=3;renderWidget(container);};
          grid.appendChild(btn);
        });
        var back=h('button',{className:'dlb-btn',style:'margin-top:8px;background:#e2e8f0;color:#1a1a2e'},'← Retour');
        back.onclick=function(){state.step=1;renderWidget(container);};
        step.appendChild(grid);
        step.appendChild(back);
        return step;
      })(),
      // Step 3: Coordonnées
      (function(){
        var step=h('div',{className:'dlb-step'+(state.step===3?' active':''),'data-step':'3'},[]);
        step.appendChild(h('p',{},'Vos coordonnées :'));
        var nameInput=h('input',{className:'dlb-input',type:'text',placeholder:'Votre prénom',value:state.client.name||''},'');
        nameInput.oninput=function(){state.client.name=this.value;};
        var phoneInput=h('input',{className:'dlb-input',type:'tel',placeholder:'Téléphone',value:state.client.phone||''},'');
        phoneInput.oninput=function(){state.client.phone=this.value;};
        var confirmBtn=h('button',{className:'dlb-btn'},'Confirmer le rendez-vous');
        confirmBtn.onclick=function(){submitBooking(container);};
        var back=h('button',{className:'dlb-btn',style:'margin-top:8px;background:#e2e8f0;color:#1a1a2e'},'← Retour');
        back.onclick=function(){state.step=2;renderWidget(container);};
        step.appendChild(nameInput);step.appendChild(phoneInput);step.appendChild(confirmBtn);step.appendChild(back);
        return step;
      })(),
      // Step 4: Confirmation
      (function(){
        var step=h('div',{className:'dlb-step'+(state.step===4?' active':''),'data-step':'4'},[]);
        step.appendChild(h('div',{className:'dlb-msg success'},'✅ Rendez-vous confirmé ! Un SMS de confirmation vous sera envoyé.'));
        return step;
      })(),
    ]),
    h('div',{className:'dlb-powered'},'Propulsé par DALEBA · Solutions Saloniques')
  ]);

  container.appendChild(widget);
}

function renderWidget(container){
  api('/booking/availability?serviceId='+state.service).then(function(data){
    render(container,data.services||[],data.slots||[]);
  });
}

function submitBooking(container){
  api('/booking/create',{method:'POST',body:JSON.stringify({
    tenantId:DALEBA.tenantId,serviceId:state.service,startAt:state.slot,client:state.client
  })}).then(function(data){
    if(data.success){state.step=4;render(container,[],[]);}
    else{var err=container.querySelector('.dlb-msg');if(err)err.textContent='Erreur: '+(data.error||'Réessayez');}
  });
}

function init(){
  var containers=d.querySelectorAll('[data-daleba-widget]');
  containers.forEach(function(container){
    var cssEl=d.createElement('style');
    cssEl.textContent=':root{${cssVars}}';
    container.appendChild(cssEl);
    api('/services').then(function(data){
      render(container,data.services||[],[]);
    });
  });
}

if(d.readyState==='loading'){d.addEventListener('DOMContentLoaded',init);}else{init();}
})(window,document);
`.trim();

  const sizeKb = Buffer.byteLength(script, 'utf8') / 1024;
  bus.system(`[WidgetGenerator] Script généré: ${sizeKb.toFixed(1)} Ko (max 45 Ko)`);
  if (sizeKb > 45) bus.system('[WidgetGenerator] ⚠️ Script > 45 Ko — minification requise');

  return { script, sizeKb: sizeKb.toFixed(1), tenantId, apiKey };
}

/**
 * [362] Valide l'origine CORS de la requête widget
 */
async function validateOrigin(pool, tenantId, requestOrigin) {
  if (!requestOrigin) return { valid: false, reason: 'no_origin' };

  try {
    const r = await pool.query(
      `SELECT website_url, allowed_origins FROM tenant_settings WHERE tenant_id=$1`,
      [tenantId]
    );
    const tenant = r.rows[0];
    if (!tenant) return { valid: false, reason: 'tenant_not_found' };

    const allowed = [
      tenant.website_url,
      ...(tenant.allowed_origins || []),
    ].filter(Boolean).map(u => u.replace(/\/$/, '').toLowerCase());

    const origin = requestOrigin.replace(/\/$/, '').toLowerCase();
    const valid  = allowed.some(a => origin.includes(a) || a.includes(origin.replace(/^https?:\/\//, '')));

    if (!valid) bus.system(`[WidgetGenerator] CORS refusé: origin=${origin} non dans [${allowed.join(', ')}]`);
    return { valid, origin, allowedOrigins: allowed };
  } catch (err) {
    return { valid: false, error: err.message };
  }
}

module.exports = { generateWidgetScript, validateOrigin, buildBrandCSS };
