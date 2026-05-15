import { NavLink, Navigate, Route, Routes, useLocation } from 'react-router-dom';
import type { ReactNode } from 'react';

interface Section {
  slug: string;
  title: string;
  group: string;
  body: ReactNode;
}

const SECTIONS: Section[] = [
  {
    slug: 'introduction',
    title: 'Introduction',
    group: 'Get started',
    body: <Introduction />,
  },
  {
    slug: 'quickstart',
    title: 'Quickstart',
    group: 'Get started',
    body: <Quickstart />,
  },
  {
    slug: 'two-mcp',
    title: 'The Two-MCP model',
    group: 'Concepts',
    body: <TwoMcp />,
  },
  {
    slug: 'zero-trust',
    title: 'Zero Trust for agents',
    group: 'Concepts',
    body: <ZeroTrust />,
  },
  {
    slug: 'policies',
    title: 'Policies',
    group: 'Reference',
    body: <Policies />,
  },
  {
    slug: 'audit',
    title: 'Audit ledger',
    group: 'Reference',
    body: <Audit />,
  },
  {
    slug: 'self-host',
    title: 'Self-hosting',
    group: 'Operations',
    body: <SelfHost />,
  },
  {
    slug: 'api',
    title: 'API reference',
    group: 'Reference',
    body: <ApiRef />,
  },
];

export function Docs() {
  return (
    <div className="mx-auto max-w-6xl px-6 py-10">
      <div className="grid grid-cols-1 gap-10 lg:grid-cols-[220px_minmax(0,1fr)]">
        <DocsNav />
        <div className="min-w-0">
          <Routes>
            <Route index element={<Navigate to="introduction" replace />} />
            {SECTIONS.map((s) => (
              <Route
                key={s.slug}
                path={s.slug}
                element={
                  <article className="prose prose-slate max-w-none">
                    <SectionHeader title={s.title} />
                    {s.body}
                  </article>
                }
              />
            ))}
            <Route path="*" element={<Navigate to="introduction" replace />} />
          </Routes>
        </div>
      </div>
    </div>
  );
}

function DocsNav() {
  const location = useLocation();
  const groups = Array.from(new Set(SECTIONS.map((s) => s.group)));
  return (
    <aside className="lg:sticky lg:top-20 lg:self-start">
      <nav className="space-y-6 text-sm">
        {groups.map((g) => (
          <div key={g}>
            <h4 className="mb-2 text-xs font-semibold uppercase tracking-wider text-slate-500">{g}</h4>
            <ul className="space-y-0.5">
              {SECTIONS.filter((s) => s.group === g).map((s) => (
                <li key={s.slug}>
                  <NavLink
                    to={`/docs/${s.slug}`}
                    className={({ isActive }) =>
                      `block rounded-md px-2.5 py-1.5 transition-colors ${
                        isActive || location.pathname === `/docs/${s.slug}`
                          ? 'bg-brand-50 font-medium text-brand-700'
                          : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900'
                      }`
                    }
                  >
                    {s.title}
                  </NavLink>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </nav>
    </aside>
  );
}

function SectionHeader({ title }: { title: string }) {
  return (
    <header className="mb-8 border-b border-slate-200 pb-6">
      <p className="mb-2 text-xs font-semibold uppercase tracking-wider text-brand-600">Documentation</p>
      <h1 className="text-3xl font-semibold tracking-tight text-slate-900">{title}</h1>
    </header>
  );
}

/* -------------------------------------------------------------- Sections */

function P({ children }: { children: ReactNode }) {
  return <p className="mb-4 text-base leading-relaxed text-slate-700">{children}</p>;
}
function H2({ children }: { children: ReactNode }) {
  return <h2 className="mt-10 mb-3 text-xl font-semibold tracking-tight text-slate-900">{children}</h2>;
}
function H3({ children }: { children: ReactNode }) {
  return <h3 className="mt-6 mb-2 text-base font-semibold text-slate-900">{children}</h3>;
}
function Code({ children }: { children: ReactNode }) {
  return <code className="rounded bg-slate-100 px-1.5 py-0.5 font-mono text-[0.85em] text-slate-800">{children}</code>;
}
function Pre({ children }: { children: string }) {
  return (
    <pre className="my-4 overflow-x-auto rounded-lg border border-slate-200 bg-slate-50 px-4 py-3 font-mono text-[12.5px] leading-relaxed text-slate-800">
      {children}
    </pre>
  );
}
function Note({ children }: { children: ReactNode }) {
  return (
    <div className="my-4 rounded-md border-l-4 border-brand-600 bg-brand-50/60 px-4 py-3 text-sm text-slate-700">
      {children}
    </div>
  );
}

/* ------ INTRODUCTION */

function Introduction() {
  return (
    <>
      <P>
        GetMCP is the policy proxy and audit log that sits between AI agents and your existing API. It does two things:
      </P>
      <ol className="mb-4 ml-6 list-decimal text-base leading-relaxed text-slate-700">
        <li><strong>Generates</strong> Internal and External MCP servers from any OpenAPI spec.</li>
        <li><strong>Enforces</strong> per-request policy + tamper-evident audit on every call.</li>
      </ol>
      <P>
        Internal MCP is the wedge — your engineers' Claude Desktop / Cursor get safe, full access to production. External
        MCP is the business — your <em>customers'</em> agents can transact with you, scoped, audited, with human-in-the-loop
        for sensitive mutations.
      </P>
      <H2>What you get</H2>
      <ul className="mb-4 ml-6 list-disc space-y-1 text-base text-slate-700">
        <li>Stateless API in NestJS, Postgres-backed via Prisma</li>
        <li>5 rule types: <Code>ALLOWLIST</Code>, <Code>BLOCK</Code>, <Code>AUDIT</Code>, <Code>RATE_LIMIT</Code>, <Code>MUTATION_APPROVAL</Code></li>
        <li>SHA-256 hash-chained audit log with one-call verification</li>
        <li>AES-256-GCM at-rest encryption for every per-org secret</li>
        <li>Slack approval flow with signed callbacks</li>
        <li>Self-hosted: Docker Compose, Helm chart, no vendor lock-in</li>
        <li>128 tests, CI coverage gates on the correctness-critical files</li>
      </ul>
      <Note>
        This documentation is the in-app summary. The full operator runbook,
        security threat model, performance targets, and testing strategy live
        in the <a className="font-medium text-brand-700 hover:underline" href="https://github.com/Rayenbabdallah/GetMCP/tree/main/docs" target="_blank" rel="noreferrer">docs/ directory on GitHub</a>.
      </Note>
    </>
  );
}

/* ------ QUICKSTART */

function Quickstart() {
  return (
    <>
      <P>From git clone to a real proxied request, in about 10 minutes.</P>

      <H2>1. Bootstrap (one command)</H2>
      <Pre>{`git clone https://github.com/Rayenbabdallah/GetMCP
cd GetMCP
./deploy/scripts/bootstrap.sh`}</Pre>
      <P>
        The script generates a fresh Postgres password and AES key, brings up Postgres, runs migrations, starts the API and
        Web, and seeds a demo org. Re-runnable safely.
      </P>

      <H2>2. Save your API key</H2>
      <P>The seed prints a key like <Code>gmcp_xxxxxxxxxxxxxxxxxxxxxxxx</Code> exactly once. Save it now.</P>
      <Pre>{`KEY=gmcp_…
INTERNAL_AGENT=cl…   # also from seed output`}</Pre>

      <H2>3. Configure an upstream</H2>
      <P>Tell the proxy where to forward authorized calls. We use httpbin as a stand-in:</P>
      <Pre>{`curl -X PATCH http://localhost:3000/orgs/me \\
  -H "Authorization: Bearer $KEY" \\
  -H "Content-Type: application/json" \\
  -d '{"upstreamBaseUrl": "https://httpbin.org", "upstreamTimeoutMs": 10000}'`}</Pre>

      <H2>4. Make a real proxied call</H2>
      <Pre>{`curl -X POST http://localhost:3000/proxy/execute \\
  -H "Authorization: Bearer $KEY" \\
  -H "x-agent-id: $INTERNAL_AGENT" \\
  -H "x-agent-source: internal_mcp" \\
  -H "x-agent-reasoning: smoke test from quickstart" \\
  -H "Content-Type: application/json" \\
  -d '{"method":"GET","path":"/get?hello=getmcp"}'`}</Pre>
      <P>You'll get back the actual httpbin echo — auth checked, agent verified, policy evaluated, forwarded, streamed.</P>

      <H2>5. Verify the audit chain</H2>
      <Pre>{`curl -H "Authorization: Bearer $KEY" http://localhost:3000/audit/verify
# {"valid": true, "rowCount": 1, "lastHash": "..."}`}</Pre>
      <P>
        That's the moat: any later modification — to a single field, the row's existence, or the row order — is detectable
        by walking the chain.
      </P>
      <Note>The dashboard at <Code>http://localhost:8080</Code> wraps all of this in a UI. Sign in with the same key.</Note>
    </>
  );
}

/* ------ TWO-MCP */

function TwoMcp() {
  return (
    <>
      <P>The industry assumes one MCP per app. Real enterprises need <strong>two</strong>.</P>
      <H3>Internal MCP — god mode</H3>
      <P>For your own engineers and ops bots. Full surface, raw queries, deployment rollbacks, customer impersonation.</P>
      <H3>External MCP — walled garden</H3>
      <P>For your customers' AI agents. A scoped, safe subset. Tenant-isolated, rate-limited, mutations require human approval.</P>
      <H2>Why this matters</H2>
      <P>
        Stripe doesn't only need an internal MCP for support. They need an external MCP so when a customer's AI says
        "refund order #1234," it can call Stripe — safely, scoped to that customer's tenant, audited.
      </P>
      <P>
        Without an external MCP, your SaaS is invisible to the agentic web. Two years from now, when a customer's
        Claude or ChatGPT plans a multi-step task, it picks the vendors that have a usable MCP.
      </P>
      <H2>How GetMCP generates both</H2>
      <P>
        Point the generator at any OpenAPI spec. An LLM classifier scores every endpoint on four axes (data sensitivity,
        mutation impact, tenant scope, reversibility) and decides which belong in the External MCP. Your security team
        reviews and overrides per endpoint. Output: two runnable Node MCP servers, pinned SDK version, ready to deploy.
      </P>
      <Pre>{`POST /generator/classify   { "openapiUrl": "https://…/openapi.json" }
POST /generator/override   { "specHash": "…", "path": "/admin/users", "method": "delete", "exposeExternally": true }
POST /generator/generate   { "openapiUrl": "…" }
GET  /generator/export?openapiUrl=…       → downloadable .zip`}</Pre>
    </>
  );
}

/* ------ ZERO TRUST */

function ZeroTrust() {
  return (
    <>
      <P>
        Companies spent the last decade building Zero Trust for their employees — verify every request, least privilege,
        audit everything. AI agents broke that model overnight: most companies hand agents a single API key and pray.
      </P>
      <P>GetMCP is Zero Trust Architecture for AI agents. The principles map directly to what the platform ships:</P>

      <div className="my-6 overflow-hidden rounded-lg border border-slate-200">
        <table className="w-full text-sm">
          <thead className="border-b border-slate-200 bg-slate-50/60">
            <tr>
              <th className="px-4 py-2 text-left text-xs font-semibold uppercase tracking-wider text-slate-500">Zero Trust principle</th>
              <th className="px-4 py-2 text-left text-xs font-semibold uppercase tracking-wider text-slate-500">GetMCP implementation</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            <Row left="Verify explicitly" right="Per-org bearer + per-call x-agent-id, resolved fresh (5s cache)" />
            <Row left="Least privilege" right="Two-MCP split — external agents get a scoped subset" />
            <Row left="Assume breach" right="Hash-chained, tamper-evident audit ledger" />
            <Row left="Continuous validation" right="Policy engine evaluates every request" />
            <Row left="Microsegmentation" right="Per-org isolation, per-tenant rate buckets, per-agent scopes" />
          </tbody>
        </table>
      </div>
      <P>
        This isn't framing — it's literally what the code does. See <a className="font-medium text-brand-700 hover:underline" href="https://github.com/Rayenbabdallah/GetMCP/blob/main/docs/security.md" target="_blank" rel="noreferrer">docs/security.md</a> for the full threat model.
      </P>
    </>
  );
}

function Row({ left, right }: { left: string; right: string }) {
  return (
    <tr>
      <td className="px-4 py-3 align-top font-medium text-slate-900">{left}</td>
      <td className="px-4 py-3 align-top text-slate-700">{right}</td>
    </tr>
  );
}

/* ------ POLICIES */

function Policies() {
  return (
    <>
      <P>
        Five rule types, evaluated by <Code>priority ASC, createdAt ASC</Code>. Lower priority runs first; the first
        terminal decision wins.
      </P>

      <H3>ALLOWLIST</H3>
      <P>Terminal allow. Short-circuits later BLOCK / RATE_LIMIT for this match.</P>

      <H3>BLOCK</H3>
      <P>Terminal deny → <Code>403</Code>.</P>

      <H3>AUDIT</H3>
      <P>
        Rejects requests whose <Code>x-agent-reasoning</Code> is missing, shorter than 10 chars, or in the boilerplate
        blocklist (<Code>test</Code>, <Code>placeholder</Code>, <Code>debugging</Code>, etc.). Passing AUDIT does NOT
        terminate; it just gates further rules.
      </P>

      <H3>RATE_LIMIT (external_mcp only)</H3>
      <P>Token bucket per <Code>(orgId, agentId, tenantId)</Code>. Returns <Code>429</Code> with <Code>Retry-After</Code>.</P>
      <Pre>{`actionConfig:
{
  "limit": 50,
  "windowMs": 60000,
  "scope": "agent+tenant"   // or "agent" or "tenant"
}`}</Pre>

      <H3>MUTATION_APPROVAL (external_mcp only)</H3>
      <P>
        Holds the request, posts an interactive Slack card to the configured channel, returns <Code>202</Code> with a{' '}
        <Code>pendingId</Code>. On Approve, replays through the proxy with bypass; on Deny, audits and never executes.
      </P>
      <Pre>{`actionConfig:
{ "channel": "#finance-ops" }`}</Pre>

      <H2>Path matching</H2>
      <ul className="mb-4 ml-6 list-disc space-y-1 text-base text-slate-700">
        <li><Code>/v1/refunds</Code> — exact</li>
        <li><Code>/v1/users/:id</Code> — single-segment param</li>
        <li><Code>/v1/foo/*</Code> — prefix wildcard</li>
        <li><Code>*</Code> — match anything</li>
      </ul>
      <Note>
        Old <Code>String.includes</Code> matching is gone. <Code>/v1/refunds-undo</Code> does NOT match
        <Code>/v1/refunds</Code>.
      </Note>

      <H2>Dry-run</H2>
      <P>Use <Code>POST /policies/simulate</Code> to see what every rule would do for a request shape, including a
        per-rule trace — without forwarding upstream.</P>
    </>
  );
}

/* ------ AUDIT */

function Audit() {
  return (
    <>
      <P>
        Every <Code>POST /proxy/execute</Code> writes one <Code>AuditLog</Code> row, regardless of outcome. Rows form a
        per-organization SHA-256 hash chain.
      </P>

      <H2>Hash construction</H2>
      <Pre>{`hash = sha256_hex(canonicalJson({
  organizationId, seq, timestamp,
  method, path, source, tenantId,
  agentId, apiKeyId,
  reasoning, reason, actionTaken,
  upstreamStatus,
  requestBytes, responseBytes, latencyMs,
  prevHash
}))`}</Pre>
      <P>
        Canonical JSON: keys sorted lexicographically, no whitespace, NaN/Infinity rejected. The implementation is ~25 lines
        and intentionally not pulled from a library — auditors should be able to recompute any row's hash from a database
        export.
      </P>

      <H2>Verification</H2>
      <Pre>{`GET /audit/verify
# valid:   {"valid":true, "rowCount":N, "lastHash":"…"}
# broken:  {"valid":false, "brokenAtSeq":N,
#           "reason":"hash_mismatch" | "prev_hash_mismatch" | "gap_in_seq",
#           "expected":"…", "actual":"…"}`}</Pre>

      <H2>Listing & export</H2>
      <Pre>{`GET /audit?limit=100&path=/v1/refunds&from=2026-01-01&to=2026-12-31&cursor=…
GET /audit/export                      # NDJSON, streamed`}</Pre>
      <P>
        NDJSON pipes straight into Splunk, Datadog, BigQuery. Both endpoints are scoped to the caller's organization by
        the AuthGuard.
      </P>
    </>
  );
}

/* ------ SELF-HOST */

function SelfHost() {
  return (
    <>
      <H3>Docker Compose (production)</H3>
      <Pre>{`./deploy/scripts/bootstrap.sh
# OR explicitly:
docker compose -f docker-compose.prod.yml up -d`}</Pre>
      <P>
        Postgres port is not exposed to the host. Restart policies and JSON log rotation are wired in. The API container
        depends on a one-shot <Code>api-migrate</Code> service that runs <Code>prisma migrate deploy</Code> first — so the
        API never starts against an unmigrated DB.
      </P>

      <H3>Kubernetes (Helm)</H3>
      <Pre>{`helm install getmcp deploy/helm/getmcp \\
  --namespace getmcp \\
  --set image.tag=0.1.0 \\
  --set ingress.host=getmcp.your-domain.example`}</Pre>
      <P>
        The chart deliberately does NOT bundle Postgres — bring your own (Marketplace Neon, RDS, Cloud SQL, or an HA
        operator). A pre-install Helm hook runs migrations; if it fails, the upgrade aborts and the old pods keep serving.
        Rolling deploy uses <Code>maxSurge: 1, maxUnavailable: 0</Code>.
      </P>

      <H3>Backups</H3>
      <Pre>{`./deploy/scripts/backup-db.sh                # cron-ready
./deploy/scripts/restore-db.sh backup.dump   # asks for confirmation`}</Pre>
      <Note>
        Always re-run <Code>GET /audit/verify</Code> after a restore. The chain must report <Code>valid: true</Code> — if a
        row was lost in the restore, you'll see <Code>gap_in_seq</Code>.
      </Note>
    </>
  );
}

/* ------ API REFERENCE */

function ApiRef() {
  return (
    <>
      <P>
        The full machine-readable spec is generated by <Code>@nestjs/swagger</Code> and served by the API itself.
      </P>

      <div className="my-6 grid grid-cols-1 gap-4 sm:grid-cols-2">
        <Linkout
          title="Swagger UI"
          href="http://localhost:3000/docs"
          description="Interactive API explorer. Click 'Authorize' and paste your gmcp_… key."
        />
        <Linkout
          title="OpenAPI JSON"
          href="http://localhost:3000/docs-json"
          description="Import into Postman, Insomnia, openapi-generator-cli, or any OpenAPI tool."
        />
      </div>

      <Note>
        In production, Swagger UI is disabled by default. Set <Code>ENABLE_DOCS=true</Code> on the API container to expose
        it, and gate at the ingress (auth header, IP allowlist, separate hostname).
      </Note>

      <H2>Endpoint summary</H2>
      <div className="my-6 overflow-hidden rounded-lg border border-slate-200">
        <table className="w-full text-sm">
          <thead className="border-b border-slate-200 bg-slate-50/60">
            <tr>
              <th className="px-4 py-2 text-left text-xs font-semibold uppercase tracking-wider text-slate-500">Group</th>
              <th className="px-4 py-2 text-left text-xs font-semibold uppercase tracking-wider text-slate-500">Endpoints</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            <ApiRow group="Proxy" eps="POST /proxy/execute" />
            <ApiRow group="Policies" eps="GET /policies, POST /policies, PATCH /policies/:id, DELETE /policies/:id, POST /policies/simulate" />
            <ApiRow group="Agents" eps="GET /agents, POST /agents, PATCH /agents/:id, DELETE /agents/:id" />
            <ApiRow group="Audit" eps="GET /audit, GET /audit/verify, GET /audit/export" />
            <ApiRow group="Approvals" eps="GET /approvals/:id" />
            <ApiRow group="Generator" eps="POST /generator/classify, POST /generator/override, POST /generator/generate, GET /generator/export" />
            <ApiRow group="API keys" eps="GET /api-keys, POST /api-keys, DELETE /api-keys/:id" />
            <ApiRow group="Organization" eps="GET /orgs/me, PATCH /orgs/me" />
            <ApiRow group="Slack" eps="POST /slack/interactions (signature-verified, public)" />
            <ApiRow group="Health & metrics" eps="GET /health/live, GET /health/ready, GET /metrics" />
          </tbody>
        </table>
      </div>
    </>
  );
}

function Linkout({ title, href, description }: { title: string; href: string; description: string }) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className="block rounded-lg border border-slate-200 bg-white p-4 transition-shadow hover:shadow-sm"
    >
      <div className="flex items-center justify-between">
        <span className="text-sm font-semibold text-slate-900">{title}</span>
        <span className="text-brand-700" aria-hidden>↗</span>
      </div>
      <p className="mt-1 text-xs text-slate-500">{description}</p>
      <p className="mt-2 truncate font-mono text-[11px] text-slate-400">{href}</p>
    </a>
  );
}

function ApiRow({ group, eps }: { group: string; eps: string }) {
  return (
    <tr>
      <td className="px-4 py-3 align-top font-medium text-slate-900">{group}</td>
      <td className="px-4 py-3 align-top font-mono text-xs text-slate-700">{eps}</td>
    </tr>
  );
}
