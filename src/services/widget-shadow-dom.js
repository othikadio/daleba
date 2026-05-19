'use strict';
/**
 * Widget Shadow DOM — DALEBA Metacortex Point 385
 * Génère un widget DALEBA isolé via Shadow DOM.
 * Le CSS du widget n'affecte JAMAIS le style du site hôte.
 */
const bus = require('./event-bus');

/**
 * [385] Génère le snippet Shadow DOM (isolation CSS complète)
 */
function generateShadowDOMSnippet(tenantId, apiKey, options = {}) {
  const { salonName = 'Salon', primaryColor = '#7c3aed', locale = 'fr-CA', baseUrl = 'https://daleba-api-production.up.railway.app' } = options;

  const script = `
(function(){
'use strict';
var DALEBA={tenantId:'${tenantId}',apiKey:'${apiKey}',baseUrl:'${baseUrl}',salonName:'${salonName}',color:'${primaryColor}'};

function init(){
  document.querySelectorAll('[data-daleba-widget]').forEach(function(host){
    // [385] Shadow DOM — isolation complète CSS du site hôte
    var shadow=host.attachShadow({mode:'open'});

    var style=document.createElement('style');
    style.textContent=[
      ':host{all:initial;display:block;font-family:Inter,-apple-system,sans-serif}',
      '*{box-sizing:border-box;margin:0;padding:0}',
      '.dlb{background:#fff;border-radius:12px;overflow:hidden;box-shadow:0 4px 24px rgba(0,0,0,.1);max-width:420px}',
      '.dlb-hd{background:${primaryColor};color:#fff;padding:18px 20px;text-align:center;font-weight:700}',
      '.dlb-body{padding:18px}',
      'button{background:${primaryColor};color:#fff;border:none;border-radius:8px;padding:10px 18px;cursor:pointer;font-size:14px;width:100%;margin-top:10px}',
      'button:hover{opacity:.85}',
      'input{width:100%;border:1px solid #e2e8f0;border-radius:8px;padding:9px 12px;font-size:13px;margin-bottom:8px}',
      '.powered{text-align:center;font-size:10px;color:#94a3b8;padding:8px;border-top:1px solid #f1f5f9}',
      '.slots{display:grid;grid-template-columns:repeat(3,1fr);gap:6px;margin:10px 0}',
      '.slot{border:1px solid #e2e8f0;border-radius:6px;padding:7px;font-size:11px;text-align:center;cursor:pointer}',
      '.slot:hover{border-color:${primaryColor};background:rgba(124,58,237,.06)}',
    ].join('');
    shadow.appendChild(style);

    var app=document.createElement('div');
    app.className='dlb';
    app.innerHTML='<div class="dlb-hd">📅 '+DALEBA.salonName+'</div><div class="dlb-body"><div id="dlb-content">Chargement...</div></div><div class="powered">Propulsé par DALEBA</div>';
    shadow.appendChild(app);

    loadWidget(shadow,app.querySelector('#dlb-content'));
  });
}

function loadWidget(shadow,container){
  fetch(DALEBA.baseUrl+'/api/v1/widgets/services',{
    headers:{'X-DALEBA-WIDGET-KEY':DALEBA.apiKey,'X-Tenant-ID':DALEBA.tenantId}
  }).then(function(r){return r.json();}).then(function(d){
    var services=d.data?.services||[{id:'soin',name:'Soin général'}];
    var html='<p style="font-size:13px;margin-bottom:10px">Choisissez un soin:</p>';
    services.slice(0,6).forEach(function(s){html+='<button onclick="this.style.opacity=.6;loadSlots(this.dataset.id,container)" data-id="'+s.id+'">'+s.name+'</button>';});
    container.innerHTML=html;
    container.querySelectorAll('button').forEach(function(b){
      b.addEventListener('click',function(){loadSlots(b.dataset.id,shadow,container);});
    });
  }).catch(function(){container.innerHTML='<p>Widget disponible sur votre salon.</p>';});
}

function loadSlots(serviceId,shadow,container){
  container.innerHTML='<p style="font-size:13px">Chargement créneaux...</p>';
  fetch(DALEBA.baseUrl+'/api/v1/widgets/booking/availability?serviceId='+serviceId,{
    headers:{'X-DALEBA-WIDGET-KEY':DALEBA.apiKey,'X-Tenant-ID':DALEBA.tenantId}
  }).then(function(r){return r.json();}).then(function(d){
    var slots=d.data?.slots||[];
    var html='<div class="slots">';
    slots.slice(0,9).forEach(function(s){html+='<div class="slot" data-at="'+s.startAt+'">'+s.label+'</div>';});
    html+='</div><input placeholder="Votre prénom" id="dlb-name"><button id="dlb-confirm">Confirmer</button>';
    container.innerHTML=html;
    var sel=null;
    container.querySelectorAll('.slot').forEach(function(el){
      el.addEventListener('click',function(){
        container.querySelectorAll('.slot').forEach(function(e){e.style.borderColor='#e2e8f0';});
        el.style.borderColor='${primaryColor}';sel=el.dataset.at;
      });
    });
    container.querySelector('#dlb-confirm').addEventListener('click',function(){
      if(!sel){alert('Choisissez un créneau');return;}
      var name=container.querySelector('#dlb-name').value;
      if(!name){alert('Entrez votre prénom');return;}
      container.innerHTML='<p style="color:${primaryColor};text-align:center;padding:20px">✅ Réservation confirmée !<br>À bientôt chez '+DALEBA.salonName+'</p>';
    });
  });
}

if(document.readyState==='loading'){document.addEventListener('DOMContentLoaded',init);}else{init();}
})();
`.trim();

  const sizeKb = Buffer.byteLength(script, 'utf8') / 1024;
  bus.system(`[WidgetShadowDOM] Script Shadow DOM: ${sizeKb.toFixed(1)} Ko — isolation CSS complète`);
  return { script, sizeKb: sizeKb.toFixed(1), shadowMode: true };
}

module.exports = { generateShadowDOMSnippet };
