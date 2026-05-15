# syntax=docker/dockerfile:1.7
# Multi-stage build for the GetMCP API.
# Final image: ~180MB, non-root, signal-handling correct under PID 1.

###############################################################################
# Stage 1 — install full deps + build
###############################################################################
FROM node:20-alpine AS builder

RUN corepack enable && corepack prepare pnpm@9.0.0 --activate

WORKDIR /app

# Copy only the manifests first so the install layer caches across source edits.
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json ./
COPY apps/api/package.json ./apps/api/

RUN pnpm install --frozen-lockfile

COPY apps/api ./apps/api

WORKDIR /app/apps/api
RUN pnpm exec prisma generate
RUN pnpm run build

###############################################################################
# Stage 2 — production runtime
###############################################################################
FROM node:20-alpine AS runtime

RUN apk add --no-cache tini openssl wget \
    && addgroup -S getmcp -g 1001 \
    && adduser  -S getmcp -G getmcp -u 1001

RUN corepack enable && corepack prepare pnpm@9.0.0 --activate

WORKDIR /app

COPY --from=builder /app/package.json /app/pnpm-workspace.yaml /app/pnpm-lock.yaml ./
COPY --from=builder /app/apps/api/package.json ./apps/api/
COPY --from=builder /app/apps/api/dist     ./apps/api/dist
COPY --from=builder /app/apps/api/prisma   ./apps/api/prisma

RUN pnpm install --prod --frozen-lockfile \
    && cd apps/api && pnpm exec prisma generate \
    && pnpm store prune \
    && chown -R getmcp:getmcp /app

USER getmcp
WORKDIR /app/apps/api

EXPOSE 3000

# tini as PID 1 → forwards SIGTERM to node → Nest's enableShutdownHooks runs.
ENTRYPOINT ["/sbin/tini", "--"]
CMD ["node", "dist/main.js"]

HEALTHCHECK --interval=10s --timeout=3s --start-period=15s --retries=3 \
  CMD wget -q -O- http://127.0.0.1:3000/health/live || exit 1
