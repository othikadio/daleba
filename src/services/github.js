/**
 * DALEBA — GitHub API Service (Point 14)
 * Lit, crée et met à jour des fichiers dans le repo GitHub.
 */

const GITHUB_TOKEN = process.env.GITHUB_TOKEN || 'REDACTED_USE_ENV';
const REPO = 'othikadio/daleba';
const BASE = 'https://api.github.com';

function headers() {
  return {
    Authorization: `Bearer ${GITHUB_TOKEN}`,
    Accept: 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28',
    'Content-Type': 'application/json',
    'User-Agent': 'DALEBA-Core/1.0',
  };
}

/**
 * Récupère le contenu d'un fichier (décodé base64)
 */
async function getFile(filePath) {
  const url = `${BASE}/repos/${REPO}/contents/${filePath}`;
  const res = await fetch(url, { headers: headers() });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(`GitHub getFile [${res.status}]: ${err.message || res.statusText}`);
  }
  const data = await res.json();
  return {
    sha: data.sha,
    content: Buffer.from(data.content, 'base64').toString('utf8'),
    raw: data,
  };
}

/**
 * Crée un nouveau fichier dans le repo
 */
async function createFile(filePath, content, message = 'feat: auto-create via DALEBA') {
  const url = `${BASE}/repos/${REPO}/contents/${filePath}`;
  const body = {
    message,
    content: Buffer.from(content).toString('base64'),
  };
  const res = await fetch(url, {
    method: 'PUT',
    headers: headers(),
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(`GitHub createFile [${res.status}]: ${err.message || res.statusText}`);
  }
  return await res.json();
}

/**
 * Met à jour un fichier existant (sha requis)
 */
async function updateFile(filePath, content, sha, message = 'chore: auto-update via DALEBA') {
  const url = `${BASE}/repos/${REPO}/contents/${filePath}`;
  const body = {
    message,
    content: Buffer.from(content).toString('base64'),
    sha,
  };
  const res = await fetch(url, {
    method: 'PUT',
    headers: headers(),
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(`GitHub updateFile [${res.status}]: ${err.message || res.statusText}`);
  }
  return await res.json();
}

/**
 * Liste les fichiers d'un dossier
 */
async function listFiles(dir) {
  const url = `${BASE}/repos/${REPO}/contents/${dir}`;
  const res = await fetch(url, { headers: headers() });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(`GitHub listFiles [${res.status}]: ${err.message || res.statusText}`);
  }
  const data = await res.json();
  return Array.isArray(data) ? data.map(f => ({
    name: f.name,
    path: f.path,
    type: f.type, // 'file' | 'dir'
    sha: f.sha,
    size: f.size,
  })) : [];
}

/**
 * Crée une nouvelle branche depuis une branche existante
 */
async function createBranch(name, fromBranch = 'main') {
  // Récupère le SHA du dernier commit de la branche source
  const refUrl = `${BASE}/repos/${REPO}/git/ref/heads/${fromBranch}`;
  const refRes = await fetch(refUrl, { headers: headers() });
  if (!refRes.ok) {
    throw new Error(`GitHub createBranch — impossible de lire la ref '${fromBranch}'`);
  }
  const refData = await refRes.json();
  const sha = refData.object.sha;

  // Crée la nouvelle branche
  const createUrl = `${BASE}/repos/${REPO}/git/refs`;
  const body = {
    ref: `refs/heads/${name}`,
    sha,
  };
  const res = await fetch(createUrl, {
    method: 'POST',
    headers: headers(),
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(`GitHub createBranch [${res.status}]: ${err.message || res.statusText}`);
  }
  return await res.json();
}

module.exports = { getFile, createFile, updateFile, listFiles, createBranch };
