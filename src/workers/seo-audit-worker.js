/**
 * KADIO OS — Axe 3: Division 2 — Audit SEO Automatisé
 * Analyse SEO d'un site web et génère un rapport PDF
 */

const path = require('path');
const fs = require('fs');

// Fetch avec timeout
async function fetchWithTimeout(url, timeoutMs = 10000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const start = Date.now();
    const res = await fetch(url, {
      signal: controller.signal,
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; DALEBASEOBot/1.0; +https://daleba.app)',
        'Accept': 'text/html,application/xhtml+xml'
      },
      redirect: 'follow'
    });
    const responseTime = Date.now() - start;
    return { res, responseTime };
  } finally {
    clearTimeout(timer);
  }
}

// Analyser le SEO d'un site
async function analyzeSEO(websiteUrl) {
  const issues = [];
  const details = {};
  let score = 100;

  // Normaliser URL
  if (!websiteUrl.startsWith('http')) websiteUrl = 'https://' + websiteUrl;

  try {
    const { res, responseTime } = await fetchWithTimeout(websiteUrl);
    const html = await res.text();
    const cheerio = require('cheerio');
    const $ = cheerio.load(html);

    // 1. SSL (HTTPS)
    const isHttps = websiteUrl.startsWith('https://');
    details.ssl = isHttps;
    if (!isHttps) { issues.push({ type: 'critical', text: 'Site non sécurisé (HTTP) — Google pénalise fortement' }); score -= 20; }

    // 2. Title tag
    const title = $('title').first().text().trim();
    details.title = title;
    if (!title) { issues.push({ type: 'critical', text: 'Balise <title> manquante — indispensable pour le référencement' }); score -= 20; }
    else if (title.length < 10) { issues.push({ type: 'warning', text: `Titre trop court (${title.length} car.) — recommandé: 50-60 caractères` }); score -= 10; }
    else if (title.length > 65) { issues.push({ type: 'warning', text: `Titre trop long (${title.length} car.) — risque de troncature dans Google` }); score -= 5; }

    // 3. Meta description
    const metaDesc = $('meta[name="description"]').attr('content') || '';
    details.metaDescription = metaDesc;
    if (!metaDesc) { issues.push({ type: 'critical', text: 'Meta description manquante — réduit fortement le taux de clic dans Google' }); score -= 15; }
    else if (metaDesc.length < 50) { issues.push({ type: 'warning', text: `Meta description trop courte (${metaDesc.length} car.)` }); score -= 7; }

    // 4. H1
    const h1s = $('h1');
    details.h1Count = h1s.length;
    if (h1s.length === 0) { issues.push({ type: 'critical', text: 'Aucune balise H1 — structure de contenu absente' }); score -= 15; }
    else if (h1s.length > 1) { issues.push({ type: 'warning', text: `${h1s.length} balises H1 — n\'en utiliser qu\'une seule` }); score -= 5; }

    // 5. Mobile viewport
    const hasViewport = !!$('meta[name="viewport"]').length;
    details.mobileViewport = hasViewport;
    if (!hasViewport) { issues.push({ type: 'critical', text: 'Pas de meta viewport — site non mobile-friendly' }); score -= 15; }

    // 6. Images sans alt
    const images = $('img');
    let imagesWithoutAlt = 0;
    images.each((_, img) => { if (!$(img).attr('alt')) imagesWithoutAlt++; });
    details.imagesWithoutAlt = imagesWithoutAlt;
    details.totalImages = images.length;
    if (imagesWithoutAlt > 0) {
      issues.push({ type: 'warning', text: `${imagesWithoutAlt}/${images.length} images sans attribut alt — pénalité accessibilité + SEO` });
      score -= Math.min(10, imagesWithoutAlt * 2);
    }

    // 7. Vitesse de réponse
    details.responseTimeMs = responseTime;
    if (responseTime > 3000) { issues.push({ type: 'critical', text: `Temps de chargement lent: ${responseTime}ms — Google Core Web Vitals en rouge` }); score -= 10; }
    else if (responseTime > 1500) { issues.push({ type: 'warning', text: `Temps de réponse moyen: ${responseTime}ms — optimisation recommandée` }); score -= 5; }

    // 8. Liens brisés (juste vérification superficielle)
    const links = $('a[href]').map((_, el) => $(el).attr('href')).get();
    details.linksCount = links.length;

    // 9. Canonical
    const canonical = $('link[rel="canonical"]').attr('href');
    details.canonical = canonical || null;
    if (!canonical) { issues.push({ type: 'info', text: 'Pas de balise canonical — doublon de contenu possible' }); score -= 3; }

    // 10. Open Graph
    const ogTitle = $('meta[property="og:title"]').attr('content');
    details.openGraph = !!ogTitle;
    if (!ogTitle) { issues.push({ type: 'info', text: 'Open Graph manquant — partages réseaux sociaux non optimisés' }); score -= 2; }

  } catch (e) {
    issues.push({ type: 'critical', text: `Site inaccessible: ${e.message}` });
    score = 0;
    details.error = e.message;
  }

  score = Math.max(0, Math.min(100, score));

  // Top 5 problèmes
  const top5Issues = issues.slice(0, 5);

  return { score, issues, top5Issues, details };
}

// Générer un PDF de rapport SEO avec pdf-lib
async function generateSEOReport(lead, auditResult) {
  const { PDFDocument, rgb, StandardFonts } = require('pdf-lib');

  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const fontBold = await doc.embedFont(StandardFonts.HelveticaBold);

  const gold = rgb(0.788, 0.659, 0.298);
  const dark = rgb(0.051, 0.067, 0.090);
  const white = rgb(1, 1, 1);
  const red = rgb(0.9, 0.2, 0.2);
  const orange = rgb(1, 0.6, 0);
  const green = rgb(0.2, 0.7, 0.3);
  const cyan = rgb(0.22, 0.816, 0.847);

  // =========== PAGE 1 — Couverture ===========
  const page1 = doc.addPage([595, 842]);
  const { width, height } = page1.getSize();

  // Fond sombre
  page1.drawRectangle({ x: 0, y: 0, width, height, color: dark });

  // Bande dorée en haut
  page1.drawRectangle({ x: 0, y: height - 80, width, height: 80, color: gold });

  // DALEBA
  page1.drawText('DALEBA', { x: 40, y: height - 55, size: 32, font: fontBold, color: dark });
  page1.drawText('Audit SEO Automatisé', { x: 250, y: height - 45, size: 14, font, color: dark });

  // Score en grand
  const scoreColor = auditResult.score >= 70 ? green : auditResult.score >= 40 ? orange : red;
  page1.drawText(`${auditResult.score}`, { x: width/2 - 60, y: height/2 + 20, size: 120, font: fontBold, color: scoreColor });
  page1.drawText('/100', { x: width/2 + 65, y: height/2 + 50, size: 36, font, color: white });

  // Nom du site
  const siteName = (lead.company_name || lead.website || 'Votre site').slice(0, 50);
  page1.drawText(siteName, { x: 40, y: height/2 - 60, size: 22, font: fontBold, color: white });
  page1.drawText(lead.website || '', { x: 40, y: height/2 - 90, size: 12, font, color: gold });
  page1.drawText(lead.city ? `📍 ${lead.city}` : '', { x: 40, y: height/2 - 115, size: 12, font, color: gold });

  // Score label
  const scoreLabel = auditResult.score >= 70 ? 'BON' : auditResult.score >= 40 ? 'MOYEN' : 'CRITIQUE';
  page1.drawText(`Score SEO: ${scoreLabel}`, { x: 40, y: 200, size: 16, font: fontBold, color: scoreColor });
  page1.drawText(`${auditResult.issues.length} problème(s) identifié(s)`, { x: 40, y: 175, size: 13, font, color: white });

  // Footer
  page1.drawRectangle({ x: 0, y: 0, width, height: 50, color: gold });
  page1.drawText('kadiocoiffure.vercel.app  •  Rapport généré automatiquement par DALEBA', { x: 40, y: 18, size: 10, font, color: dark });

  // =========== PAGE 2 — Résumé exécutif ===========
  const page2 = doc.addPage([595, 842]);
  page2.drawRectangle({ x: 0, y: 0, width, height, color: dark });
  page2.drawRectangle({ x: 0, y: height - 70, width, height: 70, color: gold });
  page2.drawText('RÉSUMÉ EXÉCUTIF', { x: 40, y: height - 45, size: 22, font: fontBold, color: dark });

  let y = height - 110;

  page2.drawText('3 PROBLÈMES CRITIQUES DÉTECTÉS', { x: 40, y, size: 14, font: fontBold, color: cyan });
  y -= 30;

  const criticals = auditResult.issues.filter(i => i.type === 'critical').slice(0, 3);
  const warnings = auditResult.issues.filter(i => i.type === 'warning').slice(0, 3);

  for (const issue of criticals) {
    page2.drawText('⚠', { x: 40, y, size: 14, font, color: red });
    const text = issue.text.slice(0, 80);
    page2.drawText(text, { x: 65, y, size: 11, font, color: white });
    y -= 25;
  }

  if (criticals.length === 0) {
    page2.drawText('Aucun problème critique détecté — excellent !', { x: 40, y, size: 12, font, color: green });
    y -= 25;
  }

  y -= 20;
  page2.drawText('AVERTISSEMENTS', { x: 40, y, size: 14, font: fontBold, color: orange });
  y -= 25;

  for (const issue of warnings) {
    page2.drawText('•', { x: 40, y, size: 14, font, color: orange });
    const text = issue.text.slice(0, 80);
    page2.drawText(text, { x: 55, y, size: 11, font, color: white });
    y -= 22;
  }

  // Détails techniques
  y -= 30;
  page2.drawText('MÉTRIQUES TECHNIQUES', { x: 40, y, size: 14, font: fontBold, color: cyan });
  y -= 25;

  const metrics = [
    ['SSL/HTTPS', auditResult.details.ssl ? '✅ Actif' : '❌ Absent'],
    ['Balise Title', auditResult.details.title ? `✅ "${auditResult.details.title.slice(0,40)}"` : '❌ Manquante'],
    ['Meta Description', auditResult.details.metaDescription ? '✅ Présente' : '❌ Absente'],
    ['Balise H1', auditResult.details.h1Count > 0 ? `✅ ${auditResult.details.h1Count} trouvée(s)` : '❌ Absente'],
    ['Mobile-Friendly', auditResult.details.mobileViewport ? '✅ Oui' : '❌ Non'],
    ['Temps de réponse', auditResult.details.responseTimeMs ? `${auditResult.details.responseTimeMs}ms` : 'N/A'],
    ['Images sans alt', `${auditResult.details.imagesWithoutAlt || 0}/${auditResult.details.totalImages || 0}`],
  ];

  for (const [key, val] of metrics) {
    if (y < 80) break;
    page2.drawText(`${key}:`, { x: 40, y, size: 11, font: fontBold, color: gold });
    page2.drawText(val, { x: 200, y, size: 11, font, color: white });
    y -= 22;
  }

  page2.drawRectangle({ x: 0, y: 0, width, height: 50, color: gold });
  page2.drawText('kadiocoiffure.vercel.app  •  Rapport généré automatiquement par DALEBA', { x: 40, y: 18, size: 10, font, color: dark });

  // =========== PAGE 3 — Recommandations + CTA ===========
  const page3 = doc.addPage([595, 842]);
  page3.drawRectangle({ x: 0, y: 0, width, height, color: dark });
  page3.drawRectangle({ x: 0, y: height - 70, width, height: 70, color: gold });
  page3.drawText('RECOMMANDATIONS & PLAN D\'ACTION', { x: 40, y: height - 45, size: 18, font: fontBold, color: dark });

  y = height - 110;
  page3.drawText('CORRECTIONS PRIORITAIRES', { x: 40, y, size: 14, font: fontBold, color: cyan });
  y -= 30;

  const allIssues = auditResult.issues.slice(0, 5);
  const recommendations = {
    'Balise <title> manquante': 'Ajouter une balise <title> unique et descriptive (50-60 caractères) dans le <head> de chaque page.',
    'Meta description manquante': 'Rédiger une meta description accrocheuse (150-160 car.) avec vos mots-clés principaux.',
    'Aucune balise H1': 'Structurer votre contenu avec un H1 unique par page contenant le mot-clé principal.',
    'Pas de meta viewport': 'Ajouter <meta name="viewport" content="width=device-width, initial-scale=1"> pour le mobile.',
    'Site non sécurisé': 'Migrer vers HTTPS avec un certificat SSL (gratuit via Let\'s Encrypt).',
  };

  for (const issue of allIssues) {
    if (y < 150) break;
    const iconColor = issue.type === 'critical' ? red : issue.type === 'warning' ? orange : green;
    page3.drawText(issue.type === 'critical' ? '🔴' : '🟡', { x: 40, y, size: 11, font, color: iconColor });
    page3.drawText(issue.text.slice(0, 75), { x: 60, y, size: 11, font: fontBold, color: white });
    y -= 18;
    // Trouver recommandation correspondante
    const recKey = Object.keys(recommendations).find(k => issue.text.includes(k.split(' ')[0]));
    const rec = recKey ? recommendations[recKey] : 'Consulter notre équipe pour une correction personnalisée.';
    const recWords = rec.slice(0, 90);
    page3.drawText(`→ ${recWords}`, { x: 60, y, size: 10, font, color: gold });
    y -= 28;
  }

  // CTA
  y = 160;
  page3.drawRectangle({ x: 40, y: y - 20, width: width - 80, height: 120, color: rgb(0.1, 0.15, 0.22) });
  page3.drawRectangle({ x: 40, y: y + 80, width: width - 80, height: 20, color: gold });
  page3.drawText('OFFRE SPÉCIALE — CORRECTION SEO COMPLÈTE', { x: 65, y: y + 85, size: 11, font: fontBold, color: dark });
  page3.drawText('Notre équipe corrige TOUS les problèmes identifiés + optimisation avancée.', { x: 65, y: y + 50, size: 11, font, color: white });
  page3.drawText('✓ Correction de tous les problèmes techniques  ✓ Optimisation mots-clés  ✓ Rapport de suivi 30j', { x: 65, y: y + 28, size: 9, font, color: gold });
  page3.drawText('→ kadiocoiffure.vercel.app  |  Réponse en 24h garantie', { x: 65, y: y + 8, size: 10, font: fontBold, color: cyan });
  page3.drawText('150$/mois — Premier mois offert sur présentation de ce rapport', { x: 65, y: y - 8, size: 10, font: fontBold, color: white });

  page3.drawRectangle({ x: 0, y: 0, width, height: 50, color: gold });
  page3.drawText('kadiocoiffure.vercel.app  •  contact@daleba.app  •  Rapport confidentiel', { x: 40, y: 18, size: 10, font, color: dark });

  // Sauvegarder PDF
  const pdfBytes = await doc.save();
  const tmpDir = '/tmp/daleba-audits';
  if (!fs.existsSync(tmpDir)) fs.mkdirSync(tmpDir, { recursive: true });
  const filePath = `${tmpDir}/audit-${lead.id || Date.now()}.pdf`;
  fs.writeFileSync(filePath, pdfBytes);
  return filePath;
}

// Job principal d'audit SEO
async function runSeoAuditJob(jobData, pool) {
  const { leadId, website, leadName } = jobData;
  console.log(`[SEO Audit] Démarrage: leadId=${leadId}, site=${website}`);

  // Créer table si nécessaire
  await pool.query(`
    CREATE TABLE IF NOT EXISTS daleba_seo_audits (
      id SERIAL PRIMARY KEY,
      lead_id INTEGER REFERENCES daleba_leads(id),
      score INTEGER,
      issues JSONB,
      report_path TEXT,
      created_at TIMESTAMPTZ DEFAULT NOW()
    )
  `).catch(() => {});

  // Lancer l'audit
  const auditResult = await analyzeSEO(website);

  // Récupérer les infos du lead
  let lead = { id: leadId, website, company_name: leadName };
  try {
    const row = await pool.query('SELECT * FROM daleba_leads WHERE id = $1', [leadId]);
    if (row.rows[0]) lead = row.rows[0];
  } catch {}

  // Générer le PDF
  let reportPath = null;
  try {
    reportPath = await generateSEOReport(lead, auditResult);
    console.log(`[SEO Audit] PDF généré: ${reportPath}`);
  } catch (e) {
    console.warn(`[SEO Audit] PDF error:`, e.message);
  }

  // Sauvegarder l'audit en DB
  await pool.query(
    `INSERT INTO daleba_seo_audits (lead_id, score, issues, report_path) VALUES ($1, $2, $3, $4)`,
    [leadId, auditResult.score, JSON.stringify(auditResult.issues), reportPath]
  ).catch(console.warn);

  // Mettre à jour le lead avec le score
  await pool.query(
    `UPDATE daleba_leads SET audit_score = $1 WHERE id = $2`,
    [auditResult.score, leadId]
  ).catch(console.warn);

  console.log(`[SEO Audit] Terminé: leadId=${leadId}, score=${auditResult.score}`);
  return { leadId, score: auditResult.score, reportPath, issuesCount: auditResult.issues.length };
}

module.exports = { runSeoAuditJob, analyzeSEO, generateSEOReport };
