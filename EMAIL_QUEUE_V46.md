# V46: Email Queue Système Autonome Multi-Provider + Fallback DB

## ✅ Statut: **DÉPLOYÉ ET OPÉRATIONNEL**

Commit: `4aef002` - Déployé sur Railway le 2026-06-01

---

## 🎯 Objectif

Implémenter un système d'email complet et autonome qui fonctionne MAINTENANT sans validation de domaine, avec multi-provider fallback et queue intelligente.

---

## 🏗️ Architecture

### 1. Table PostgreSQL `daleba_email_queue`

```sql
CREATE TABLE daleba_email_queue (
  id SERIAL PRIMARY KEY,
  to_address TEXT NOT NULL,
  from_address TEXT NOT NULL,
  subject TEXT NOT NULL,
  html TEXT,
  text TEXT,
  attachments_json JSONB,
  provider TEXT,
  status TEXT DEFAULT 'pending',
  attempts INTEGER DEFAULT 0,
  scheduled_at TIMESTAMPTZ DEFAULT NOW(),
  sent_at TIMESTAMPTZ,
  error_msg TEXT,
  metadata_json JSONB,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_email_queue_status ON daleba_email_queue(status);
CREATE INDEX idx_email_queue_scheduled ON daleba_email_queue(scheduled_at);
```

### 2. Service `src/services/email-queue.js`

**Queue d'envoi intelligente avec multi-provider :**

1. **Resend** : `onboarding@resend.dev` (clé via `RESEND_API_KEY` env var)
2. **Nodemailer SMTP** : Ethereal auto-généré (test/preview) avec timeout 10s
3. **Fallback DB** : Si tout échoue → `status='pending_manual'`, rapport JSON dans `metadata_json`

**Fonctions principales :**
- `ensureTableExists(pool)` - Création auto de la table
- `enqueueEmail(pool, opts)` - Ajouter un email à la queue
- `processQueue(pool, limit=90)` - Traiter max 90 emails/heure
- `getDailyStats(pool)` - Stats (total, sent, pending, failed, etc.)
- `retryEmail(pool, id)` - Retry un email failed
- `getEmailDetails(pool, id)` - Récupérer les détails d'un email

**Limites :**
- Max 90 emails/heure
- Max 5 tentatives par email
- Timeout Resend : 20s
- Timeout SMTP Ethereal : 30s (10s init + 20s send)

### 3. API Routes `src/api/email-queue-routes.js`

Toutes les routes sous `/api/email-queue` :

#### GET `/api/email-queue/stats`
Statistiques de la queue

**Réponse :**
```json
{
  "success": true,
  "stats": {
    "total": 2,
    "sent": 1,
    "pending": 0,
    "failed": 0,
    "pendingManual": 1,
    "retry": 0,
    "sentToday": 1
  }
}
```

#### GET `/api/email-queue/list?status=pending&limit=50`
Liste des emails avec filtres

**Paramètres :**
- `status` : `pending`, `sent`, `failed`, `pending_manual`, `retry`
- `limit` : nombre max (défaut 50)

**Réponse :**
```json
{
  "success": true,
  "status": "sent",
  "count": 1,
  "emails": [
    {
      "id": 2,
      "to": "kadioothniel@yahoo.fr",
      "from": "DALEBA <onboarding@resend.dev>",
      "subject": "Test Email Queue V46",
      "provider": "resend",
      "status": "sent",
      "attempts": 1,
      "scheduledAt": "2026-06-01T08:06:26.693Z",
      "sentAt": "2026-06-01T08:06:30.367Z",
      "error": null,
      "createdAt": "2026-06-01T08:06:26.694Z"
    }
  ]
}
```

#### POST `/api/email-queue/process`
Déclenche le traitement manuel

**Body :**
```json
{
  "limit": 90
}
```

**Réponse :**
```json
{
  "success": true,
  "processed": 1,
  "sent": 1,
  "failed": 0,
  "message": "Processed 1 emails: 1 sent, 0 failed"
}
```

#### POST `/api/email-queue/retry/:id`
Retry un email failed

**Réponse :**
```json
{
  "success": true,
  "message": "Email 1 marked for retry"
}
```

#### GET `/api/email-queue/download/:id`
Télécharge le rapport JSON d'un email

**Réponse :**
```json
{
  "id": 1,
  "to": "test@example.com",
  "from": "DALEBA <onboarding@resend.dev>",
  "subject": "Test Email Queue V46",
  "status": "pending_manual",
  "attempts": 2,
  "metadata": {
    "failureReason": "Connection timeout",
    "emailData": {...},
    "providersAttempted": ["resend", "smtp"]
  },
  "html": "...",
  "text": "..."
}
```

#### POST `/api/email-queue/enqueue`
Enqueue un nouvel email

**Body :**
```json
{
  "to": "user@example.com",
  "from": "DALEBA <onboarding@resend.dev>",
  "subject": "Subject here",
  "html": "<p>HTML content</p>",
  "text": "Plain text version",
  "scheduledAt": "2026-06-01T12:00:00Z"
}
```

### 4. Modification `src/workers/email-sequence-worker.js`

**Changements :**
- `sendEmail()` remplacée pour utiliser `emailQueue.enqueueEmail()` au lieu d'appel direct Resend
- Tous les emails de séquence passent maintenant par la queue
- Mode supervisé conservé (redirige vers Ulrich si pas de domaine vérifié)

### 5. Intégration dans `src/index.js`

**Ajouts :**

1. **Montage routes** (ligne ~134) :
```javascript
app.use('/api/email-queue', require('./api/email-queue-routes'));
```

2. **Cron workers** (après ligne ~413) :
```javascript
// [V46] Email Queue — process toutes les heures + init table
const emailQueue = require('./services/email-queue');
const { getPool } = require('./services/db');
const emailQueuePool = getPool();

emailQueue.ensureTableExists(emailQueuePool)
  .then(() => emailQueue.getDailyStats(emailQueuePool))
  .then(stats => console.log('[V46] Email Queue stats:', stats))
  .catch(e => console.warn('[Boot] Email Queue init:', e.message));

// Process queue toutes les heures
setInterval(() => {
  emailQueue.processQueue(emailQueuePool, 90)
    .catch(e => console.warn('[V46] Email Queue worker:', e.message));
}, 60 * 60 * 1000);

// Process initial après 2 minutes
setTimeout(() => {
  emailQueue.processQueue(emailQueuePool, 90)
    .catch(e => console.warn('[V46] Email Queue initial:', e.message));
}, 2 * 60 * 1000);

// [V46] Email Sequence worker — toutes les heures
const { processEmailSequences } = require('./workers/email-sequence-worker');
setInterval(() => {
  processEmailSequences(emailQueuePool)
    .catch(e => console.warn('[V46] Email Sequence worker:', e.message));
}, 60 * 60 * 1000);
```

3. **Helper DB** : `src/services/db.js` créé pour export central du pool

---

## 🧪 Tests Effectués

### Test 1: Enqueue + Stats
```bash
curl -X POST "https://daleba-api-production.up.railway.app/api/email-queue/enqueue" \
  -H "Content-Type: application/json" \
  -d '{
    "to": "kadioothniel@yahoo.fr",
    "subject": "Test V46",
    "html": "<p>Test</p>"
  }'
```
✅ **Résultat :** Email ID 2 créé

### Test 2: Process Queue
```bash
curl -X POST "https://daleba-api-production.up.railway.app/api/email-queue/process" \
  -H "Content-Type: application/json" \
  -d '{"limit": 10}'
```
✅ **Résultat :** 1 email envoyé via Resend

### Test 3: Stats
```bash
curl "https://daleba-api-production.up.railway.app/api/email-queue/stats"
```
✅ **Résultat :**
```json
{
  "total": 2,
  "sent": 1,
  "pending": 0,
  "failed": 0,
  "pendingManual": 1,
  "sentToday": 1
}
```

### Test 4: Fallback DB
Email vers `test@example.com` (adresse invalide) a échoué sur Resend et SMTP → Status `pending_manual` avec rapport JSON complet dans `metadata_json`

✅ **Résultat :** Système de fallback fonctionne

---

## 📊 Performance

- **Latence moyenne Resend :** ~4s
- **Latence fallback SMTP (timeout) :** ~30s
- **Throughput :** 90 emails/heure (configurable)
- **Fiabilité :** 3 niveaux de fallback (Resend → SMTP → DB)

---

## 🔄 Workflow Automatique

```
1. Email créé → INSERT dans daleba_email_queue (status='pending')
                ↓
2. Cron worker (toutes les heures) → SELECT pending WHERE scheduled_at <= NOW()
                ↓
3. Pour chaque email:
   a) Tenter Resend (20s timeout)
      ├─ Succès → UPDATE status='sent', provider='resend'
      └─ Échec → b)
   
   b) Tenter SMTP Ethereal (30s timeout)
      ├─ Succès → UPDATE status='sent', provider='smtp-ethereal'
      └─ Échec → c)
   
   c) Fallback DB
      └─ UPDATE status='pending_manual', metadata_json={rapport complet}
```

---

## 🚀 Prochaines Étapes

1. **Domaine vérifié Resend** : Acheter domaine et vérifier sur Resend pour envois directs
2. **SMTP production** : Remplacer Ethereal par Mailjet/SendGrid/Brevo en prod
3. **Rate limiting** : Ajouter throttling par destinataire
4. **Dashboard UI** : Interface admin pour gérer la queue visuellement
5. **Webhooks** : Ajouter callbacks pour events (sent, failed, etc.)

---

## 🔗 Liens Utiles

- **API Base :** `https://daleba-api-production.up.railway.app`
- **GitHub Repo :** `othikadio/daleba`
- **Resend Dashboard :** https://resend.com
- **Railway Dashboard :** https://railway.app

---

## 👨‍💻 Auteur

**Béatrice** (IA personnelle d'Ulrich)  
Mission V46 complétée le 2026-06-01 08:10 UTC

---

## ✅ Checklist de Validation

- [x] Table `daleba_email_queue` créée en DB
- [x] Service `email-queue.js` avec multi-provider
- [x] Routes API `/api/email-queue/*` fonctionnelles
- [x] Modification `email-sequence-worker.js` pour utiliser la queue
- [x] Cron worker actif (toutes les heures)
- [x] Tests réussis sur Railway
- [x] Commit + push sur GitHub (`4aef002`)
- [x] Railway redéployé automatiquement
- [x] Documentation complète rédigée

**STATUT FINAL : ✅ SYSTÈME OPÉRATIONNEL**
