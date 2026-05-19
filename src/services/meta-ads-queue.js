'use strict';
/**
 * Meta Ads Queue — DALEBA [483]
 * File d'attente sécurisée si API Meta déconnectée. Retry toutes les 30min.
 */
const bus=require('./event-bus');
const RETRY_MS=30*60*1000;
const _queue=[]; let _timer=null;

function enqueue(operation) {
  const item={...operation,enqueuedAt:new Date().toISOString(),id:`mq_${Date.now()}`};
  _queue.push(item);
  bus.system(`[MetaAdsQueue] 📥 Op en attente: ${operation.type||'?'} (queue: ${_queue.length})`);
  if (!_timer) _timer=setTimeout(async()=>{_timer=null;await drainQueue();if(_queue.length>0)enqueue({type:'_retry'});},RETRY_MS);
  return item.id;
}

async function drainQueue() {
  if (!_queue.length) return {processed:0};
  let processed=0;
  while (_queue.length>0) {
    const item=_queue[0];
    try {
      const metaAds=require('./meta-ads');
      if (item.type&&metaAds[item.type]) await metaAds[item.type](item.params);
      else _queue.shift(); // retire les _retry
      _queue.shift(); processed++;
    } catch {break;}
  }
  if (processed>0) bus.system(`[MetaAdsQueue] ✅ Drain: ${processed} op(s)`);
  return {processed,remaining:_queue.length};
}

module.exports={enqueue,drainQueue,getQueueSize:()=>_queue.length,RETRY_MS};
