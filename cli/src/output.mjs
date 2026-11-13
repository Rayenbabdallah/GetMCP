// Everything the user sees: the terminal report, and the files written to disk.

import { mkdir, readdir, writeFile, copyFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { CATEGORIES } from './analyze.mjs';
import { clip } from './spec.mjs';

const SDK_VERSION = '^1.32.2';

const useColor = process.stdout.isTTY && !process.env.NO_COLOR;
const paint = (code) => (s) => (useColor ? `\x1b[${code}m${s}\x1b[0m` : String(s));
const bold = paint('1');
const dim = paint('2');
const green = paint('32');
const yellow = paint('33');
const red = paint('31');

const n = (x) => x.toLocaleString('en-US');
const kTokens = (t) => (t >= 1000 ? `${(t / 1000).toFixed(t >= 10_000 ? 0 : 1)}k` : String(t));

export function printReport(r, { readOnly }) {
  const out = [];
  const saved = r.tokens.all ? Math.round((1 - r.tokens.selected / r.tokens.all) * 100) : 0;

  out.push('');
  out.push(`${bold(r.title)} ${dim(r.version)}`);
  out.push(`  ${bold(n(r.counts.operations))} operations in the spec ${dim(`≈ ${kTokens(r.tokens.all)} tokens of tool definitions if you exposed them all`)}`);
  out.push('');

  if (r.counts.excluded) {
    out.push(`  ${red('Left out')} ${dim('— not something to hand an agent')}`);
    const rows = Object.entries(r.byCategory).sort((a, b) => b[1].length - a[1].length);
    for (const [category, items] of rows) {
      const example = items[0];
      out.push(`    ${String(items.length).padStart(5)}  ${CATEGORIES[category].padEnd(40)} ${dim(clip(`${example.method} ${example.path}`, 46))}`);
    }
    out.push('');
  }

  out.push(
    `  ${green('Safe candidates')}  ${n(r.counts.candidates)} ${dim(`(${n(r.counts.candidateReads)} read, ${n(r.counts.candidateWrites)} write)`)}` +
      (r.counts.eligible !== r.counts.candidates ? dim(`, ${n(r.counts.eligible)} after your filters`) : ''),
  );
  out.push(
    `  ${green('Curated to')}       ${bold(r.counts.selected)} tools ${dim(`≈ ${kTokens(r.tokens.selected)} tokens`)}` +
      (saved > 0 ? `  ${bold(`${saved}% smaller`)}` : ''),
  );
  out.push('');

  const nameWidth = Math.min(40, Math.max(...r.tools.map((t) => t.name.length), 4));
  for (const t of r.tools) {
    const badge = t.tier === 'read' ? green('R') : yellow('W');
    out.push(`    ${badge}  ${clip(t.name, nameWidth).padEnd(nameWidth)}  ${dim(clip(`${t.route.method} ${t.route.path}`, 52))}`);
  }
  out.push('');
  out.push(dim(`    R = read-only   W = write${readOnly ? '' : '   (run with --read-only to drop writes)'}`));
  if (r.counts.eligible > r.counts.selected) {
    const groups = [...new Set(r.tools.map((t) => t.group))].slice(0, 2).join(',');
    out.push(dim(`    Not the ${r.counts.selected} you would pick? Steer it with --only ${groups} or raise --max`));
  }
  out.push('');
  console.log(out.join('\n'));
}

export function slugify(title) {
  return (
    String(title)
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 40) || 'api'
  );
}

export async function writeServer(r, { outDir, baseUrl, auth, source, force }) {
  const dir = resolve(outDir);
  if (existsSync(dir)) {
    const entries = await readdir(dir);
    if (entries.length && !entries.includes('tools.json') && !force) {
      throw new Error(`${dir} exists and was not created by getmcp. Pick another --out or pass --force.`);
    }
  }
  await mkdir(dir, { recursive: true });

  const name = `${slugify(r.title)}-mcp`;
  const manifest = {
    name,
    version: '0.0.1',
    baseUrl,
    auth: { kind: auth.kind, ...(auth.name ? { name: auth.name } : {}) },
    generatedBy: 'getmcp',
    source,
    tools: r.tools.map(({ name, description, inputSchema, annotations, route }) => ({ name, description, inputSchema, annotations, route })),
  };
  await writeFile(join(dir, 'tools.json'), JSON.stringify(manifest, null, 2) + '\n');
  await copyFile(new URL('../template/server.mjs', import.meta.url), join(dir, 'server.mjs'));
  await writeFile(
    join(dir, 'package.json'),
    JSON.stringify(
      {
        name,
        version: '0.0.1',
        private: true,
        type: 'module',
        bin: { [name]: 'server.mjs' },
        scripts: { start: 'node server.mjs' },
        dependencies: { '@modelcontextprotocol/sdk': SDK_VERSION },
        engines: { node: '>=20' },
      },
      null,
      2,
    ) + '\n',
  );
  await writeFile(join(dir, 'README.md'), readme(r, name, dir, baseUrl, auth));
  await writeFile(join(dir, 'REPORT.md'), reportMarkdown(r));
  return { dir, name };
}

/** One line telling the user what API_KEY should hold for this API. */
export function describeAuth(auth) {
  if (auth.kind === 'header') return 'sent as the ' + auth.name + ' header';
  if (auth.kind === 'query') return 'sent as the ' + auth.name + ' query parameter';
  if (auth.kind === 'basic') return 'sent as HTTP Basic auth (user:password, or just the key if the API takes it as the username)';
  return 'sent as Authorization: Bearer' + (auth.declared ? '' : ' (the spec declares no auth scheme, so this is a guess)');
}

function readme(r, name, dir, baseUrl, auth) {
  const serverPath = join(dir, 'server.mjs').replace(/\\/g, '/');
  return `# ${name}

MCP server for **${r.title}**, generated by [GetMCP](https://github.com/Rayenbabdallah/GetMCP).

${r.counts.selected} curated tools out of ${r.counts.operations} operations in the spec. See [REPORT.md](REPORT.md) for
what was kept, what was left out, and why.

## Run

\`\`\`bash
npm install
\`\`\`

Then add it to your MCP client.

**Claude Code**

\`\`\`bash
claude mcp add ${name} --env API_KEY=YOUR_KEY -- node ${serverPath}
\`\`\`

**Claude Desktop, Cursor, and other clients** (\`mcpServers\` config)

\`\`\`json
{
  "mcpServers": {
    "${name}": {
      "command": "node",
      "args": ["${serverPath}"],
      "env": { "API_KEY": "YOUR_KEY" }
    }
  }
}
\`\`\`

## Settings

| Variable | What it does |
|---|---|
| \`API_KEY\` | Your credential, ${describeAuth(auth)}. Leave unset for public APIs. |
| \`API_AUTH_HEADER\` | Full \`Authorization\` header value, to override how the key is sent. |
| \`API_HEADERS\` | Extra headers as JSON. |
| \`API_BASE_URL\` | Override the base URL (${baseUrl ? `spec says \`${baseUrl}\`` : 'the spec did not declare one, so this is required'}). |
| \`GETMCP_READ_ONLY\` | Set to \`1\` to hide and refuse every write tool. |
| \`GETMCP_MAX_CHARS\` | Cap on response text returned to the agent (default 20000). |

Edit \`tools.json\` to rename tools, rewrite descriptions, or delete ones you don't want.
`;
}

function reportMarkdown(r) {
  const lines = [];
  lines.push(`# GetMCP report — ${r.title} ${r.version}`.trim(), '');
  lines.push(`- Operations in spec: **${r.counts.operations}** (≈ ${n(r.tokens.all)} tokens if all were exposed as tools)`);
  lines.push(`- Left out as unsafe or unusable: **${r.counts.excluded}**`);
  lines.push(`- Safe candidates: **${r.counts.candidates}** (${r.counts.candidateReads} read, ${r.counts.candidateWrites} write)`);
  lines.push(`- Curated tools: **${r.counts.selected}** (≈ ${n(r.tokens.selected)} tokens)`, '');
  lines.push('Token figures are estimates (characters ÷ 4).', '');

  lines.push('## Tools', '', '| | Tool | Route | Description |', '|---|---|---|---|');
  for (const t of r.tools) {
    lines.push(`| ${t.tier === 'read' ? 'R' : 'W'} | \`${t.name}\` | \`${t.route.method} ${t.route.path}\` | ${t.description.replace(/\|/g, '\\|')} |`);
  }
  lines.push('');

  lines.push('## Left out', '');
  for (const [category, items] of Object.entries(r.byCategory).sort((a, b) => b[1].length - a[1].length)) {
    lines.push(`### ${CATEGORIES[category]} (${items.length})`, '');
    for (const e of items) lines.push(`- \`${e.method} ${e.path}\` — ${e.reason}`);
    lines.push('');
  }
  return lines.join('\n');
}
