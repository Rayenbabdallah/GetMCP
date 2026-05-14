# GetMCP Beta Deployment Guide

Welcome to the GetMCP Beta. This guide outlines how to deploy the GetMCP Enterprise Control Plane to your infrastructure.

## Prerequisites
- Docker & Docker Compose
- Node.js 20+ (for local development) — see `.nvmrc`
- pnpm 9+
- PostgreSQL (if running outside of Docker)

## Quick Start (Docker Compose)

The easiest way to run the GetMCP platform is via the included Docker Compose configuration. This will spin up a PostgreSQL database, the NestJS Policy Engine (API), and the React Control Plane Dashboard.

1. **Set environment variables**

   Copy the templates and fill in real values. Never commit the resulting `.env` files.
   ```bash
   cp .env.example .env
   cp apps/api/.env.example apps/api/.env
   ```
   Generate a strong `POSTGRES_PASSWORD` (e.g. `openssl rand -base64 32`) and set it in both files. The previous publicly-published default has been rotated — any existing volume must be recreated.

2. **Initialize the database**
   ```bash
   docker-compose up -d postgres
   pnpm install
   pnpm --filter api exec prisma db push
   ```

3. **Start the platform**
   ```bash
   docker-compose up --build -d
   ```

4. **Access the dashboard**
   Navigate to `http://localhost:80` (or your server's IP) to access the GetMCP Control Plane.

## Local development

```bash
pnpm install
pnpm dev          # runs API and web concurrently
pnpm typecheck    # whole monorepo
pnpm lint
pnpm test
```

## Architecture overview

- **`apps/api` (NestJS):** The core intelligence engine. It parses OpenAPI specs, generates Two-MCP trust boundaries, and runs the Proxy Interceptor to evaluate real-time agent requests against your policies.
- **`apps/web` (React/Vite):** The enterprise dashboard for managing policies, generating infrastructure, and viewing audit logs.
- **`docker-compose.yml`**: Container orchestration for local and beta deployments.

## Authentication

Every API endpoint (except `/health`) requires an `Authorization: Bearer <api-key>` header scoped to an Organization. Keys are minted by the seed script and via the `/orgs` endpoints (see `apps/api/src/auth`). All Prisma queries are filtered by the authenticated organization — see the tenant-isolation tests in `apps/api/src/auth/auth.spec.ts`.

## Roadmap

See `CHECKLIST.md` for the open execution list. The proxy currently simulates downstream execution and the Slack approval flow is a stub — both are scheduled in the next milestones.
