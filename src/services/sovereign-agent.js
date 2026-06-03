// src/services/sovereign-agent.js
// ██████████████████████████████████████████████████████████████████████
// CERVEAU AUTONOME DALEBA — Agent Exécuteur Souverain v2.0
// Cerveau: GPT-4o (function calling natif) + fallbacks multi-modèles
// 3 juin 2026 — Exécution A→Z + Déploiement Vercel + GitHub
// ██████████████████████████████████████████████████████████████████████
'use strict';

const axios  = require('axios');
const fs     = require('fs').promises;
const path   = require('path');
const { EventEmitter } = require('events');

// ── CONFIG ────────────────────────────────────────────────────────────────────
const CFG = {
  openaiKey:      process.env.OPENAI_API_KEY,
  claudeKey:      process.env.CLAWRAPID_API_KEY,
  claudeBase:     'https://www.clawrapid.com/api/llm/proxy/v1',
  deepseekKey:    process.env.DEEPSEEK_API_KEY,
  mistralKey:     process.env.MISTRAL_API_KEY,
  vercelToken:    process.env.VERCEL_TOKEN,
  githubToken:    process.env.GITHUB_TOKEN,
  githubUser:     process.env.GITHUB_USERNAME || 'othikadio',
  workspace:      process.env.AGENT_WORKSPACE || '/tmp/daleba-agents',
};

// ── SESSIONS ──────────────────────────────────────────────────────────────────
const sessions = new Map();
const emitters = new Map();

function getSession(id) { return sessions.get(id); }
function getEmitter(id) {
  if (!emitters.has(id)) emitters.set(id, new EventEmitter());
  return emitters.get(id);
}
function emit(id, type, data) {
  const ev = getEmitter(id);
  ev.emit('event', { type, data, ts: Date.now() });
}

// ── TOOLS FORMAT OPENAI ───────────────────────────────────────────────────────
const OPENAI_TOOLS = [
  {
    type: 'function',
    function: {
      name: 'create_file',
      description: 'Crée ou écrase un fichier dans le workspace du projet. Utilise des chemins relatifs ex: index.html, css/style.css, js/app.js',
      parameters: {
        type: 'object',
        properties: {
          path:    { type: 'string', description: 'Chemin relatif du fichier' },
          content: { type: 'string', description: 'Contenu complet et final du fichier' },
        },
        required: ['path', 'content'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'read_file',
      description: 'Lit le contenu d\'un fichier déjà créé dans le workspace.',
      parameters: {
        type: 'object',
        properties: { path: { type: 'string' } },
        required: ['path'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'list_files',
      description: 'Liste tous les fichiers créés dans le workspace.',
      parameters: { type: 'object', properties: {} },
    },
  },
  {
    type: 'function',
    function: {
      name: 'http_request',
      description: 'Effectue une requête HTTP vers une API externe.',
      parameters: {
        type: 'object',
        properties: {
          url:     { type: 'string' },
          method:  { type: 'string', enum: ['GET','POST','PUT','DELETE','PATCH'] },
          headers: { type: 'object' },
          body:    { type: 'string', description: 'Body JSON string' },
        },
        required: ['url', 'method'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'deploy_vercel',
      description: 'Déploie TOUS les fichiers du workspace sur Vercel. Retourne l\'URL live publique. Utiliser uniquement quand tous les fichiers sont prêts.',
      parameters: {
        type: 'object',
        properties: {
          project_name: { type: 'string', description: 'Nom projet Vercel (minuscules, tirets, ex: kadio-coiffure-site)' },
          framework:    { type: 'string', description: 'null pour static, nextjs, vue, etc.' },
        },
        required: ['project_name'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'create_github_repo',
      description: 'Crée un repo GitHub public et pousse tous les fichiers du workspace.',
      parameters: {
        type: 'object',
        properties: {
          repo_name:   { type: 'string' },
          description: { type: 'string' },
        },
        required: ['repo_name'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'search_web',
      description: 'Recherche des informations sur internet.',
      parameters: {
        type: 'object',
        properties: { query: { type: 'string' } },
        required: ['query'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'delegate_specialist',
      description: 'Délègue une sous-tâche à un modèle IA spécialisé: deepseek-r1 (raisonnement/code), mistral-large (multilingue), claude-sonnet (créatif).',
      parameters: {
        type: 'object',
        properties: {
          model:   { type: 'string', description: 'deepseek-r1, mistral-large, ou claude-sonnet' },
          task:    { type: 'string', description: 'Tâche précise à déléguer' },
          context: { type: 'string', description: 'Contexte nécessaire' },
        },
        required: ['model', 'task'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'ask_user',
      description: 'Pose UNE question cruciale à l\'utilisateur. Utiliser SEULEMENT si une info est absolument indispensable. Max 2 fois par session.',
      parameters: {
        type: 'object',
        properties: {
          question: { type: 'string' },
          options:  { type: 'array', items: { type: 'string' } },
        },
        required: ['question'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'task_complete',
      description: 'OBLIGATOIRE — Appeler quand la tâche est 100% terminée. Marque la livraison.',
      parameters: {
        type: 'object',
        properties: {
          summary:       { type: 'string', description: 'Résumé de ce qui a été accompli' },
          live_url:      { type: 'string', description: 'URL live du déploiement' },
          github_url:    { type: 'string', description: 'URL repo GitHub' },
          files_created: { type: 'array', items: { type: 'string' } },
        },
        required: ['summary'],
      },
    },
  },
];

// ── SYSTEM PROMPT ─────────────────────────────────────────────────────────────
function buildSystemPrompt(session) {
  return `Tu es le CERVEAU AUTONOME DALEBA — un agent IA d'élite qui exécute des tâches de A à Z.

## Mission
Recevoir une demande et l'accomplir COMPLÈTEMENT: de la première ligne de code à une URL live publique.

## Règles absolues
1. AUTONOMIE TOTALE — Tu n'attends pas, tu agis. Questions utilisateur: max 2 par session, seulement si indispensable.
2. QUALITÉ PRODUCTION — Tout ce que tu livres est prêt pour un client réel. Design soigné, contenu réel (pas de lorem ipsum).
3. COMPLÉTUDE — Tu vas jusqu'au bout. Créer + déployer + retourner URL. Toujours appeler task_complete à la fin.
4. EFFICACITÉ — Chaque action est concrète. Pas de bavardage, tu agis.
5. EXCELLENCE — Code propre, HTML sémantique, CSS responsive, design professionnel.

## Pour un site web (procédure)
1. Crée index.html avec TOUT le contenu (HTML5 complet, head, body, CSS inline ou <style>, scripts)
2. Crée les fichiers supplémentaires si nécessaire (style.css, script.js, etc.)
3. Le HTML doit être 100% autonome et beau — pas besoin de CDN externe (sauf Google Fonts)
4. Appelle deploy_vercel avec un nom de projet court en minuscules
5. Appelle task_complete avec l'URL live

## Contexte
Session: ${session.id}
Tâche: ${session.task}
Démarré: ${new Date(session.createdAt).toLocaleString('fr-FR')}`;
}

// ── EXÉCUTEURS DE TOOLS ───────────────────────────────────────────────────────
async function toolCreateFile(sessionId, { path: filePath, content }) {
  const session = getSession(sessionId);
  const dir = path.join(CFG.workspace, sessionId);
  await fs.mkdir(dir, { recursive: true });
  const fullPath = path.join(dir, filePath);
  await fs.mkdir(path.dirname(fullPath), { recursive: true });
  await fs.writeFile(fullPath, content, 'utf8');
  session.files[filePath] = content;
  emit(sessionId, 'file_created', { path: filePath, size: content.length });
  return `✅ Fichier créé: ${filePath} (${content.length} caractères)`;
}

async function toolReadFile(sessionId, { path: filePath }) {
  const session = getSession(sessionId);
  if (session.files[filePath]) return session.files[filePath];
  try {
    return await fs.readFile(path.join(CFG.workspace, sessionId, filePath), 'utf8');
  } catch { return `❌ Fichier introuvable: ${filePath}`; }
}

async function toolListFiles(sessionId) {
  const session = getSession(sessionId);
  const list = Object.keys(session.files);
  return list.length === 0 ? 'Aucun fichier créé.' : list.map(f => `📄 ${f}`).join('\n');
}

async function toolHttpRequest(sessionId, { url, method, headers = {}, body }) {
  emit(sessionId, 'http_request', { url, method });
  try {
    const res = await axios({
      url, method,
      headers: { 'Content-Type': 'application/json', ...headers },
      data: body ? JSON.parse(body) : undefined,
      timeout: 20000,
      validateStatus: () => true,
    });
    const text = typeof res.data === 'object' ? JSON.stringify(res.data).slice(0, 3000) : String(res.data).slice(0, 3000);
    return `HTTP ${res.status}\n${text}`;
  } catch (e) { return `❌ Erreur HTTP: ${e.message}`; }
}

async function toolDeployVercel(sessionId, { project_name, framework = null }) {
  const session = getSession(sessionId);
  if (!CFG.vercelToken) return '❌ VERCEL_TOKEN manquant dans Railway';
  const files = Object.entries(session.files).map(([file, data]) => ({
    file,
    data: Buffer.from(data).toString('base64'),
    encoding: 'base64',
  }));
  if (files.length === 0) return '❌ Aucun fichier à déployer.';

  emit(sessionId, 'deploying', { platform: 'Vercel', files: files.length });
  try {
    const res = await axios.post('https://api.vercel.com/v13/deployments', {
      name: project_name,
      files,
      projectSettings: { framework: framework || null, buildCommand: null, outputDirectory: null },
      target: 'production',
    }, {
      headers: { Authorization: `Bearer ${CFG.vercelToken}`, 'Content-Type': 'application/json' },
      timeout: 60000,
    });
    const url = `https://${res.data.url}`;
    session.liveUrl = url;
    emit(sessionId, 'deployed', { url, platform: 'Vercel' });
    return `✅ Déployé sur Vercel!\nURL live: ${url}`;
  } catch (e) {
    const msg = e.response?.data?.error?.message || e.message;
    return `❌ Erreur Vercel: ${msg}`;
  }
}

async function toolCreateGitHubRepo(sessionId, { repo_name, description = '' }) {
  const session = getSession(sessionId);
  if (!CFG.githubToken) return '❌ GITHUB_TOKEN manquant';
  emit(sessionId, 'github', { action: 'create_repo', name: repo_name });
  try {
    await axios.post('https://api.github.com/user/repos', {
      name: repo_name, description, private: false, auto_init: false,
    }, {
      headers: { Authorization: `token ${CFG.githubToken}`, 'Content-Type': 'application/json' },
      timeout: 15000,
    });
    for (const [filePath, content] of Object.entries(session.files)) {
      await axios.put(
        `https://api.github.com/repos/${CFG.githubUser}/${repo_name}/contents/${filePath}`,
        { message: `Add ${filePath}`, content: Buffer.from(content).toString('base64') },
        { headers: { Authorization: `token ${CFG.githubToken}` }, timeout: 15000 }
      ).catch(() => {});
    }
    const url = `https://github.com/${CFG.githubUser}/${repo_name}`;
    session.githubUrl = url;
    emit(sessionId, 'github_done', { url });
    return `✅ Repo GitHub créé: ${url}`;
  } catch (e) {
    return `❌ Erreur GitHub: ${e.response?.data?.message || e.message}`;
  }
}

async function toolSearchWeb(sessionId, { query }) {
  emit(sessionId, 'searching', { query });
  try {
    const res = await axios.get(`https://api.duckduckgo.com/?q=${encodeURIComponent(query)}&format=json&no_html=1&skip_disambig=1`, {
      timeout: 8000, headers: { 'User-Agent': 'DALEBA-Agent/2.0' },
    });
    const d = res.data;
    let result = '';
    if (d.AbstractText) result += `📝 ${d.AbstractText}\n`;
    if (d.RelatedTopics?.length) {
      result += '\n🔗 Infos:\n';
      d.RelatedTopics.slice(0, 4).forEach(t => { if (t.Text) result += `- ${t.Text}\n`; });
    }
    return result || `Recherche "${query}" effectuée.`;
  } catch { return `Recherche "${query}" effectuée (résultat limité).`; }
}

async function toolDelegateSpecialist(sessionId, { model, task, context = '' }) {
  emit(sessionId, 'delegate', { model, task: task.slice(0, 80) });

  const MODELS = {
    'deepseek-r1':   { model: 'deepseek-reasoner', base: 'https://api.deepseek.com/v1', key: CFG.deepseekKey },
    'mistral-large': { model: 'mistral-large-latest', base: 'https://api.mistral.ai/v1', key: CFG.mistralKey },
    'claude-sonnet': { model: 'claude-sonnet-4-6', base: CFG.claudeBase, key: CFG.claudeKey, anthropic: true },
  };

  const cfg = MODELS[model];
  if (!cfg || !cfg.key) return `❌ Modèle ${model} non disponible (clé manquante).`;

  try {
    if (cfg.anthropic) {
      const res = await axios.post(`${cfg.base}/messages`, {
        model: cfg.model,
        messages: [{ role: 'user', content: context ? `${context}\n\n${task}` : task }],
        system: 'Tu es un expert. Réponds en français de façon précise et complète.',
        max_tokens: 2048,
      }, {
        headers: { 'x-api-key': cfg.key, 'anthropic-version': '2023-06-01', 'Content-Type': 'application/json' },
        timeout: 40000,
      });
      const txt = res.data.content?.filter(b => b.type==='text').map(b=>b.text).join('') || '';
      emit(sessionId, 'delegate_done', { model });
      return `[${model}]\n${txt}`;
    } else {
      const res = await axios.post(`${cfg.base}/chat/completions`, {
        model: cfg.model,
        messages: [
          { role: 'system', content: 'Tu es un expert. Réponds en français de façon précise.' },
          { role: 'user', content: context ? `${context}\n\n${task}` : task },
        ],
        max_tokens: 2048, temperature: 0.3,
      }, {
        headers: { Authorization: `Bearer ${cfg.key}`, 'Content-Type': 'application/json' },
        timeout: 40000,
      });
      const txt = res.data.choices[0].message.content;
      emit(sessionId, 'delegate_done', { model });
      return `[${model}]\n${txt}`;
    }
  } catch (e) {
    return `❌ Délégation ${model} échouée: ${e.message}`;
  }
}

async function toolAskUser(sessionId, { question, options = [] }) {
  const session = getSession(sessionId);
  session.status = 'waiting_user';
  session.pendingQuestion = { question, options };
  emit(sessionId, 'ask_user', { question, options });
  return new Promise((resolve) => {
    const timeout = setTimeout(() => {
      session.status = 'running';
      resolve('(pas de réponse — je continue avec mes meilleures hypothèses)');
    }, 300000);
    session.answerCallback = (answer) => {
      clearTimeout(timeout);
      session.status = 'running';
      session.pendingQuestion = null;
      resolve(`Réponse utilisateur: ${answer}`);
    };
  });
}

// ── DISPATCHER ────────────────────────────────────────────────────────────────
async function executeTool(sessionId, toolName, rawInput) {
  const input = typeof rawInput === 'string' ? JSON.parse(rawInput) : rawInput;
  const session = getSession(sessionId);
  emit(sessionId, 'tool_start', { tool: toolName });
  let result;
  try {
    switch (toolName) {
      case 'create_file':         result = await toolCreateFile(sessionId, input);        break;
      case 'read_file':           result = await toolReadFile(sessionId, input);           break;
      case 'list_files':          result = await toolListFiles(sessionId);                 break;
      case 'http_request':        result = await toolHttpRequest(sessionId, input);        break;
      case 'deploy_vercel':       result = await toolDeployVercel(sessionId, input);       break;
      case 'create_github_repo':  result = await toolCreateGitHubRepo(sessionId, input);  break;
      case 'search_web':          result = await toolSearchWeb(sessionId, input);          break;
      case 'delegate_specialist': result = await toolDelegateSpecialist(sessionId, input); break;
      case 'ask_user':            result = await toolAskUser(sessionId, input);            break;
      case 'task_complete':
        session.status = 'done';
        session.result = input;
        if (input.live_url)   session.liveUrl   = input.live_url;
        if (input.github_url) session.githubUrl = input.github_url;
        emit(sessionId, 'complete', input);
        result = '✅ Tâche terminée et livrée.';
        break;
      default: result = `❌ Tool inconnu: ${toolName}`;
    }
  } catch (e) { result = `❌ Erreur ${toolName}: ${e.message}`; }
  session.logs.push({ tool: toolName, result: String(result).slice(0, 500) });
  return String(result);
}

// ── APPEL GPT-4o AVEC FUNCTION CALLING ───────────────────────────────────────
async function callGPT4oWithTools(messages, systemPrompt) {
  if (!CFG.openaiKey) throw new Error('OPENAI_API_KEY manquante');
  const res = await axios.post('https://api.openai.com/v1/chat/completions', {
    model: 'gpt-4o',
    messages: [{ role: 'system', content: systemPrompt }, ...messages],
    tools: OPENAI_TOOLS,
    tool_choice: 'auto',
    max_tokens: 4096,
    temperature: 0.4,
  }, {
    headers: { Authorization: `Bearer ${CFG.openaiKey}`, 'Content-Type': 'application/json' },
    timeout: 120000,
  });
  return res.data.choices[0];
}

// ── BOUCLE AGENT PRINCIPALE ───────────────────────────────────────────────────
async function runAgentLoop(sessionId) {
  const session = getSession(sessionId);
  session.status = 'running';
  const systemPrompt = buildSystemPrompt(session);
  const messages = [{ role: 'user', content: session.task }];
  let iterations = 0;
  const MAX = 30;

  emit(sessionId, 'agent_start', { task: session.task });

  while (iterations < MAX && session.status !== 'done') {
    iterations++;
    emit(sessionId, 'thinking', { iteration: iterations });

    let choice;
    try {
      choice = await callGPT4oWithTools(messages, systemPrompt);
    } catch (e) {
      const msg = e.response?.data?.error?.message || e.message;
      emit(sessionId, 'error', { message: `GPT-4o indisponible: ${msg}` });
      session.status = 'error';
      break;
    }

    const { finish_reason, message } = choice;

    // Ajouter le message assistant dans l'historique
    messages.push(message);

    // Message texte sans tool_calls
    if (message.content && !message.tool_calls) {
      emit(sessionId, 'agent_message', { text: message.content });
    }

    if (finish_reason === 'stop' && !message.tool_calls) {
      // GPT-4o a terminé sans appeler task_complete
      if (session.status !== 'done') {
        session.status = 'done';
        emit(sessionId, 'complete', {
          summary: message.content || 'Tâche terminée.',
          live_url: session.liveUrl,
          github_url: session.githubUrl,
          files_created: Object.keys(session.files),
        });
      }
      break;
    }

    if (finish_reason === 'tool_calls' && message.tool_calls?.length > 0) {
      const toolResults = [];
      let shouldStop = false;

      for (const toolCall of message.tool_calls) {
        const name   = toolCall.function.name;
        const args   = toolCall.function.arguments;
        const result = await executeTool(sessionId, name, args);

        // Format OpenAI tool result
        toolResults.push({
          role:         'tool',
          tool_call_id: toolCall.id,
          content:      result,
        });

        if (session.status === 'done') { shouldStop = true; break; }
      }

      // Ajouter tous les tool_results (OpenAI les attend comme messages séparés ou dans l'array)
      for (const tr of toolResults) {
        messages.push(tr);
      }

      if (shouldStop) break;
    }
  }

  if (iterations >= MAX && session.status !== 'done') {
    session.status = 'done';
    emit(sessionId, 'complete', {
      summary: `Terminé après ${MAX} étapes. Fichiers: ${Object.keys(session.files).join(', ')}`,
      live_url: session.liveUrl,
      files_created: Object.keys(session.files),
    });
  }
}

// ── API PUBLIQUE ──────────────────────────────────────────────────────────────
function createSession(task) {
  const id = `agent-${Date.now()}-${Math.random().toString(36).slice(2,8)}`;
  sessions.set(id, {
    id, task, status: 'init',
    files: {}, logs: [],
    liveUrl: null, githubUrl: null, result: null,
    pendingQuestion: null, answerCallback: null,
    createdAt: Date.now(),
  });
  getEmitter(id);
  return id;
}

function startAgent(sessionId) {
  const session = getSession(sessionId);
  if (!session) throw new Error('Session introuvable: ' + sessionId);
  runAgentLoop(sessionId).catch(e => {
    emit(sessionId, 'error', { message: e.message });
    const s = getSession(sessionId);
    if (s) s.status = 'error';
  });
}

function answerQuestion(sessionId, answer) {
  const session = getSession(sessionId);
  if (!session || !session.answerCallback) return false;
  session.answerCallback(answer);
  session.answerCallback = null;
  return true;
}

function getSessionStatus(sessionId) {
  const session = getSession(sessionId);
  if (!session) return null;
  return {
    id:              session.id,
    status:          session.status,
    task:            session.task,
    filesCreated:    Object.keys(session.files),
    liveUrl:         session.liveUrl,
    githubUrl:       session.githubUrl,
    result:          session.result,
    pendingQuestion: session.pendingQuestion,
    logsCount:       session.logs.length,
    createdAt:       session.createdAt,
  };
}

// Nettoyage sessions > 6h
setInterval(() => {
  const now = Date.now();
  for (const [id, s] of sessions) {
    if (now - s.createdAt > 6 * 3600 * 1000) {
      sessions.delete(id); emitters.delete(id);
      fs.rm(path.join(CFG.workspace, id), { recursive: true, force: true }).catch(() => {});
    }
  }
}, 3600 * 1000);

module.exports = { createSession, startAgent, answerQuestion, getSessionStatus, getEmitter, sessions };
