/**
 * DALEBA — Protocole de Rollback Vocal Instantané (Point 18)
 * Commande : "DALEBA, annule ça" → revert du dernier commit Git
 * Sécurisé : nécessite la masterKey d'Ulrich
 */

const { execSync, exec } = require('child_process');
const { promisify } = require('util');
const execAsync = promisify(exec);
const { logEntry, ENTRY_TYPES } = require('./journal');

const REPO_PATH = process.env.REPO_PATH || '/app';

/**
 * Récupère le dernier commit (hash + message)
 */
async function getLastCommit() {
  try {
    const { stdout } = await execAsync('git log -1 --format="%H|%s|%ai" --', { cwd: REPO_PATH });
    const [hash, message, date] = stdout.trim().split('|');
    return { hash, message, date };
  } catch (err) {
    throw new Error('Impossible de lire le dernier commit Git: ' + err.message);
  }
}

/**
 * Récupère les N derniers commits
 */
async function getRecentCommits(n = 5) {
  try {
    const { stdout } = await execAsync(`git log -${n} --format="%H|%s|%ai" --`, { cwd: REPO_PATH });
    return stdout.trim().split('\n').map(line => {
      const [hash, message, date] = line.split('|');
      return { hash, message, date };
    });
  } catch (err) {
    throw new Error('Impossible de lire les commits: ' + err.message);
  }
}

/**
 * Rollback du dernier commit (git revert --no-commit + git commit)
 * @param {string} masterKey - Clé maître DALEBA (sécurité)
 * @param {string} reason - Raison du rollback (ex: "correction visuelle demandée par Ulrich")
 */
async function rollbackLast(masterKey, reason = 'Rollback vocal demandé') {
  // Vérification sécurité
  if (masterKey !== process.env.DALEBA_MASTER_KEY) {
    throw new Error('🔒 Clé maître invalide — Rollback refusé');
  }

  // Récupère le commit cible
  const lastCommit = await getLastCommit();

  console.log(`🔄 ROLLBACK — Revert de: [${lastCommit.hash.slice(0, 7)}] ${lastCommit.message}`);

  // Revert propre (crée un nouveau commit de revert)
  const { stdout } = await execAsync(
    `git revert --no-edit HEAD`,
    { cwd: REPO_PATH }
  );

  // Journal
  await logEntry(
    ENTRY_TYPES.CORRECTED,
    `Rollback vocal: revert de "${lastCommit.message}"`,
    reason,
    { revertedHash: lastCommit.hash, trigger: 'vocal_command' }
  );

  return {
    success: true,
    reverted: lastCommit,
    message: `✅ Rollback effectué — Commit [${lastCommit.hash.slice(0, 7)}] annulé`,
    output: stdout,
  };
}

/**
 * Rollback vers un commit spécifique par hash
 * @param {string} targetHash - Hash du commit cible
 * @param {string} masterKey
 */
async function rollbackToCommit(targetHash, masterKey) {
  if (masterKey !== process.env.DALEBA_MASTER_KEY) {
    throw new Error('🔒 Clé maître invalide — Rollback refusé');
  }

  const { stdout } = await execAsync(
    `git revert --no-edit HEAD..${targetHash}`,
    { cwd: REPO_PATH }
  );

  await logEntry(
    ENTRY_TYPES.CORRECTED,
    `Rollback ciblé vers commit ${targetHash.slice(0, 7)}`,
    'Rollback vers commit spécifique',
    { targetHash, trigger: 'manual' }
  );

  return { success: true, targetHash, output: stdout };
}

/**
 * Détecte si un message vocal contient une commande de rollback
 * Patterns reconnus :
 * - "DALEBA, annule ça"
 * - "annule le dernier changement"
 * - "reviens en arrière"
 * - "rollback"
 * - "c'était mieux avant"
 */
function detectRollbackIntent(message) {
  const patterns = [
    /annule?\s+(ça|ca|le\s+dernier|les?\s+dernier)/i,
    /reviens?\s+en\s+arrière/i,
    /rollback/i,
    /c'était\s+mieux\s+avant/i,
    /défais?\s+(ça|ca|le\s+dernier)/i,
    /revert/i,
  ];
  return patterns.some(p => p.test(message));
}

module.exports = {
  getLastCommit,
  getRecentCommits,
  rollbackLast,
  rollbackToCommit,
  detectRollbackIntent,
};
