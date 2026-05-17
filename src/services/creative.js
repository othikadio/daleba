/**
 * DALEBA — Module Créatif (Scaffolding Points 29-34)
 * Narratif, mémoire vectorielle, écriture stylistique, ebook, relecture, traduction
 */

const { query } = require('../agents/claude');

// ─── POINT 30 — MÉMOIRE VECTORIELLE (simulation) ──────────────────────────────
const plotMemory = new Map();

function addPlotContext(projectId, event) {
  const memory = plotMemory.get(projectId) || { context: '', characters: [], events: [], timeline: [] };
  memory.events.push({ event, timestamp: new Date().toISOString() });
  memory.context = [memory.context, event].filter(Boolean).join('\n\n');
  plotMemory.set(projectId, memory);
  return memory;
}

function getRelevantContext(projectId, queryText) {
  const memory = plotMemory.get(projectId);
  if (!memory) return null;

  // Recherche simple par mots-clés (simulation sans vraie DB vectorielle)
  const words = queryText.toLowerCase().split(/\s+/);
  const relevantEvents = memory.events.filter(e =>
    words.some(w => e.event.toLowerCase().includes(w))
  );

  return {
    projectId,
    context: memory.context.slice(-2000), // Dernier 2000 chars
    relevantEvents: relevantEvents.slice(-10),
    characters: memory.characters,
    timeline: memory.timeline.slice(-20),
  };
}

// ─── POINT 29 — ARCHITECTE NARRATIF ──────────────────────────────────────────

async function buildNarrativeStructure(concept, genre = 'roman', chapters = 10) {
  const systemPrompt = `Tu es un architecte narratif expert. Tu construis des structures romanesques cohérentes, riches, et originales. 
Tu maîtrises le voyage du héros, la structure en 3 actes, et les arcs personnages.
Réponds toujours en JSON valide.`;

  const userPrompt = `Crée une structure narrative complète pour :
Concept : "${concept}"
Genre : ${genre}
Nombre de chapitres : ${chapters}

Retourne un JSON avec : { title, synopsis, genre, themes[], acts[{name, chapters[], climax}], characters[{name, role, arc, motivation}], chapters[{number, title, summary, characters[], tension: 1-10}] }`;

  const result = await query(userPrompt, systemPrompt);

  try {
    const jsonMatch = result.content.match(/\{[\s\S]*\}/);
    return jsonMatch ? JSON.parse(jsonMatch[0]) : { raw: result.content };
  } catch {
    return { raw: result.content };
  }
}

// ─── POINT 31 — ÉCRITURE STYLISTIQUE ─────────────────────────────────────────

const STYLES = {
  litteraire: 'Écris dans un style littéraire raffiné — métaphores, rythme, profondeur psychologique. Pense Modiano, Duras, ou Diallo.',
  technique: 'Écris de façon claire, précise, structurée. Langage expert, sans fioritures, efficacité maximale.',
  poetique: 'Écris en prose poétique — images fortes, musicalité, ruptures, silence entre les mots.',
  commercial: 'Écris en style commercial accrocheur — CTA implicites, émotions simples, bénéfices clairs, lisibilité maximale.',
  educatif: 'Écris de façon pédagogique — exemples concrets, progression logique, vocabulaire accessible, mémorisation facilitée.',
};

async function writeInStyle(prompt, style = 'litteraire', length = 'medium') {
  const styleInstructions = STYLES[style] || STYLES.litteraire;
  const lengthMap = { short: '150-300 mots', medium: '400-700 mots', long: '800-1500 mots' };
  const wordCount = lengthMap[length] || lengthMap.medium;

  const systemPrompt = `${styleInstructions}
Longueur cible : ${wordCount}.
Écris directement le texte sans introduction ni commentaire.`;

  const result = await query(prompt, systemPrompt);
  return { content: result.content, style, length, wordCount };
}

// ─── POINT 32 — GÉNÉRATION EBOOK ─────────────────────────────────────────────

async function generateEbook(title, subject, chapters = 5, targetAudience = 'grand public') {
  const systemPrompt = `Tu es un auteur professionnel spécialisé dans la création d'ebooks de qualité.
Tu écris chapitre par chapitre, avec cohérence et profondeur.
Public cible : ${targetAudience}`;

  let markdown = `# ${title}\n\n*Par DALEBA Publishing — Kadio Coiffure & Esthétique*\n\n---\n\n`;
  markdown += `## Introduction\n\n`;

  // Introduction
  const introResult = await query(
    `Écris une introduction engageante pour un ebook intitulé "${title}" sur le sujet : ${subject}. Public : ${targetAudience}. 200-300 mots.`,
    systemPrompt
  );
  markdown += introResult.content + '\n\n';

  // Chapitres
  for (let i = 1; i <= chapters; i++) {
    const chapterResult = await query(
      `Écris le chapitre ${i}/${chapters} de l'ebook "${title}" (sujet: ${subject}). 
      Donne-lui un titre accrocheur et développe le contenu en 400-600 mots. 
      Commence directement par "## Chapitre ${i} —"`,
      systemPrompt
    );
    markdown += chapterResult.content + '\n\n';
  }

  // Conclusion
  const conclusionResult = await query(
    `Écris une conclusion mémorable pour l'ebook "${title}". 150-200 mots.`,
    systemPrompt
  );
  markdown += `## Conclusion\n\n` + conclusionResult.content + '\n\n';
  markdown += `---\n\n*© ${new Date().getFullYear()} DALEBA — Tous droits réservés*\n`;

  return { title, subject, chapters, targetAudience, markdown, generatedAt: new Date().toISOString() };
}

// ─── POINT 33 — AUTO-RELECTURE ────────────────────────────────────────────────

async function proofread(text) {
  const systemPrompt = `Tu es un éditeur littéraire expert (français & anglais).
Tu corriges les fautes d'orthographe, grammaire, style, clarté.
Réponds en JSON : { corrected: "texte corrigé complet", changes: [{original, correction, reason}], score: 0-100, feedback: "commentaire général" }`;

  const result = await query(`Relis et corrige ce texte :\n\n${text}`, systemPrompt);

  try {
    const jsonMatch = result.content.match(/\{[\s\S]*\}/);
    if (jsonMatch) return JSON.parse(jsonMatch[0]);
  } catch {}

  return { corrected: text, changes: [], score: 70, raw: result.content };
}

// ─── POINT 34 — TRADUCTION LITTÉRAIRE ────────────────────────────────────────

const LANG_NAMES = {
  fr: 'français', en: 'anglais', es: 'espagnol',
  pt: 'portugais', ar: 'arabe', wo: 'wolof', dioula: 'dioula',
};

async function translateLiterarily(text, fromLang = 'fr', toLang = 'en') {
  const fromName = LANG_NAMES[fromLang] || fromLang;
  const toName = LANG_NAMES[toLang] || toLang;

  const systemPrompt = `Tu es un traducteur littéraire de haut niveau.
Tu traduis en préservant le style, le ton, les émotions, les nuances culturelles.
Tu ne traduis pas mot-à-mot — tu réécris dans l'esprit de l'auteur.
Langue source : ${fromName}. Langue cible : ${toName}.
Réponds UNIQUEMENT avec la traduction, sans commentaire.`;

  const result = await query(text, systemPrompt);
  return {
    original: text,
    translated: result.content,
    fromLang,
    toLang,
    method: 'literary',
  };
}

module.exports = {
  // Mémoire vectorielle
  addPlotContext,
  getRelevantContext,
  plotMemory,
  // Narratif
  buildNarrativeStructure,
  // Écriture
  writeInStyle,
  STYLES,
  // Ebook
  generateEbook,
  // Relecture
  proofread,
  // Traduction
  translateLiterarily,
};
