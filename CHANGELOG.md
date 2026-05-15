# Changelog

All notable changes to GetMCP. The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Open work
See [`CHECKLIST.md`](CHECKLIST.md) for the ranked roadmap.

## [0.1.0] — 2026-05-15

First public release. Apache 2.0.

### Added — Platform
- **NestJS API** with per-organization bearer authentication (scrypt-hashed `gmcp_…` keys), tenant isolation enforced on every Prisma query, and `class-validator` DTOs on every endpoint.
- **Streaming proxy** at `POST /proxy/execute` — forwards real upstream responses faithfully (status, headers, body) via axios stream pipe. Per-org `upstreamBaseUrl` and AES-256-GCM-encrypted `upstreamAuthHeader`. Timeouts → 504, connection errors → 502.
- **Tamper-evident audit ledger** — every call writes one row to a per-org SHA-256 hash chain. `GET /audit/verify` walks the chain, returns first broken link with reason (`hash_mismatch` / `prev_hash_mismatch` / `gap_in_seq`). `GET /audit/export` streams NDJSON.
- **Agent identities** with 5-second revocation cache, asserted per call via `x-agent-id`. Cross-org lookups blocked.
- **Policy engine**: 5 rule types — `ALLOWLIST`, `BLOCK`, `AUDIT`, `RATE_LIMIT`, `MUTATION_APPROVAL` — evaluated by `priority ASC, createdAt ASC`. Real path templates (`/v1/users/:id`, `/v1/foo/*`, `*`), token-bucket rate limiter with `Retry-After`, reasoning quality gate. `POST /policies/simulate` dry-run with per-rule trace.
- **Slack approval flow** — interactive Block Kit cards, HMAC SHA-256 signature verification (±5min replay window), idempotent state transitions, replay-on-approve through the proxy with `bypassApproval`, captured upstream response surfaced via `GET /approvals/:id`. Periodic sweeper for TTL'd pendings.
- **LLM-assisted generator** — Claude classifies OpenAPI endpoints on 4 axes (data sensitivity, mutation impact, tenant scope, reversibility); falls back to keyword heuristics without `ANTHROPIC_API_KEY`. Per-endpoint human overrides. Spec-hash cache. Exports a runnable Node MCP server scaffold with pinned `@modelcontextprotocol/sdk@1.0.4`.

### Added — Operability
- **Prisma migrations** (no more `db push`); pre-install Helm hook and a one-shot `api-migrate` Compose service.
- **Pino structured JSON logs** with request id, org id, api key id, status, latency.
- **Prometheus metrics** at `/metrics` — proxy histogram, policy decision counters, audit write success/failure, approval lifecycle events.
- **Graceful shutdown** drains in-flight requests, closes Prisma, stops the approval sweeper.
- **`/health/live`** + **`/health/ready`** (DB ping).
- **Compression** middleware for JSON paths; explicitly skipped on `/proxy/execute` to preserve streaming.

### Added — Self-host
- **Multi-stage Dockerfiles** for API (~180MB, non-root, tini PID 1) and Web (~50MB, non-root nginx-unprivileged).
- **`docker-compose.prod.yml`** with healthchecks, restart policies, log rotation, resource limits.
- **Helm chart** at `deploy/helm/getmcp` with rolling deploys (`maxSurge:1, maxUnavailable:0`), pre-install migration job, externalized secrets, no bundled Postgres (BYO).
- **`bootstrap.sh`** — one-command first-time install that generates secrets, brings up the stack, seeds a demo org.
- **`backup-db.sh`** + **`restore-db.sh`** with sanity checks.

### Added — Security
- **Per-file CI coverage gates** on the 12 correctness-critical files; CI blocks merge on regression.
- **GitHub CodeQL** with `security-extended` query suite.
- **`pnpm audit --audit-level=high`** in CI.
- **`SECURITY.md`** + **`docs/security.md`** — threat model, data-at-rest catalog, TLS posture, vuln disclosure SLA.

### Added — Web dashboard
- React 19 + Tailwind 4 dashboard with Inter typography, teal brand (`#2f6364`).
- Public landing page + in-app docs at `/docs`.
- Eight product surfaces: Dashboard, Generator, Policies, Agents, Approvals, Audit log, API keys, Organization. Auth via paste-bearer-key flow.
- Swagger UI exposed at `GET /docs` on the API (gated behind `ENABLE_DOCS=true` in production).

### Added — Tests
- 128 tests, 20 suites. Property-style tests for the audit chain (200 random inserts, 50 single-field tampers, deletion + forgery detection). Cross-rule combination tests for the policy engine.

### Documentation
- Operator runbook (`docs/operations.md`)
- Performance targets and tuning (`docs/performance.md`)
- Test strategy and claim → test mapping (`docs/testing.md`)
- Quickstart, policies reference, audit, security, self-host, API reference

[Unreleased]: https://github.com/Rayenbabdallah/GetMCP/compare/v0.1.0...HEAD
[0.1.0]: https://github.com/Rayenbabdallah/GetMCP/releases/tag/v0.1.0
