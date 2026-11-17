# Ta boîte à outils — Kadio Coiffure / Daleba

Tout est dans ton dépôt GitHub (branche `claude/montage-video-pvdm69`). Dans une nouvelle session sur cette branche, demande simplement en français ce que tu veux : Claude choisit le bon skill. Tu peux aussi l'appeler par son nom, par exemple `/seo`.

## 1. Vidéo et réseaux sociaux
| Besoin | Skill |
|---|---|
| Monter un face caméra (coupes, sous-titres, sons) | `short-editing`, `editing` |
| Motion design animé | `hyperframes`, `remotion-*`, `motion-doctrine`, `cut-the-curve` |
| Copier le style d'une vidéo que tu aimes | `steal`, `taste-distillation`, `taste-application` |
| Sons et musique réels | `real-sound`, `earshot` |
| Personnage IA, avatar, vidéo générée | `media-use` (HeyGen), `fal-ai-media` (fal.ai) — comptes payants |
| Scripts et accroches | `studio-script` (+ `video-agent/scripts/50-scripts-kadio.md`) |
| Publier / programmer | `publish`, `social-publisher`, `short-video-distribution`, `crosspost` (+ Postiz déjà branché) |
| Système de contenu, calendrier | `content-engine` |

## 2. Marketing et ventes
| Besoin | Skill / agent |
|---|---|
| Identité de marque, ton de voix | `brand-discovery`, `brand-voice` |
| Campagne (fêtes, rentrée…) | `marketing-campaign`, agent `marketing-agent` |
| Référencement Google | `seo` |
| Étude de marché, concurrents à Longueuil | `market-research`, `competitive-report-structure`, `competitive-platform-analysis`, `research-ops` |
| Trouver des clients / partenaires (comme Jolina, Faso Déh) | `lead-intelligence` (+ `video-agent/prospection/`) |
| Articles, infolettres, textes de site | `article-writing` |

## 3. Gestion de l'entreprise
| Besoin | Skill / agent |
|---|---|
| Courriels (trier, rédiger, relancer) | `email-ops` |
| Abonnements, remboursements, facturation | `customer-billing-ops`, `finance-billing-ops` |
| Google Drive, Docs, Sheets | `google-workspace-ops` |
| Ton « bras droit » qui organise les priorités | agent `chief-of-staff` |
| Applis libres (caisse, compta, CRM, horaires, signatures…) | `outils/EVERYTHING.md` — liens utilisables depuis ton téléphone |

## 4. Ton appli Daleba (site, réservations, Stripe, WhatsApp…)
| Besoin | Skill / agent |
|---|---|
| Planifier une nouvelle fonction | agents `planner`, `architect` |
| Relire le code, sécurité | agents `code-reviewer`, `security-reviewer`, skill `ecc-security-review` |
| Base de données | `postgres-patterns`, `database-migrations`, agent `database-reviewer` |
| API, serveur | `backend-patterns`, `api-design` |
| Tests | `tdd-workflow`, `e2e-testing`, agent `e2e-runner` |
| Mise en ligne | `deployment-patterns`, `docker-patterns`, `production-audit` |
| Réparer un build cassé | agent `build-error-resolver` |
| Nettoyer le code / la doc | agents `refactor-cleaner`, `doc-updater` |

## 5. Dépôts complets (sous-modules)
- `outils/everything` — HeyPuter/everything : 50+ logiciels libres (MIT).
- `outils/everything-claude-code` — 327 skills, 72 agents, 98 commandes (MIT). Seuls ceux utiles sont activés ; pour en ajouter un : copier `outils/everything-claude-code/skills/<nom>` dans `.claude/skills/`.
- Télécharger le code des sous-modules : `git submodule update --init --depth 1`.

> Non activé volontairement : les *hooks* d'everything-claude-code (scripts qui s'exécuteraient automatiquement à chaque session).
