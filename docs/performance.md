# Performance & Scaling

## SLA targets (CHECKLIST §12)

| Path | p95 added | p99 added | Per-instance RPS | Notes |
|---|---|---|---|---|
| `POST /policies/simulate` | < 25ms | < 80ms | ≥ 1000 | All-CPU. Cache hit on rules. Audit write fire-and-forget. |
| `POST /proxy/execute` | < 50ms | < 150ms | ≥ 1000 | Adds upstream RTT — measure against a fast/fake upstream to isolate GetMCP overhead. |
| `GET /health/live` | < 10ms | < 25ms | ≥ 5000 | Process up only, no DB call. |
| `GET /audit?limit=100` | < 100ms | < 300ms | ≥ 200 | One indexed Postgres scan per call. |

"Added latency" = total minus upstream. Verify with the load scripts in `deploy/load/`.

## Hot-path architecture

```
POST /proxy/execute
   │
   ├─ AuthGuard          ── ~1ms  (scrypt verify on a small candidate set)
   ├─ AgentService.resolve ─ <1ms  (5s in-memory cache, hit ratio ~99%)
   ├─ PolicyService.evaluate
   │     ├─ getActiveRules ─ <1ms  (5s in-memory cache, hit ratio ~99%)
   │     └─ engine.evaluate ─ <1ms (pure function, ~5 rules typical)
   ├─ ProxyService.forwardUpstream ─ N ms (upstream RTT)
   ├─ stream pipe → res
   └─ AuditService.recordSafe ─ async, off the response path
```

Two design choices that matter for perf:

1. **Caches are aggressively short**: 5s TTL on rules + agents. Long enough to absorb burst (one DB lookup per second, per org-instance combo), short enough that revocations propagate within the SLA in §5/§6.
2. **Audit writes never block the response**. `recordSafe()` returns immediately; the serializable transaction runs in the background. A failed audit increments `getmcp_audit_writes_total{result="failed"}` — alert on this; do not slow the hot path to wait for it.

## Measured baselines

> **TODO**: baseline numbers from real runs. Until the first paid pilot, we publish the targets only — measured numbers without context (instance size, network topology, upstream characteristics) mislead. Run `deploy/load/k6-baseline.js` against your own staging and record the result here per release.

## Tuning knobs

### Prisma connection pool

Default: `num_physical_cpus * 2 + 1` (per process). In a Kubernetes pod with `cpu: 1`, that's **3 connections** — too low for sustained 1000 RPS.

Set explicitly via the `DATABASE_URL`:

```
DATABASE_URL="postgresql://user:pass@host:5432/getmcp_platform?schema=public&connection_limit=20&pool_timeout=10"
```

Rule of thumb: `connection_limit ≈ 2 × expected concurrent in-flight DB queries per pod`. Audit writes + occasional `findMany`s mean ~10 in-flight at p95 for 1000 RPS — set `connection_limit=20` and watch `getmcp_proxy_request_duration_ms_bucket` p95 under load.

**Total cluster connections** = `connection_limit × replica_count`. Stay well under your Postgres `max_connections` (default 100 on managed Postgres). For more replicas, put PgBouncer or RDS Proxy in front.

### Body parser limits

`JSON_BODY_LIMIT=1mb` (default). Larger bodies inflate p99 and increase audit `requestBytes`. Raise only if a real customer needs it.

### Rate limiter scope

The in-app `RATE_LIMIT` policy is **per-instance** in v1. With N replicas, the global limit is `N × actionConfig.limit`. Size accordingly, or move the limiter to Redis (open in CHECKLIST §6).

### Compression

`compression` middleware is enabled for JSON responses but **explicitly skipped** for `/proxy/execute` (would buffer the streamed upstream response and inflate p95 on large bodies) and `/audit/export` (already streams NDJSON). Audit list and policies see ~70% size reduction on typical payloads.

### Logging

Pino is async and fast (~5x faster than the default Nest logger). At `LOG_LEVEL=debug` expect ~10% throughput drop. In production, leave it at `info`.

### Node settings

Defaults are fine. For very large pods (`cpu: 4+`), set `UV_THREADPOOL_SIZE=8` so scrypt + crypto ops don't queue. Below 4 vCPU, the default 4-thread pool is correct.

## Horizontal scaling

The API is stateless EXCEPT for two in-memory caches (rules + agents) and the in-memory rate limiter:

| Component | Multi-instance behavior | Mitigation |
|---|---|---|
| Rules cache | Each instance hits the DB once per 5s per org | Acceptable. DB load scales with `replicas × org_count / 5s`. |
| Agents cache | Same — once per 5s per `(org, agent)` pair | Acceptable. |
| Rate limiter | Per-instance; global cap = `N × limit` | Set per-instance limits accordingly, OR move to Redis. |
| Approval sweeper | Each instance sweeps; idempotent `updateMany WHERE status='PENDING'` makes double-sweep a no-op | None needed. |

The Helm chart sets `RollingUpdate maxSurge:1, maxUnavailable:0` and `terminationGracePeriodSeconds: 30` — `enableShutdownHooks` drains in-flight requests before exit, so deploys are zero-loss for non-streamed responses. Long-running streamed proxy responses past 30s are killed; raise the grace period if your customers do long upstreams.

## Bottleneck shopping list

If `k6-baseline.js` misses an SLA, investigate in this order (rough impact, descending):

1. **Postgres connections** — check `pg_stat_activity` count vs `max_connections`. If pegged, raise `connection_limit` per pod or add PgBouncer.
2. **Audit write backlog** — check `getmcp_audit_writes_total{result="failed"}`. Spike means the chain transaction is timing out under serializable conflict; consider switching to `READ COMMITTED` and relying on the `(orgId, seq)` unique constraint for safety (open work — currently we use Serializable + retry).
3. **Cache miss rate on rules/agents** — log the `findMany` calls; if hit ratio < 95%, the TTL may need to be longer for your workload (tradeoff against revocation latency).
4. **Scrypt under burst** — every request runs scrypt verify. With many distinct API keys per prefix, the candidate set grows. At ≥ 2000 unique keys per org, add an LRU around the verified key.
5. **JSON serialization on huge audit rows** — `canonicalJson` is O(n log n) on field count. Our hashable payload is fixed-size so this isn't a concern in practice; mention here for completeness.
6. **Event loop lag** — `getmcp_nodejs_eventloop_lag_seconds`. Spikes always indicate something synchronous took too long. Capture the stack with `--trace-sync-io`.

## What we do NOT optimize (yet)

- **Cold start** — Node + Prisma client + Nest bootstrap is ~1s. Fine for k8s deploy, bad for serverless. We don't target serverless.
- **Memory per concurrent connection** — node's HTTP server is fine until ~10k concurrent connections. We don't currently support that scale; if you need it, run more replicas.
- **TCP keepalive to upstream** — axios uses keepalive by default per host but we recreate the request config each call. At very high RPS to a single upstream, switch to a shared `http.Agent` with `keepAlive: true` and `maxSockets`.
