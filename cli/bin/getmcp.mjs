#!/usr/bin/env node
import { loadSpec, baseUrlOf } from '../src/spec.mjs';
import { analyze, CATEGORIES } from '../src/analyze.mjs';
import { printReport, writeServer, slugify } from '../src/output.mjs';

const HELP = `getmcp — turn a big OpenAPI spec into a small, agent-ready MCP server.

Usage
  getmcp <openapi-url-or-file> [options]

Options
  --max <n>          How many tools to keep (default 25)
  --only <a,b>       Only consider operations about these resources (tags or path words)
  --read-only        Keep GET operations only
  --all              Keep every safe operation instead of curating
  --allow <a,b>      Let a risky category back in: ${Object.keys(CATEGORIES).join(', ')}
  --out <dir>        Where to write the server (default ./<api-name>-mcp)
  --dry-run          Print the report, write nothing
  --json             Print the report as JSON
  --force            Write into a non-empty directory
  -h, --help

Example
  getmcp https://petstore3.swagger.io/api/v3/openapi.json
`;

function parseArgs(argv) {
  const opts = { max: 25, only: [], allow: [], readOnly: false, all: false, dryRun: false, json: false, force: false };
  const list = (v) => String(v ?? '').split(',').map((s) => s.trim()).filter(Boolean);
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const next = () => {
      if (i + 1 >= argv.length) throw new Error(`${a} needs a value`);
      return argv[++i];
    };
    if (a === '-h' || a === '--help') opts.help = true;
    else if (a === '--max') opts.max = Number(next());
    else if (a === '--only') opts.only = list(next());
    else if (a === '--allow') opts.allow = list(next());
    else if (a === '--out') opts.out = next();
    else if (a === '--read-only') opts.readOnly = true;
    else if (a === '--all') opts.all = true;
    else if (a === '--dry-run') opts.dryRun = true;
    else if (a === '--json') opts.json = true;
    else if (a === '--force') opts.force = true;
    else if (a.startsWith('-')) throw new Error(`unknown option ${a}`);
    else if (!opts.source) opts.source = a;
    else throw new Error(`unexpected argument ${a}`);
  }
  if (!Number.isInteger(opts.max) || opts.max < 1) throw new Error('--max must be a positive whole number');
  const unknown = opts.allow.filter((c) => !(c in CATEGORIES));
  if (unknown.length) throw new Error(`--allow: unknown category ${unknown.join(', ')} (choose from ${Object.keys(CATEGORIES).join(', ')})`);
  return opts;
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  if (opts.help || !opts.source) {
    console.log(HELP);
    process.exit(opts.help ? 0 : 1);
  }

  const spec = await loadSpec(opts.source);
  const report = analyze(spec, opts);
  const baseUrl = baseUrlOf(spec, opts.source);

  if (opts.json) {
    const { byCategory: _omit, ...rest } = report;
    console.log(JSON.stringify({ ...rest, baseUrl }, null, 2));
  } else {
    printReport(report, opts);
  }

  if (report.tools.length === 0) {
    console.error('Nothing left to expose with these options. Try loosening --only or --read-only.');
    process.exit(1);
  }
  if (opts.dryRun) return;

  const outDir = opts.out ?? `./${slugify(report.title)}-mcp`;
  const { dir, name } = await writeServer(report, { outDir, baseUrl, source: opts.source, force: opts.force });
  const log = opts.json ? console.error : console.log;
  log(`  Wrote ${dir}`);
  log('');
  log('  Next');
  log(`    cd ${outDir} && npm install`);
  log(`    claude mcp add ${name} --env API_AUTH_HEADER="Bearer YOUR_TOKEN" -- node ${dir.replace(/\\/g, '/')}/server.mjs`);
  if (!baseUrl) log('    (the spec declares no server URL — also set API_BASE_URL)');
  log('');
}

main().catch((err) => {
  console.error(`getmcp: ${err.message}`);
  process.exit(1);
});
