'use strict';
/**
 * Google Review Guard — DALEBA Metacortex Points 403-407
 * [403] SMS 90min post-RDV avec lien /api/v1/feedback/:txId
 * [404] Interface de notation 5 étoiles
 * [405] 5★ → redirect Google Business Profile
 * [406] ≤4★ → formulaire de doléance privé (intercepte flux)
 * [407] Doléance → DB + alerte HUD + SMS gérant
 */
const bus    = require('./event-bus');
const crypto = require('crypto');

async function initSchema(pool) {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS tenant_review_tokens (
      id              SERIAL PRIMARY KEY,
      tenant_id       TEXT NOT NULL,
      tx_id           TEXT NOT NULL,
      token           TEXT UNIQUE NOT NULL,
      customer_id     TEXT,
      customer_name   TEXT,
      customer_phone  TEXT,
      appointment_end TIMESTAMPTZ,
      sms_sent_at     TIMESTAMPTZ,
      opened_at       TIMESTAMPTZ,
      rating          INTEGER,
      status          TEXT DEFAULT 'pending',  -- pending | opened | rated | redirected | complaint
      created_at      TIMESTAMPTZ DEFAULT NOW(),
      UNIQUE(tenant_id, tx_id)
    )
  `).catch(() => {});

  await pool.query(`
    CREATE TABLE IF NOT EXISTS tenant_private_feedback (
      id              SERIAL PRIMARY KEY,
      tenant_id       TEXT NOT NULL,
      token           TEXT NOT NULL,
      customer_id     TEXT,
      customer_name   TEXT,
      rating          INTEGER NOT NULL,
      message         TEXT,
      resolved        BOOL DEFAULT false,
      resolved_at     TIMESTAMPTZ,
      created_at      TIMESTAMPTZ DEFAULT NOW()
    )
  `).catch(() => {});
  await pool.query('CREATE INDEX IF NOT EXISTS idx_feedback_tenant ON tenant_private_feedback(tenant_id, resolved, created_at DESC)').catch(() => {});
}

/**
 * [403] Génère un token de feedback et programme l'envoi SMS 90min post-RDV
 */
async function scheduleReviewRequest(pool, tenantId, { txId, customerId, customerName, customerPhone, appointmentEndAt }) {
  await initSchema(pool);
  const token    = crypto.randomBytes(16).toString('hex');
  const sendAt   = new Date((appointmentEndAt ? new Date(appointmentEndAt) : new Date()).getTime() + 90 * 60000);

  await pool.query(`
    INSERT INTO tenant_review_tokens (tenant_id, tx_id, token, customer_id, customer_name, customer_phone, appointment_end)
    VALUES ($1,$2,$3,$4,$5,$6,$7)
    ON CONFLICT (tenant_id, tx_id) DO UPDATE SET token=$3, appointment_end=$7
  `, [tenantId, txId, token, customerId, customerName, customerPhone, appointmentEndAt || new Date().toISOString()]);

  bus.system(`[ReviewGuard] 📅 SMS feedback planifié: ${customerName||customerId} à ${sendAt.toLocaleTimeString('fr-CA')}`);
  return { token, sendAt: sendAt.toISOString(), txId };
}

/**
 * [403] Envoie le SMS de demande d'avis
 */
async function sendReviewRequest(pool, tenantId, { txId, customerId, customerName, customerPhone, appointmentEndAt }) {
  const { token } = await scheduleReviewRequest(pool, tenantId, { txId, customerId, customerName, customerPhone, appointmentEndAt });

  const baseUrl  = process.env.DALEBA_BASE_URL || 'https://daleba-api-production.up.railway.app';
  const feedbackUrl = `${baseUrl}/api/v1/feedback/${token}`;

  if (customerPhone) {
    try {
      const twilio = require('./twilio-sender');
      const msg = `Bonjour ${customerName||''}! Nous espérons que votre soin vous a comblé 🌿 Laissez-nous votre avis (30 secondes) : ${feedbackUrl} — Merci de votre confiance 💜`;
      await twilio.sendSMS({ to: customerPhone, body: msg });
      await pool.query(`UPDATE tenant_review_tokens SET sms_sent_at=NOW(), status='sent' WHERE token=$1`, [token]);
      bus.system(`[ReviewGuard] ✅ SMS envoyé: ${customerPhone}`);
    } catch(e) { bus.system(`[ReviewGuard] ⚠️ SMS échoué: ${e.message}`); }
  }

  return { token, feedbackUrl, sent: !!customerPhone };
}

/**
 * [404-406] Génère la page HTML de notation 5 étoiles
 */
function buildFeedbackPage(token, tenantName = 'votre salon') {
  return `<!DOCTYPE html>
<html lang="fr">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1.0">
<title>Votre avis — ${tenantName}</title>
<style>
*{margin:0;padding:0;box-sizing:border-box}
body{font-family:Inter,-apple-system,sans-serif;background:#fafaf8;min-height:100vh;display:flex;align-items:center;justify-content:center;padding:20px}
.card{background:#fff;border-radius:16px;padding:32px;max-width:400px;width:100%;text-align:center;box-shadow:0 8px 40px rgba(0,0,0,.08)}
.logo{font-size:24px;font-weight:700;color:#7c3aed;margin-bottom:4px}
h2{font-size:20px;color:#1a1a2e;margin:16px 0 8px}
p{color:#64748b;font-size:14px;margin-bottom:24px}
.stars{display:flex;justify-content:center;gap:8px;margin-bottom:24px}
.star{font-size:40px;cursor:pointer;transition:transform .15s;filter:grayscale(1)}
.star:hover,.star.active{filter:none;transform:scale(1.15)}
.btn{width:100%;background:#7c3aed;color:#fff;border:none;border-radius:10px;padding:14px;font-size:16px;font-weight:600;cursor:pointer;transition:opacity .2s;display:none}
.btn:hover{opacity:.85}
#complaint{display:none;margin-top:16px}
#complaint textarea{width:100%;border:1px solid #e2e8f0;border-radius:10px;padding:12px;font-size:13px;min-height:100px;resize:vertical}
#complaint .btn{display:block;margin-top:12px;background:#ef4444}
.thanks{display:none;color:#10b981;font-size:16px;padding:20px}
</style>
</head>
<body>
<div class="card">
  <div class="logo">DALEBA</div>
  <div style="font-size:12px;color:#94a3b8">${tenantName}</div>
  <h2>Comment s'est passé votre soin ? ✨</h2>
  <p>Votre avis nous aide à nous améliorer et à récompenser notre équipe.</p>
  <div class="stars" id="starsRow">
    <span class="star" data-v="1">⭐</span>
    <span class="star" data-v="2">⭐</span>
    <span class="star" data-v="3">⭐</span>
    <span class="star" data-v="4">⭐</span>
    <span class="star" data-v="5">⭐</span>
  </div>
  <button class="btn" id="submitBtn" onclick="submitRating()">Envoyer mon avis</button>
  <div id="complaint">
    <p style="color:#ef4444;font-size:13px">Nous sommes désolés que votre expérience ne soit pas parfaite. Partagez-nous ce qui n'allait pas — nous vous recontacterons rapidement.</p>
    <textarea id="complaintText" placeholder="Décrivez votre expérience..."></textarea>
    <button class="btn" onclick="submitComplaint()">Envoyer en privé</button>
  </div>
  <div class="thanks" id="thanks"></div>
</div>
<script>
var selected = 0;
var TOKEN = '${token}';
document.querySelectorAll('.star').forEach(function(s,i){
  s.addEventListener('mouseover',function(){
    document.querySelectorAll('.star').forEach(function(x,j){x.classList.toggle('active',j<=i);});
  });
  s.addEventListener('click',function(){
    selected=parseInt(s.dataset.v);
    document.querySelectorAll('.star').forEach(function(x,j){x.classList.toggle('active',j<selected);});
    if(selected===5){
      document.getElementById('submitBtn').style.display='block';
      document.getElementById('complaint').style.display='none';
    } else {
      document.getElementById('submitBtn').style.display='none';
      document.getElementById('complaint').style.display='block';
    }
  });
});
document.querySelector('.stars').addEventListener('mouseleave',function(){
  document.querySelectorAll('.star').forEach(function(x,j){x.classList.toggle('active',j<selected);});
});
function submitRating(){
  fetch('/api/v1/feedback/'+TOKEN+'/rate',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({rating:5})})
  .then(r=>r.json()).then(d=>{if(d.redirectUrl)window.location.href=d.redirectUrl;});
}
function submitComplaint(){
  var msg=document.getElementById('complaintText').value;
  fetch('/api/v1/feedback/'+TOKEN+'/rate',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({rating:selected,message:msg})})
  .then(r=>r.json()).then(d=>{
    document.querySelector('.card').innerHTML='<div class="thanks" style="display:block">💚 Merci pour votre retour. Notre équipe vous contactera sous 24h pour arranger les choses.</div>';
  });
}
</script>
</body>
</html>`;
}

/**
 * [405-407] Traite la note soumise
 * 5★ → redirect Google | ≤4★ → doléance privée + alerte
 */
async function processFeedback(pool, tenantId, { token, rating, message }) {
  await initSchema(pool);

  // Récupère le token
  const r = await pool.query(
    `SELECT * FROM tenant_review_tokens WHERE token=$1 AND tenant_id=$2`,
    [token, tenantId]
  ).catch(() => ({ rows: [] }));
  const entry = r.rows[0];
  if (!entry) throw new Error('Token de feedback invalide ou expiré');

  // Met à jour le statut
  const status = rating === 5 ? 'redirected' : 'complaint';
  await pool.query(`UPDATE tenant_review_tokens SET rating=$1, status=$2, opened_at=COALESCE(opened_at,NOW()) WHERE token=$3`, [rating, status, token]);

  if (rating === 5) {
    // [405] Cherche le Google Place ID du tenant
    const s = await pool.query(`SELECT google_place_id FROM tenant_settings WHERE tenant_id=$1`, [tenantId]).catch(() => ({ rows: [] }));
    const placeId     = s.rows[0]?.google_place_id;
    const redirectUrl = placeId
      ? `https://search.google.com/local/writereview?placeid=${placeId}`
      : 'https://google.com';

    bus.system(`[ReviewGuard] ⭐⭐⭐⭐⭐ 5★ reçu de ${entry.customer_name} → redirect Google`);
    return { rating, status: 'redirected', redirectUrl };
  }

  // [406-407] Doléance privée
  await pool.query(`
    INSERT INTO tenant_private_feedback (tenant_id, token, customer_id, customer_name, rating, message)
    VALUES ($1,$2,$3,$4,$5,$6)
  `, [tenantId, token, entry.customer_id, entry.customer_name, rating, message || '']);

  // [407] Alerte gérant
  bus.system(`[ReviewGuard] 🚨 AVIS NÉGATIF ${rating}★ — ${entry.customer_name}: "${(message||'').slice(0,50)}" → alerte HUD`);
  bus.emit('review:negative:alert', { tenantId, rating, customerName: entry.customer_name, message, token });

  // SMS Ulrich
  try {
    const twilio = require('./twilio-sender');
    await twilio.sendSMS({ to: process.env.ULRICH_PHONE_NUMBER, body: `🚨 AVIS PRIVÉ ${rating}★ de ${entry.customer_name}: "${(message||'Sans commentaire').slice(0,60)}". Contactez-le rapidement pour résoudre avant que ça parte sur Google.` });
  } catch {}

  return { rating, status: 'complaint_stored', message: 'Doléance enregistrée. Nous vous recontactons sous 24h.' };
}

module.exports = { scheduleReviewRequest, sendReviewRequest, processFeedback, buildFeedbackPage, initSchema };
