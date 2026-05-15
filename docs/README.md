# GetMCP Documentation

Customer-facing docs. Operator runbooks, reference, and threat model. The repo's top-level `README.md` is the marketing summary; this directory is the actual operator/auditor material.

## Read in this order

1. **[`quickstart.md`](quickstart.md)** — Zero to first proxied request in 10 minutes. Start here.
2. **[`policies.md`](policies.md)** — Reference for all five rule types with worked examples.
3. **[`audit.md`](audit.md)** — Hash-chained ledger schema, hash construction, verification, NDJSON export.
4. **[`security.md`](security.md)** — Threat model, data-at-rest catalog, TLS posture. Read before deploying to production.
5. **[`operations.md`](operations.md)** — Self-host runbook (Compose + Helm), backups, rolling secrets, common incidents.
6. **[`performance.md`](performance.md)** — SLA targets, hot-path architecture, tuning knobs, scaling characteristics.
7. **[`testing.md`](testing.md)** — Test strategy, claim → test mapping, coverage gates.

## Live API documentation

When the API is running with `NODE_ENV=development` (default) or `ENABLE_DOCS=true`:

- **Swagger UI** — <http://localhost:3000/docs> (paste your `gmcp_…` key into "Authorize")
- **OpenAPI JSON** — <http://localhost:3000/docs-json> (import into Postman, Insomnia, or any OpenAPI-aware client)

In production, set `ENABLE_DOCS=true` only if you want the docs publicly reachable. Gate at the ingress (auth header, IP allowlist, separate hostname) — the docs route is unauthenticated by design so the Swagger UI loads.

## External

- **Repository**: <https://github.com/Rayenbabdallah/GetMCP>
- **Vulnerability disclosure**: see [`../SECURITY.md`](../SECURITY.md) (rayenbenabdallah88@gmail.com)
- **Changelog**: [`../CHANGELOG.md`](../CHANGELOG.md)
- **Roadmap**: [GitHub Issues](https://github.com/Rayenbabdallah/GetMCP/issues) and [Discussions](https://github.com/Rayenbabdallah/GetMCP/discussions)
