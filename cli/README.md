# getmcp

Turn a big OpenAPI spec into a small, agent-ready MCP server, with the dangerous endpoints left out.

```bash
npx getmcp-cli https://petstore3.swagger.io/api/v3/openapi.json
```

No account, no database, no LLM call. It reads the spec, prints what it kept and what it left out, and writes a server
you can plug into Claude Code, Claude Desktop, Cursor, or any other MCP client.

## Why

Most OpenAPI-to-MCP converters emit one tool per endpoint. On a real API that means hundreds of tools: the agent's
context fills up, tool selection gets worse, and `DELETE /repos/{owner}/{repo}` is sitting right there.

`getmcp` makes three decisions for you:

1. **Classify.** Every operation is checked for reasons an agent should not have it: destructive or irreversible
   actions, money movement, admin and internal routes, credentials and secrets, webhooks, deprecated routes, binary
   uploads.
2. **Curate.** The safe ones are ranked and cut to 25, balanced across resources, with about a third able to write.
3. **Generate.** A runnable stdio MCP server, plus a `REPORT.md` listing every tool kept and every operation left out,
   with the reason.

| Spec | Operations | Left out | Kept | Tool definitions |
|---|---|---|---|---|
| GitHub REST | 1,280 | 376 | 25 | ~263k tokens → ~6k |
| Stripe | 612 | 168 | 25 | ~176k tokens → ~10k |
| Petstore | 19 | 5 | 14 | ~1.7k tokens → ~1.3k |

Token figures are estimates (characters ÷ 4).

## Use it

```bash
npx getmcp-cli <openapi-url-or-file>          # JSON or YAML, OpenAPI 3.x or Swagger 2
cd <api-name>-mcp && npm install
claude mcp add <api-name>-mcp --env API_KEY=YOUR_KEY -- node /absolute/path/to/server.mjs
```

The command prints the exact lines for your spec, including how `API_KEY` will be sent. It reads the spec's security
scheme, so a bearer token, a custom header such as `X-Api-Key`, a query parameter, and HTTP Basic all work from the one
variable.

For other clients, the generated `README.md` has the `mcpServers` JSON block.

## Options

```
--max <n>        How many tools to keep (default 25)
--only <a,b>     Only consider these resources, e.g. --only issues,pulls,search
--read-only      Keep GET operations only
--all            Keep every safe operation instead of curating
--allow <a,b>    Let a risky category back in:
                 destructive, money, admin, credentials, webhooks, deprecated, unsupported
--out <dir>      Where to write the server (default ./<api-name>-mcp)
--dry-run        Print the report, write nothing
--json           Print the report as JSON
--force          Write into a non-empty directory
```

Start with `--dry-run` to see the report, then steer with `--only` if the default pick is not what you want.

## The generated server

- `tools.json` holds the tool definitions. Rename tools, rewrite descriptions, or delete entries freely.
- Reads carry MCP's `readOnlyHint`, so clients can auto-approve them and still prompt on writes.
- Responses are capped (20,000 characters by default) so one call cannot flood the agent's context.

| Variable | What it does |
|---|---|
| `API_KEY` | Your credential, sent the way the spec says. Leave unset for public APIs. |
| `API_AUTH_HEADER` | Full `Authorization` header value, to override how the key is sent. |
| `API_HEADERS` | Extra headers as JSON. |
| `API_BASE_URL` | Override the base URL from the spec. |
| `GETMCP_READ_ONLY` | Set to `1` to hide and refuse every write tool. |
| `GETMCP_MAX_CHARS` | Cap on response text returned to the agent. |

## How tools are chosen

Ranking is deterministic and uses only the spec:

- **Hubs.** A path that many other paths hang off (`/repos/{owner}/{repo}`) is a core resource.
- **Mentions.** A resource the rest of the API keeps referring to ("issue", "customer") outranks one that only appears
  in its own corner.
- **Shape.** List, get, create and search beat one-off actions; shallow paths beat deep ones.
- **Balance.** Diminishing returns per resource, and a cap on search endpoints.

## Limits

- Ranking cannot know your use case. `--only` is the steering wheel.
- Classification is keyword-based and errs toward leaving things out. Check `REPORT.md`, then use `--allow`.
- Local `$ref`s only. JSON and form-encoded request bodies only. stdio transport only.
- OAuth flows are not handled: pass an access token as `API_KEY`.

## Develop

```bash
pnpm install --ignore-workspace   # or: npm install
node --test
```

Part of [GetMCP](https://github.com/Rayenbabdallah/GetMCP). Apache-2.0.
