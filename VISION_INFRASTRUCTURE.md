# DALEBA — Feuille de Route Infrastructure V24+
**Document stratégique — Rédigé par Béatrice | 18 mai 2026**
**Statut : CONFIDENTIEL — Ulrich Kadio / DALEBA SaaS**

---

## Vision

DALEBA devient le **système d'exploitation des PME**. Chaque client clique une fois, connecte ses outils existants, et une IA s'occupe du reste : communications, contenu, clients, paiements. Zéro terminal. Zéro API key à gérer. Zéro prise de tête.

---

## Pilier 1 — Hub de Communication Universel

### Objectif UX
Un bouton : **"Activer mon IA Assistante"**. Le client n'a aucune notion de Twilio, Meta ou webhook.

### Architecture sous le capot

#### 1.1 Twilio ISV (Tech Provider Program)

Twilio a un programme officiel exactement taillé pour notre modèle SaaS :

| Mécanisme | Ce que ça fait |
|---|---|
| **Sous-comptes automatiques** | `POST /2010-04-01/Accounts` → crée un sub-account dédié par tenant en 1 appel API |
| **Numéro provisionné** | Achète un numéro local (CA, FR, US…) et le lie au sous-compte automatiquement |
| **WhatsApp sans compte dev** | Flux Embedded Signup Meta intégré dans Twilio — le client se connecte avec Facebook Business, Twilio gère le WABA côté serveur |
| **IVR géré** | TwiML Studio pour l'arbre d'appel — zéro config pour le client |

> **Action V24 :** Candidater au programme **Twilio WhatsApp Tech Provider** (formulaire Twilio ISV). Une fois approuvé, notre compte master peut enregistrer des WABA pour chaque tenant sans que le client touche à Meta Graph API.

**Code cible (onboarding 1 clic) :**
```js
// twilio-master.js — provisionSubaccount() est déjà en place (V23)
// V24 ajoute : connectWhatsApp(businessId, fbAccessToken)
async function connectWhatsApp(businessId, fbAccessToken) {
  // 1. Crée sous-compte si pas encore fait
  // 2. Enregistre le WABA via Twilio Senders API
  // 3. Stocke dans tenant_integrations (provider='whatsapp')
  // → client n'a rien d'autre à faire
}
```

#### 1.2 Stack Communication Complète V24

```
Voix entrante  → Twilio Voice → IVR TwiML → Agent IA (voice-agent.js)
                                           ↓ frustration ≥70
                                           → Escalade Ulrich (déjà en V22)

SMS            → Twilio SMS   → communication-hub.js → intent detection → réponse auto
WhatsApp       → Twilio WA    → communication-hub.js → même pipeline
Instagram DM   → Meta Graph   → communication-hub.js → même pipeline
Facebook DM    → Meta Graph   → communication-hub.js → même pipeline
```

**Priorité :** Tout passe par `communication-hub.js`. Un seul point d'entrée, une seule IA, tous les canaux.

---

## Pilier 2 — Studio de Contenu Automatique

### Objectif UX
Le client voit une file d'attente de publications prêtes. Il approuve ou laisse l'IA publier toute seule.

### Analyse des APIs Vidéo (Recherche marché mai 2026)

#### Option A — Creatomate ⭐ RECOMMANDÉ V24
**Positionnement :** Vidéos template programmatiques (promos, réels, stories)

| Critère | Détail |
|---|---|
| **Prix** | À partir de $41/mois — ~143 min vidéo 720p |
| **API** | REST clean, templates JSON, overlays texte/image/logo dynamiques |
| **Cas d'usage DALEBA** | "Promotion -20% ce weekend" → template promo → vidéo 30s rendue en <2min |
| **Avantage clé** | Templates réutilisables par tenant (personnalisation automatique couleurs/logo) |
| **Intégration** | `POST /v1/renders` avec JSON template → URL vidéo finale |

#### Option B — HeyGen API ⭐ RECOMMANDÉ V24
**Positionnement :** Vidéos avec avatar IA parlant (annonces, messages personnalisés)

| Critère | Détail |
|---|---|
| **Prix** | $1 = 1 minute vidéo 720p/1080p (pay-as-you-go depuis $5) |
| **API** | Séparée du plan web — achat de crédits API indépendant |
| **Cas d'usage DALEBA** | "Bonjour [Prénom], votre RDV est demain…" → vidéo avatar personnalisée |
| **Avantage clé** | Avatar personnalisé par business (clone voix/visage du propriétaire) |
| **Intégration** | `POST /v2/video/generate` + webhook callback quand rendu terminé |

#### Option C — Shotstack (Runner-up)
**Positionnement :** Rendu vidéo pur (sans avatar), bon pour montages automatisés

| Critère | Détail |
|---|---|
| **Prix** | $49/mois, 200 min rendu — mais AI voice non incluse |
| **Limitation** | Pas d'avatar IA natif — doit combiner avec ElevenLabs |
| **Verdict** | Moins complet que Creatomate pour notre usage |

#### Option D — Remotion (Open Source)
**Positionnement :** Framework React → vidéo, hébergé soi-même

| Critère | Détail |
|---|---|
| **Prix** | Gratuit + coûts serveur (~$50-100/mois) |
| **Complexité** | Élevée — nécessite ingénierie dédiée |
| **Verdict** | Réservé V25+ si volume justifie l'internalisation |

### Stack Contenu Cible V24

```
LLM (Claude)          → Génère le script/caption
                       ↓
Creatomate API         → Monte la vidéo promo (template salon)
HeyGen API             → Génère vidéo avatar si message personnalisé
DALL-E 3 / Flux        → Génère visuels statiques (stories, affiches)
ElevenLabs (existant)  → Voix pour les vidéos Creatomate
                       ↓
daleba_content_queue   → File d'attente (déjà en V23)
                       ↓
Meta Graph API         → Publication automatique Instagram/Facebook
                       ↓
HUD Zenith             → Preview pour approbation client (optionnel)
```

---

## Pilier 3 — Hub de Connexion OAuth Simplifié

### Architecture des passerelles

| Provider | Méthode | Statut |
|---|---|---|
| **Square** | OAuth 2.0 PKCE — bouton "Se connecter à Square" | 🔄 Token manuel V23 → OAuth V24 |
| **Stripe** | OAuth Connect — plateforme de paiement | 📋 À implémenter V24 |
| **Shopify** | OAuth 2.0 — boutique en ligne | 📋 À implémenter V24 |
| **Google** | OAuth 2.0 — Agenda / My Business / Analytics | 📋 À implémenter V24 |
| **Meta** | Facebook Login for Business (Embedded Signup) | 📋 Via Twilio ISV V24 |

### Flow OAuth Universel (même pattern pour tous)

```
1. Client clique "Connecter [Provider]"
2. DALEBA redirige vers OAuth du provider
3. Client autorise sur son compte habituel
4. Provider callback → /api/oauth/callback/:provider
5. DALEBA stocke access_token dans tenant_integrations
6. UI confirme ✅ — client ne revoit jamais un token
```

**Tables V23 déjà prêtes pour stocker tous ces tokens.**

---

## Roadmap Technique

### V24 — Hub Communication + Studio Vidéo
**Durée estimée : 3-4 semaines de dev**

- [ ] Candidature Twilio WhatsApp Tech Provider Program
- [ ] `connectWhatsApp(businessId, fbToken)` — WABA en 1 clic
- [ ] Square OAuth flow complet (`/api/oauth/square`)
- [ ] Intégration Creatomate — templates "salon" (promo, annonce, story)
- [ ] Intégration HeyGen — vidéo avatar pour messages VIP
- [ ] Générateur d'images (DALL-E 3 ou Flux.1) pour posts statiques
- [ ] HUD Zenith — section "Contenu en attente d'approbation"
- [ ] Dashboard onboarding — checklist visuelle % complété

### V25 — Intelligence Prédictive
- [ ] Analyse historique Square → prédiction jours creux → campagne SMS auto
- [ ] Scoring client (LTV, churn risk) → actions proactives
- [ ] Rapport mensuel auto-généré (PDF) envoyé à l'owner
- [ ] Multi-locations (un owner, plusieurs adresses)

### V26 — Marketplace & Expansion
- [ ] Marketplace de templates (salons, restaurants, cliniques…)
- [ ] White-label (revendeurs qui revendent DALEBA sous leur marque)
- [ ] API publique DALEBA pour développeurs tiers
- [ ] Internationalisation (FR, EN, ES, PT)

---

## Budget Estimé Infrastructure V24

| Service | Usage estimé | Coût mensuel |
|---|---|---|
| Twilio SMS/Voice | ~2000 SMS + 500 min/mois (tous tenants) | ~$80 |
| Creatomate | Plan Starter (143 min) | $41 |
| HeyGen API | Pay-as-you-go 50 min vidéos avatar | ~$50 |
| DALL-E 3 / OpenAI | ~500 images/mois | ~$20 |
| Railway DB + Hosting | Actuel | ~$20 |
| **TOTAL** | | **~$211/mois** |

**Breakeven :** 5 clients au plan Starter ($49 × 5 = $245). Rentable dès le 5ème client.

---

## Décisions Stratégiques Immédiates

1. **Candidater au Twilio WhatsApp Tech Provider** — c'est le déblocage #1 pour le Pilier 1. Sans ce statut, WhatsApp multi-tenant est impossible proprement.

2. **Choisir Creatomate comme moteur vidéo V24** — meilleur ratio fonctionnalités/prix pour notre usage. Templates personnalisables par tenant.

3. **Square OAuth avant Stripe** — Square est déjà notre intégration principale. Passer au flow OAuth élimine la friction du token manuel à l'onboarding.

4. **HeyGen comme upgrade payant** — vidéo avatar = fonctionnalité Premium. Justifie la différence de prix entre Pro et Enterprise.

---

*Document vivant — mis à jour à chaque version majeure.*
*Prochaine révision : V24 kickoff*
