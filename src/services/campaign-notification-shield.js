'use strict';
/**
 * Campaign Notification Shield — DALEBA [470]
 * Bloque les alertes stock/ROAS en boucle si valeur inchangée dans la journée.
 */
const bus=require('./event-bus');
const COOLDOWN_MS=24*60*60*1000;
const _state=new Map();

function shouldNotify(key, currentValue, valueOverride) {
  // Support 3-arg form: shouldNotify(tenantId, alertType, value)
  // In that case build a compound key and use valueOverride as the tracked value
  let trackKey = key;
  let trackValue = currentValue;
  if (valueOverride !== undefined) {
    trackKey = `${key}:${currentValue}`;
    trackValue = valueOverride;
  }
  const now=Date.now(); const entry=_state.get(trackKey);
  if (!entry){_state.set(trackKey,{lastValue:String(trackValue),lastSentAt:now});return true;}
  const changed=entry.lastValue!==String(trackValue);
  const expired=now-entry.lastSentAt>=COOLDOWN_MS;
  if (changed||expired){_state.set(trackKey,{lastValue:String(trackValue),lastSentAt:now});return true;}
  return false;
}

async function guardedAlert(tenantId,alertType,currentValue,sendFn) {
  const key=`${tenantId}:${alertType}`;
  if (shouldNotify(key,currentValue)) return sendFn();
  bus.system(`[NotifShield] 🛡️ Alerte ${alertType} bloquée (valeur inchangée: ${currentValue})`);
  return {blocked:true,reason:'value_unchanged_cooldown'};
}

function resetAlert(tenantId,alertType){_state.delete(`${tenantId}:${alertType}`);}
module.exports={shouldNotify,guardedAlert,resetAlert,COOLDOWN_MS};
