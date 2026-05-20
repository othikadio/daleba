#!/bin/bash
# ─────────────────────────────────────────────────────────────
# PostgreSQL Slave Init — Clone du Master via pg_basebackup
# Exécuté une seule fois au démarrage du VPS de secours
# ─────────────────────────────────────────────────────────────
set -e

PRIMARY_HOST="${PRIMARY_HOST:-localhost}"
PRIMARY_PORT="${PRIMARY_PORT:-5432}"
REPLICATION_USER="replicator"
REPLICATION_PASSWORD="${REPLICATION_PASSWORD}"
PGDATA="${PGDATA:-/var/lib/postgresql/data}"

echo "🔄 [Slave] Connexion au master: $PRIMARY_HOST:$PRIMARY_PORT"

# Attendre que le master soit prêt
until pg_isready -h "$PRIMARY_HOST" -p "$PRIMARY_PORT" -U "$REPLICATION_USER"; do
  echo "⏳ [Slave] Attente du master..."
  sleep 2
done

echo "📥 [Slave] Clone de la base via pg_basebackup..."
rm -rf "$PGDATA"/*
PGPASSWORD="$REPLICATION_PASSWORD" pg_basebackup \
  -h "$PRIMARY_HOST" \
  -p "$PRIMARY_PORT" \
  -U "$REPLICATION_USER" \
  -D "$PGDATA" \
  -P -Xs -R \
  --checkpoint=fast

# Fichier de récupération (PostgreSQL 12+)
cat > "$PGDATA/postgresql.auto.conf" <<EOF
# Auto-généré par slave-init.sh
primary_conninfo = 'host=$PRIMARY_HOST port=$PRIMARY_PORT user=$REPLICATION_USER password=$REPLICATION_PASSWORD application_name=daleba-slave'
primary_slot_name = 'daleba_replica_slot'
recovery_target_timeline = 'latest'
EOF

# Marquer comme standby
touch "$PGDATA/standby.signal"

echo "✅ [Slave] Réplication configurée — hot standby prêt"
