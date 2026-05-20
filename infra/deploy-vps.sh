#!/bin/bash
# ═══════════════════════════════════════════════════════════════
# DALEBA — Script de déploiement VPS (OVH / DigitalOcean)
# Usage: curl -sL <URL>/deploy-vps.sh | bash -s -- --env=.env.production
# Testé sur: Ubuntu 22.04 LTS / Debian 12
# ═══════════════════════════════════════════════════════════════
set -euo pipefail

REPO="https://github.com/othikadio/daleba.git"
APP_DIR="/opt/daleba"
COMPOSE_FILE="docker-compose.prod.yml"

log()  { echo -e "\033[1;36m[DALEBA]\033[0m $1"; }
ok()   { echo -e "\033[1;32m✅\033[0m $1"; }
err()  { echo -e "\033[1;31m❌\033[0m $1"; exit 1; }
warn() { echo -e "\033[1;33m⚠️\033[0m $1"; }

# ── 1. Dépendances système ───────────────────────────────────
log "1/6 — Installation Docker + Git..."
if ! command -v docker &>/dev/null; then
  apt-get update -qq && apt-get install -y -qq curl git
  curl -fsSL https://get.docker.com | sh
  systemctl enable --now docker
  ok "Docker installé"
else
  ok "Docker déjà présent: $(docker --version)"
fi

# Docker Compose v2
if ! docker compose version &>/dev/null; then
  apt-get install -y -qq docker-compose-plugin
  ok "Docker Compose installé"
fi

# ── 2. Clone / Pull du repo ──────────────────────────────────
log "2/6 — Récupération du code DALEBA..."
if [ -d "$APP_DIR/.git" ]; then
  cd "$APP_DIR" && git pull --ff-only origin main
  ok "Repo mis à jour"
else
  git clone "$REPO" "$APP_DIR"
  ok "Repo cloné dans $APP_DIR"
fi
cd "$APP_DIR"

# ── 3. Vérification .env.production ─────────────────────────
log "3/6 — Vérification des variables d'environnement..."
if [ ! -f ".env.production" ]; then
  if [ -f ".env.production.example" ]; then
    warn ".env.production absent — copie depuis .env.production.example"
    cp .env.production.example .env.production
    warn "⚠️  ÉDITE .env.production avant de continuer (DATABASE_URL, clés API...)"
    warn "    nano $APP_DIR/.env.production"
    read -r -p "Appuie sur Entrée une fois .env.production complété..."
  else
    err ".env.production manquant — impossible de continuer"
  fi
fi

REQUIRED_VARS=(DATABASE_URL POSTGRES_PASSWORD ANTHROPIC_API_KEY SQUARE_ACCESS_TOKEN TWILIO_ACCOUNT_SID TWILIO_AUTH_TOKEN)
for var in "${REQUIRED_VARS[@]}"; do
  if grep -q "^${var}=" .env.production; then
    ok "$var ✓"
  else
    warn "$var manquant dans .env.production"
  fi
done

# ── 4. SSL (Let's Encrypt ou self-signed) ────────────────────
log "4/6 — Certificats SSL..."
mkdir -p infra/nginx/ssl
if [ ! -f "infra/nginx/ssl/fullchain.pem" ]; then
  if command -v certbot &>/dev/null && [ -n "${DOMAIN:-}" ]; then
    certbot certonly --standalone -d "$DOMAIN" --non-interactive --agree-tos -m "kadioothniel@yahoo.fr"
    ln -sf "/etc/letsencrypt/live/$DOMAIN/fullchain.pem" infra/nginx/ssl/fullchain.pem
    ln -sf "/etc/letsencrypt/live/$DOMAIN/privkey.pem"   infra/nginx/ssl/privkey.pem
    ok "Let's Encrypt configuré pour $DOMAIN"
  else
    warn "Génération d'un certificat auto-signé (à remplacer par Let's Encrypt)"
    openssl req -x509 -nodes -days 365 -newkey rsa:2048 \
      -keyout infra/nginx/ssl/privkey.pem \
      -out infra/nginx/ssl/fullchain.pem \
      -subj "/C=CA/ST=QC/L=Longueuil/O=Kadio Coiffure/CN=${DOMAIN:-daleba.local}" 2>/dev/null
    ok "Certificat auto-signé généré"
  fi
fi

# ── 5. Build + démarrage ────────────────────────────────────
log "5/6 — Build de l'image Docker + démarrage..."
docker compose -f "$COMPOSE_FILE" build --no-cache
docker compose -f "$COMPOSE_FILE" up -d
ok "Conteneurs démarrés"

# ── 6. Vérification santé ───────────────────────────────────
log "6/6 — Vérification santé..."
sleep 15
MAX_WAIT=60; waited=0
until curl -sf http://localhost/api/status &>/dev/null; do
  sleep 3; waited=$((waited+3))
  [ $waited -ge $MAX_WAIT ] && err "Healthcheck échoué après ${MAX_WAIT}s — vérifie: docker compose -f $COMPOSE_FILE logs"
done

ok "DALEBA opérationnel sur http://localhost"
echo ""
echo "═══════════════════════════════════════════════════════"
echo "  🚀 DALEBA DÉPLOYÉ AVEC SUCCÈS"
echo "  📊 HUD Admin:   https://${DOMAIN:-<IP>}/admin"
echo "  ❤️  Status:     https://${DOMAIN:-<IP>}/api/status"
echo "  📋 Logs:        docker compose -f $APP_DIR/$COMPOSE_FILE logs -f"
echo "  🔄 Failover:    bash $APP_DIR/infra/cloudflare/failover.sh &"
echo "═══════════════════════════════════════════════════════"

# ── Optionnel: démarrer le failover guard en arrière-plan ───
if [ -f ".env.cloudflare" ]; then
  source .env.cloudflare
  nohup bash infra/cloudflare/failover.sh >> /var/log/daleba-failover.log 2>&1 &
  ok "Failover guard démarré (PID $!)"
fi
