# ─────────────────────────────────────────────────────────────
# DALEBA — Dockerfile Production Multi-Stage
# Stage 1: deps → Stage 2: production minimal
# ─────────────────────────────────────────────────────────────

# ── Stage 1: install deps ────────────────────────────────────
FROM node:20-alpine AS deps
WORKDIR /app
COPY package*.json ./
RUN npm ci --only=production --ignore-scripts && npm cache clean --force

# ── Stage 2: image production finale ─────────────────────────
FROM node:20-alpine AS production
LABEL maintainer="Béatrice/DALEBA <kadioothniel@yahoo.fr>"
LABEL org.opencontainers.image.title="DALEBA Core"
LABEL org.opencontainers.image.version="2.0"

# Sécurité: utilisateur non-root
RUN addgroup -S daleba && adduser -S daleba -G daleba

WORKDIR /app

# Copier deps compilés depuis Stage 1
COPY --from=deps /app/node_modules ./node_modules

# Copier le code source (hors node_modules, hors .env)
COPY --chown=daleba:daleba src/ ./src/
COPY --chown=daleba:daleba public/ ./public/
COPY --chown=daleba:daleba package.json railway.json ./

# Dossier logs runtime
RUN mkdir -p /app/logs && chown daleba:daleba /app/logs

USER daleba

# Railway / DigitalOcean / OVH injectent PORT automatiquement
ENV NODE_ENV=production
ENV PORT=3000

EXPOSE 3000

# Healthcheck natif Docker — vérifié par Cloudflare et docker-compose
HEALTHCHECK --interval=15s --timeout=5s --start-period=20s --retries=3 \
  CMD wget -qO- http://localhost:3000/api/status || exit 1

CMD ["node", "src/index.js"]
