'use strict';
/**
 * Voice Aesthetics Extractor — DALEBA Metacortex Point 375
 */
const bus = require('./event-bus');
const PATTERNS = [
  { regex: /fiche.{0,20}peau.{0,30}de\s+(\w+)/i,        action:'get_aesthetic_record', n:1 },
  { regex: /profil.{0,10}cut.{0,30}de\s+(\w+)/i,        action:'get_aesthetic_record', n:1 },
  { regex: /recomm.{0,20}botanique.{0,30}(?:pour|de)\s+(\w+)/i, action:'recommend_botanicals', n:1 },
  { regex: /évolution.{0,20}peau.{0,30}de\s+(\w+)/i,    action:'compare_progress', n:1 },
  { regex: /qui\s+(?:a|ont?)\s+(?:la\s+)?peau\s+(\w+)/i,action:'list_by_skin_type', n:1 },
];
function extractAestheticIntent(utterance) {
  for (const p of PATTERNS) {
    const m = (utterance||'').match(p.regex);
    if (m) { const n=m[p.n]; return { action:p.action, clientName:n?n[0].toUpperCase()+n.slice(1):null, raw:utterance, confidence:0.90 }; }
  }
  return null;
}
async function handleVoiceAestheticCommand(pool, tenantId, utterance) {
  const intent = extractAestheticIntent(utterance);
  if (!intent) return null;
  if (intent.action === 'get_aesthetic_record' && intent.clientName) {
    const r = await pool.query(`SELECT client_name,skin_type,hydration_index,botanical_prefs FROM tenant_aesthetic_records WHERE tenant_id=$1 AND LOWER(client_name) LIKE LOWER($2) LIMIT 1`, [tenantId, `%${intent.clientName}%`]).catch(()=>({rows:[]}));
    const rec = r.rows[0];
    if (!rec) return { spoken:`Pas de fiche esthétique pour ${intent.clientName}.`, intent };
    const bots = (rec.botanical_prefs||[]).slice(0,3).join(', ')||'aucune préférence';
    return { spoken:`Fiche de ${rec.client_name}: peau ${rec.skin_type||'inconnue'}, hydratation ${rec.hydration_index||'—'}. Botaniques: ${bots}.`, record:rec, intent };
  }
  return { spoken:`Commande "${intent.action}" reçue.`, intent };
}
module.exports = { extractAestheticIntent, handleVoiceAestheticCommand, PATTERNS };
