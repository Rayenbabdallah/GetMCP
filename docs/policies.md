# Policy Reference

Five rule types, evaluated by `priority ASC, createdAt ASC`. **First terminal decision wins.** Lower `priority` value = evaluated first.

| ruleType | Terminal? | Source filter | Purpose |
|---|---|---|---|
| `ALLOWLIST` | yes (allow) | both | Explicit allow; short-circuits later BLOCK / RATE_LIMIT for this match |
| `BLOCK` | yes (deny) | both | Terminal 403 |
| `AUDIT` | only on failure | both | Reject if `x-agent-reasoning` is empty / too short / a placeholder |
| `RATE_LIMIT` | only on exhaustion | external_mcp only | Token bucket; returns 429 with `Retry-After` |
| `MUTATION_APPROVAL` | yes (held) | external_mcp only | Returns 202 + `pendingId`; posts Slack approval card |

`internal_mcp` requests skip `RATE_LIMIT` and `MUTATION_APPROVAL` by design — internal agents are god mode. To rate-limit or hold internal traffic, classify those agents as `external_mcp`.

## Common fields

Every rule:

```jsonc
{
  "name": "string, ≤200 chars, required",
  "description": "string, ≤2000 chars, required (used in 403 messages and Slack cards)",
  "ruleType": "ALLOWLIST | BLOCK | AUDIT | RATE_LIMIT | MUTATION_APPROVAL",
  "targetMethod": "GET | POST | PUT | PATCH | DELETE | * (matches any)",
  "targetPath":   "exact | /v1/users/:id | /v1/foo/* | * (matches any)",
  "actionConfig": { /* type-specific, see below */ },
  "priority": 100,        // optional, 0..10000, default 100; lower runs first
  "isActive": true        // optional, default true
}
```

### Path matching

- **Exact**: `/v1/refunds` — matches only `/v1/refunds` (and `/v1/refunds/` after normalization).
- **Param**: `/v1/users/:id` — `:id` matches one path segment, no slashes.
- **Prefix**: `/v1/foo/*` — matches `/v1/foo/anything` and deeper, NOT `/v1/foo` or `/v1/foobar`.
- **Wildcard**: `*` or `**` — matches everything.

The matcher is segment-aware. Old `String.includes` matching is gone — `/v1/refunds` does NOT match `/v1/refunds-undo`.

### Method matching

Case-insensitive exact match, or `*` for any.

## ALLOWLIST

```jsonc
{
  "ruleType": "ALLOWLIST",
  "targetMethod": "POST",
  "targetPath": "/v1/refunds",
  "actionConfig": {},
  "priority": 50
}
```

Behavior: when this rule matches, the engine **immediately allows** the request and skips all later rules. Useful for carving exceptions to a broader BLOCK / RATE_LIMIT.

## BLOCK

```jsonc
{
  "ruleType": "BLOCK",
  "targetMethod": "DELETE",
  "targetPath": "/v1/customers/:id",
  "actionConfig": {},
  "priority": 10
}
```

Behavior: terminal `403` with `reason: "Policy Violation: <description>"`.

## AUDIT

```jsonc
{
  "ruleType": "AUDIT",
  "targetMethod": "*",
  "targetPath": "*",
  "actionConfig": {},
  "priority": 5
}
```

Behavior: requires the request to carry a non-trivial `x-agent-reasoning` header. Rejected reasons:

- empty / whitespace
- shorter than 10 characters
- in the boilerplate blocklist: `test`, `testing`, `because`, `reason`, `idk`, `why not`, `na`, `n/a`, `todo`, `fix`, `fixme`, `debug`, `debugging`, `just doing it`, `placeholder`

A passing AUDIT rule does NOT terminate evaluation — it just gates further rules. Failing AUDIT returns a `403` with a specific message (`reasoning is empty` / `reasoning must be at least 10 chars` / `reasoning is a generic placeholder`).

Best practice: put AUDIT at `priority: 5` so it runs first. A failing AUDIT short-circuits before consuming RATE_LIMIT tokens or firing Slack approvals.

## RATE_LIMIT

```jsonc
{
  "ruleType": "RATE_LIMIT",
  "targetMethod": "POST",
  "targetPath": "*",
  "actionConfig": {
    "limit": 50,
    "windowMs": 60000,
    "scope": "agent+tenant"
  },
  "priority": 100
}
```

`actionConfig`:

| Field | Type | Default | Notes |
|---|---|---|---|
| `limit` | int | 60 | Tokens per window |
| `windowMs` | int | 60000 | Window length in ms |
| `scope` | string | `agent+tenant` | Bucket key composition |

`scope` controls the bucket key. The rule's id is always part of the key, so two RATE_LIMIT rules with different limits don't share buckets:

| `scope` | Bucket key |
|---|---|
| `agent` | `<ruleId>\|<orgId>\|<agentId>` |
| `tenant` | `<ruleId>\|<orgId>\|<tenantId>` |
| `agent+tenant` (default) | `<ruleId>\|<orgId>\|<agentId>\|<tenantId>` |

Behavior: deducts 1 token per matching request. On exhaustion: terminal `429` with `Retry-After` header (computed from refill rate + tokens needed). On success: continues evaluation.

**Tenant required**: `RATE_LIMIT` requires the request to carry `x-tenant-id`. Without it, the rule blocks with `Policy Violation: missing x-tenant-id` regardless of bucket state — closing the easy bypass.

**Multi-instance gotcha**: the limiter is in-memory per API replica. With N replicas the global cap is `N × limit`. Size accordingly, or move to Redis (open in CHECKLIST §6).

## MUTATION_APPROVAL

```jsonc
{
  "ruleType": "MUTATION_APPROVAL",
  "targetMethod": "POST",
  "targetPath": "/v1/refunds",
  "actionConfig": {
    "channel": "#finance-ops"
  },
  "priority": 50
}
```

`actionConfig`:

| Field | Type | Default | Notes |
|---|---|---|---|
| `channel` | string | `#ops` | Slack channel for the approval card. Org's `slackDefaultChannel` used as fallback. |

Behavior:

1. Persists a `PendingRequest` row capturing the full original request (method, path, body, query, source, tenant, reasoning) with a 15-minute TTL.
2. Posts an interactive Slack message with `Approve` / `Deny` buttons (requires the org to have `slackBotToken` configured via `PATCH /orgs/me`).
3. Returns `202` to the caller with `{ pendingId, pollUrl, expiresAt, status: "AWAITING_APPROVAL" }`.
4. Caller polls `GET /approvals/:id` until status changes.
5. On Approve: replays the request through the proxy with `bypassApproval=true` (other rules — BLOCK / RATE_LIMIT / AUDIT — still apply), captures the upstream response (status + headers + JSON body up to 256KB), surfaces it to the polling caller. Approver's Slack identity recorded in the audit row.
6. On Deny / Expire: writes a `BLOCKED` audit row, no upstream call.

**Without a Slack bot token configured**: the rule still creates the `PendingRequest` row. The dashboard can drive the decision via a future approval UI; for now, an operator can mark the row by direct DB update. Tracked in CHECKLIST §7.

## Worked example: realistic ruleset for a payments API

```bash
KEY=gmcp_…

# 1. AUDIT — every external request must explain itself
curl -X POST http://localhost:3000/policies \
  -H "Authorization: Bearer $KEY" -H "Content-Type: application/json" \
  -d '{
    "name": "Mandatory reasoning",
    "description": "All external requests must include a non-trivial x-agent-reasoning header",
    "ruleType": "AUDIT", "targetMethod": "*", "targetPath": "*",
    "priority": 5
  }'

# 2. BLOCK — never allow deletes via the external surface, even with approval
curl -X POST http://localhost:3000/policies \
  -H "Authorization: Bearer $KEY" -H "Content-Type: application/json" \
  -d '{
    "name": "No external deletes",
    "description": "DELETE is never permitted from external_mcp",
    "ruleType": "BLOCK", "targetMethod": "DELETE", "targetPath": "*",
    "priority": 10
  }'

# 3. ALLOWLIST — read-only customer endpoints are always safe
curl -X POST http://localhost:3000/policies \
  -H "Authorization: Bearer $KEY" -H "Content-Type: application/json" \
  -d '{
    "name": "Customer read-only allowlist",
    "description": "GET /v1/customers/:id is always permitted",
    "ruleType": "ALLOWLIST", "targetMethod": "GET", "targetPath": "/v1/customers/:id",
    "priority": 30
  }'

# 4. RATE_LIMIT — 100 mutations per minute per (agent, tenant)
curl -X POST http://localhost:3000/policies \
  -H "Authorization: Bearer $KEY" -H "Content-Type: application/json" \
  -d '{
    "name": "Mutation rate limit",
    "description": "100 mutations per minute per agent+tenant",
    "ruleType": "RATE_LIMIT", "targetMethod": "POST", "targetPath": "*",
    "actionConfig": { "limit": 100, "windowMs": 60000, "scope": "agent+tenant" },
    "priority": 50
  }'

# 5. MUTATION_APPROVAL — refunds need a human in the loop
curl -X POST http://localhost:3000/policies \
  -H "Authorization: Bearer $KEY" -H "Content-Type: application/json" \
  -d '{
    "name": "Refund approval",
    "description": "All refunds require Slack approval from #finance-ops",
    "ruleType": "MUTATION_APPROVAL", "targetMethod": "POST", "targetPath": "/v1/refunds",
    "actionConfig": { "channel": "#finance-ops" },
    "priority": 60
  }'
```

Order at runtime (because of priority):

1. AUDIT (5) — reject if no reasoning
2. BLOCK (10) — reject if DELETE
3. ALLOWLIST (30) — short-circuit allow if GET /v1/customers/:id
4. RATE_LIMIT (50) — consume token, 429 if exhausted
5. MUTATION_APPROVAL (60) — hold for Slack approval if POST /v1/refunds

A `POST /v1/charges` from external_mcp with valid reasoning passes 1, doesn't match 2 or 3, consumes a RATE_LIMIT token at 4, doesn't match 5 → forwards to upstream.

A `POST /v1/refunds` from external_mcp with valid reasoning passes 1-3, consumes a RATE_LIMIT token at 4, matches 5 → returns 202 with `pendingId`.

Test any combination via `/policies/simulate` before traffic arrives:

```bash
curl -X POST http://localhost:3000/policies/simulate \
  -H "Authorization: Bearer $KEY" -H "Content-Type: application/json" \
  -d '{
    "method": "POST", "path": "/v1/refunds", "source": "external_mcp",
    "tenantId": "tenant-42",
    "reasoning": "customer #321 requested rollback per CS-987"
  }' | jq
```

The response includes a `trace` showing each rule's outcome — the canonical way to debug "why did my rule fire (or not)".

## CRUD reference

| Method | Path | Purpose |
|---|---|---|
| `GET` | `/policies` | List all rules for the authenticated org, sorted by priority + createdAt |
| `POST` | `/policies` | Create a new rule (validated by `class-validator`) |
| `PATCH` | `/policies/:id` | Update — any field in CreatePolicyDto |
| `DELETE` | `/policies/:id` | Hard delete |
| `POST` | `/policies/simulate` | Dry-run; consumes RATE_LIMIT tokens deliberately so callers can't dry-run their way around limits |

All write operations invalidate the in-memory rule cache for the org (5s TTL otherwise). Cache invalidation is per-instance; multi-instance deployments see new rules within ≤5s on other instances.

## Open work (tracked in CHECKLIST.md §6)

- Move RATE_LIMIT bucket to Redis for global limits across replicas
- Add `EXTERNAL_ONLY` / `INTERNAL_ONLY` source filter as an explicit DTO field instead of an implicit per-rule-type rule
- Add policy versioning + audit who changed what
- Add `dryRunOnly` flag so a rule can be staged without affecting traffic
