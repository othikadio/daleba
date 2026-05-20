#!/bin/bash
# ─────────────────────────────────────────────────────────────
# PostgreSQL Master Init — Réplication Streaming
# Exécuté une seule fois à la création du conteneur
# ─────────────────────────────────────────────────────────────
set -e

REPLICATION_USER="${POSTGRES_REPLICATION_USER:-replicator}"
REPLICATION_PASSWORD="${POSTGRES_REPLICATION_PASSWORD}"

echo "🔧 [Master] Création utilisateur de réplication: $REPLICATION_USER"

psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" <<-EOSQL
  -- Utilisateur de réplication (lecture seule, pas de login DB)
  CREATE USER $REPLICATION_USER WITH REPLICATION ENCRYPTED PASSWORD '$REPLICATION_PASSWORD';

  -- Autoriser connexion depuis n'importe quelle IP du réseau Docker
  -- (Cloudflare + replica VPS)
EOSQL

# Ajouter pg_hba.conf pour la réplication
cat >> "$PGDATA/pg_hba.conf" <<EOF

# Réplication streaming (slave)
host    replication     $REPLICATION_USER    0.0.0.0/0    scram-sha-256
# Connexion app depuis Docker network
host    all             all                  172.0.0.0/8  scram-sha-256
EOF

echo "✅ [Master] Réplication configurée"
