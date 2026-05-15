// Produces a runnable MCP server scaffold from an OpenAPI spec subset.
// Pinned @modelcontextprotocol/sdk version. Not boilerplate — index.js
// actually reads schema.json at startup, registers each path/method as a
// tool, and forwards calls to UPSTREAM_BASE_URL via fetch.

const SDK_VERSION = '1.0.4';

export interface ServerScaffold {
  name: string;
  files: Array<{ path: string; content: string }>;
}

export function buildServerScaffold(
  serverName: string,
  spec: any,
  isInternal: boolean,
): ServerScaffold {
  const files: ServerScaffold['files'] = [];

  files.push({
    path: 'schema.json',
    content: JSON.stringify(spec, null, 2),
  });

  files.push({
    path: 'package.json',
    content: JSON.stringify(
      {
        name: serverName,
        version: '1.0.0',
        type: 'module',
        main: 'index.js',
        scripts: { start: 'node index.js' },
        dependencies: {
          '@modelcontextprotocol/sdk': SDK_VERSION,
        },
        engines: { node: '>=20' },
      },
      null,
      2,
    ),
  });

  files.push({ path: 'index.js', content: indexJs(serverName, isInternal) });
  files.push({ path: 'README.md', content: readme(serverName, isInternal) });

  return { name: serverName, files };
}

function indexJs(serverName: string, isInternal: boolean): string {
  return `import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { CallToolRequestSchema, ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

// ${isInternal ? 'INTERNAL MCP — full privilege. Do NOT expose to third parties.' : 'EXTERNAL MCP — scoped subset, customer-safe.'}

const __dirname = dirname(fileURLToPath(import.meta.url));
const schema = JSON.parse(readFileSync(join(__dirname, "schema.json"), "utf8"));

const UPSTREAM = process.env.UPSTREAM_BASE_URL;
if (!UPSTREAM) {
  console.error("UPSTREAM_BASE_URL is required");
  process.exit(1);
}
const UPSTREAM_AUTH = process.env.UPSTREAM_AUTH_HEADER ?? null;

// One tool per (method, path). Tool names use underscores so they're MCP-safe.
const tools = [];
for (const [path, methods] of Object.entries(schema.paths ?? {})) {
  for (const [method, op] of Object.entries(methods)) {
    const name = toolName(method, path);
    tools.push({
      name,
      description: op?.summary || op?.description || \`\${method.toUpperCase()} \${path}\`,
      inputSchema: buildInputSchema(op),
      _route: { method: method.toLowerCase(), path },
    });
  }
}

function toolName(method, path) {
  return (method + "_" + path)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

function buildInputSchema(op) {
  const props = {};
  const required = [];
  for (const p of op?.parameters ?? []) {
    if (!p?.name) continue;
    props[p.name] = { type: "string", description: p.description ?? "" };
    if (p.required) required.push(p.name);
  }
  if (op?.requestBody) {
    props.body = { type: "object", description: "Request body (JSON)" };
    if (op.requestBody.required) required.push("body");
  }
  return { type: "object", properties: props, required };
}

function fillPath(template, args) {
  return template.replace(/\\{([A-Za-z_][A-Za-z0-9_]*)\\}/g, (_, k) => encodeURIComponent(args[k] ?? ""));
}

const server = new Server(
  { name: "${serverName}", version: "1.0.0" },
  { capabilities: { tools: {} } },
);

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: tools.map(({ _route, ...t }) => t),
}));

server.setRequestHandler(CallToolRequestSchema, async (req) => {
  const tool = tools.find((t) => t.name === req.params.name);
  if (!tool) throw new Error(\`unknown tool: \${req.params.name}\`);

  const args = req.params.arguments ?? {};
  const url = new URL(fillPath(tool._route.path, args), UPSTREAM);

  // Query params: anything not in path or body becomes ?name=
  const pathParams = new Set([...tool._route.path.matchAll(/\\{([A-Za-z_][A-Za-z0-9_]*)\\}/g)].map((m) => m[1]));
  for (const [k, v] of Object.entries(args)) {
    if (k === "body" || pathParams.has(k)) continue;
    if (v !== undefined && v !== null) url.searchParams.set(k, String(v));
  }

  const headers = { "Content-Type": "application/json" };
  if (UPSTREAM_AUTH) headers["Authorization"] = UPSTREAM_AUTH;

  const res = await fetch(url, {
    method: tool._route.method.toUpperCase(),
    headers,
    body: args.body ? JSON.stringify(args.body) : undefined,
  });
  const text = await res.text();
  return {
    content: [{ type: "text", text: \`HTTP \${res.status}\\n\${text}\` }],
    isError: !res.ok,
  };
});

const transport = new StdioServerTransport();
await server.connect(transport);
console.error("${serverName} ready (\${tools.length} tools)");
`;
}

function readme(serverName: string, isInternal: boolean): string {
  const warn = isInternal
    ? '\n> ⚠️ INTERNAL server — full privilege. Do NOT expose to third parties or untrusted agents.\n'
    : '';
  return `# ${serverName}
${warn}
Auto-generated by GetMCP. Forwards MCP tool calls to your upstream HTTP API.

## Run

\`\`\`bash
npm install
UPSTREAM_BASE_URL=https://api.example.com \\
UPSTREAM_AUTH_HEADER="Bearer sk_test_..." \\
npm start
\`\`\`

## Wire up an MCP client

In Claude Desktop's \`claude_desktop_config.json\` (or any MCP-aware client):

\`\`\`json
{
  "mcpServers": {
    "${serverName}": {
      "command": "node",
      "args": ["${serverName}/index.js"],
      "env": {
        "UPSTREAM_BASE_URL": "https://api.example.com",
        "UPSTREAM_AUTH_HEADER": "Bearer sk_test_..."
      }
    }
  }
}
\`\`\`

Tools are derived from \`schema.json\` (OpenAPI subset). Each (method, path) becomes one tool — the description is taken from the operation summary.

## Routing through GetMCP

For policy enforcement and audit, point \`UPSTREAM_BASE_URL\` at your GetMCP proxy and have GetMCP forward to the real upstream. Use \`UPSTREAM_AUTH_HEADER\` to pass your GetMCP API key.
`;
}
