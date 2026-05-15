# Quickstart — Zero to Proxied Request in 10 Minutes

This walks an engineer who has never seen GetMCP from `git clone` to a real, policy-enforced, audited proxy call. No theory — copy-paste each block.

## What you'll have at the end

- GetMCP running locally (Postgres + API + Web)
- Your own organization with an API key
- An agent identity registered
- An upstream API configured (we use httpbin as a fake; swap for Stripe sandbox / your API later)
- A policy rule that requires reasoning on every call
- One successful proxied request, captured in the tamper-evident audit log

## Prerequisites

- Docker & Docker Compose
- `bash` and `curl`
- (Optional) `jq` for prettier output

## 1. Clone and bootstrap (~2 min)

```bash
git clone https://github.com/Rayenbabdallah/GetMCP
cd GetMCP
./deploy/scripts/bootstrap.sh
```

The script generates `.env` with a fresh `POSTGRES_PASSWORD` and `KEY_ENCRYPTION_KEY`, brings up Postgres, runs migrations, starts the API and Web, and seeds a demo org.

When it finishes you'll see:

```
GetMCP is up:
  Dashboard: http://localhost:8080
  API:       http://localhost:3000
  Health:    http://localhost:3000/health/ready
  Metrics:   http://localhost:3000/metrics
```

The seed prints an API key (saved exactly once). Save it now:

```bash
KEY=gmcp_paste_your_key_here
INTERNAL_AGENT=clxxx_internal_id_from_seed_output
```

Sanity check:

```bash
curl http://localhost:3000/health/ready
# {"status":"ok","db":"up"}

curl -H "Authorization: Bearer $KEY" http://localhost:3000/orgs/me | jq
```

## 2. Configure an upstream API (~1 min)

The proxy needs to know where to forward authorized calls. We use `httpbin.org` here as a stand-in — it echoes back whatever you send, so it's perfect for verifying the pipeline.

```bash
curl -X PATCH http://localhost:3000/orgs/me \
  -H "Authorization: Bearer $KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "upstreamBaseUrl": "https://httpbin.org",
    "upstreamTimeoutMs": 10000
  }'
```

To use a real API later, also set `upstreamAuthHeader` (encrypted at rest):

```bash
curl -X PATCH http://localhost:3000/orgs/me \
  -H "Authorization: Bearer $KEY" -H "Content-Type: application/json" \
  -d '{"upstreamAuthHeader": "Bearer sk_test_your_real_token"}'
```

## 3. Make your first proxied call (~1 min)

```bash
curl -X POST http://localhost:3000/proxy/execute \
  -H "Authorization: Bearer $KEY" \
  -H "x-agent-id: $INTERNAL_AGENT" \
  -H "x-agent-source: internal_mcp" \
  -H "x-agent-reasoning: smoke test from quickstart guide step 3" \
  -H "Content-Type: application/json" \
  -d '{"method":"GET","path":"/get?hello=getmcp"}'
```

You should get a JSON response from httpbin echoing your call. **That's a real proxied request** — auth checked, agent identity verified, policy evaluated, forwarded upstream, response streamed back.

## 4. Verify the audit log (~1 min)

Every proxy call writes one row to a per-org sha256 hash chain:

```bash
curl -H "Authorization: Bearer $KEY" "http://localhost:3000/audit?limit=5" | jq
```

You should see your `/get?hello=getmcp` call with `actionTaken: "EXECUTED"`, `upstreamStatus: 200`, and a non-zero `responseBytes`.

Now verify the chain integrity:

```bash
curl -H "Authorization: Bearer $KEY" http://localhost:3000/audit/verify | jq
# {"valid": true, "rowCount": <N>, "lastHash": "..."}
```

If anyone tampered with a row, this would return `{"valid": false, "brokenAtSeq": <N>, "reason": "hash_mismatch", ...}`. Try it: edit a row directly in Postgres and re-run.

## 5. Add a policy that blocks (~2 min)

The seed already created an `AUDIT` rule that requires `x-agent-reasoning`. Let's add a `BLOCK` rule for a specific path:

```bash
curl -X POST http://localhost:3000/policies \
  -H "Authorization: Bearer $KEY" -H "Content-Type: application/json" \
  -d '{
    "name": "no deletes via proxy",
    "description": "DELETE on any path is forbidden",
    "ruleType": "BLOCK",
    "targetMethod": "DELETE",
    "targetPath": "*",
    "priority": 10
  }'
```

Try a DELETE — you should get a 403:

```bash
curl -X POST http://localhost:3000/proxy/execute \
  -H "Authorization: Bearer $KEY" \
  -H "x-agent-id: $INTERNAL_AGENT" \
  -H "x-agent-source: internal_mcp" \
  -H "x-agent-reasoning: should be blocked by policy" \
  -H "Content-Type: application/json" \
  -d '{"method":"DELETE","path":"/delete"}'
# {"allowed":false,"status":"BLOCKED","reason":"Policy Violation: DELETE on any path is forbidden"}
```

The audit row is written before the 403 returns — check it:

```bash
curl -H "Authorization: Bearer $KEY" "http://localhost:3000/audit?limit=2" | jq '.data[].actionTaken'
```

## 6. Try the dry-run (~30 sec)

`/policies/simulate` shows what every rule would do for a request shape, without forwarding upstream. Great for tuning rules without sending real traffic:

```bash
curl -X POST http://localhost:3000/policies/simulate \
  -H "Authorization: Bearer $KEY" -H "Content-Type: application/json" \
  -d '{
    "method": "DELETE",
    "path": "/delete",
    "source": "external_mcp",
    "tenantId": "tenant-42",
    "reasoning": "investigating customer-reported issue ABC-123"
  }' | jq
```

You'll see a `trace` array showing each rule's decision — that's the same evaluation order the proxy uses at runtime.

## 7. Generate MCP servers from an OpenAPI spec (~2 min)

The other half of GetMCP — auto-generate Internal + External MCP servers from any OpenAPI spec:

```bash
curl -X POST http://localhost:3000/generator/classify \
  -H "Authorization: Bearer $KEY" -H "Content-Type: application/json" \
  -d '{"openapiUrl":"https://petstore3.swagger.io/api/v3/openapi.json"}' | jq '.endpoints[0:3]'
```

You'll see each endpoint with a risk score (0-100 across data sensitivity, mutation impact, tenant scope, reversibility) and an `exposeExternally` verdict. Without `ANTHROPIC_API_KEY` set, this uses a keyword heuristic; with it, Claude classifies. Either way, the verdict is overridable per endpoint.

Generate the runnable scaffold:

```bash
curl -G "http://localhost:3000/generator/export" \
  -H "Authorization: Bearer $KEY" \
  --data-urlencode "openapiUrl=https://petstore3.swagger.io/api/v3/openapi.json" \
  -o getmcp-petstore.zip

unzip -d getmcp-petstore getmcp-petstore.zip
ls getmcp-petstore/
# external-mcp/  internal-mcp/  docker-compose.yml  README.md
```

`internal-mcp/` and `external-mcp/` are real Node MCP servers — pinned `@modelcontextprotocol/sdk`, `cd` and `npm install && UPSTREAM_BASE_URL=... npm start` runs them.

## What now?

- **Browse the API** at <http://localhost:3000/docs> (Swagger UI; click "Authorize" and paste your `gmcp_…` key).
- **Add Slack approval** — paste a Slack bot token + signing secret into `PATCH /orgs/me`, then create a `MUTATION_APPROVAL` rule. Slack callback at `/slack/interactions`. See [`docs/operations.md`](operations.md).
- **Wire to your real upstream** — replace `https://httpbin.org` with your Stripe / Salesforce / internal API base URL.
- **Deploy to k8s** — see the Helm chart at `deploy/helm/getmcp/`.
- **Read the threat model** before you go to production — [`docs/security.md`](security.md).

## Troubleshooting

| Symptom | Cause | Fix |
|---|---|---|
| `bootstrap.sh` exits "postgres did not become healthy" | Port 5433 in use, or a stale `getmcp_pgdata` volume from a previous attempt with a different password | `docker compose -f docker-compose.prod.yml down -v && rm .env && ./deploy/scripts/bootstrap.sh` |
| `401 Unknown agent id` | You used `x-agent-id` from a previous bootstrap | Re-run the seed output OR `curl -H "Authorization: Bearer $KEY" http://localhost:3000/agents` to find the current ids |
| `400 No upstream configured` | Step 2 was skipped or hit the wrong org | `curl -H "Authorization: Bearer $KEY" http://localhost:3000/orgs/me` to confirm |
| `502 Upstream unreachable` | Your `upstreamBaseUrl` is wrong, or the upstream is down | `curl -v <upstreamBaseUrl>/<path>` directly to confirm |
| `403 Policy Violation: ...x-agent-reasoning...` | The seeded AUDIT rule wants reasoning ≥ 10 chars and not a placeholder | Send a real `x-agent-reasoning` header; "test", "debugging", "n/a" are rejected |
