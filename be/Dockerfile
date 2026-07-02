# ─── Stage 1: Install dependencies ───────────────────────────────────────────
FROM node:22-slim AS deps
WORKDIR /app

COPY package*.json ./
# Keep dotenv v17 while bypassing upstream peer conflict from optional integrations.
# Also harden install against transient network timeouts in container builds.
RUN --mount=type=cache,id=npm-be,target=/root/.npm \
    npm ci --legacy-peer-deps

# ─── Stage 2: Build ───────────────────────────────────────────────────────────
FROM node:22-slim AS builder
WORKDIR /app

COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN npm run build

# Prune dev dependencies for the runtime stage
RUN npm prune --omit=dev --legacy-peer-deps

# ─── Stage 3: Production runtime ──────────────────────────────────────────────
FROM node:22-slim AS runner
WORKDIR /app

# tini: forwards SIGTERM from EKS to Node and reaps zombie processes.
# chromium: required by puppeteer-core (RAG document extraction).
RUN --mount=type=cache,id=apt-be,target=/var/cache/apt,sharing=locked \
    --mount=type=cache,id=apt-be-lists,target=/var/lib/apt/lists,sharing=locked \
    apt-get update && apt-get install -y --no-install-recommends \
    chromium \
    tini

# Non-secret config only — secrets are injected at runtime by the
# Secrets Store CSI Driver or External Secrets Operator.
ENV NODE_ENV=production \
    PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true \
    PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium \
    PORT=3000

# Passwordless, shell-less non-root user
RUN groupadd --system nodejs \
    && useradd --system --gid nodejs --no-create-home nestjs

COPY --from=builder --chown=nestjs:nodejs /app/dist        ./dist
COPY --from=builder --chown=nestjs:nodejs /app/node_modules ./node_modules
COPY --chown=nestjs:nodejs package*.json ./

USER nestjs
EXPOSE 3000

# TCP health check — EKS liveness/readiness probes override this in-cluster,
# but it's useful for local docker run and docker compose.
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
    CMD node -e "require('net').createConnection(3000,'localhost').on('connect',()=>process.exit(0)).on('error',()=>process.exit(1))"

# tini is PID 1; CMD is overridable by EKS Deployment spec args.
ENTRYPOINT ["/usr/bin/tini", "--"]
CMD ["node", "dist/main"]