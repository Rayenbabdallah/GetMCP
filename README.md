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

## Configuring an upstream

The proxy forwards requests to a per-organization downstream API. Set it via:

```bash
KEY=<your-gmcp_-key>
curl -X PATCH http://localhost:3000/orgs/me \
  -H "Authorization: Bearer $KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "upstreamBaseUrl": "https://api.stripe.com",
    "upstreamAuthHeader": "Bearer sk_test_...",
    "upstreamTimeoutMs": 10000
  }'
```

`upstreamAuthHeader` is encrypted at rest with `KEY_ENCRYPTION_KEY` (AES-256-GCM) and never returned by the API. Then call:

```bash
curl -X POST http://localhost:3000/proxy/execute \
  -H "Authorization: Bearer $KEY" \
  -H "x-agent-source: internal_mcp" \
  -H "Content-Type: application/json" \
  -d '{"method":"GET","path":"/v1/charges"}'
```

The upstream's status code, headers, and body stream through faithfully. Upstream timeouts return `504`, connection errors return `502`.

## Agents

`POST /proxy/execute` requires the caller to assert which agent they're acting as via the `x-agent-id` header. The agent must belong to the authenticated org and not be revoked or disabled.

```bash
KEY=<your-gmcp_-key>
# create an agent
AGENT_ID=$(curl -s -X POST http://localhost:3000/agents \
  -H "Authorization: Bearer $KEY" -H "Content-Type: application/json" \
  -d '{"name":"my-bot","source":"internal_mcp"}' | jq -r .id)

# use it
curl -X POST http://localhost:3000/proxy/execute \
  -H "Authorization: Bearer $KEY" \
  -H "x-agent-id: $AGENT_ID" \
  -H "x-agent-source: internal_mcp" \
  -H "Content-Type: application/json" \
  -d '{"method":"GET","path":"/v1/charges"}'

# revoke (takes effect within 5s on this instance)
curl -X DELETE http://localhost:3000/agents/$AGENT_ID -H "Authorization: Bearer $KEY"
```

## Policy engine

Five rule types, evaluated in `priority asc, createdAt asc` order. First terminal decision wins.

| ruleType | What it does | actionConfig |
|---|---|---|
| `ALLOWLIST` | Short-circuits to allow; skips later BLOCK/RATE_LIMIT for this match. | — |
| `BLOCK` | Terminal deny → `403`. | — |
| `AUDIT` | Rejects requests whose `x-agent-reasoning` is missing, < 10 chars, or boilerplate (`test`, `placeholder`, etc.). | — |
| `RATE_LIMIT` | Token bucket per `(orgId, agentId, tenantId)`. Returns `429` with `Retry-After`. External agents only. | `{"limit":50,"windowMs":60000,"scope":"agent+tenant"}` |
| `MUTATION_APPROVAL` | Holds the request, returns `202 AWAITING_APPROVAL`, fires Slack stub (real flow lands in §7). External agents only. | `{"channel":"#finance-ops"}` |

Path templates support exact (`/v1/refunds`), params (`/v1/users/:id`), prefix (`/v1/foo/*`), and `*`. Old `String.includes` matching is gone — `/v1/refunds-undo` no longer matches `/v1/refunds`.

```bash
KEY=<your-gmcp_-key>

# Full CRUD
curl http://localhost:3000/policies -H "Authorization: Bearer $KEY"
curl -X POST http://localhost:3000/policies -H "Authorization: Bearer $KEY" \
  -H "Content-Type: application/json" \
  -d '{"name":"block deletes","ruleType":"BLOCK","targetMethod":"DELETE","targetPath":"/v1/*","priority":10}'
curl -X PATCH http://localhost:3000/policies/ID -H "Authorization: Bearer $KEY" \
  -H "Content-Type: application/json" -d '{"isActive":false}'
curl -X DELETE http://localhost:3000/policies/ID -H "Authorization: Bearer $KEY"

# Dry-run: shows which rules fire and why, without forwarding upstream
curl -X POST http://localhost:3000/policies/simulate -H "Authorization: Bearer $KEY" \
  -H "Content-Type: application/json" \
  -d '{"method":"DELETE","path":"/v1/refunds/abc","source":"external_mcp","tenantId":"t-1","reasoning":"customer #321 requested rollback"}'
```

## Audit ledger

Every proxy call writes one tamper-evident `AuditLog` row to a per-organization hash chain. Quick checks:

```bash
KEY=<your-gmcp_-key>
curl -H "Authorization: Bearer $KEY" http://localhost:3000/audit | jq
curl -H "Authorization: Bearer $KEY" http://localhost:3000/audit/verify
curl -H "Authorization: Bearer $KEY" http://localhost:3000/audit/export -o audit.ndjson
```

Schema, hash construction, and integrity guarantees are documented in `docs/audit.md`.

## Roadmap

See `CHECKLIST.md` for the open execution list. Slack approval is still a stub log line — that's next.
