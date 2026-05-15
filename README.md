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

## Endpoints API

| Méthode | Route | Description |
|---|---|---|
| POST | `/api/chat` | Envoyer un message à DALEBA |
| GET | `/api/history/:id` | Historique d'une session |
| GET | `/api/status` | Santé du système |
| POST | `/api/emergency-stop` | Disjoncteur maître |

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
- [ ] Twilio SMS
- [ ] Interface 3D WebGL
