'use strict';
/**
 * Payroll Worker Client — Point 342
 * Lance le worker enfant et envoie les calculs lourds en dehors de l'event loop principal.
 */
const { fork } = require('child_process');
const path     = require('path');
const bus      = require('./event-bus');

const WORKER_PATH = path.join(__dirname, '../workers/payroll-worker.js');
const TIMEOUT_MS  = 30_000;

let _worker = null;
const _pending = new Map(); // requestId → { resolve, reject, timer }

function getWorker() {
  if (_worker && !_worker.killed) return _worker;

  _worker = fork(WORKER_PATH, [], { silent: true });

  _worker.on('message', ({ requestId, result, error, fatal }) => {
    const p = _pending.get(requestId);
    if (!p) return;
    clearTimeout(p.timer);
    _pending.delete(requestId);
    if (error) p.reject(new Error(error));
    else       p.resolve(result);
    if (fatal) { _worker = null; } // respawn au prochain appel
  });

  _worker.on('error', (err) => {
    bus.system(`[PayrollWorker] Erreur enfant: ${err.message}`);
    _worker = null;
  });

  _worker.on('exit', () => { _worker = null; });
  bus.system('[PayrollWorker] Worker enfant démarré');
  return _worker;
}

function runInWorker(action, payload) {
  return new Promise((resolve, reject) => {
    const requestId = `req_${Date.now()}_${Math.random().toString(36).slice(2,8)}`;
    const timer = setTimeout(() => {
      _pending.delete(requestId);
      reject(new Error(`[PayrollWorker] Timeout ${action}`));
    }, TIMEOUT_MS);

    _pending.set(requestId, { resolve, reject, timer });
    try { getWorker().send({ action, payload, requestId }); }
    catch(e) { _pending.delete(requestId); clearTimeout(timer); reject(e); }
  });
}

module.exports = { runInWorker };
