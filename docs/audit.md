# Audit Ledger

Every call to `POST /proxy/execute` produces exactly one `AuditLog` row, regardless of outcome (executed, blocked by policy, awaiting approval, or terminated mid-stream). Rows form a **per-organization hash chain** so any later modification — to a single field, the row's existence, or the row order — is detectable.

## Row schema

| Field | Type | Notes |
|---|---|---|
| `id` | cuid | Surrogate key. Not part of the hash. |
| `organizationId` | string | Scopes the chain. |
| `seq` | int | Monotonic per organization, starting at 1. Unique with `organizationId`. |
| `timestamp` | datetime | UTC, set inside the insert transaction. |
| `method` | string | HTTP method of the agent's request. |
| `path` | string | Path the agent asked the proxy to forward. |
| `source` | enum | `internal_mcp` \| `external_mcp` \| `system`. |
| `tenantId` | string? | From the `x-tenant-id` header. |
| `agentId` | string? | FK to `AgentIdentity` (currently unused, reserved for §5). |
| `apiKeyId` | string? | The `ApiKey` that authenticated the call. |
| `reasoning` | string? | The `x-agent-reasoning` header value. |
| `reason` | string? | Policy rule description or upstream error message. |
| `actionTaken` | enum | `EXECUTED` \| `BLOCKED` \| `AWAITING_APPROVAL` \| `INCOMPLETE`. |
| `upstreamStatus` | int? | Upstream HTTP status. `null` for policy decisions and connection errors. |
| `requestBytes` | int | `Buffer.byteLength(JSON.stringify(body))` at controller entry. |
| `responseBytes` | int? | Bytes that flowed through the byte-counting transform. |
| `latencyMs` | float | Time from controller entry to response `finish`/`close`. |
| `prevHash` | string | Hash of the previous row in this org's chain. `"genesis"` for `seq = 1`. |
| `hash` | string | sha256 of `canonical(this row)` — see below. |

## Hash construction

The hash for a row is computed over a **canonical JSON serialization** of a fixed field set:

```
hash = sha256_hex(canonicalJson({
  organizationId, seq, timestamp,         // chain identity
  method, path, source, tenantId,         // request shape
  agentId, apiKeyId,                      // who
  reasoning, reason, actionTaken,         // why & what
  upstreamStatus,                         // result
  requestBytes, responseBytes, latencyMs, // size & cost
  prevHash                                // chain link
}))
```

`timestamp` is serialized as ISO 8601 UTC. Numeric fields use plain JSON numbers. `null` is `null` (not omitted). See `apps/api/src/audit/canonical.util.ts`.

Canonical JSON rules:

- Object keys are sorted lexicographically.
- No whitespace.
- Arrays preserve insertion order.
- `NaN`, `Infinity`, and `undefined` are rejected.

These rules make the hash reproducible across processes, languages, and serializer versions. The implementation is ~25 lines and intentionally not pulled from a library; auditors should be able to re-implement it from this document and recompute any row's hash from a database export.

## Atomicity

`AuditService.record` runs inside a serializable Postgres transaction:

1. Read `Organization.lastAuditHash` and `lastAuditSeq`.
2. Compute `seq = lastAuditSeq + 1`, `prevHash = lastAuditHash`, `timestamp = now()`.
3. Compute `hash` over the canonical payload.
4. `INSERT` the new row. The `(organizationId, seq)` unique constraint is the second line of defense if isolation breaks.
5. `UPDATE` the org's `lastAuditHash` and `lastAuditSeq`.

On a serialization conflict (Prisma `P2034`) or unique violation on `(organizationId, seq)` (`P2002`), the transaction is retried up to 5 times with backoff.

## Verification

`GET /audit/verify` walks the chain in `seq` order and returns one of:

- `{ valid: true, rowCount, lastHash }` — every row's `prevHash` matches the prior row's `hash`, every row's recomputed `hash` matches its stored `hash`, and `seq` is contiguous from 1.
- `{ valid: false, brokenAtSeq, reason: 'gap_in_seq' | 'prev_hash_mismatch' | 'hash_mismatch', expected, actual }` — the first failure encountered. The remainder of the chain is not checked because once a link is broken, downstream comparisons are uninterpretable.

A clean verification result is the property an auditor needs: it asserts that no row was modified, deleted, inserted, or reordered after the fact, given that the head hash itself was not also tampered with. To extend this guarantee, periodically anchor `(orgId, lastAuditSeq, lastAuditHash)` to an external append-only store (object lock, transparency log, customer's own infra) — see open items below.

## Listing & export

- `GET /audit?from=&to=&path=&agentId=&cursor=&limit=` — paginated reverse-chronological list (default 100, max 1000). `nextCursor` is the last row's id.
- `GET /audit/export` — newline-delimited JSON (NDJSON), streamed, in `seq` order. Suitable for piping into Splunk, Datadog, BigQuery, etc.

Both are scoped to the caller's organization by `AuthGuard`. Cross-tenant reads are not possible without a valid bearer token for the target org.

## Open issues

- Audit writes from the proxy hot path are fire-and-log on failure. A real outbox + recovery worker still needs to land — today, an ack'd response with a failed audit insert produces a missing seq, which `verify` will surface as `gap_in_seq`.
- No periodic external anchoring of the head hash yet.
- No retention/pruning policy implementation; pruning will need to either keep genesis-equivalent checkpoint rows or re-anchor the chain.
