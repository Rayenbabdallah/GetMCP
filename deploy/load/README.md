# Load testing

Two tools, three scripts.

## Prerequisites

```bash
# k6 — primary load tool
brew install k6                # macOS
choco install k6               # Windows
# autocannon comes via npx, no install

# A running GetMCP instance + a valid API key + agent id
KEY=gmcp_...
AGENT=clxxxxxxxxxxxxxxxxxx
BASE=https://getmcp.your-domain.example
```

## Scripts

| Script | What it measures | When to run |
|---|---|---|
| `k6-baseline.js` | All three hot paths in parallel — `/health/live`, `/policies/simulate`, `/proxy/execute`. Asserts the SLA thresholds from `CHECKLIST.md` §12. | Before tagging a release. CI nightly against staging. |
| `k6-policy-eval.js` | Pure-CPU path — auth → cached rules → engine evaluate. Ramping arrival rate up to 1500 RPS to find saturation. | Comparing two builds. Tuning the engine. |
| `autocannon.sh` | 30s/50-conn smoke against `/policies/simulate`. ~2-line summary. | "Did my change just regress something obvious?" |

## Run

```bash
# Baseline (all scenarios, 60s, asserts thresholds)
k6 run -e BASE_URL=$BASE -e API_KEY=$KEY -e AGENT_ID=$AGENT k6-baseline.js

# Policy engine ramp to find the per-instance ceiling
k6 run -e BASE_URL=$BASE -e API_KEY=$KEY k6-policy-eval.js

# Autocannon quick check
BASE_URL=$BASE API_KEY=$KEY ./autocannon.sh
```

## SLA targets (from CHECKLIST §12)

- **`policy_simulate` p95 < 25ms, p99 < 80ms** — added latency over what the engine + audit write should cost. With cached rules (5s TTL) this is essentially CPU + a fire-and-forget DB insert.
- **`proxy_execute` p95 < 50ms, p99 < 150ms** — adds the upstream RTT. Test against a fake upstream (or a Stripe sandbox you trust to be fast) so you isolate GetMCP overhead from upstream variance.
- **1000 RPS per API instance** at 1 vCPU / 512MB. Past that, scale horizontally.
- **`http_req_failed` < 1%** across the run.

A failed threshold makes k6 exit non-zero — wire that into CI as a release gate.

## Troubleshooting

- **p95 climbs after ~30s of load** → check `getmcp_audit_writes_total{result="failed"}`; the audit write may be saturating Postgres connections. Increase `?connection_limit=` in `DATABASE_URL` (default is `num_cpu * 2 + 1`).
- **Spiky tail latencies** → check Node's event loop lag in `/metrics` (`getmcp_nodejs_eventloop_lag_seconds`). Spikes often mean a synchronous workload sneaking in (canonical JSON over a huge audit row, scrypt verify under burst auth).
- **Sudden 401 storm under load** → `AuthGuard.findMany` for the API key prefix is uncached. If you have many keys per prefix collision, this is a hot spot — turn it into a small LRU.
- **Rate-limit policy fires unexpectedly** → the bucket is in-memory per process. With multiple replicas you have N×limit total budget; set per-instance limits accordingly or move the limiter to Redis (open in CHECKLIST §12 / §6).

See `docs/performance.md` for the full scaling characteristics.
