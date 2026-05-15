import { Link } from 'react-router-dom';
import type { ReactNode } from 'react';

export function Landing() {
  return (
    <main>
      <Hero />
      <Pillars />
      <HowItWorks />
      <SelfHost />
      <CTA />
    </main>
  );
}

/* ------------------------------------------------------------------ Hero */

function Hero() {
  return (
    <section className="relative overflow-hidden border-b border-slate-200">
      {/* subtle teal wash */}
      <div
        aria-hidden
        className="absolute inset-0 -z-10 opacity-60"
        style={{
          backgroundImage:
            'radial-gradient(60% 50% at 50% -10%, color-mix(in oklab, var(--color-brand-100) 70%, transparent), transparent 70%)',
        }}
      />
      <div className="mx-auto max-w-6xl px-6 py-20 sm:py-28">
        <div className="mx-auto max-w-3xl text-center">
          <span className="inline-flex items-center gap-2 rounded-full border border-brand-200 bg-brand-50 px-3 py-1 text-xs font-medium text-brand-700">
            <span className="inline-block h-1.5 w-1.5 rounded-full bg-brand-600" />
            Zero Trust Architecture for AI Agents
          </span>
          <h1 className="mt-6 text-4xl font-semibold tracking-tight text-slate-900 sm:text-6xl">
            Make your API <span className="text-brand-700">agent-ready</span> — safely.
          </h1>
          <p className="mx-auto mt-6 max-w-2xl text-lg leading-relaxed text-slate-600">
            GetMCP generates the MCP servers your customers' AI agents need, and enforces a per-request policy +
            tamper-evident audit log on every call. Internal copilots and external customer agents — one control plane.
          </p>
          <div className="mt-9 flex items-center justify-center gap-3">
            <Link
              to="/docs/quickstart"
              className="inline-flex items-center gap-2 rounded-md bg-brand-600 px-5 py-3 text-sm font-medium text-white shadow-sm transition-colors hover:bg-brand-700"
            >
              Quickstart
              <span aria-hidden>→</span>
            </Link>
            <a
              href="https://github.com/Rayenbabdallah/GetMCP"
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-2 rounded-md border border-slate-200 bg-white px-5 py-3 text-sm font-medium text-slate-700 shadow-sm transition-colors hover:bg-slate-50"
            >
              <GithubMark /> View on GitHub
            </a>
          </div>
          <p className="mt-4 text-xs text-slate-500">
            Self-host in 60 seconds with one bash command. Apache-style permissive license.
          </p>
        </div>

        <FlowDiagram />
      </div>
    </section>
  );
}

function FlowDiagram() {
  return (
    <div className="mx-auto mt-16 max-w-4xl">
      <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
        <div className="grid grid-cols-3 items-stretch gap-4">
          <Node label="Agent" sub="Claude / GPT / your bot" tone="slate" />
          <Connector />
          <Node label="Your API" sub="Stripe / Salesforce / internal" tone="slate" />
        </div>
        <div className="my-4 flex items-center justify-center">
          <div className="rounded-md border-2 border-brand-600 bg-brand-50 px-6 py-4 text-center">
            <div className="text-xs font-semibold uppercase tracking-wider text-brand-700">GetMCP</div>
            <div className="mt-1 text-sm text-slate-700">
              auth · agent identity · policy · approval · audit
            </div>
          </div>
        </div>
        <div className="grid grid-cols-3 gap-3 text-center text-xs text-slate-500">
          <div>① Agent calls<br/>via MCP</div>
          <div>② GetMCP gates<br/>each request</div>
          <div>③ Forwarded to<br/>your real API</div>
        </div>
      </div>
    </div>
  );
}

function Node({ label, sub, tone = 'slate' }: { label: string; sub: string; tone?: 'slate' | 'brand' }) {
  const cls =
    tone === 'brand'
      ? 'border-brand-200 bg-brand-50 text-brand-700'
      : 'border-slate-200 bg-slate-50 text-slate-700';
  return (
    <div className={`rounded-lg border ${cls} p-4 text-center`}>
      <div className="text-sm font-semibold">{label}</div>
      <div className="mt-1 text-xs text-slate-500">{sub}</div>
    </div>
  );
}

function Connector() {
  return (
    <div className="flex items-center justify-center">
      <div className="h-px w-full border-t-2 border-dashed border-slate-300" />
    </div>
  );
}

/* --------------------------------------------------------------- Pillars */

function Pillars() {
  return (
    <section className="border-b border-slate-200 bg-slate-50/50">
      <div className="mx-auto max-w-6xl px-6 py-20">
        <div className="mb-12 max-w-2xl">
          <h2 className="text-3xl font-semibold tracking-tight text-slate-900">
            Three things, one platform.
          </h2>
          <p className="mt-3 text-lg text-slate-600">
            Each piece is useful alone. Together they replace 6 months of custom infrastructure.
          </p>
        </div>
        <div className="grid grid-cols-1 gap-6 md:grid-cols-3">
          <Pillar
            num="01"
            title="Generate"
            description="Point at any OpenAPI spec. GetMCP classifies every endpoint by data sensitivity, mutation impact, tenant scope, and reversibility — then exports a runnable Internal MCP (god-mode) and External MCP (customer-safe) server."
          />
          <Pillar
            num="02"
            title="Enforce"
            description="Five rule types — ALLOWLIST, BLOCK, AUDIT, RATE_LIMIT, MUTATION_APPROVAL — evaluated per-request in deterministic priority order. Slack-driven human-in-the-loop for sensitive mutations. Real path templates, real token-bucket rate limits."
          />
          <Pillar
            num="03"
            title="Audit"
            description={
              <>
                Every call writes one row to a per-org SHA-256 hash chain. Tamper detection is a single
                <code className="mx-1 rounded bg-slate-100 px-1.5 py-0.5 font-mono text-xs text-slate-800">
                  GET /audit/verify
                </code>
                away. NDJSON export streams straight into Splunk or Datadog.
              </>
            }
          />
        </div>
      </div>
    </section>
  );
}

function Pillar({ num, title, description }: { num: string; title: string; description: ReactNode }) {
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-6">
      <div className="text-xs font-semibold uppercase tracking-wider text-brand-600">{num}</div>
      <h3 className="mt-2 text-xl font-semibold tracking-tight text-slate-900">{title}</h3>
      <p className="mt-3 text-sm leading-relaxed text-slate-600">{description}</p>
    </div>
  );
}

/* -------------------------------------------------------- How it works */

function HowItWorks() {
  return (
    <section className="border-b border-slate-200">
      <div className="mx-auto max-w-6xl px-6 py-20">
        <div className="grid grid-cols-1 gap-12 lg:grid-cols-2">
          <div>
            <span className="text-xs font-semibold uppercase tracking-wider text-brand-600">In your terminal</span>
            <h2 className="mt-2 text-3xl font-semibold tracking-tight text-slate-900">
              From <code className="text-brand-700">git clone</code> to a real proxied request.
            </h2>
            <p className="mt-3 text-base leading-relaxed text-slate-600">
              The bootstrap script generates a fresh database password and encryption key, runs migrations, brings up
              Postgres + API + Web, and seeds a demo organization. Re-runnable safely. Output prints a working API key
              you can paste into the dashboard.
            </p>
            <div className="mt-6 space-y-3 text-sm text-slate-700">
              <Step n="1" text="Clone the repo and run bootstrap.sh" />
              <Step n="2" text="Paste the printed API key into the dashboard" />
              <Step n="3" text="Configure your upstream API in /app/organization" />
              <Step n="4" text="Make a real call through /proxy/execute" />
              <Step n="5" text="Watch it land in the audit log with a verifiable hash" />
            </div>
          </div>

          <div>
            <CodeWindow
              title="bash"
              code={`git clone https://github.com/Rayenbabdallah/GetMCP
cd GetMCP
./deploy/scripts/bootstrap.sh

# → API:        http://localhost:3000
# → Dashboard:  http://localhost:8080
# → API key:    gmcp_xxxxxxxxxxxxxxxxxxxxxxxx
#   (saved exactly once — paste into the UI)`}
            />
            <div className="h-4" />
            <CodeWindow
              title="curl"
              code={`KEY=gmcp_…
AGENT=clxxx…

curl -X POST http://localhost:3000/proxy/execute \\
  -H "Authorization: Bearer $KEY" \\
  -H "x-agent-id: $AGENT" \\
  -H "x-agent-source: internal_mcp" \\
  -H "x-agent-reasoning: investigating customer #321" \\
  -H "Content-Type: application/json" \\
  -d '{"method":"GET","path":"/v1/charges"}'`}
            />
          </div>
        </div>
      </div>
    </section>
  );
}

function Step({ n, text }: { n: string; text: string }) {
  return (
    <div className="flex items-start gap-3">
      <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-brand-100 text-xs font-semibold text-brand-700">
        {n}
      </span>
      <span>{text}</span>
    </div>
  );
}

function CodeWindow({ title, code }: { title: string; code: string }) {
  return (
    <div className="overflow-hidden rounded-lg border border-slate-200 bg-slate-900 shadow-sm">
      <div className="flex items-center justify-between border-b border-slate-800 bg-slate-800/60 px-4 py-2">
        <div className="flex items-center gap-1.5">
          <span className="h-2.5 w-2.5 rounded-full bg-slate-700" />
          <span className="h-2.5 w-2.5 rounded-full bg-slate-700" />
          <span className="h-2.5 w-2.5 rounded-full bg-slate-700" />
        </div>
        <span className="font-mono text-[10px] uppercase tracking-wider text-slate-500">{title}</span>
      </div>
      <pre className="overflow-x-auto px-4 py-4 font-mono text-[12.5px] leading-relaxed text-slate-100">{code}</pre>
    </div>
  );
}

/* --------------------------------------------------------------- Self-host */

function SelfHost() {
  return (
    <section className="border-b border-slate-200 bg-slate-50/50">
      <div className="mx-auto max-w-6xl px-6 py-20">
        <div className="grid grid-cols-1 items-center gap-12 lg:grid-cols-2">
          <div>
            <span className="text-xs font-semibold uppercase tracking-wider text-brand-600">Built to run anywhere</span>
            <h2 className="mt-2 text-3xl font-semibold tracking-tight text-slate-900">
              Your data never leaves your network.
            </h2>
            <p className="mt-3 text-base leading-relaxed text-slate-600">
              GetMCP is open-source and self-hosted by default. A two-stage Docker image, a production-grade Helm chart,
              tamper-evident audit chain, AES-256-GCM encryption for every per-org secret, and a pre-install migration
              hook for zero-downtime upgrades. Bring your own Postgres.
            </p>
            <ul className="mt-6 space-y-2 text-sm text-slate-700">
              <Check>Multi-stage non-root Docker images</Check>
              <Check>Helm chart with rolling, zero-loss deploys</Check>
              <Check>Prisma migrations + backup/restore scripts</Check>
              <Check>Per-file CI coverage gates on the correctness-critical surfaces</Check>
              <Check>SECURITY.md, threat model, vuln disclosure SLA</Check>
            </ul>
          </div>
          <CodeWindow
            title="kubernetes (helm)"
            code={`kubectl create namespace getmcp

kubectl -n getmcp create secret generic getmcp-db \\
  --from-literal=DATABASE_URL=postgresql://…
kubectl -n getmcp create secret generic getmcp-encryption-key \\
  --from-literal=KEY_ENCRYPTION_KEY=$(openssl rand -hex 32)

helm install getmcp deploy/helm/getmcp \\
  --namespace getmcp \\
  --set image.tag=0.1.0 \\
  --set ingress.host=getmcp.your-domain.example`}
          />
        </div>
      </div>
    </section>
  );
}

function Check({ children }: { children: ReactNode }) {
  return (
    <li className="flex items-start gap-2">
      <svg className="mt-0.5 h-4 w-4 shrink-0 text-brand-600" viewBox="0 0 20 20" fill="currentColor" aria-hidden>
        <path fillRule="evenodd" d="M16.7 5.3a1 1 0 0 1 0 1.4l-7 7a1 1 0 0 1-1.4 0l-3-3a1 1 0 1 1 1.4-1.4L9 11.6l6.3-6.3a1 1 0 0 1 1.4 0z" clipRule="evenodd" />
      </svg>
      <span>{children}</span>
    </li>
  );
}

/* -------------------------------------------------------------- Final CTA */

function CTA() {
  return (
    <section>
      <div className="mx-auto max-w-4xl px-6 py-20 text-center">
        <h2 className="text-3xl font-semibold tracking-tight text-slate-900 sm:text-4xl">
          Ready when your customers' agents are.
        </h2>
        <p className="mx-auto mt-3 max-w-xl text-base text-slate-600">
          Two years from now, every B2B SaaS will need an MCP. The ones that ship safely will be the ones that already
          had Zero Trust for humans.
        </p>
        <div className="mt-8 flex items-center justify-center gap-3">
          <Link
            to="/docs/quickstart"
            className="inline-flex items-center gap-2 rounded-md bg-brand-600 px-5 py-3 text-sm font-medium text-white shadow-sm hover:bg-brand-700"
          >
            Read the quickstart
          </Link>
          <a
            href="https://github.com/Rayenbabdallah/GetMCP"
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-2 rounded-md border border-slate-200 bg-white px-5 py-3 text-sm font-medium text-slate-700 hover:bg-slate-50"
          >
            <GithubMark /> Star on GitHub
          </a>
        </div>
      </div>
    </section>
  );
}

function GithubMark() {
  return (
    <svg viewBox="0 0 16 16" className="h-4 w-4" fill="currentColor" aria-hidden>
      <path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0 0 16 8c0-4.42-3.58-8-8-8z" />
    </svg>
  );
}
