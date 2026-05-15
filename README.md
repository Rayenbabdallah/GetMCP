# GetMCP Beta Deployment Guide

Welcome to the GetMCP Beta. This guide outlines how to deploy the GetMCP Enterprise Control Plane to your infrastructure.

## Prerequisites
- Docker & Docker Compose
- Node.js 20+ (for local development) — see `.nvmrc`
- pnpm 9+
- PostgreSQL (if running outside of Docker)

## Quick Start (one command)

```bash
git clone https://github.com/Rayenbabdallah/GetMCP
cd GetMCP
./deploy/scripts/bootstrap.sh
```

The bootstrap script generates `.env` with fresh `POSTGRES_PASSWORD` + `KEY_ENCRYPTION_KEY`, brings up Postgres, runs migrations, starts API + Web, and seeds a demo org. Re-runnable safely. Output prints a working API key (saved exactly once) and curl commands.

Defaults: dashboard at `http://localhost:8080`, API at `http://localhost:3000`. Kubernetes deploy via Helm chart in `deploy/helm/getmcp/`. Full operations runbook in `docs/operations.md`.

## Production deploy

- **Docker Compose**: `docker compose -f docker-compose.prod.yml up -d` after `bootstrap.sh`. Healthchecks, restart policies, log rotation, resource limits, and the migrate-before-start ordering are all wired in.
- **Kubernetes (Helm)**: `helm install getmcp deploy/helm/getmcp -n getmcp --set ingress.host=...`. Pre-install Helm hook runs `prisma migrate deploy`; rolling deploy uses `maxSurge:1, maxUnavailable:0`. Chart deliberately does NOT bundle Postgres — bring your own (Marketplace Neon, RDS, Cloud SQL).
- **Backups**: `./deploy/scripts/backup-db.sh` (compressed `pg_dump` + retention prune); restore via `./deploy/scripts/restore-db.sh`. Always re-run `GET /audit/verify` after a restore — the chain must report `valid: true`.

See `docs/operations.md` for the full runbook (upgrades, rolling secrets, common incidents, alerting thresholds).

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

## Generator

GetMCP turns an OpenAPI spec into two runnable MCP servers (Internal + External). Endpoints are scored by an LLM classifier on four axes (data sensitivity, mutation impact, tenant scope, reversibility), cached by canonical spec hash, and overridable per endpoint by your security team.

```bash
KEY=<your-gmcp_-key>

# Classify (cached on second call for the same spec — no LLM cost)
curl -X POST http://localhost:3000/generator/classify \
  -H "Authorization: Bearer $KEY" -H "Content-Type: application/json" \
  -d '{"openapiUrl":"https://petstore3.swagger.io/api/v3/openapi.json"}'

# Flip an endpoint manually (or clear with "exposeExternally": null)
curl -X POST http://localhost:3000/generator/override \
  -H "Authorization: Bearer $KEY" -H "Content-Type: application/json" \
  -d '{"specHash":"...","path":"/admin/users","method":"delete","exposeExternally":true,"reason":"audited"}'

# Generate the Two-MCP split (uses cached classifications + overrides)
curl -X POST http://localhost:3000/generator/generate \
  -H "Authorization: Bearer $KEY" -H "Content-Type: application/json" \
  -d '{"openapiUrl":"https://petstore3.swagger.io/api/v3/openapi.json"}'

# Download the runnable scaffold (zip)
curl -G "http://localhost:3000/generator/export" \
  -H "Authorization: Bearer $KEY" --data-urlencode "openapiUrl=..." -o getmcp.zip
```

The exported zip contains real, runnable Node MCP servers — pinned `@modelcontextprotocol/sdk@1.0.4`, one tool per (method, path), reads `schema.json` at startup, forwards calls to `UPSTREAM_BASE_URL` via fetch. `cd internal-mcp && npm install && UPSTREAM_BASE_URL=... npm start` works out of the box.

Set `ANTHROPIC_API_KEY` to enable the LLM classifier. Without it, the generator falls back to keyword heuristics (deterministic, no network call, lower accuracy).

## Operability

- **Logs**: structured JSON via pino, one line per request. Each line carries `req.id` (sourced from `x-request-id` header or generated). Override level with `LOG_LEVEL=debug|info|warn|error|silent`.
- **Health**: `GET /health/live` (process up), `GET /health/ready` (DB reachable). Both `@Public`.
- **Metrics**: `GET /metrics` exposes Prometheus text. Series:
  - `getmcp_proxy_requests_total{action,source,upstream_status}` — proxy outcomes
  - `getmcp_proxy_request_duration_ms_bucket{action,source}` — controller-entry to response-finish latency histogram
  - `getmcp_policy_decisions_total{kind}` — engine outcome distribution
  - `getmcp_audit_writes_total{result}` — `ok` vs `failed` audit writes (the headline reliability metric)
  - `getmcp_approval_events_total{event}` — created / approved / denied / expired
  - Plus `getmcp_*` Node defaults (CPU, heap, event loop lag).
- **Migrations**: `prisma migrate` is the deploy path; `db push` is gone. Initial migration committed under `apps/api/prisma/migrations/20260515000000_init`.
- **Shutdown**: `enableShutdownHooks()` on SIGINT/SIGTERM drains in-flight requests, closes Prisma, stops the approval sweeper.

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

## Slack approval flow

A `MUTATION_APPROVAL` rule holds the request, posts an interactive Approve/Deny card to Slack, and returns `202` with a `pendingId`. The original caller polls `GET /approvals/:id` until status leaves `PENDING`.

**Configure once per org:**

```bash
curl -X PATCH http://localhost:3000/orgs/me \
  -H "Authorization: Bearer $KEY" -H "Content-Type: application/json" \
  -d '{
    "slackBotToken": "xoxb-...",
    "slackSigningSecret": "abc123...",
    "slackDefaultChannel": "#approvals"
  }'
```

Both Slack secrets are AES-256-GCM encrypted at rest. Point your Slack app's **Interactivity Request URL** at `https://your-getmcp/slack/interactions` — the endpoint verifies signatures (`v0` HMAC-SHA256, ±5min replay window).

**Lifecycle:**

1. Caller `POST /proxy/execute` → policy fires `MUTATION_APPROVAL` → response is `202 { pendingId, pollUrl, expiresAt }`. Default TTL 15 min.
2. Slack message has Approve/Deny buttons. The clicker's identity is recorded in the audit log.
3. On Approve: request is replayed through the proxy with `bypassApproval=true` (other rules — BLOCK / RATE_LIMIT / AUDIT — still apply). Upstream response is captured (status + headers + body up to 256KB).
4. On Deny / Expire: a BLOCKED audit row is written, no upstream call is made.
5. Caller polls `GET /approvals/:id` → eventually receives `{status, responseStatus, responseHeaders, responseBody}`.

A background sweeper expires PENDING rows past their TTL every 30s.

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
