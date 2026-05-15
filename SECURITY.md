# Security Policy

## Reporting a vulnerability

**Please do not file public GitHub issues for security reports.**

Email **rayenbenabdallah88@gmail.com** with:

- A description of the vulnerability and where you found it (commit hash, file, line)
- Reproduction steps and a minimal proof-of-concept
- Your name and PGP key if you'd like attribution

We will:

| Stage | SLA |
|---|---|
| Acknowledge receipt | Within 2 business days |
| Initial triage and severity assignment | Within 5 business days |
| Patch in progress / status update | Weekly until resolved |
| Coordinated disclosure | After patched release; mutually agreed timeline (default 90 days max) |

Critical issues affecting production deployments may be patched and released ahead of the public disclosure window. We will credit reporters in the release notes unless they prefer to remain anonymous.

## Supported versions

GetMCP is pre-1.0. Security fixes land on `main`; users self-hosting from a git tag should rebase or redeploy from `main` until a stable release line exists.

## Out of scope

- Findings against the dev `docker-compose.yml` (intended for local development only — production uses `docker-compose.prod.yml` or the Helm chart in `deploy/helm/getmcp/`)
- Issues requiring a compromised host, a stolen `KEY_ENCRYPTION_KEY`, or a compromised database (these are assumed in-scope of the customer's own threat model)
- Denial-of-service via unauthenticated traffic flooding (front the API with a rate limiter or WAF)

## Security architecture

See [`docs/security.md`](docs/security.md) for the full threat model, data-at-rest catalog, and TLS posture.
