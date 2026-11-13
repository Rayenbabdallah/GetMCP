# getmcp (prototype)

Turn a big OpenAPI spec into a small, agent-ready MCP server — with the dangerous endpoints left out.

```bash
node bin/getmcp.mjs https://petstore3.swagger.io/api/v3/openapi.json
```

This is a **prototype to test whether developers want this**. It is not published to npm and sits outside the pnpm
workspace on purpose (install with `pnpm install --ignore-workspace` or `npm install` in this folder).

## What it does

Most OpenAPI-to-MCP converters emit one tool per endpoint. On a real API that is hundreds of tools: the agent's context
fills up, tool selection gets worse, and `DELETE /repos/{owner}/{repo}` is sitting right there. `getmcp` makes three
decisions for you, offline and deterministically (no LLM, no account, no database):

1. **Classify.** Every operation is checked for reasons an agent should not have it: destructive or irreversible
   actions, money movement, admin/internal routes, credentials and secrets, webhooks, deprecated routes, binary uploads.
2. **Curate.** The safe ones are ranked by the shape of the API (core "hub" resources, shallow paths, list/get/create/
   search) and cut to 25, balanced across resources, with roughly a third able to write.
3. **Generate.** A runnable stdio MCP server: `tools.json` (edit it freely), `server.mjs`, and a `REPORT.md` listing
   every tool kept and every operation left out, with the reason.

Measured on public specs (token figures are estimates, characters ÷ 4):

| Spec | Operations | Left out | Kept | Tool-definition tokens |
|---|---|---|---|---|
| GitHub REST | 1,280 | 376 | 25 | ~263k → ~8k |
| Stripe | 612 | 168 | 25 | ~176k → ~11k |
| Petstore | 19 | 5 | 14 | ~1.7k → ~1.3k |

## Options

```
--max <n>        How many tools to keep (default 25)
--only <a,b>     Only consider these resources, e.g. --only issues,pulls,search
--read-only      Keep GET operations only
--all            Keep every safe operation instead of curating
--allow <a,b>    Let a risky category back in: destructive, money, admin, credentials, webhooks, deprecated, unsupported
--out <dir>      Where to write the server (default ./<api-name>-mcp)
--dry-run        Print the report, write nothing
--json           Print the report as JSON
```

The generated server also honours `GETMCP_READ_ONLY=1` at runtime, and marks every read with MCP's `readOnlyHint` so
clients can auto-approve reads and still prompt on writes.

## Known limits

- Curation uses API structure only. It finds the core resources well, but it cannot know that your users care about
  `commits` more than `codespaces`. `--only` is the steering wheel; LLM-assisted ranking is the obvious next step.
- Classification is keyword-based and errs toward leaving things out. Check `REPORT.md`, then use `--allow`.
- Local `$ref`s only. JSON and form-encoded bodies only. Auth is a single `Authorization` header value.
- stdio transport only.

## Tests

```bash
node --test
```
