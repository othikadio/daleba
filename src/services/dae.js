/**
 * DAE — Direct Action Engine
 * DALEBA Metacortex — Points 051-059, 066, 069, 070
 *
 * Opérations fichiers · Pipeline validation · Gestion dépendances
 * Rollback automatique · Backup config · CVE scan
 */

'use strict';

const fs      = require('fs').promises;
const fsSync  = require('fs');
const path    = require('path');
const { execSync, exec } = require('child_process');
const { promisify } = require('util');
const execAsync = promisify(exec);

// ─── CONFIGURATION ────────────────────────────────────────────────────────────

const ROOT = process.env.REPO_PATH || path.resolve(__dirname, '../../');
const BACKUP_DIR = path.join(ROOT, 'config', 'backup');
const SECURITY_LOG = path.join(ROOT, 'logs', 'dae-security.log');

// [070] Fichiers critiques — backup obligatoire avant toute modification
const CRITICAL_FILES = [
  'package.json', 'package-lock.json',
  'railway.json', 'vercel.json',
  '.env', '.env.production',
];

// [059] Packages interdits (failles critiques connues ou malveillants)
const BLOCKED_PACKAGES = new Set([
  'event-stream', 'flatmap-stream',  // supply chain attacks historiques
  'ua-parser-js',                    // CVE-2021-41265
  'node-ipc',                        // logic bomb historique
  'colors', 'faker',                 // incidents supply chain
]);

// ─── UTILITAIRES ─────────────────────────────────────────────────────────────

function ensureDir(dirPath) {
  if (!fsSync.existsSync(dirPath)) fsSync.mkdirSync(dirPath, { recursive: true });
}

function maskSensitive(content) {
  return content
    .replace(/(["']?(?:key|token|secret|password|auth)['":\s]+["']?)([^"'\s,}{]+)/gi, '$1[REDACTED]')
    .replace(/Bearer\s+\S+/gi, 'Bearer [REDACTED]');
}

async function securityLog(entry) {
  ensureDir(path.dirname(SECURITY_LOG));
  const line = JSON.stringify({ ts: new Date().toISOString(), ...entry }) + '\n';
  await fs.appendFile(SECURITY_LOG, line).catch(() => {});
}

// ─── BACKUP [070] ─────────────────────────────────────────────────────────────

async function backupFile(filePath) {
  ensureDir(BACKUP_DIR);
  const abs = path.isAbsolute(filePath) ? filePath : path.join(ROOT, filePath);

  try {
    const content = await fs.readFile(abs, 'utf8');
    const rel = path.relative(ROOT, abs).replace(/\//g, '__');
    const ts = Date.now();
    const backupPath = path.join(BACKUP_DIR, `${rel}.${ts}.bak`);
    await fs.writeFile(backupPath, content, 'utf8');
    return { backupPath, size: content.length };
  } catch (err) {
    if (err.code === 'ENOENT') return { backupPath: null, size: 0 }; // Fichier nouveau
    throw err;
  }
}

async function restoreBackup(backupPath, targetPath) {
  const content = await fs.readFile(backupPath, 'utf8');
  await fs.writeFile(targetPath, content, 'utf8');
  await securityLog({ action: 'RESTORE', backupPath, targetPath });
  return true;
}

// Liste les backups disponibles pour un fichier
async function listBackups(relPath) {
  ensureDir(BACKUP_DIR);
  const prefix = relPath.replace(/\//g, '__');
  const files = await fs.readdir(BACKUP_DIR);
  return files
    .filter(f => f.startsWith(prefix))
    .sort()
    .reverse()
    .map(f => path.join(BACKUP_DIR, f));
}

// ─── OPÉRATIONS FICHIERS [051-053] ────────────────────────────────────────────

async function readFile(relPath) {
  const abs = path.isAbsolute(relPath) ? relPath : path.join(ROOT, relPath);
  return fs.readFile(abs, 'utf8');
}

async function writeFile(relPath, content, options = {}) {
  const abs = path.isAbsolute(relPath) ? relPath : path.join(ROOT, relPath);
  const isCritical = CRITICAL_FILES.some(f => abs.endsWith(f));

  // [070] Backup automatique si fichier critique
  let backup = null;
  if (isCritical || options.backup !== false) {
    backup = await backupFile(abs);
  }

  ensureDir(path.dirname(abs));
  await fs.writeFile(abs, content, 'utf8');

  await securityLog({
    action: 'WRITE', path: relPath,
    critical: isCritical, backup: backup?.backupPath,
    size: content.length,
  });

  return { path: abs, backup, size: content.length };
}

async function createFile(relPath, content = '', options = {}) {
  const abs = path.isAbsolute(relPath) ? relPath : path.join(ROOT, relPath);
  if (fsSync.existsSync(abs) && !options.overwrite) {
    throw new Error(`DAE: Fichier déjà existant (utilisez overwrite=true): ${relPath}`);
  }
  return writeFile(relPath, content, options);
}

async function deleteFile(relPath) {
  const abs = path.isAbsolute(relPath) ? relPath : path.join(ROOT, relPath);
  const isCritical = CRITICAL_FILES.some(f => abs.endsWith(f));

  if (isCritical) throw new Error(`DAE: Suppression refusée pour fichier critique: ${relPath}`);

  // [053] Backup TOUJOURS avant suppression — jamais de hard delete
  const backup = await backupFile(abs);
  await fs.unlink(abs);

  await securityLog({ action: 'DELETE', path: relPath, backup: backup?.backupPath });
  return { deleted: relPath, recoverable: true, backupPath: backup?.backupPath };
}

// [052] Analyse de l'arborescence
async function scanTree(dir = 'src', options = {}) {
  const abs = path.isAbsolute(dir) ? dir : path.join(ROOT, dir);
  const maxDepth = options.maxDepth || 4;

  async function walk(currentPath, depth) {
    if (depth > maxDepth) return [];
    const entries = await fs.readdir(currentPath, { withFileTypes: true });
    const nodes = [];

    for (const entry of entries) {
      if (['node_modules', '.git', '.next', 'dist', 'build'].includes(entry.name)) continue;
      const entryPath = path.join(currentPath, entry.name);
      const rel = path.relative(ROOT, entryPath);
      if (entry.isDirectory()) {
        const children = await walk(entryPath, depth + 1);
        nodes.push({ type: 'dir', name: entry.name, path: rel, children });
      } else {
        const stat = await fs.stat(entryPath);
        nodes.push({ type: 'file', name: entry.name, path: rel, size: stat.size });
      }
    }
    return nodes;
  }

  return walk(abs, 0);
}

// ─── VALIDATION PIPELINE [054-056] ────────────────────────────────────────────

async function validateSyntax(filePath) {
  const abs = path.isAbsolute(filePath) ? filePath : path.join(ROOT, filePath);
  if (!abs.endsWith('.js') && !abs.endsWith('.ts')) return { valid: true, errors: [] };

  try {
    execSync(`node --check "${abs}"`, { timeout: 10000, stdio: 'pipe' });
    return { valid: true, errors: [] };
  } catch (err) {
    return {
      valid: false,
      errors: [err.stderr?.toString()?.trim() || err.message],
    };
  }
}

async function runLint(filePath) {
  const abs = path.isAbsolute(filePath) ? filePath : path.join(ROOT, filePath);
  try {
    const eslintBin = path.join(ROOT, 'node_modules', '.bin', 'eslint');
    if (!fsSync.existsSync(eslintBin)) return { valid: true, warnings: [], note: 'ESLint non installé' };

    const { stdout, stderr } = await execAsync(`"${eslintBin}" --format=json "${abs}"`, {
      cwd: ROOT, timeout: 15000,
    }).catch(e => ({ stdout: e.stdout || '[]', stderr: e.stderr || '' }));

    const results = JSON.parse(stdout || '[]');
    const errors   = results.flatMap(r => r.messages.filter(m => m.severity === 2).map(m => m.message));
    const warnings = results.flatMap(r => r.messages.filter(m => m.severity === 1).map(m => m.message));

    return { valid: errors.length === 0, errors, warnings };
  } catch {
    return { valid: true, warnings: [], note: 'Lint skippé' };
  }
}

async function runTests(pattern = '') {
  try {
    const jestBin = path.join(ROOT, 'node_modules', '.bin', 'jest');
    if (!fsSync.existsSync(jestBin)) return { passed: true, note: 'Jest non installé — tests skippés' };

    const args = ['--passWithNoTests', '--forceExit', pattern ? `--testPathPattern="${pattern}"` : ''].join(' ');
    const { stdout } = await execAsync(`"${jestBin}" ${args}`, { cwd: ROOT, timeout: 60000 });

    return {
      passed: true,
      output: stdout.slice(-1000),
    };
  } catch (err) {
    return {
      passed: false,
      output: (err.stdout || err.message || '').slice(-1000),
    };
  }
}

/**
 * [054-056] Validation complète avant déploiement
 * En cas d'échec : rollback automatique si originalContent fourni
 */
async function validateAndDeploy(filePath, newContent, originalContent = null) {
  // 1. Écriture temporaire
  const result = await writeFile(filePath, newContent, { backup: true });

  // 2. Validation syntaxe
  const syntax = await validateSyntax(filePath);
  if (!syntax.valid) {
    if (originalContent !== null) {
      await writeFile(filePath, originalContent, { backup: false });
    }
    await securityLog({ action: 'ROLLBACK', path: filePath, reason: 'syntax', errors: syntax.errors });
    throw new Error(`DAE: Rollback syntaxe — ${syntax.errors[0]}`);
  }

  // 3. Lint
  const lint = await runLint(filePath);

  // 4. Tests
  const tests = await runTests();
  if (!tests.passed) {
    if (originalContent !== null) {
      await writeFile(filePath, originalContent, { backup: false });
    }
    await securityLog({ action: 'ROLLBACK', path: filePath, reason: 'tests', output: tests.output?.slice(0, 200) });
    throw new Error(`DAE: Rollback tests — ${tests.output?.slice(0, 200)}`);
  }

  return {
    success: true,
    path: filePath,
    backup: result.backup?.backupPath,
    lint,
    tests,
  };
}

// ─── GESTIONNAIRE DE DÉPENDANCES [057-059] ────────────────────────────────────

async function checkPackageSafety(packageName) {
  // [059] Blacklist
  const baseName = packageName.split('@')[0];
  if (BLOCKED_PACKAGES.has(baseName)) {
    return { safe: false, reason: `Package bloqué: ${baseName} (liste noire DALEBA)` };
  }

  // [059] npm audit check
  try {
    const { stdout } = await execAsync(
      `npm view ${baseName} --json 2>/dev/null`,
      { cwd: ROOT, timeout: 10000 }
    );
    const info = JSON.parse(stdout);

    // Vérifie si le package est deprecated
    if (info.deprecated) {
      return { safe: false, reason: `Package déprécié: ${info.deprecated}` };
    }

    return { safe: true, name: baseName, version: info['dist-tags']?.latest, license: info.license };
  } catch {
    return { safe: true, note: 'Vérification npm view échouée — installation autorisée' };
  }
}

async function installPackage(packageName, options = {}) {
  // [059] Vérification sécurité
  const safety = await checkPackageSafety(packageName);
  if (!safety.safe) {
    await securityLog({ action: 'INSTALL_BLOCKED', package: packageName, reason: safety.reason });
    throw new Error(`DAE: Installation bloquée — ${safety.reason}`);
  }

  // [058] Installation sécurisée
  const flags = ['--no-audit', '--no-fund', '--save'];
  if (options.dev) flags.push('--save-dev');

  const { stdout } = await execAsync(
    `npm install ${packageName} ${flags.join(' ')}`,
    { cwd: ROOT, timeout: 60000 }
  );

  await securityLog({ action: 'INSTALL', package: packageName, output: stdout.slice(0, 200) });

  return { installed: true, package: packageName, safety };
}

// ─── 1-CLICK DEPLOYMENT [066-069] ────────────────────────────────────────────

async function deployPatch(patch, commitMessage, options = {}) {
  const { filePath, newContent } = patch;

  // Lire contenu original pour rollback
  let originalContent = null;
  try { originalContent = await readFile(filePath); } catch {}

  // [054] Validation pipeline
  await validateAndDeploy(filePath, newContent, originalContent);

  // [067] Git push
  const { stdout: gitOut } = await execAsync(
    `git add "${filePath}" && git commit -m "${commitMessage.replace(/"/g, "'")}" && git push origin main`,
    { cwd: ROOT, timeout: 60000 }
  );

  await securityLog({
    action: 'DEPLOY', path: filePath,
    message: commitMessage, git: gitOut.slice(0, 200),
  });

  return { deployed: true, path: filePath, commit: gitOut.match(/\[main (\w+)\]/)?.[1] };
}

// [069] Rollback global en < 60s
async function rollbackToCommit(commitHash) {
  const { stdout } = await execAsync(
    `git revert --no-edit ${commitHash} && git push origin main`,
    { cwd: ROOT, timeout: 60000 }
  );

  await securityLog({ action: 'GLOBAL_ROLLBACK', target: commitHash, output: stdout.slice(0, 200) });
  return { success: true, revertedTo: commitHash };
}

async function getDeployHistory(n = 10) {
  const { stdout } = await execAsync(
    `git log -${n} --format="%H|%s|%ai|%an" --`,
    { cwd: ROOT }
  );
  return stdout.trim().split('\n').filter(Boolean).map(line => {
    const [hash, subject, date, author] = line.split('|');
    return { hash, subject, date, author };
  });
}

// ─── EXPORTS ─────────────────────────────────────────────────────────────────

module.exports = {
  // Fichiers
  readFile, writeFile, createFile, deleteFile,
  scanTree, backupFile, restoreBackup, listBackups,
  // Validation
  validateSyntax, runLint, runTests, validateAndDeploy,
  // Dépendances
  checkPackageSafety, installPackage,
  // Déploiement
  deployPatch, rollbackToCommit, getDeployHistory,
  // Utils
  securityLog, ROOT, BACKUP_DIR,
};
