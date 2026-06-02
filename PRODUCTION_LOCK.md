# 🔒 USINE DALEBA — VERROUILLAGE DE PRODUCTION

**Date de verrouillage :** 2 juin 2026  
**Validé par :** Kadio Ehouman Ulrich  
**Déployé par :** Béatrice (IA DALEBA)  
**Commit final :** `aeb3288` + email-notifier fix

---

## ✅ STATUT : PRODUCTION STABLE — NE PAS MODIFIER SANS AUTORISATION ULRICH

---

## Architecture verrouillée

| Module | Status | Rôle |
|--------|--------|------|
| `opportunity-scanner.js` | 🔒 LOCKED | 10 sources, ~385 opps/scan |
| `opportunity-classifier.js` | 🔒 LOCKED | DeepSeek classifier, score 0-100 |
| `market-pricer.js` | 🔒 LOCKED | Squad #801 — analyse prix marché mondial (35 catégories) |
| `negotiation-engine.js` | 🔒 LOCKED | Squad #802 — algo dynamique 🔥⚡🛡 |
| `dynamic-payment-link.js` | 🔒 LOCKED | Squad #803 — liens Stripe ajustés dynamiquement |
| `proposal-writer.js` | 🔒 LOCKED | Génération LLM + phrase marché obligatoire |
| `email-notifier.js` | 🔒 LOCKED | Notification Ulrich avec pricing block + lien Stripe |
| `sender-agent.js` | 🔒 LOCKED | CTA Stripe dans chaque email prospect |
| `pricing-guard.js` | 🔒 LOCKED | Plancher 150 CAD — JAMAIS de 0$ |
| `opportunity-worker.js` | 🔒 LOCKED | Boucle 4h, BullMQ ×10 concurrence |

## Verrous de sécurité actifs

- 🛡 **Prix plancher 150 CAD** : aucune proposition ne part à 0$
- 🚫 **PRICE_GUARD_BLOCKED** : HTTP 422 si budget=0 sur /send
- 🔗 **0 lien kadiocoiffure** dans les emails B2B prospects
- 📈 **Dynamic pricing** : chaque proposition a son propre prix calculé et lien Stripe
- 📧 **Email Ulrich** : contient le bloc pricing avec lien Stripe calculé

## Règles de modification

1. **AUCUNE modification** sans validation écrite d'Ulrich
2. **Tests locaux** obligatoires avant tout push (`node -e "require('./src/...')"`)
3. **Commit atomique** avec description complète
4. **Redeploy Railway** uniquement après validation syntaxe

## Performance en production (au 2 juin 2026)

- 248 opportunités en DB (148 approuvées, 106 pitches)
- CA potentiel : $178 685 USD
- 1 abonné actif Stripe (Fils matondo kusehuka, 104.99 CAD/mois)
- Boucle autonome : scan toutes les 4h, 3 escouades géographiques + Squad #801-850

---

> *"L'Usine tourne seule à l'international. Elle chasse, elle négocie, elle propose.*  
> *Le prochain projet s'appelle DALEBA Local — commerces de proximité."*  
> — Béatrice, 2 juin 2026
