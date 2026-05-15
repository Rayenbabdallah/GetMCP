# Testing Strategy

The product makes three claims that need to be true under load, multi-tenant, multi-instance:

1. **Tenant A cannot read or affect Tenant B.**
2. **Every action produces a tamper-evident audit row.**
3. **Policies enforce what the operator wrote, in deterministic order.**

This document maps each claim to the tests that prove it. If a test in this list breaks, a customer-facing claim breaks.

## Coverage gates

CI runs `pnpm --filter api run test:cov` and fails the build if any of these per-file thresholds regress (`apps/api/package.json#jest.coverageThreshold`):

| File | Statements | Branches | Functions | Lines | Why this floor |
|---|---|---|---|---|---|
| `audit/canonical.util.ts` | 95 | 80 | 100 | 95 | Hash function — any uncovered branch is a hash divergence risk |
| `audit/audit.service.ts` | 70 | 50 | 70 | 70 | Service has prisma side effects; branches need integration tests |
| `policy/policy.engine.ts` | 95 | 75 | 100 | 95 | Pure function — every rule type and decision path must be exercised |
| `policy/path-match.util.ts` | 85 | 80 | 100 | 100 | Single most-likely-to-have-bugs file; old String.includes regression must stay dead |
| `policy/rate-limiter.ts` | 90 | 85 | 50 | 90 | Token bucket math — exhaustion and refill paths both gated |
| `policy/reasoning.util.ts` | 100 | 100 | 100 | 100 | Tiny, pure — no excuse not to be 100% |
| `proxy/proxy.service.ts` | 90 | 80 | 80 | 90 | Header filter, error mapping, decision dispatch — all customer-visible |
| `auth/api-key.util.ts` | 90 | 75 | 100 | 90 | scrypt round-trip, prefix derivation, malformed-input rejection |
| `slack/slack.signature.ts` | 95 | 85 | 100 | 95 | HMAC verifier — branch coverage matters more than statement here |
| `crypto.util.ts` | 90 | 80 | 100 | 90 | AES-GCM auth tag check, key length validation |
| `generator/heuristic.ts` | 85 | 75 | 100 | 85 | Fallback classifier — keyword + verb cases all covered |
| `generator/spec-hash.util.ts` | 85 | 70 | 100 | 85 | Cache key — different spec must produce different hash |

**Controllers, modules, and `*.dto.ts` files are excluded from gates.** Controllers need integration tests (real DB, real HTTP) which are a separate effort — see "Open work" below. DTO classes are pure declarations with no logic.

## Test inventory by claim

### Claim 1: Tenant isolation

| Test | File | Asserts |
|---|---|---|
| `AuthGuard — tenant isolation` (5 cases) | `auth/auth.spec.ts` | Org B's API key prefix can collide with Org A's, but verifying the hash resolves to the correct org. Revoked keys excluded. Tampered key rejected. |
| `ClassifierService — per-org isolation` | `generator/classifier.service.spec.ts` | Classifications from Org A do not appear in Org B's cache lookup |
| `AgentService — cross-org` | `agents/agent.service.spec.ts` | Resolving Org B's agent id with Org A's scope returns null |
| `audit chain — per-org` | `audit/property.spec.ts` | Tampering Org A's chain leaves Org B's `verifyChain` valid |

### Claim 2: Tamper-evident audit

| Test | File | Asserts |
|---|---|---|
| `audit chain — 200 random inserts` | `audit/property.spec.ts` | Property: any sequence of valid inserts produces a verifiable chain |
| `audit chain — single random tamper detected (50 trials)` | `audit/property.spec.ts` | Property: any single-field mutation is detected at the victim seq |
| `audit chain — deletion → gap_in_seq` | `audit/property.spec.ts` | Removed row is detected with the correct reason code |
| `audit chain — forged row → prev_hash_mismatch` | `audit/property.spec.ts` | A row with valid self-hash but wrong link is detected |
| `canonicalJson` (5 cases) | `audit/audit.spec.ts` | Stable across key reorder, rejects NaN/Infinity/functions/symbols |
| `recordSafe never throws` | `audit/audit.spec.ts` | Audit-write failures are isolated from the response path |

### Claim 3: Policy correctness

| Test | File | Asserts |
|---|---|---|
| Single-rule cases per ruleType (10) | `policy/policy.engine.spec.ts` | Each rule type behaves per spec — block, allow, audit, rate_limit, mutation_approval |
| Cross-rule combinations (10) | `policy/policy.engine.combinations.spec.ts` | BLOCK beats MUTATION_APPROVAL by priority. ALLOWLIST short-circuits. AUDIT failure terminates before ALLOWLIST. RATE_LIMIT consumed THEN approval fires. RATE_LIMIT exhaustion blocks before approval. Source filter — internal_mcp skips MUTATION_APPROVAL/RATE_LIMIT but not BLOCK. Priority tiebreak by createdAt. bypassApproval skips multiple matching MUTATION_APPROVAL rules. |
| Path matcher — exact, params, wildcards, **regression guard against `/refunds-undo` matching `/refunds`** | `policy/path-match.util.spec.ts` | The old `String.includes` bug stays fixed |
| Rate limiter — token bucket math under fake timers | `policy/rate-limiter.spec.ts` | 5 allowed → 6th 429s with correct retryAfter; refill proportional to time |
| Reasoning validator — boilerplate rejection | `policy/reasoning.util.spec.ts` | "test", "placeholder", "debugging" rejected even at length |

## What's NOT tested by unit tests (and why)

### Integration: full request → policy → upstream → audit cycle
Needs a real Postgres + a fake upstream HTTP server stood up per-test. The cleanest path is `@testcontainers/postgresql` + an in-process express server. Adds ~30s to CI per run and a 200MB Docker pull.

**Mitigation today**: the unit tests exercise every component of the pipeline in isolation; a contract test on the Prisma calls would double the maintenance burden without catching new bugs.

**Open work**: add a `npm run test:integration` job to CI gated on `TEST_DATABASE_URL` env var. A handful of integration tests (tenant isolation through a real Prisma, audit chain integrity through real Serializable transactions, full proxy cycle against a fake upstream) would close this.

### Multi-instance behavior
Caches (rule, agent), the rate limiter, and the approval sweeper are all per-instance. The §6/§7 docs explicitly call this out as a per-instance design choice for v1. Verifying multi-instance behavior needs a Helm deploy + load tests + chaos (kill a pod mid-stream) — that's the §12 load test work, not unit tests.

### LLM classifier real-call accuracy
`classifier.service.spec.ts` exercises the JSON parse, markdown-fence stripping, score clamping, and heuristic fallback. It does not call Claude. Real classifier accuracy needs a curated benchmark spec set (Stripe / GitHub / Slack / Twilio / Plaid) with ground-truth labels and is best done as an offline eval, not a CI test.

### Slack callback round-trip
`slack.signature.spec.ts` exercises the HMAC verifier including timestamp window, tampered body, wrong secret, and constant-time-compare. The `SlackController` request handler is not unit-tested — it composes signature check + Prisma lookup + ApprovalService dispatch, all of which are individually tested. End-to-end coverage needs the integration suite.

## Running

```bash
# Full unit suite (default)
pnpm --filter api test

# With coverage report + threshold gates (CI-equivalent)
pnpm --filter api run test:cov

# Single file
pnpm --filter api exec jest src/audit/property.spec.ts

# Watch mode while iterating
pnpm --filter api run test:watch
```

## Adding a test that proves a new claim

1. Identify the claim — write it as a one-sentence assertion in plain English. If you can't, the feature isn't done.
2. Place the test in the file matching the claim:
   - Pure-function logic → next to the function (`canonical.util.spec.ts`, `path-match.util.spec.ts`, etc.)
   - Service behavior with mocks → service spec (`audit.service.spec.ts`, `agent.service.spec.ts`)
   - Cross-module interaction → a `*.combinations.spec.ts` or `*.property.spec.ts`
3. If the new code is on a critical correctness file, add or update its threshold in `package.json#jest.coverageThreshold`.
4. Update this document's claim table if the claim is customer-facing.
