# ─── Stage 1: Install dependencies ───────────────────────────────────────────
FROM node:22-alpine AS deps
WORKDIR /app

COPY package*.json ./
RUN npm ci

# ─── Stage 2: Build ───────────────────────────────────────────────────────────
FROM node:22-alpine AS builder
WORKDIR /app

COPY --from=deps /app/node_modules ./node_modules
COPY . .

# NEXT_PUBLIC_* vars are embedded into the JS bundle at build time (not at container start).
# Kubernetes env on the Deployment cannot override this — rebuild with the URL the browser
# must call (public API / ingress), not cluster Service DNS.
# Example: docker build --build-arg NEXT_PUBLIC_API_BASE_URL=https://api.example.com -f fe/Dockerfile fe
ARG NEXT_PUBLIC_API_BASE_URL=http://localhost:3001
ENV NEXT_PUBLIC_API_BASE_URL=$NEXT_PUBLIC_API_BASE_URL
ENV NEXT_TELEMETRY_DISABLED=1

RUN --mount=type=cache,id=nextjs-fe,target=/app/.next/cache \
    npm run build

# ─── Stage 3: Production runtime ──────────────────────────────────────────────
FROM node:22-alpine AS runner
WORKDIR /app

# tini: forwards SIGTERM from EKS to Node and reaps zombie processes.
RUN apk add --no-cache tini

# Non-secret config only — secrets are injected at runtime by the
# Secrets Store CSI Driver or External Secrets Operator.
ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    PORT=3000 \
    HOSTNAME="0.0.0.0"

# Passwordless, shell-less non-root user
RUN addgroup --system --gid 1001 nodejs \
    && adduser  --system --uid 1001 --no-create-home --ingroup nodejs nextjs

# Standalone output contains only what the server needs (~70% smaller image)
COPY --from=builder /app/public                                ./public
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static     ./.next/static

USER nextjs
EXPOSE 3000

# TCP health check — EKS liveness/readiness probes override this in-cluster.
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
    CMD node -e "require('net').createConnection(3000,'localhost').on('connect',()=>process.exit(0)).on('error',()=>process.exit(1))"

# tini is PID 1; CMD is overridable by EKS Deployment spec args.
ENTRYPOINT ["/sbin/tini", "--"]
CMD ["node", "server.js"]
