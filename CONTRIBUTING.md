# Contributing to GetMCP

Thanks for considering a contribution. GetMCP is **Apache 2.0** and contributions are accepted under the same license, no CLA required (we use the [Developer Certificate of Origin](https://developercertificate.org/) — sign your commits with `git commit -s`).

## TL;DR

```bash
git clone https://github.com/Rayenbabdallah/GetMCP
cd GetMCP
./deploy/scripts/bootstrap.sh   # spins up Postgres + API + Web + seeds a demo org
pnpm --filter api test          # all 128 tests should pass
```

If a test breaks, the build breaks. CI gates merges on lint, typecheck, tests, per-file coverage thresholds, `pnpm audit --audit-level=high`, and CodeQL.

## Where things live

| Path | What |
|---|---|
| `apps/api` | NestJS API — proxy, policy engine, audit ledger, generator |
| `apps/web` | React dashboard + landing + docs |
| `apps/api/prisma` | Schema + committed migrations |
| `deploy/helm/getmcp` | Production Helm chart |
| `deploy/scripts` | Bootstrap, backup, restore |
| `docs/` | Operator + auditor documentation |

## Local development

```bash
pnpm install
pnpm dev              # API + web concurrently
pnpm --filter api run test:cov   # tests + coverage gates (CI-equivalent)
pnpm --filter web run dev        # dashboard at http://localhost:5173
pnpm typecheck        # whole monorepo
pnpm lint
```

The API needs a running Postgres. Either run `bootstrap.sh` once and reuse its `getmcp_db` container, or set a `DATABASE_URL` to your own.

## What kind of contributions are welcome

- **Bug fixes with a regression test** — every bug fix should add a test that fails on `main` and passes after the change.
- **Performance improvements** with measurements (`deploy/load/k6-baseline.js` is the standard rig).
- **Generator heuristic improvements** — false-positive / false-negative cases against real OpenAPI specs.
- **Documentation fixes** — typo or clarity PRs are merged fast.
- **New rule types** — discuss in an issue first; the policy engine is the most-tested surface and changes need to preserve determinism.
- **Multi-instance Redis backends** for the rate limiter and the agent / policy caches — currently in-memory per pod.

## What needs an issue first

- New endpoints or breaking schema changes
- New dependencies (we keep the dep tree small)
- Anything that touches the audit chain or the hash construction
- Anything in `apps/api/src/auth/` (tenant isolation regressions are catastrophic)

Open a [GitHub Discussion](https://github.com/Rayenbabdallah/GetMCP/discussions) before writing the code. Saves both of us time.

## Coding conventions

- TypeScript everywhere. Strict mode. No `any` without a comment explaining why.
- DTOs use `class-validator` decorators (see `apps/api/src/orgs/org.dto.ts` for the canonical pattern). Bare TypeScript interfaces don't validate at runtime.
- Service methods are unit-tested directly with in-memory Prisma fakes (see `apps/api/src/agents/agent.service.spec.ts` for the pattern). Controllers are not unit-tested in isolation — they're covered by integration tests.
- Per-file coverage gates live in `apps/api/package.json` under `jest.coverageThreshold`. If you add a critical-correctness file, add a threshold for it.
- React: function components only, named exports, Tailwind classes, no inline styles unless dynamic.

## PR checklist

Before opening:

- [ ] `pnpm --filter api run test:cov` passes locally
- [ ] `pnpm typecheck` and `pnpm lint` pass
- [ ] The PR description explains **why**, not just what
- [ ] If you changed schema: a new migration is committed under `apps/api/prisma/migrations/`
- [ ] If you changed user-facing behavior: the relevant `docs/*.md` is updated
- [ ] If you added a CLI flag, env var, or DB field: it's in the README or `docs/operations.md`
- [ ] Commits are signed off (`git commit -s`)

## Reporting security issues

**Do not file public issues for security reports.** See [SECURITY.md](SECURITY.md) for the disclosure process and SLA.

## License

By contributing, you agree your contributions are licensed under the [Apache License 2.0](LICENSE).
