'use strict';
/**
 * Evolution Sandbox — DALEBA [604,605]
 * Sandbox hermétique pour analyse de code externe.
 * PRINCIPE [605]: aucun code externe n'entre dans le thread principal sans passer ici.
 */
const bus = require('./event-bus');
const crypto = require('crypto');
const { VM } = (() => { try { return require('vm2'); } catch { return { VM: null }; } })();

// Limite d'exécution stricte
const SANDBOX_TIMEOUT_MS  = 3000;
const MAX_CODE_SIZE_BYTES  = 50_000; // 50 KB max

// API whitelist — seules ces opérations sont autorisées dans le sandbox
const SAFE_GLOBALS = {
  console: { log: () => {}, warn: () => {}, error: () => {} },
  Math, JSON, Date, parseInt, parseFloat, isNaN, isFinite,
  Buffer: { from: () => null }, // Buffer read-only mock
  setTimeout: () => {}, clearTimeout: () => {},
};

/**
 * [604] Exécution hermétique via vm2 ou fallback analyse statique
 * JAMAIS d'accès réseau, fs, process dans le sandbox
 */
async function runInSandbox(code, options = {}) {
  if (!code || typeof code !== 'string')
    return { success: false, error: 'Code invalide' };
  if (Buffer.byteLength(code) > MAX_CODE_SIZE_BYTES)
    return { success: false, error: `Code trop volumineux (max ${MAX_CODE_SIZE_BYTES} octets)` };

  const hash = crypto.createHash('sha256').update(code).digest('hex').slice(0, 16);
  bus.system(`[Sandbox] 🔒 Analyse hermétique — hash: ${hash}`);

  // Essai vm2 (niveau production)
  if (VM) {
    try {
      const vm = new VM({
        timeout: SANDBOX_TIMEOUT_MS,
        sandbox: { ...SAFE_GLOBALS },
        allowAsync: false,
        fixAsync: true,
      });
      const result = vm.run(`(function() { ${code} })()`);
      return { success: true, hash, result: result !== undefined ? String(result).slice(0, 500) : null, engine: 'vm2' };
    } catch(e) {
      return { success: false, hash, error: e.message.slice(0, 200), engine: 'vm2' };
    }
  }

  // Fallback: analyse statique uniquement (pas d'exécution)
  return staticAnalyze(code, hash);
}

/**
 * Analyse statique — détecte les patterns sans exécuter
 */
function staticAnalyze(code, hash) {
  const patterns = [
    { re: /require\s*\(\s*['"]fs['"]/,        issue: 'Accès fs détecté' },
    { re: /require\s*\(\s*['"]child_process['"]/,issue:'child_process détecté'},
    { re: /process\.(env|exit|kill)/,           issue: 'Accès process détecté' },
    { re: /fetch\s*\(|axios\s*\.|http\.get/,    issue: 'Requête réseau détectée' },
    { re: /eval\s*\(|new\s+Function\s*\(/,      issue: 'eval/Function dynamique' },
  ];
  const issues = patterns.filter(p => p.re.test(code)).map(p => p.issue);
  return {
    success: issues.length === 0,
    hash, engine: 'static_analysis',
    issues: issues.length ? issues : null,
    note: 'vm2 non disponible — analyse statique uniquement',
  };
}

module.exports = { runInSandbox, staticAnalyze, SANDBOX_TIMEOUT_MS, MAX_CODE_SIZE_BYTES };
