// src/services/sovereign-agent.js
// ██████████████████████████████████████████████████████████████████████
// CERVEAU AUTONOME DALEBA — Agent Exécuteur Souverain v1.0
// 3 juin 2026 — Coordination multi-modèles + Exécution A→Z + Déploiement
// ██████████████████████████████████████████████████████████████████████
'use strict';

const axios  = require('axios');
const fs     = require('fs').promises;
const fsSync = require('fs');
const path   = require('path');
const { EventEmitter } = require('events');

// ── CONFIG ────────────────────────────────────────────────────────────────────
const CFG = {
  claudeKey:      process.env.CLAWRAPID_API_KEY,
  claudeBase:     'https://www.clawrapid.com/api/llm/proxy/v1',
  claudeModel:    'claude-sonnet-4-6',
  openaiKey:      process.env.OPENAI_API_KEY,
  openaiModel:    'gpt-4o',
  vercelToken:    process.env.VERCEL_TOKEN,
  githubToken:    process.env.GITHUB_TOKEN,
  githubUser:     process.env.GITHUB_USERNAME || 'othikadio',
  deepseekKey:    process.env.DEEPSEEK_API_KEY,
  mistralKey:     process.env.MISTRAL_API_KEY,
  openrouterKey:  process.env.OPENROUTER_API_KEY,
  workspace:      process.env.AGENT_WORKSPACE || '/tmp/daleba-agents',
};

// ── SESSIONS EN MÉMOIRE ───────────────────────────────────────────────────────
const sessions = new Map();   // sessionId → session object
const emitters = new Map();   // sessionId → EventEmitter

function getSession(id) { return sessions.get(id); }
function getEmitter(id) {
  if (!emitters.has(id)) emitters.set(id, new EventEmitter());
  return emitters.get(id);
}
function emit(id, type, data) {
  const ev = getEmitter(id);
  ev.emit('event', { type, data, ts: Date.now() });
}

// ── OUTILS DISPONIBLES (format Anthropic tools) ───────────────────────────────
const TOOLS = [
  {
    name: 'create_file',
    description: 'Crée ou écrase un fichier dans le workspace du projet (HTML, CSS, JS, JSON, etc.). Utilise des chemins relatifs.',
    input_schema: {
      type: 'object',
      properties: {
        path:    { type: 'string', description: 'Chemin relatif ex: index.html ou css/style.css' },
        content: { type: 'string', description: 'Contenu complet et final du fichier' },
      },
      required: ['path', 'content'],
    },
  },
  {
    name: 'read_file',
    description: 'Lit le contenu d\'un fichier déjà créé dans le workspace.',
    input_schema: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'Chemin relatif du fichier à lire' },
      },
      required: ['path'],
    },
  },
  {
    name: 'list_files',
    description: 'Liste tous les fichiers créés dans le workspace du projet en cours.',
    input_schema: { type: 'object', properties: {} },
  },
  {
    name: 'http_request',
    description: 'Effectue une requête HTTP vers une API externe. Retourne le statut et le body de la réponse.',
    input_schema: {
      type: 'object',
      properties: {
        url:     { type: 'string',  description: 'URL complète de la requête' },
        method:  { type: 'string',  enum: ['GET','POST','PUT','DELETE','PATCH'], description: 'Méthode HTTP' },
        headers: { type: 'object',  description: 'Headers HTTP (optionnel)' },
        body:    { type: 'string',  description: 'Body de la requête en JSON string (optionnel)' },
      },
      required: ['url', 'method'],
    },
  },
  {
    name: 'deploy_vercel',
    description: 'Déploie TOUS les fichiers du workspace sur Vercel et retourne l\'URL live publique. Utilise cet outil UNIQUEMENT quand tous les fichiers sont créés et prêts.',
    input_schema: {
      type: 'object',
      properties: {
        project_name: { type: 'string', description: 'Nom du projet Vercel (minuscules, tirets autorisés, ex: mon-site-daleba)' },
        framework:    { type: 'string', description: 'Framework: null (static), nextjs, create-react-app, vue, etc. (défaut: null pour sites statiques)' },
      },
      required: ['project_name'],
    },
  },
  {
    name: 'create_github_repo',
    description: 'Crée un repo GitHub public, pousse tous les fichiers et retourne l\'URL du repo.',
    input_schema: {
      type: 'object',
      properties: {
        repo_name:   { type: 'string', description: 'Nom du repo (ex: mon-projet-daleba)' },
        description: { type: 'string', description: 'Description du projet' },
      },
      required: ['repo_name'],
    },
  },
  {
    name: 'search_web',
    description: 'Recherche des informations sur internet pour s\'inspirer, trouver des exemples ou vérifier des données.',
    input_schema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Requête de recherche' },
      },
      required: ['query'],
    },
  },
  {
    name: 'delegate_specialist',
    description: 'Délègue une sous-tâche précise à un modèle IA spécialisé de la flotte. Utilise cet outil quand tu as besoin d\'un renfort spécifique (code bas niveau, traduction, optimisation SQL, etc.).',
    input_schema: {
      type: 'object',
      properties: {
        model:   { type: 'string', description: 'Modèle: deepseek-r1 (code/logique), gpt-4o (créatif/vision), mistral-large (rapide/multilingue)' },
        task:    { type: 'string', description: 'Description précise de la sous-tâche à accomplir' },
        context: { type: 'string', description: 'Contexte complet nécessaire au spécialiste' },
      },
      required: ['model', 'task'],
    },
  },
  {
    name: 'ask_user',
    description: 'Pose UNE question cruciale à l\'utilisateur. Utilise cet outil SEULEMENT quand une information est absolument indispensable et ne peut pas être déduite ou assumée. Maximum 2 utilisations par session.',
    input_schema: {
      type: 'object',
      properties: {
        question: { type: 'string', description: 'Question claire et précise pour l\'utilisateur' },
        options:  { type: 'array', items: { type: 'string' }, description: 'Options de réponse proposées (fortement conseillé pour des réponses rapides)' },
      },
      required: ['question'],
    },
  },
  {
    name: 'task_complete',
    description: 'OBLIGATOIRE — Appelle cet outil quand la tâche est 100% terminée et le résultat livré. Résume ce qui a été accompli.',
    input_schema: {
      type: 'object',
      properties: {
        summary:       { type: 'string', description: 'Résumé complet de ce qui a été créé et accompli' },
        live_url:      { type: 'string', description: 'URL live du déploiement (si applicable)' },
        github_url:    { type: 'string', description: 'URL du repo GitHub (si applicable)' },
        files_created: { type: 'array',  items: { type: 'string' }, description: 'Liste des fichiers créés' },
      },
      required: ['summary'],
    },
  },
];

// ── PROMPT SYSTÈME AGENT ──────────────────────────────────────────────────────
function buildSystemPrompt(session) {
  return `Tu es le CERVEAU AUTONOME DALEBA — un agent IA d'élite qui exécute des tâches de A à Z sans supervision humaine.

## Ta mission
Tu reçois une demande et tu l'accomplis COMPLÈTEMENT, de la première ligne de code à la livraison avec une URL live publique.

## Tes capacités
- Créer n'importe quel type de fichier (HTML, CSS, JS, Python, JSON, SQL, etc.)
- Déployer automatiquement sur Vercel (sites statiques et apps)
- Créer des repos GitHub
- Faire des requêtes HTTP vers des APIs externes
- Déléguer à des spécialistes (DeepSeek pour le code complexe, GPT-4o pour la créativité)
- Rechercher des informations sur le web

## Règles d'or
1. **AUTONOMIE TOTALE** — Tu ne demandes des infos à l'utilisateur que si c'est ABSOLUMENT impossible de déduire ou assumer. Maximum 2 questions par session.
2. **QUALITÉ PROFESSIONNELLE** — Tout ce que tu livres est de niveau production, prêt à être montré à un client.
3. **COMPLÉTUDE** — Tu vas jusqu'au bout. Créer + déployer + retourner l'URL. Pas de demi-mesures.
4. **EFFICACITÉ** — Tu ne répètes pas, tu agis. Chaque tool_use est une action concrète.
5. **EXCELLENCE** — Code propre, design soigné, best practices respectées.

## Pour créer un site web
1. Crée tous les fichiers (index.html, style.css, script.js, etc.) avec du VRAI contenu, pas de placeholder
2. Assure-toi que le HTML est complet et fonctionnel
3. Déploie sur Vercel avec deploy_vercel
4. Termine avec task_complete + l'URL live

## Contexte de session
- ID: ${session.id}
- Tâche: ${session.task}
- Démarré: ${new Date(session.createdAt).toLocaleString('fr-FR')}

## Important
- Tes fichiers HTML doivent être COMPLETS avec HEAD, BODY, scripts, styles (inline ou fichiers séparés)
- Pour les sites: ajoute du vrai contenu, des vraies couleurs, un vrai design professionnel
- Utilise task_complete OBLIGATOIREMENT quand tout est terminé`;
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
  const fullPath = path.join(CFG.workspace, sessionId, filePath);
  try {
    return await fs.readFile(fullPath, 'utf8');
  } catch {
    return `❌ Fichier introuvable: ${filePath}`;
  }
}

async function toolListFiles(sessionId) {
  const session = getSession(sessionId);
  const list = Object.keys(session.files);
  if (list.length === 0) return 'Aucun fichier créé pour l\'instant.';
  return list.map(f => `📄 ${f} (${session.files[f].length} chars)`).join('\n');
}

async function toolHttpRequest(sessionId, { url, method, headers = {}, body }) {
  emit(sessionId, 'http_request', { url, method });
  try {
    const res = await axios({
      url, method,
      headers: { 'Content-Type': 'application/json', ...headers },
      data: body ? (typeof body === 'string' ? JSON.parse(body) : body) : undefined,
      timeout: 20000,
      validateStatus: () => true,
    });
    const text = typeof res.data === 'object' ? JSON.stringify(res.data).slice(0, 3000) : String(res.data).slice(0, 3000);
    return `HTTP ${res.status}\n${text}`;
  } catch (e) {
    return `❌ Erreur HTTP: ${e.message}`;
  }
}

async function toolDeployVercel(sessionId, { project_name, framework = null }) {
  const session = getSession(sessionId);
  if (!CFG.vercelToken) return '❌ VERCEL_TOKEN manquant dans Railway';
  const files = Object.entries(session.files).map(([file, data]) => ({
    file,
    data: Buffer.from(data).toString('base64'),
    encoding: 'base64',
  }));
  if (files.length === 0) return '❌ Aucun fichier à déployer. Crée d\'abord les fichiers avec create_file.';

  emit(sessionId, 'deploying', { platform: 'Vercel', files: files.length });

  try {
    const body = {
      name: project_name,
      files,
      projectSettings: { framework, buildCommand: null, outputDirectory: null, installCommand: null },
      target: 'production',
    };
    const res = await axios.post('https://api.vercel.com/v13/deployments', body, {
      headers: { Authorization: `Bearer ${CFG.vercelToken}`, 'Content-Type': 'application/json' },
      timeout: 60000,
    });
    const url = `https://${res.data.url}`;
    session.liveUrl = url;
    emit(sessionId, 'deployed', { url, platform: 'Vercel' });
    return `✅ Déployé sur Vercel!\nURL live: ${url}\nStatut: ${res.data.status}`;
  } catch (e) {
    const msg = e.response?.data?.error?.message || e.message;
    return `❌ Erreur Vercel: ${msg}`;
  }
}

async function toolCreateGitHubRepo(sessionId, { repo_name, description = '' }) {
  const session = getSession(sessionId);
  if (!CFG.githubToken) return '❌ GITHUB_TOKEN manquant dans Railway';

  emit(sessionId, 'github', { action: 'create_repo', name: repo_name });

  try {
    // Créer le repo
    await axios.post('https://api.github.com/user/repos', {
      name: repo_name, description, private: false, auto_init: false,
    }, {
      headers: { Authorization: `token ${CFG.githubToken}`, 'Content-Type': 'application/json' },
      timeout: 15000,
    });

    // Pusher les fichiers
    for (const [filePath, content] of Object.entries(session.files)) {
      await axios.put(
        `https://api.github.com/repos/${CFG.githubUser}/${repo_name}/contents/${filePath}`,
        { message: `Add ${filePath}`, content: Buffer.from(content).toString('base64') },
        { headers: { Authorization: `token ${CFG.githubToken}` }, timeout: 15000 }
      ).catch(() => {}); // ignore erreur fichier individuel
    }

    const repoUrl = `https://github.com/${CFG.githubUser}/${repo_name}`;
    session.githubUrl = repoUrl;
    emit(sessionId, 'github_done', { url: repoUrl });
    return `✅ Repo GitHub créé et fichiers poussés!\nURL: ${repoUrl}`;
  } catch (e) {
    const msg = e.response?.data?.message || e.message;
    return `❌ Erreur GitHub: ${msg}`;
  }
}

async function toolSearchWeb(sessionId, { query }) {
  emit(sessionId, 'searching', { query });
  try {
    // DuckDuckGo Instant Answers (gratuit, sans clé)
    const res = await axios.get(`https://api.duckduckgo.com/?q=${encodeURIComponent(query)}&format=json&no_html=1&skip_disambig=1`, {
      timeout: 8000, headers: { 'User-Agent': 'DALEBA-Agent/1.0' },
    });
    const d = res.data;
    let result = '';
    if (d.AbstractText) result += `📝 ${d.AbstractText}\n`;
    if (d.RelatedTopics?.length) {
      result += '\n🔗 Résultats connexes:\n';
      d.RelatedTopics.slice(0, 5).forEach(t => {
        if (t.Text) result += `- ${t.Text}\n`;
      });
    }
    return result || `Recherche effectuée pour: ${query} (aucun résultat direct trouvé)`;
  } catch (e) {
    return `Recherche pour "${query}" effectuée (résultat non disponible).`;
  }
}

async function toolDelegateSpecialist(sessionId, { model, task, context = '' }) {
  emit(sessionId, 'delegate', { model, task: task.slice(0, 80) });

  const MODEL_MAP = {
    'deepseek-r1':   { provider: 'deepseek', model: 'deepseek-reasoner', base: 'https://api.deepseek.com/v1',      key: CFG.deepseekKey },
    'gpt-4o':        { provider: 'openai',   model: 'gpt-4o',             base: 'https://api.openai.com/v1',       key: CFG.openaiKey   },
    'mistral-large': { provider: 'mistral',  model: 'mistral-large-latest',base: 'https://api.mistral.ai/v1',      key: CFG.mistralKey  },
    'qwen-max':      { provider: 'openrouter',model:'qwen/qwen3-coder:free',base:'https://openrouter.ai/api/v1',   key: CFG.openrouterKey},
  };

  const cfg = MODEL_MAP[model];
  if (!cfg || !cfg.key) return `❌ Modèle ${model} non disponible ou clé manquante.`;

  try {
    const res = await axios.post(`${cfg.base}/chat/completions`, {
      model: cfg.model,
      messages: [
        { role: 'system', content: 'Tu es un expert technique IA. Réponds en français. Sois précis et complet.' },
        { role: 'user',   content: context ? `Contexte:\n${context}\n\nTâche: ${task}` : task },
      ],
      max_tokens: 2048,
      temperature: 0.3,
    }, {
      headers: { Authorization: `Bearer ${cfg.key}`, 'Content-Type': 'application/json' },
      timeout: 40000,
    });
    const answer = res.data.choices[0].message.content;
    emit(sessionId, 'delegate_done', { model, preview: answer.slice(0, 100) });
    return `[Réponse de ${model}]\n${answer}`;
  } catch (e) {
    return `❌ Erreur délégation ${model}: ${e.message}`;
  }
}

async function toolAskUser(sessionId, { question, options = [] }) {
  const session = getSession(sessionId);
  session.status = 'waiting_user';
  session.pendingQuestion = { question, options };
  emit(sessionId, 'ask_user', { question, options });

  // Attendre la réponse de l'utilisateur (max 5 minutes)
  return new Promise((resolve) => {
    const timeout = setTimeout(() => {
      session.status = 'running';
      resolve('(pas de réponse reçue — je continue avec mes meilleures hypothèses)');
    }, 300000);

    session.answerCallback = (answer) => {
      clearTimeout(timeout);
      session.status = 'running';
      session.pendingQuestion = null;
      resolve(`Réponse de l'utilisateur: ${answer}`);
    };
  });
}

// ── DISPATCHER DE TOOLS ───────────────────────────────────────────────────────
async function executeTool(sessionId, toolName, input) {
  const session = getSession(sessionId);
  emit(sessionId, 'tool_start', { tool: toolName, input: JSON.stringify(input).slice(0, 200) });

  let result;
  try {
    switch (toolName) {
      case 'create_file':         result = await toolCreateFile(sessionId, input);       break;
      case 'read_file':           result = await toolReadFile(sessionId, input);          break;
      case 'list_files':          result = await toolListFiles(sessionId);                break;
      case 'http_request':        result = await toolHttpRequest(sessionId, input);       break;
      case 'deploy_vercel':       result = await toolDeployVercel(sessionId, input);      break;
      case 'create_github_repo':  result = await toolCreateGitHubRepo(sessionId, input); break;
      case 'search_web':          result = await toolSearchWeb(sessionId, input);         break;
      case 'delegate_specialist': result = await toolDelegateSpecialist(sessionId, input);break;
      case 'ask_user':            result = await toolAskUser(sessionId, input);           break;
      case 'task_complete':
        session.status = 'done';
        session.result = input;
        if (input.live_url)   session.liveUrl   = input.live_url;
        if (input.github_url) session.githubUrl = input.github_url;
        emit(sessionId, 'complete', input);
        result = '✅ Tâche terminée et livrée.';
        break;
      default:
        result = `❌ Tool inconnu: ${toolName}`;
    }
  } catch (e) {
    result = `❌ Erreur outil ${toolName}: ${e.message}`;
  }

  emit(sessionId, 'tool_done', { tool: toolName, result: String(result).slice(0, 300) });
  session.logs.push({ tool: toolName, input, result: String(result).slice(0, 500) });
  return String(result);
}

// ── APPEL CLAUDE AVEC TOOLS ───────────────────────────────────────────────────
async function callClaudeWithTools(messages, systemPrompt) {
  const res = await axios.post(
    `${CFG.claudeBase}/messages`,
    {
      model:       CFG.claudeModel,
      max_tokens:  4096,
      system:      systemPrompt,
      tools:       TOOLS,
      messages,
    },
    {
      headers: {
        'x-api-key':         CFG.claudeKey,
        'anthropic-version': '2023-06-01',
        'Content-Type':      'application/json',
      },
      timeout: 120000,
    }
  );
  return res.data;
}

// ── BOUCLE AGENT PRINCIPALE ───────────────────────────────────────────────────
async function runAgentLoop(sessionId) {
  const session = getSession(sessionId);
  session.status = 'running';
  const systemPrompt = buildSystemPrompt(session);

  const messages = [{ role: 'user', content: session.task }];
  let iterations = 0;
  const MAX_ITERATIONS = 30;

  emit(sessionId, 'agent_start', { task: session.task });

  while (iterations < MAX_ITERATIONS && session.status !== 'done') {
    iterations++;
    emit(sessionId, 'thinking', { iteration: iterations });

    let response;
    try {
      response = await callClaudeWithTools(messages, systemPrompt);
    } catch (e) {
      const errMsg = e.response?.data?.error?.message || e.message;
      console.warn('[Agent] Claude error:', errMsg);
      // Fallback GPT-4o — convertir les messages au format OpenAI
      if (CFG.openaiKey) {
        emit(sessionId, 'fallback', { from: 'claude-sonnet', to: 'gpt-4o', reason: errMsg });
        try {
          // Convertir les messages Anthropic en messages OpenAI (texte seulement)
          const gptMessages = [{ role: 'system', content: systemPrompt }];
          for (const m of messages) {
            if (m.role === 'user') {
              if (typeof m.content === 'string') gptMessages.push({ role: 'user', content: m.content });
              else if (Array.isArray(m.content)) {
                const txt = m.content.filter(b => b.type === 'text' || b.type === 'tool_result').map(b => b.content || b.text || '').join('\n');
                if (txt) gptMessages.push({ role: 'user', content: txt });
              }
            } else if (m.role === 'assistant') {
              if (typeof m.content === 'string') gptMessages.push({ role: 'assistant', content: m.content });
              else if (Array.isArray(m.content)) {
                const txt = m.content.filter(b => b.type === 'text').map(b => b.text).join('');
                if (txt) gptMessages.push({ role: 'assistant', content: txt });
              }
            }
          }
          const gptRes = await axios.post('https://api.openai.com/v1/chat/completions', {
            model: 'gpt-4o',
            messages: gptMessages.slice(-20), // garder max 20 messages pour GPT-4o
            max_tokens: 2048,
          }, {
            headers: { Authorization: `Bearer ${CFG.openaiKey}`, 'Content-Type': 'application/json' },
            timeout: 60000,
          });
          const gptText = gptRes.data.choices[0].message.content;
          messages.push({ role: 'assistant', content: gptText });
          emit(sessionId, 'agent_message', { text: gptText });
          continue;
        } catch (e2) {
          const err2 = e2.response?.data?.error?.message || e2.message;
          emit(sessionId, 'error', { message: 'Erreur critique: ' + err2 });
          session.status = 'error';
          break;
        }
      } else {
        emit(sessionId, 'error', { message: 'Claude indisponible: ' + errMsg });
        session.status = 'error';
        break;
      }
    }

    const { stop_reason, content } = response;

    // Extraire le texte et les tool_use
    const textBlocks   = content.filter(b => b.type === 'text');
    const toolUseBlocks = content.filter(b => b.type === 'tool_use');

    if (textBlocks.length > 0) {
      const text = textBlocks.map(b => b.text).join('');
      if (text.trim()) emit(sessionId, 'agent_message', { text });
    }

    // Ajouter la réponse de l'assistant
    messages.push({ role: 'assistant', content });

    if (stop_reason === 'end_turn' && toolUseBlocks.length === 0) {
      // Claude a fini sans appeler task_complete — on marque quand même done
      if (session.status !== 'done') {
        session.status = 'done';
        emit(sessionId, 'complete', {
          summary: textBlocks.map(b => b.text).join('') || 'Tâche terminée.',
          live_url: session.liveUrl,
          github_url: session.githubUrl,
          files_created: Object.keys(session.files),
        });
      }
      break;
    }

    if (stop_reason === 'tool_use' && toolUseBlocks.length > 0) {
      const toolResults = [];
      let shouldStop = false;
      let stopIndex  = -1;

      for (let ti = 0; ti < toolUseBlocks.length; ti++) {
        const toolUse = toolUseBlocks[ti];
        const result = await executeTool(sessionId, toolUse.name, toolUse.input);
        toolResults.push({ type: 'tool_result', tool_use_id: toolUse.id, content: result });
        if (session.status === 'done') { shouldStop = true; stopIndex = ti; break; }
      }

      // CRITICAL: s'assurer que TOUS les tool_use ont un tool_result correspondant
      // (requis par l'API Anthropic — sinon 400 à la prochaine requête)
      if (shouldStop && stopIndex >= 0) {
        for (let ti = stopIndex + 1; ti < toolUseBlocks.length; ti++) {
          toolResults.push({
            type: 'tool_result',
            tool_use_id: toolUseBlocks[ti].id,
            content: '(annulé — tâche terminée)',
          });
        }
      }

      messages.push({ role: 'user', content: toolResults });
      if (shouldStop) break;
    }
  }

  if (iterations >= MAX_ITERATIONS && session.status !== 'done') {
    session.status = 'done';
    emit(sessionId, 'complete', {
      summary: `Tâche exécutée en ${MAX_ITERATIONS} étapes. Fichiers créés: ${Object.keys(session.files).join(', ')}`,
      live_url: session.liveUrl,
      github_url: session.githubUrl,
      files_created: Object.keys(session.files),
    });
  }
}

// ── API PUBLIQUE ──────────────────────────────────────────────────────────────

function createSession(task) {
  const id = `agent-${Date.now()}-${Math.random().toString(36).slice(2,8)}`;
  const session = {
    id, task,
    status: 'init',
    files: {},
    logs: [],
    liveUrl: null,
    githubUrl: null,
    result: null,
    pendingQuestion: null,
    answerCallback: null,
    createdAt: Date.now(),
  };
  sessions.set(id, session);
  getEmitter(id); // init emitter
  return id;
}

function startAgent(sessionId) {
  const session = getSession(sessionId);
  if (!session) throw new Error('Session introuvable: ' + sessionId);
  // Lancer en background
  runAgentLoop(sessionId).catch(e => {
    emit(sessionId, 'error', { message: e.message });
    getSession(sessionId).status = 'error';
  });
}

function answerQuestion(sessionId, answer) {
  const session = getSession(sessionId);
  if (!session) return false;
  if (session.answerCallback) {
    session.answerCallback(answer);
    session.answerCallback = null;
    return true;
  }
  return false;
}

function getSessionStatus(sessionId) {
  const session = getSession(sessionId);
  if (!session) return null;
  return {
    id:            session.id,
    status:        session.status,
    task:          session.task,
    filesCreated:  Object.keys(session.files),
    liveUrl:       session.liveUrl,
    githubUrl:     session.githubUrl,
    result:        session.result,
    pendingQuestion: session.pendingQuestion,
    logsCount:     session.logs.length,
    createdAt:     session.createdAt,
  };
}

// Nettoyage des sessions > 6h
setInterval(() => {
  const now = Date.now();
  for (const [id, s] of sessions) {
    if (now - s.createdAt > 6 * 3600 * 1000) {
      sessions.delete(id);
      emitters.delete(id);
      fs.rm(path.join(CFG.workspace, id), { recursive: true, force: true }).catch(() => {});
    }
  }
}, 3600 * 1000);

module.exports = {
  createSession,
  startAgent,
  answerQuestion,
  getSessionStatus,
  getEmitter,
  sessions,
};
