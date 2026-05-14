# GetMCP — Road to Real

The execution checklist to turn the GetMCP repo from a pitch-deck demo into a product a paying B2B customer would deploy. Ordered by what unblocks the next thing, not by what's fun.

**Operating rules while working this list:**
- No new UI work until §3 is complete. The dashboard is fine. The plumbing is not.
- Every checked box must have a test or a demo recording proving it. "It compiles" is not done.
- If a task is blocked, write *why* next to the box and move on — don't stall the list.
- Re-read this file at the start of every work session. Cross items off in commits.

---

## §1 — Stop the bleeding (Days 1–2)

Repo hygiene that's costing time every day it's not fixed.

- [ ] Remove `apps/api/dist/` from git, add to `.gitignore`. Force-rebuild from source.
- [ ] Remove tracked `node_modules/` churn from git history (it's in `git status` — should never be).
- [ ] Add a real root `.gitignore` covering `dist/`, `node_modules/`, `.env`, `*.log`, `.DS_Store`.
- [ ] Move `apps/api/.env` out of git. Commit `.env.example` instead. Rotate the `beta_password_secure` Postgres password — it's in the README publicly.
- [ ] Add `pnpm typecheck` script at root (`pnpm -r exec tsc --noEmit`). Wire to CI.
- [ ] Add GitHub Actions: install → typecheck → lint → test on every PR. No merges without green.
- [ ] Pin Node version in `package.json` `engines` and `.nvmrc`. Currently nothing forces Node 20+.
- [ ] Downgrade `apps/web` TypeScript from `~6.0.2` (preview) to `~5.7` to match the API. One TS version across the monorepo.

## §2 — Real auth & multi-tenancy (Week 1) 🔴 ship-blocker

Without this, the product cannot be deployed to even one paying customer. Every endpoint is currently public.

- [ ] Add `Organization.apiKeyHash` (or split into `ApiKey` table for rotation). Hash with argon2id, never store plaintext.
- [ ] NestJS `AuthGuard` reading `Authorization: Bearer <key>`. Resolves to an `Organization` and attaches to request context.
- [ ] Apply guard globally via `APP_GUARD` provider. Whitelist only `/health`.
- [ ] Add `@CurrentOrg()` param decorator. Refactor every controller to use it.
- [ ] Refactor every Prisma query to filter by `organizationId` from the auth context. Audit: `grep -r "prisma\." apps/api/src` — every call must be scoped.
- [ ] Write a tenant-isolation integration test: seed two orgs, create a policy under org A with org A's key, attempt to read it with org B's key, assert 404.
- [ ] Replace `app.enableCors()` with explicit allowed origins from env.
- [ ] Add `helmet`, `compression`, request body size limits.
- [ ] Add per-org request ID middleware, log it on every line.

## §3 — Make the proxy actually proxy (Week 1–2) 🔴 ship-blocker

The product's core value prop is currently a `simulated_response`. This is the headline lie.

- [ ] Add `Organization.upstreamBaseUrl` to the schema + migration.
- [ ] Replace `simulateDownstreamExecution()` with real axios forwarding: method, path, headers (filtered), body, query string. Strip GetMCP-internal headers (`x-agent-*`) before forwarding.
- [ ] Per-org upstream auth: store `upstreamAuthHeader` (encrypted at rest) and inject into forwarded requests.
- [ ] Forward upstream response status, headers, body back to the caller faithfully. Don't swallow errors into 500s.
- [ ] Streaming-safe: handle large response bodies without buffering everything in memory.
- [ ] Configurable timeout per org, default 30s. Surface upstream timeouts as 504, not 500.
- [ ] Demo-able: hit `/proxy/execute` against the real Stripe sandbox API and get a real Stripe response back. Record the demo.

## §4 — Audit log that's actually a ledger (Week 2) 🔴 the moat

The bible promises a "tamper-proof execution ledger." Today it's a Prisma model with zero writes.

- [ ] Write an `AuditLog` row on every `interceptAndExecute` call: agent, org, method, path, status (`EXECUTED`/`BLOCKED`/`AWAITING_APPROVAL`), latency, reasoning, upstream status code, request/response sizes.
- [ ] Use a transactional outbox pattern so the audit write can't be skipped if the proxy succeeds.
- [ ] **Hash chain**: each row stores `prevHash = sha256(prevRow.hash || canonicalJson(thisRow))`. Genesis row per org. Demo-able tamper detection.
- [ ] Verification endpoint: `GET /audit/verify` walks the chain for an org, returns `{ valid: true, rowCount, lastHash }` or the index of the first broken link.
- [ ] `GET /audit?from=&to=&agentId=&path=` with cursor pagination. Default page size 100, max 1000.
- [ ] `GET /audit/export?format=ndjson` streaming export for SIEM ingestion (Splunk, Datadog).
- [ ] Document the audit schema and hash construction in `docs/audit.md` — auditors will ask.
- [ ] Retention policy field on `Organization` (default 90 days). Background job to prune older rows. Pruning must update genesis hash, not break the chain.

## §5 — AgentIdentity & key management (Week 2)

Today `AgentIdentity` exists in the schema and is unused at runtime. You can't audit who you can't identify.

- [ ] Resolve `x-agent-source` + `x-agent-id` headers to an `AgentIdentity` row. 401 if unknown.
- [ ] CRUD endpoints for agents under an org. API to mint a new agent key (returns plaintext once).
- [ ] Agent key revocation endpoint — takes effect within 5s across all instances (cache invalidation).
- [ ] Per-agent `enabled` flag. Honor it in the proxy.
- [ ] AuditLog rows reference `agentId`, not just source string. Backfill if needed.

## §6 — Policy engine that means what it says (Week 2–3)

Today the rules are partial mocks. Each one needs to do what its name claims.

- [ ] `RATE_LIMIT`: real Redis token bucket per `(orgId, agentId, tenantId)`. Configurable window + capacity in `actionConfig`. Return 429 with `Retry-After` header.
- [ ] `MUTATION_APPROVAL`: real Slack flow — see §7.
- [ ] `AUDIT`: validates `x-agent-reasoning` is present *and* non-trivial (length > 10 chars, not boilerplate). Reject `"because"` / `"test"` / empty.
- [ ] Add `ALLOWLIST` rule type: only proceed if the path matches an allowlist regex. Useful for narrow agent scopes.
- [ ] Add `BLOCK` rule type: explicit deny, used for breakglass shutoffs.
- [ ] Path matching: replace `path.includes(rule.targetPath)` (which matches `/v1/refunds-undo` against `/v1/refunds`) with proper path-template matching (`/v1/refunds/:id`).
- [ ] Rule precedence: deterministic ordering by `priority` field. Currently first-match-wins on `findMany` order — flaky.
- [ ] Cache active rules per org with 5s TTL. Invalidate on any policy `PATCH`.
- [ ] Policy dry-run endpoint: `POST /policies/simulate` — given a request shape, return which rules would fire and why.

## §7 — Slack approval that actually works (Week 3)

Today: `console.log`. Tomorrow: a real human-in-the-loop flow.

- [ ] Slack app manifest committed to repo. OAuth install per org, store bot token encrypted.
- [ ] On `MUTATION_APPROVAL`, persist a `PendingRequest` row with the full original request payload, TTL (default 15 min).
- [ ] Post interactive Slack message with `Approve` / `Deny` buttons + the reasoning + the agent name + the path.
- [ ] Slack interaction webhook endpoint with signature verification (Slack signing secret).
- [ ] On `Approve`: replay the request through the proxy with an `x-approval-token` bypass. On `Deny`: mark `PendingRequest` as denied, audit it.
- [ ] Original caller polls `GET /proxy/pending/:id` or uses long-poll/SSE for the resolution. Document both.
- [ ] Approvals expire — denied-by-timeout audit row written.
- [ ] Approver identity (Slack user) recorded in AuditLog. "Who approved what" is the compliance question.

## §8 — Operability (Week 3)

You cannot run this for a customer without these. Today none exist.

- [ ] Switch from `prisma db push` to `prisma migrate`. Generate initial migration from current schema. Document the deploy flow.
- [ ] Structured logging via `pino`. JSON to stdout. Request ID, org ID, agent ID on every line.
- [ ] `/health/live` (process up) and `/health/ready` (DB + Redis reachable) endpoints. Wire to compose healthcheck.
- [ ] Prometheus `/metrics`: request count, latency histogram, rule-evaluation counts, upstream error rate, audit chain length per org.
- [ ] OpenTelemetry traces for the proxy path. One span per: auth, policy eval, upstream call, audit write.
- [ ] Graceful shutdown: drain in-flight requests, finish audit writes before exit.
- [ ] Error tracking (Sentry or self-hosted GlitchTip). Don't log-and-pray.
- [ ] Rate-limit the API itself per org (separate from `RATE_LIMIT` policy) to prevent one customer from DoS'ing the platform.

## §9 — Generator: replace heuristics with something defensible (Week 4)

The keyword-matching generator is a nice demo and a weak product. A real enterprise spec has 500 endpoints and your regex misses half the dangerous ones.

- [ ] Add LLM-assisted classifier (Claude or GPT-4-class) that scores each endpoint on 4 axes: data sensitivity, mutation impact, tenant scope, reversibility. Output: structured JSON with reasoning.
- [ ] Cache classifier output by spec hash — don't reclassify unchanged specs.
- [ ] Human-in-the-loop review UI: show the classifier's calls, let the security team flip individual endpoints internal↔external before generating. Persist the overrides.
- [ ] Re-classification diff: when a spec is re-uploaded, show what changed (new endpoints, sensitivity changes) so the team can re-review only the deltas.
- [ ] Export the generated MCPs as actually-runnable code, not boilerplate template strings. Pin `@modelcontextprotocol/sdk` version. Include a README with run instructions.
- [ ] Test generator output against 5 real-world OpenAPI specs (Stripe, GitHub, Slack, Twilio, Plaid). Document false-positive and false-negative rates.

## §10 — Self-hosting & deploy (Week 4)

Enterprises won't let agent traffic leave their VPC. On-prem isn't optional — it's the wedge.

- [ ] Multi-stage Dockerfile for the API (build → runtime, non-root user, ~150MB final image).
- [ ] Multi-stage Dockerfile for the web (build → nginx-alpine, ~30MB).
- [ ] `docker-compose.prod.yml` with: real secrets via env, restart policies, log rotation, resource limits.
- [ ] Helm chart for k8s deploy with values for: image tag, DB URL, Redis URL, Slack secrets, replica count, ingress.
- [ ] Database backup script + restore runbook. Document RPO/RTO assumptions.
- [ ] Single-binary self-host bundle: docker compose + setup script + license-key gate. README walks a customer to working in <15 minutes.
- [ ] Air-gapped install path: documented offline image bundle, no calls home from the runtime.

## §11 — Security posture (Week 5)

You're selling security infrastructure. Your own posture is the demo.

- [ ] All secrets via env or a secret manager. Zero secrets in code, including templates.
- [ ] Encryption at rest for `upstreamAuthHeader`, Slack tokens, agent keys (column-level with KMS or libsodium sealed box).
- [ ] TLS termination documented (assume reverse proxy handles it; document required headers).
- [ ] Input validation via `class-validator` DTOs on every controller. Reject extra fields.
- [ ] Dependency scanning in CI: `pnpm audit --audit-level=high` blocks merge.
- [ ] SAST: GitHub CodeQL or Semgrep on every PR.
- [ ] One-page `SECURITY.md`: data flow diagram, what's stored, encryption story, vuln disclosure email.
- [ ] Begin SOC2 Type 1 with Vanta/Drata/Secureframe. 4–6 month timeline — start now, not later.
- [ ] Penetration test by an external firm before first paid enterprise customer. Budget $8–15k.

## §12 — Performance & scale (Week 5)

You can't sell "AI gateway" without latency numbers.

- [ ] Load test: k6 or autocannon. Target: p95 added latency < 25ms over upstream, p99 < 80ms, 1000 RPS per instance.
- [ ] Identify and fix the top 3 bottlenecks. Likely candidates: per-request `findMany` for rules (cache it), audit write blocking the response (move to async with outbox), no connection pooling on Prisma.
- [ ] Horizontal scaling test: 3 API instances behind a load balancer. Verify rate limiter and audit chain still work correctly under contention.
- [ ] Document scaling characteristics: requests/sec per CPU, memory per concurrent connection, DB connection budget.

## §13 — Tests that prove the claims (continuous)

Everything above must come with tests. Today the only spec is the Nest scaffold.

- [ ] Unit tests for `GeneratorService` heuristics: one test per rule, cover positive + negative cases.
- [ ] Unit tests for `ProxyService.interceptAndExecute`: each rule type, each match/no-match path.
- [ ] Integration tests with a real Postgres (testcontainers): tenant isolation, audit chain integrity, policy CRUD.
- [ ] E2E tests against a fake upstream (msw or a local fastify mock): full request → policy → upstream → audit cycle.
- [ ] Audit chain property test: insert N random rows, verify chain holds; mutate one row, verify detection.
- [ ] CI fails if test coverage on `proxy/` or `generator/` drops below 80%.

## §14 — Docs a customer can actually read (Week 5)

- [ ] `docs/quickstart.md`: zero to first proxied request in 10 minutes.
- [ ] `docs/policies.md`: every rule type, config schema, examples.
- [ ] `docs/audit.md`: schema, hash construction, verification, export formats.
- [ ] `docs/self-host.md`: docker, k8s, secrets, backups, upgrades.
- [ ] `docs/security.md`: threat model, data handling, compliance status.
- [ ] OpenAPI spec for the GetMCP API itself, published at `/docs` via Swagger UI.
- [ ] Postman collection in repo for manual testing.

## §15 — Go-to-market preconditions (Week 6+)

Don't take a dollar until these are true.

- [ ] One signed design-partner LOI (free or near-free pilot, reference rights). Until you have this, you're guessing.
- [ ] One demo recording: real Stripe sandbox, real Slack approval, real audit log verification. Under 4 minutes.
- [ ] Pricing page lists *one* tier (Pilot, $X/mo) until you have customers in two tiers. Don't list Enterprise before you can deliver it.
- [ ] Status page (statuspage.io or self-hosted). Begin publishing uptime from day one of the pilot.
- [ ] On-call rotation defined. Even if it's just you — a phone number that gets answered.
- [ ] Customer support channel (Slack Connect or shared Discord) with documented SLA.
- [ ] Quarterly security & uptime report template. First one ships at end of pilot quarter.

---

## Done means

A new engineer at a target customer can:
1. Read `docs/quickstart.md`.
2. Run `docker compose up`.
3. Mint an org and an agent key in the dashboard.
4. Point an MCP client at the proxy.
5. Watch a refund attempt get held in Slack, approved by a teammate, executed against the real upstream, and appear in a tamper-evident audit log they can export to their SIEM.

…in **under 30 minutes**, with **no help from you**.

When that's true, GetMCP is ready for its first 3 paying design partners. Not 20 — 3. Earn the next 17.
