'use strict';
/**
 * Dynamic Skill Injector — DALEBA [608]
 * Traduit et adapte les scripts certifiés sains en modules compatibles DALEBA.
 * Standardisation: JSDoc + EventBus + isolation multi-tenant.
 * JAMAIS exécuté sans passage par PoisonDetector + approbation Ulrich [609].
 */
const bus    = require('./event-bus');
const crypto = require('crypto');
const path   = require('path');
const fs     = require('fs');

const SKILLS_DIR = path.join(__dirname, '../services/dynamic_skills');

function ensureSkillsDir() {
  if (!fs.existsSync(SKILLS_DIR)) fs.mkdirSync(SKILLS_DIR, { recursive: true });
}

/**
 * [608] Adapte un code externe en module DALEBA standardisé
 * Retourne le texte adapté pour validation humaine — n'écrit RIEN [609]
 */
function adaptCodeToDALEBA(rawCode, skillMeta) {
  const { skillId, title, sourceUrl, author } = skillMeta;
  const moduleName = `skill_${skillId.replace(/[^a-zA-Z0-9]/g, '_').toLowerCase()}`;
  const hash = crypto.createHash('sha256').update(rawCode).digest('hex').slice(0, 16);
  const timestamp = new Date().toISOString();

  const adapted = `'use strict';
/**
 * @module ${moduleName}
 * @description DALEBA Dynamic Skill — Auto-adapté depuis source externe certifiée saine
 * @source ${sourceUrl || 'unknown'}
 * @author ${author || 'unknown'}
 * @originalTitle ${title}
 * @certifiedAt ${timestamp}
 * @integrityHash SHA-256:${hash}
 * @status STAGED_EVOLUTION — Requiert approbation Ulrich avant activation [609]
 */
const bus = require('../event-bus');

/**
 * DALEBA Skill Wrapper — Isolation multi-tenant intégrée
 * @param {object} pool - Pool PostgreSQL tenant-isolé
 * @param {string} tenantId - Identifiant tenant
 * @param {object} params - Paramètres d'exécution
 * @returns {Promise<object>} Résultat encapsulé
 */
async function execute(pool, tenantId, params = {}) {
  bus.system(\`[DynamicSkill:${skillId}] 🔄 Exécution tenant=\${tenantId}\`);
  try {
    // ─── CODE ADAPTÉ (certifié sain) ────────────────────────────────
    ${rawCode.split('\n').join('\n    ')}
    // ────────────────────────────────────────────────────────────────
  } catch(e) {
    bus.system(\`[DynamicSkill:${skillId}] ❌ Erreur: \${e.message}\`);
    throw e;
  }
}

module.exports = { execute, skillId: '${skillId}', title: '${title}', hash: '${hash}' };
`;
  return {
    moduleName, adapted, hash, skillId,
    targetPath: `src/services/dynamic_skills/${moduleName}.js`,
  };
}

/**
 * [608] Écrit le module dans dynamic_skills/ — UNIQUEMENT après approbation Ulrich [609]
 * Appelé EXCLUSIVEMENT depuis sovereign-upgrade-guard.runAssimilationPipeline()
 */
function writeApprovedSkill(adaptedCode, targetPath) {
  ensureSkillsDir();
  const fullPath = path.join(__dirname, '../../', targetPath);
  fs.writeFileSync(fullPath, adaptedCode, 'utf8');
  bus.system(`[SkillInjector] ✅ Skill écrite: ${targetPath}`);
  return { written: true, path: fullPath };
}

module.exports = { adaptCodeToDALEBA, writeApprovedSkill, SKILLS_DIR };
