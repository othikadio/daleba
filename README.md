# DALEBA Core v1.0

**Multi-AI Orchestration Engine** — Propriété de Kadio Ehouman Ulrich

## Architecture

```
Message entrant
      ↓
🧠 Routeur DALEBA (analyse intelligente)
      ↓
┌──────────────────────────────────────┐
│  Claude Sonnet  → Stratégie / Code   │
│  GPT-4o         → Créatif / Écriture │
│  DeepSeek-V3    → Données / Maths    │
└──────────────────────────────────────┘
      ↓
Mémoire PostgreSQL (historique sessions)
      ↓
Réponse unifiée
```

## Déploiement rapide (Railway)

1. Fork ce repo sur GitHub
2. Connecte Railway à ce repo
3. Ajoute les variables d'environnement (voir `.env.example`)
4. Railway déploie automatiquement

## Variables d'environnement requises

| Variable | Description |
|---|---|
| `DATABASE_URL` | PostgreSQL Railway |
| `ANTHROPIC_API_KEY` | Claude |
| `OPENAI_API_KEY` | GPT-4o |
| `DEEPSEEK_API_KEY` | DeepSeek |
| `DALEBA_MASTER_KEY` | Clé d'arrêt d'urgence |
| `STRIPE_SECRET_KEY` | Clé secrète Stripe |
| `STRIPE_WEBHOOK_SECRET` | Secret webhook Stripe |
| `STRIPE_SUCCESS_URL` | URL redirection paiement réussi |
| `STRIPE_CANCEL_URL` | URL redirection annulation |
| `TWILIO_ACCOUNT_SID` | Account SID Twilio |
| `TWILIO_AUTH_TOKEN` | Auth Token Twilio |
| `TWILIO_PHONE_NUMBER` | Numéro Twilio (ex: +15141234567) |
| `ULRICH_PHONE_NUMBER` | Téléphone Ulrich pour alertes |
| `GOOGLE_PLACES_API_KEY` | Clé Google Places API (GMB Scanner) |
| `JWT_SECRET` | Secret JWT (génère une clé aléatoire forte) |
| `APP_URL` | URL de l'app (ex: https://daleba.app) |

## Endpoints API

| Méthode | Route | Description |
|---|---|---|
| POST | `/api/chat` | Envoyer un message à DALEBA |
| GET | `/api/history/:id` | Historique d'une session |
| GET | `/api/status` | Santé du système |
| POST | `/api/emergency-stop` | Disjoncteur maître |
| POST | `/api/payment/create` | Créer session paiement Stripe |
| POST | `/api/payment/subscription` | Créer abonnement |
| POST | `/api/payment/webhook` | Webhook Stripe |
| POST | `/api/payment/refund` | Rembourser un paiement |
| POST | `/api/sms/send` | Envoyer SMS libre |
| POST | `/api/sms/confirmation` | SMS confirmation RDV |
| POST | `/api/sms/reminder` | SMS rappel 24h avant |
| POST | `/api/sms/cancellation` | SMS annulation RDV |
| POST | `/api/sms/alert` | Alerte urgente → Ulrich |
| POST | `/api/prospects/scan` | Scanner GMB une zone |
| GET | `/api/prospects/details/:id` | Fiche complète prospect |
| POST | `/api/prospects/outreach` | Générer message cold outreach |
| POST | `/api/prospects/strategy` | Stratégie de vente complète |
| POST | `/api/prospects/full` | Scan + Outreach en 1 requête |

## Exemple d'appel

```bash
curl -X POST https://ton-app.railway.app/api/chat \
  -H "Content-Type: application/json" \
  -d '{"message": "Analyse mes ventes du mois", "sessionId": "ulrich-01"}'
```

## Roadmap
- [x] Routeur multi-modèles
- [x] Mémoire PostgreSQL
- [x] API REST
- [x] Disjoncteur d'urgence
- [ ] Square Appointments
- [x] Twilio SMS
- [x] Stripe Paiements
- [x] GMB Scanner (Point 35)
- [x] Agent Prospection (Point 36)
- [ ] Interface 3D WebGL
