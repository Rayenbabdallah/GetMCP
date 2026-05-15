# Operations Runbook

## First-time deploy (Docker Compose)

```bash
git clone https://github.com/Rayenbabdallah/GetMCP
cd GetMCP
./deploy/scripts/bootstrap.sh
```

The bootstrap script generates `.env` with a fresh `POSTGRES_PASSWORD` and `KEY_ENCRYPTION_KEY`, brings up Postgres, runs `prisma migrate deploy`, brings up API + Web, and runs the seed. Re-running is safe — it only generates secrets the first time and only seeds if no organization exists yet.

After the script completes, the seed prints an API key for the demo org. **Save it** — it's shown only once. Then:

```bash
KEY=<gmcp_...>
curl -H "Authorization: Bearer $KEY" http://localhost:3000/orgs/me
```

## Kubernetes (Helm)

```bash
# 1. Create the prerequisite secrets out-of-band (or via a SealedSecret / ESO).
kubectl create namespace getmcp
kubectl -n getmcp create secret generic getmcp-db \
  --from-literal=DATABASE_URL='postgresql://user:pass@host:5432/getmcp?sslmode=require'
kubectl -n getmcp create secret generic getmcp-encryption-key \
  --from-literal=KEY_ENCRYPTION_KEY="$(openssl rand -hex 32)"

# 2. (Optional) Anthropic key for the LLM classifier.
kubectl -n getmcp create secret generic getmcp-anthropic \
  --from-literal=ANTHROPIC_API_KEY=sk-ant-...

# 3. Install the chart. Migrations run automatically as a pre-install Helm hook.
helm install getmcp deploy/helm/getmcp \
  --namespace getmcp \
  --set image.tag=0.1.0 \
  --set ingress.host=getmcp.your-domain.example \
  --set anthropic.existingSecret=getmcp-anthropic
```

The chart deliberately does **not** ship a Postgres subchart. Bring your own — Marketplace Neon, AWS RDS, Cloud SQL, or a HA Postgres operator. The chart only consumes the `DATABASE_URL` from the secret you supply.

### Upgrades

```bash
helm upgrade getmcp deploy/helm/getmcp -n getmcp --set image.tag=0.2.0
```

A new pre-upgrade migration job runs first; if it fails the upgrade aborts and the old pods keep serving. Rolling deploy on the API uses `maxSurge: 1, maxUnavailable: 0` — no request loss during normal upgrades.

### Graceful shutdown

`enableShutdownHooks()` in the API drains in-flight requests, closes the Prisma pool, and stops the approval sweeper before exiting. `terminationGracePeriodSeconds: 30` in the deployment gives that ~30 seconds. If long-running streamed proxy responses are routine, raise this value.

## Backups

```bash
# Manual one-off
./deploy/scripts/backup-db.sh

# Cron (every 6h, retain 14 days)
0 */6 * * * /opt/getmcp/deploy/scripts/backup-db.sh >> /var/log/getmcp-backup.log 2>&1
```

`pg_dump -F c -Z 9` produces a compressed custom-format archive. Sanity check on file size + magic number happens inline. Older dumps past `RETAIN_DAYS` (default 14) are pruned.

For Helm/k8s deployments, run the same script as a `CronJob` against your managed Postgres, or rely on your provider's snapshot policy.

### Restore

```bash
./deploy/scripts/restore-db.sh /var/backups/getmcp/getmcp-20260515T120000Z.dump
```

**This drops the schema and reloads from the dump.** Asks for confirmation; bypass with `FORCE=1` from non-interactive contexts.

After restore, **re-run the audit chain verification** for every active organization:

```bash
KEY=<org-api-key>
curl -H "Authorization: Bearer $KEY" http://localhost:3000/audit/verify
```

The hash chain must report `valid: true`. If a row was lost in the restore, you'll see `gap_in_seq` — investigate the source dump before continuing to serve traffic.

## Rolling secrets

| Secret | What changes | Restart needed |
|---|---|---|
| `POSTGRES_PASSWORD` | Update DB user password + `DATABASE_URL` | API pods |
| `KEY_ENCRYPTION_KEY` | **Hard rotation** — all existing encrypted secrets (Slack tokens, upstream auth headers) become unreadable. Re-encrypt with the new key by re-PATCHing `/orgs/me`. | API pods after re-PATCH |
| Slack secrets per org | `PATCH /orgs/me` with new values | None (cache TTL ≤ 5s) |
| Per-org API keys | `POST /api-keys` mints new, `DELETE /api-keys/:id` revokes old | None (cache TTL ≤ 5s) |

Plan `KEY_ENCRYPTION_KEY` rotation carefully — there is no online re-encryption job yet.

## Health & monitoring

| Endpoint | Use |
|---|---|
| `GET /health/live` | Process up. Liveness probe target. Always 200 when the process can serve HTTP. |
| `GET /health/ready` | Process up AND DB reachable. Readiness probe target. Returns `{status:"degraded",db:"down"}` with HTTP 200 when DB is unreachable — readiness is encoded in the body, not the status code. Adjust your probe spec accordingly if you want the LB to drop the pod. |
| `GET /metrics` | Prometheus scrape. See `README.md` §Operability for the metric names. |
| `pino` JSON logs on stdout | Each line carries `req.id`, `organizationId`, `apiKeyId`, response status, latency. |

The two metrics worth alerting on first:

- `rate(getmcp_audit_writes_total{result="failed"}[5m]) > 0` — page on any audit-write failure. A failed audit means a `gap_in_seq` next time the chain is verified.
- `histogram_quantile(0.95, rate(getmcp_proxy_request_duration_ms_bucket[5m])) > 500` — proxy p95 over 500ms; investigate slow upstreams or DB contention.

## Common incidents

| Symptom | Likely cause | First step |
|---|---|---|
| `Unknown agent id` 401s spike | Agent revoked but client still using the id | `GET /agents` to confirm `revokedAt` set |
| `429` storm | Rate-limit policy too strict, or single tenant burst | `GET /policies` → check `actionConfig`; `GET /audit?path=...` for the offender |
| `502 Bad Gateway` on `/proxy/execute` | Upstream API down or wrong `upstreamBaseUrl` | `curl` the upstream directly; check `GET /orgs/me` |
| `504` after 30s | Upstream slow; default timeout | Raise `upstreamTimeoutMs` via `PATCH /orgs/me` |
| `audit/verify` returns `gap_in_seq` | Audit write failed earlier (check `getmcp_audit_writes_total{result="failed"}`) or restore dropped a row | Investigate the missing seq. Cannot retroactively patch the chain — record the incident in your audit-of-the-audit-log. |
| Slack approval times out | TTL hit (15min default), or Slack callback URL unreachable | `GET /approvals/:id` to confirm status; verify Slack app interactivity URL |
