import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../lib/api';
import { Card, CardSection } from '../components/ui/Card';
import { Badge, StatusDot } from '../components/ui/Badge';
import { Button } from '../components/ui/Button';
import { PageHeader } from '../components/Layout';
import { Skeleton } from '../components/ui/Skeleton';
import { formatRelative, formatLatency } from '../lib/format';

interface AuditRow {
  id: string;
  seq: number;
  method: string;
  path: string;
  source: string;
  actionTaken: string;
  upstreamStatus: number | null;
  latencyMs: number;
  timestamp: string;
}

export function Dashboard() {
  const [org, setOrg] = useState<any>(null);
  const [verify, setVerify] = useState<any>(null);
  const [recent, setRecent] = useState<AuditRow[] | null>(null);
  const [pending, setPending] = useState<number | null>(null);
  const [policies, setPolicies] = useState<any[] | null>(null);
  const [agents, setAgents] = useState<any[] | null>(null);

  useEffect(() => {
    api('/orgs/me').then(setOrg).catch(() => undefined);
    api('/audit/verify').then(setVerify).catch(() => setVerify({ valid: false, reason: 'unreachable' }));
    api<{ data: AuditRow[] }>('/audit', { query: { limit: 8 } })
      .then((r) => setRecent(r.data))
      .catch(() => setRecent([]));
    api('/policies').then(setPolicies).catch(() => setPolicies([]));
    api('/agents').then((a) => {
      setAgents(a);
      // Fetch pending count by looking at audit for AWAITING_APPROVAL — proxy approximation
      // A dedicated /approvals?status=PENDING endpoint would be better; for now we count from audit.
    }).catch(() => setAgents([]));
    api<{ data: AuditRow[] }>('/audit', { query: { limit: 100 } })
      .then((r) => setPending(r.data.filter((row) => row.actionTaken === 'AWAITING_APPROVAL').length))
      .catch(() => setPending(0));
  }, []);

  return (
    <>
      <PageHeader
        title={org?.name ? `${org.name}` : 'Dashboard'}
        description="At-a-glance health of your GetMCP control plane"
      />

      {/* Stat tiles */}
      <div className="mb-6 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatTile
          label="Audit chain"
          value={verify?.valid ? 'Valid' : verify ? 'Broken' : '…'}
          tone={verify?.valid ? 'success' : verify ? 'danger' : 'neutral'}
          sub={verify?.valid ? `${verify.rowCount} rows` : verify?.reason ?? ''}
          to="/audit"
        />
        <StatTile
          label="Active policies"
          value={policies ? String(policies.filter((p: any) => p.isActive).length) : '…'}
          tone="brand"
          sub={policies ? `${policies.length} total` : ''}
          to="/policies"
        />
        <StatTile
          label="Agents"
          value={agents ? String(agents.filter((a: any) => a.enabled && !a.revokedAt).length) : '…'}
          tone="info"
          sub={agents ? `${agents.length} total` : ''}
          to="/agents"
        />
        <StatTile
          label="Pending approvals"
          value={pending !== null ? String(pending) : '…'}
          tone={pending && pending > 0 ? 'warning' : 'neutral'}
          sub="last 100 audited calls"
          to="/approvals"
        />
      </div>

      {/* Two-column: recent activity + setup checklist */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardSection
            title="Recent activity"
            description="Last 8 proxied calls"
            actions={
              <Link to="/audit">
                <Button variant="ghost" size="sm">View all</Button>
              </Link>
            }
          />
          {recent === null ? (
            <div className="px-6 py-4">
              <Skeleton className="h-4 w-full" />
              <Skeleton className="mt-2 h-4 w-full" />
              <Skeleton className="mt-2 h-4 w-full" />
            </div>
          ) : recent.length === 0 ? (
            <div className="px-6 py-12 text-center text-sm text-slate-500">
              No proxy traffic yet. Configure an upstream and make a call.
            </div>
          ) : (
            <ul className="divide-y divide-slate-100">
              {recent.map((row) => (
                <li key={row.id} className="flex items-center justify-between px-6 py-3">
                  <div className="flex items-center gap-3">
                    <ActionBadge action={row.actionTaken} />
                    <div className="font-mono text-xs text-slate-700">
                      <span className="text-slate-400">{row.method}</span>{' '}
                      <span className="text-slate-900">{row.path}</span>
                    </div>
                  </div>
                  <div className="flex items-center gap-3 text-xs text-slate-500">
                    <span>{formatLatency(row.latencyMs)}</span>
                    {row.upstreamStatus !== null && (
                      <span className="font-mono">{row.upstreamStatus}</span>
                    )}
                    <span>{formatRelative(row.timestamp)}</span>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card>
          <CardSection title="Setup" description="Get to a real proxied request" />
          <ul className="space-y-3 px-6 py-4 text-sm">
            <SetupItem
              done={Boolean(org?.upstreamBaseUrl)}
              label="Configure upstream"
              to="/organization"
            />
            <SetupItem
              done={Boolean(org?.hasUpstreamAuthHeader)}
              label="Add upstream auth header"
              to="/organization"
              optional
            />
            <SetupItem
              done={agents !== null && agents.length > 0}
              label="Register an agent"
              to="/agents"
            />
            <SetupItem
              done={Boolean(org?.hasSlackBotToken)}
              label="Connect Slack for approvals"
              to="/organization"
              optional
            />
            <SetupItem
              done={policies !== null && policies.length > 0}
              label="Create at least one policy"
              to="/policies"
            />
          </ul>
        </Card>
      </div>
    </>
  );
}

function StatTile({
  label, value, sub, tone, to,
}: {
  label: string; value: string; sub: string; tone: 'success'|'brand'|'info'|'warning'|'neutral'|'danger'; to: string;
}) {
  return (
    <Link to={to} className="block">
      <Card className="p-5 transition-shadow hover:shadow-sm">
        <div className="flex items-center justify-between">
          <span className="text-xs font-medium uppercase tracking-wider text-slate-500">{label}</span>
          <StatusDot tone={tone} />
        </div>
        <div className="mt-2 text-2xl font-semibold tracking-tight text-slate-900">{value}</div>
        <div className="mt-1 text-xs text-slate-500">{sub || ' '}</div>
      </Card>
    </Link>
  );
}

function ActionBadge({ action }: { action: string }) {
  if (action === 'EXECUTED') return <Badge tone="success">{action}</Badge>;
  if (action === 'BLOCKED') return <Badge tone="danger">{action}</Badge>;
  if (action === 'AWAITING_APPROVAL') return <Badge tone="warning">{action}</Badge>;
  if (action === 'INCOMPLETE') return <Badge tone="neutral">{action}</Badge>;
  return <Badge>{action}</Badge>;
}

function SetupItem({ done, label, to, optional }: { done: boolean; label: string; to: string; optional?: boolean }) {
  return (
    <li>
      <Link to={to} className="flex items-center gap-3 rounded-md px-2 py-1 -mx-2 hover:bg-slate-50">
        <span
          className={`flex h-5 w-5 items-center justify-center rounded-full text-[10px] ${
            done ? 'bg-emerald-100 text-emerald-700' : 'bg-slate-100 text-slate-400'
          }`}
        >
          {done ? '✓' : ''}
        </span>
        <span className="flex-1 text-slate-700">{label}</span>
        {optional && <span className="text-[10px] uppercase tracking-wider text-slate-400">Optional</span>}
      </Link>
    </li>
  );
}
