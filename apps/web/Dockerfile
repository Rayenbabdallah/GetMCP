# syntax=docker/dockerfile:1.7
# Multi-stage build for the GetMCP web dashboard. Final image: ~50MB.

###############################################################################
# Stage 1 — Vite build
###############################################################################
FROM node:20-alpine AS builder

RUN corepack enable && corepack prepare pnpm@9.0.0 --activate

WORKDIR /app

COPY pnpm-lock.yaml pnpm-workspace.yaml package.json ./
COPY apps/web/package.json ./apps/web/

RUN pnpm install --frozen-lockfile

COPY apps/web ./apps/web

# VITE_API_URL must be available at build time — Vite inlines it into the bundle.
ARG VITE_API_URL=/api
ENV VITE_API_URL=$VITE_API_URL

WORKDIR /app/apps/web
RUN pnpm run build

###############################################################################
# Stage 2 — non-root nginx
###############################################################################
FROM nginxinc/nginx-unprivileged:1.27-alpine AS runtime

# nginx-unprivileged runs as UID 101. Listens on 8080 (port 80 needs root).
COPY --from=builder /app/apps/web/dist /usr/share/nginx/html
COPY apps/web/nginx.conf /etc/nginx/conf.d/default.conf

EXPOSE 8080

HEALTHCHECK --interval=10s --timeout=3s --start-period=5s --retries=3 \
  CMD wget -q -O- http://127.0.0.1:8080/health || exit 1
