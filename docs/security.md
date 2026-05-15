# Security Architecture

This document is the artifact a security reviewer should read before approving a GetMCP deployment. It states what we defend against, what we don't, what's stored where, and how it's protected.

## Trust boundaries

```
        ┌────────────────────────────────────────────────────────────┐
        │                    GetMCP control plane                    │
        │                                                            │
  ┌─────┤  ┌──────────┐   ┌──────────────┐   ┌──────────────────┐  │
  │     │  │  /proxy  │ → │ PolicyEngine │ → │ Upstream forward │ ─┼─→  Customer's API
  │ AI  │  │ /agents  │   │ AuditService │   │  (axios stream)  │  │
  │ agt │  │ /policies│   │ AgentService │   └──────────────────┘  │
  │     │  │ /audit   │   └──────────────┘                          │
  └─────┤  │ /orgs    │                                              │
        │  │ /generator                                              │
        │  └──────────┘                                              │
        │       │                                                    │
        │  AuthGuard (Bearer + per-org isolation)                   │
        │       │                                                    │
        │  Postgres (org / agent / policy / audit / pending / ...)  │
        └────────────────────────────────────────────────────────────┘
                          ↑                          ↑
                   /slack/interactions          /metrics
                   (Slack-signed)                (Prom scrape)
```

Three actor classes:

1. **Org operators** — humans/CI authenticated by per-org bearer API keys (`gmcp_…`). Full read/write within their own org. Cannot see or affect other orgs.
2. **AI agents** — call `/proxy/execute` with the org's bearer + an `x-agent-id` asserting which agent they're acting as. The agent identity is checked against the org and its `enabled`/`revokedAt` state, and `x-agent-source` must match the agent record. Agents have no other surface — they cannot list or modify org config.
3. **Slack approvers** — humans inside the org's Slack workspace. Authenticated by Slack's HMAC signature on the interaction callback (per-org signing secret stored encrypted).

Cross-cutting:

- **Observability scrapers** (`GET /metrics`) are unauthenticated by design (Prometheus convention). Lock down at the network layer (in-cluster only, IP allowlist, or service mesh mTLS).
- **Healthchecks** (`GET /health/live`, `GET /health/ready`) are unauthenticated.

## Threat model

### What we defend against

| Threat | Control |
|---|---|
| Tenant A reads/writes Tenant B's data | `AuthGuard` resolves `apiKey → organizationId`; every Prisma query in the codebase is filtered by `organizationId`. Tenant-isolation regression tests in `apps/api/src/auth/auth.spec.ts`. |
| Replay of a recorded API key | API keys are scrypt-hashed at rest; revocation via `DELETE /api-keys/:id` propagates within ≤5s (cache TTL). |
| Replay/forgery of a Slack approval | HMAC SHA-256 signature verification with ±5min replay window. Constant-time comparison. Per-org signing secret is required — no global secret. |
| Tampering with audit history | Every `AuditLog` row is sha256-hashed over a canonical field set including the previous row's hash. `GET /audit/verify` walks the chain and reports `gap_in_seq` / `prev_hash_mismatch` / `hash_mismatch` at the first broken link. See [`docs/audit.md`](audit.md). |
| Unauthorized agent action | `MUTATION_APPROVAL` rules hold the request, post a Slack approval card, and only forward upstream after a human Approve. Rejected requests audit the approver's Slack ID. |
| Caller leaking their bearer to the upstream API | `ProxyService.buildForwardHeaders` strips `authorization`, `cookie`, and all `x-agent-*` / `x-tenant-id` / `x-request-id` headers before forwarding. |
| LLM spec classifier output tampering | Classifier output is persisted with `(orgId, specHash, path, method)` unique key; human overrides are tracked separately with operator + timestamp + reason. `effectiveVerdict()` makes the override precedence explicit. |
| Brute-force API key enumeration | scrypt is intentionally slow; the `prefix` index is the only fast lookup, and the prefix is 8 chars of base64url (~48 bits) — not feasible to enumerate online. Add a platform-level rate limit (deferred — see open items) for defense-in-depth. |
| Stored XSS in dashboard | Dashboard escapes by default (React) and serves with hardening headers (`X-Frame-Options: DENY`, `X-Content-Type-Options: nosniff`, `Referrer-Policy: strict-origin-when-cross-origin`) per `apps/web/nginx.conf`. |
| Open redirect via `upstreamBaseUrl` | DTO validation requires `http`/`https` scheme; Vite/Nest do not redirect based on this value. The proxy forwards to it but does not echo it back to other paths. |
| Cross-instance Slack approval double-spend | `transitionPending` uses an atomic `updateMany WHERE status='PENDING'` — the second click is a no-op. |

### What we do NOT defend against (in-scope of the customer's own threat model)

- **Compromised host** — anyone with root on the API container can read decrypted secrets and forge audit rows. Use hardened hosts and minimal IAM.
- **Compromised `KEY_ENCRYPTION_KEY`** — the at-rest encryption is irreversible without it; if leaked, all upstream auth headers + Slack secrets must be rotated.
- **Compromised database** — the audit chain is tamper-*evident*, not tamper-*proof*. An attacker with write access to Postgres can rewrite both the `AuditLog` row and the matching `Organization.lastAuditHash` head pointer. To get tamper-proof, periodically anchor `(orgId, lastAuditSeq, lastAuditHash)` to an external append-only store (object lock, transparency log, customer's own infra) — tracked in `CHECKLIST.md` §4.
- **Compromised upstream API credentials** — GetMCP forwards the per-org `upstreamAuthHeader` faithfully. If your Stripe / Salesforce / etc. key is compromised at the upstream, GetMCP cannot help you.
- **Compromised Slack workspace** — approvals are only as trustworthy as the Slack workspace's own access controls. Restrict the approver channel; consider requiring 2FA for Slack accounts.
- **Confused-deputy from the operator** — an org operator with a valid API key can change policies, revoke agents, and rotate Slack credentials. Use principle of least privilege when issuing API keys (mint scoped keys per use case; revoke aggressively).
- **Data sovereignty / region pinning** — single Postgres assumed. Customers needing EU data residency must run their own EU instance.

### Out-of-scope DoS

GetMCP does not include a platform-level WAF or unauthenticated-traffic rate limiter. Front it with one (Cloudflare, AWS WAF, or `nginx limit_req` at your ingress). The in-app `RATE_LIMIT` policy rule is for *authenticated* per-tenant burst control, not DoS protection.

## Data at rest catalog

| Where | What | How protected |
|---|---|---|
| `ApiKey.hash` | scrypt(plaintext, 16-byte salt, N=KEY_LEN=64) | Irreversible. Plaintext shown to the operator exactly once at mint. |
| `Organization.upstreamAuthHeader` | Customer's upstream API token (`Bearer sk_test_…`) | AES-256-GCM ciphertext via `KEY_ENCRYPTION_KEY`. Auth tag verified on decrypt. |
| `Organization.slackBotToken` | Slack bot OAuth token (`xoxb-…`) | Same — AES-256-GCM. |
| `Organization.slackSigningSecret` | Slack app signing secret | Same — AES-256-GCM. |
| `AgentIdentity` | Name, source, tenantScope, enabled flag | Plaintext. No credentials stored — agent identity is asserted by the org's API key holder via the `x-agent-id` header. |
| `AuditLog.hash`, `prevHash` | Per-row sha256 + chain | Tamper-evident. Verifiable via `GET /audit/verify`. |
| `AuditLog.reasoning`, `reason` | Free-text from the agent | Plaintext. May contain customer data; honor your retention policy (TODO: implement `Organization.auditRetentionDays`). |
| `PendingRequest.body`, `responseBody` | Held request payload + captured upstream response | Plaintext JSON, capped at 256KB. Cleared via lazy expiration (15-min default TTL) and the periodic sweeper. **May contain customer data — keep TTL short and clear via DB job if you need shorter retention.** |
| `EndpointClassification.reasoning` | LLM/heuristic explanation | Plaintext. Non-sensitive. |
| Postgres backups (`pg_dump`) | Everything above | Customer-managed. Treat backup files as production-sensitive — encrypt at rest (cloud-provider KMS or `gpg`). |

## Encryption details

`apps/api/src/crypto.util.ts`:

- Algorithm: AES-256-GCM
- Key: 32 bytes from `KEY_ENCRYPTION_KEY` env var (hex-encoded → 64 chars)
- IV: 12 random bytes per ciphertext (never reused — `crypto.randomBytes`)
- Format: `gcm$<iv-hex>$<authTag-hex>$<ciphertext-hex>`
- Auth tag: 16 bytes, verified on every decrypt — tampered ciphertext throws

Generate the key with `openssl rand -hex 32`. Same value must be set on every API replica.

`apps/api/src/auth/api-key.util.ts`:

- API keys: scrypt with random 16-byte salt, output 64 bytes
- Format stored: `scrypt$<salt-hex>$<derived-hex>`
- Verification: constant-time `timingSafeEqual`

`apps/api/src/audit/canonical.util.ts`:

- Audit hash: sha256 over `canonicalJson(payload)`
- Canonical JSON: keys sorted lexicographically, no whitespace, `NaN`/`Infinity` rejected

## TLS posture

GetMCP itself **does not terminate TLS**. The recommended posture:

- **Compose / VM**: front with nginx, Caddy, or a cloud LB; let it handle ACME and forward HTTP to port 3000 (API) / 8080 (Web).
- **Kubernetes**: use the bundled Ingress (`deploy/helm/getmcp/templates/ingress.yaml`) with `cert-manager` + Let's Encrypt. The chart's `ingress.tls.enabled` flag wires the secret name in.
- **Slack interactivity URL** must be HTTPS (Slack rejects HTTP). Configure your edge LB / ingress with a valid cert before pasting the URL into your Slack app config.

The API binds to all interfaces by default. **Do not expose port 3000 directly to the public internet** without TLS termination in front of it.

## CI security gates

`.github/workflows/ci.yml`:
- `pnpm audit --audit-level=high --prod` — fails the build on any high+ severity vuln in production deps. Override per-CVE via `pnpm.audit.ignoreCves` if non-applicable (document why in the PR).
- Type-check + lint + tests must all pass before merge.

`.github/workflows/codeql.yml`:
- GitHub CodeQL with `security-extended` query suite — catches SSRF, weak crypto, missing authz, prototype pollution, taint flow into shell/exec, etc.
- Runs on every PR and weekly to catch newly-published rules against unchanged code.
- Failures appear in the GitHub Security tab and block merge if branch protection requires it.

## Secrets handling — what NOT to commit

- No secrets in source. The only `.env*` files in git are `.env.example` templates with placeholder values.
- The historical leaked Postgres password (`beta_password_secure`) was rotated in commit `5921a16d`; any deployment using the old default must rebuild its volume.
- Slack tokens, Anthropic keys, and upstream API headers are configured per-org via `PATCH /orgs/me` and immediately encrypted. They are never logged (verify in pino logger config — only `req.id`, `organizationId`, `apiKeyId`, status, latency are logged).

## Vulnerability disclosure

See [`SECURITY.md`](../SECURITY.md). TL;DR: email **rayenbenabdallah88@gmail.com**, do not file public issues, response within 2 business days.
