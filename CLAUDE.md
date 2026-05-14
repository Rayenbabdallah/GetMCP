# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Repository layout

pnpm workspace monorepo (`pnpm-workspace.yaml` → `apps/*`, `packages/*`). Two apps today:

- `apps/api` — NestJS 11 + Prisma 5 + PostgreSQL. The Policy Engine and Proxy Interceptor.
- `apps/web` — React 19 + Vite. The Control Plane dashboard.

There is no shared `packages/*` yet. Root `package.json` only orchestrates workspace scripts.

## Common commands

Run from the repo root unless noted:

```bash
pnpm install                    # install all workspaces
pnpm dev                        # api + web concurrently
pnpm dev:api                    # NestJS watch mode (port 3000)
pnpm dev:web                    # Vite dev server
pnpm build                      # build all workspaces
pnpm lint                       # lint all workspaces
```

API-specific (run inside `apps/api`):

```bash
pnpm test                       # all jest specs (testRegex: *.spec.ts under src/)
pnpm test -- proxy.service      # single file / pattern
pnpm test:watch
pnpm test:cov
pnpm test:e2e                   # uses test/jest-e2e.json
pnpm start:prod                 # node dist/main (after pnpm build)

npx prisma db push              # apply schema.prisma to DATABASE_URL
npx prisma generate             # regenerate @prisma/client
node prisma/seed.js             # seed example Organization + PolicyRules
```

Docker stack (root):

```bash
docker-compose up -d postgres   # DB only — required before first prisma db push
docker-compose up --build -d    # full stack: postgres (5433→5432), api (3000), web (80)
```

`apps/api/.env` must define `DATABASE_URL`. README documents the beta value.

## Architecture

GetMCP is an "AI infrastructure generation" platform implementing the **Two-MCP trust model**: every enterprise API is split into an Internal MCP (god-mode, internal agents) and an External MCP (scoped, customer-facing agents). See `GETMCP_BIBLE.md` for product vision.

The NestJS API has two top-level modules wired in `apps/api/src/app.module.ts`:

### 1. `generator/` — the Two-MCP compiler

`GeneratorService.generateTrustBoundaries()` fetches a remote OpenAPI spec via axios and runs heuristics to decide which `(path, verb)` pairs are safe enough for the External MCP. Heuristics (in order, all in `generator.service.ts`):

1. Sensitive path keywords (`admin`, `internal`, `billing`, `logs`, …) → exclude entire path.
2. Dangerous verbs (`delete`, `patch`) → exclude verb.
3. Sensitive keywords in `description`, `summary`, or `tags`.
4. PII parameters (`ssn`, `password`, `token`, …).
5. Tenant isolation: `POST`/`PUT` without a tenant/user/customer scope param and no path templating → excluded as "global mutation".

`exportInfrastructureZip()` runs the same generator and streams a zip containing two MCP-server scaffolds (`internal-mcp/`, `external-mcp/`) plus a `docker-compose.yml`. The MCP server boilerplate is a hardcoded template literal that imports `@modelcontextprotocol/sdk` — that dependency lives in the *generated* package.json, not in `apps/api`.

### 2. `proxy/` — the runtime Policy Interceptor

`POST /proxy/execute` is the gateway endpoint. It reads three headers — `x-agent-source`, `x-agent-reasoning`, `x-tenant-id` — builds an `AgentRequest`, and calls `ProxyService.interceptAndExecute()`.

`ProxyService` loads all `isActive` `PolicyRule` rows from Prisma and walks them. Rules only apply to `source === 'external_mcp'`. The three `ruleType`s map to:

- `AUDIT` → require `x-agent-reasoning` header, else 403.
- `MUTATION_APPROVAL` → return `AWAITING_APPROVAL` (does not execute) and fire a logged "Slack webhook" stub.
- `RATE_LIMIT` → require `x-tenant-id` header, else 403. (No actual counter yet.)

If no rule blocks, `simulateDownstreamExecution()` returns a fake success — real downstream proxying is not wired yet. README notes this is intentional for the beta.

`GET /proxy/policies` and `PATCH /proxy/policies/:id` expose CRUD for the dashboard.

### 3. Persistence

Single Prisma schema at `apps/api/prisma/schema.prisma`. Core models: `Organization` → `OpenApiSpec`, `PolicyRule`, `AgentIdentity` → `AuditLog`. `prisma/seed.js` creates a sample Stripe org with the three policy rule types above — useful when the proxy interceptor returns empty results.

`PrismaService` is provided ad-hoc in modules that need it; there is no global Prisma module.

### Status of beta vs vision

Per README §"Managing Policies (Beta)": the dashboard already reads/writes `PolicyRule` rows, but downstream API proxying and tenant rate-limit counters are stubs. `AuditLog` is defined in the schema but `ProxyService` does not yet write to it — if you add audit persistence, the model is ready. `AgentIdentity` is unused at runtime.

## Conventions worth knowing

- ESM/Node 20+. The web app's TypeScript is pinned to `~6.0.2` (preview) — don't downgrade without checking Vite 8 compatibility.
- `apps/api/dist/` is committed (visible in `git status`); regenerate via `pnpm build` rather than hand-editing.
- CORS is wide-open in `main.ts` (`app.enableCors()`) — fine for local dev, reconsider before non-beta deployment.
- Compose maps Postgres to host **5433**, not 5432, to avoid clashing with a local Postgres.
