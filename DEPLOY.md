# DEPLOY.md — Daleba Infra

## 🌐 Production URL

**https://daleba.vercel.app**

Alias disponibles :
- https://daleba.vercel.app ← **principal**
- https://daleba-kadio-coiffure.vercel.app
- https://daleba-git-main-kadio-coiffure.vercel.app

## GitHub

- **Repo :** https://github.com/othikadio/daleba
- **Branch :** `main`
- **Auto-deploy :** tout push sur `main` déclenche un déploiement Vercel

## Vercel

- **Équipe :** kadio-coiffure (`team_xF28H411GIyX0CpUNUbMTGFR`)
- **Projet ID :** `prj_AB1rGiSyXAHgXhtVpwrrraIySrT5`
- **Node version :** 24.x

## Variables d'environnement Vercel

| Variable | Valeur | Notes |
|---|---|---|
| `MODE` | `demo` | Active le mode démo (pas de DB requise) |
| `NODE_ENV` | `production` | |
| `DALEBA_MASTER_KEY` | `kadio-daleba-2026` | Super admin access |
| `JWT_SECRET` | `daleba-jwt-secret-kadio-coiffure-2026` | Auth tokens |

### Variables à ajouter plus tard (production complète)
- `DATABASE_URL` — PostgreSQL (Neon, Railway, Supabase)
- `ANTHROPIC_API_KEY` — Claude
- `OPENAI_API_KEY` — GPT-4o
- `DEEPSEEK_API_KEY` — DeepSeek
- `STRIPE_SECRET_KEY` — Paiements
- `TWILIO_ACCOUNT_SID` / `TWILIO_AUTH_TOKEN` — SMS

## Mode Démo

En mode démo (`MODE=demo`) :
- **Pas de base de données requis** — données en mémoire
- **Booking complet fonctionnel** avec données Kadio Coiffure hardcodées
- **Login démo :** `admin@kadiocoiffure.ca` / `demo1234`
- **8 services** : Coupe H/F/Enfant, Tresses, Extensions, Coloration, Lissage, Soin
- **3 coiffeurs** : Ulrich, Marie-Claire, Aminata
- SMS/Stripe en mode log (pas d'envoi réel)

## Pages disponibles

| URL | Description |
|---|---|
| `https://daleba.vercel.app/` | Page d'accueil Kadio Coiffure |
| `https://daleba.vercel.app/reservation` | Système de réservation 4 étapes |
| `https://daleba.vercel.app/dashboard` | Dashboard employé |
| `https://daleba.vercel.app/health` | Health check API |
| `https://daleba.vercel.app/api/booking/info` | Info salon (API) |
| `https://daleba.vercel.app/api/booking/services` | Services (API) |

## Déploiement manuel

```bash
# Push sur GitHub = auto-deploy
git push origin main

# Ou déclencher manuellement via API Vercel
curl -X POST \
  -H "Authorization: Bearer vcp_..." \
  https://api.vercel.com/v13/deployments?teamId=team_xF28H411GIyX0CpUNUbMTGFR \
  -d '{"name":"daleba","gitSource":{"type":"github","repoId":1241349170,"ref":"main"},"target":"production"}'
```

## Historique des déploiements

| Date | Commit | Notes |
|---|---|---|
| 2026-05-17 | `bb327aa` | Mode démo, page d'accueil, fix Stripe/Twilio |
| 2026-05-17 | `4a894ae` | Fix serverless (skip app.listen) |
| 2026-05-17 | `cf81de8` | Ajout vercel.json |
| 2026-05-17 | `cbb445f` | Init : mode démo + page accueil Kadio Coiffure |
