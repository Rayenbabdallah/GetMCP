<!--
Thanks for the PR! A few asks before you submit:
  • Read CONTRIBUTING.md if you haven't.
  • Sign off your commits: git commit -s
  • If this is a security report, do NOT use a public PR. See SECURITY.md.
-->

## What this PR does

<!-- One-paragraph summary. Focus on WHY, not just WHAT. -->

## How it was tested

<!-- Which tests run? Did you add new ones? `pnpm --filter api run test:cov` results, etc. -->

## Checklist

- [ ] `pnpm --filter api run test:cov` passes locally (no coverage regressions)
- [ ] `pnpm typecheck` and `pnpm lint` pass
- [ ] Schema change → new migration committed under `apps/api/prisma/migrations/`
- [ ] User-facing change → relevant `docs/*.md` updated
- [ ] New env var, CLI flag, or DB field → README / `docs/operations.md` updated
- [ ] Commits are signed off (`git commit -s`)

## Linked issues

Closes #
