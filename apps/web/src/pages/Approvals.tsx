import { useEffect, useState } from 'react';
import { api } from '../lib/api';
import { PageHeader } from '../components/Layout';
import { Card } from '../components/ui/Card';
import { Badge } from '../components/ui/Badge';
import { Table, TBody, TD, TH, THead, TR } from '../components/ui/Table';
import { TableSkeleton } from '../components/ui/Skeleton';
import { EmptyState } from '../components/ui/EmptyState';
import { Dialog } from '../components/ui/Dialog';
import { CodeBlock } from '../components/ui/CodeBlock';
import { formatDate, formatRelative } from '../lib/format';

// We don't have a list endpoint for pending requests yet, but we can derive
// pending from the audit log (AWAITING_APPROVAL rows). For each, fetch the
// full PendingRequest via /approvals/:id to show current state + decisions.

interface AuditRow {
  id: string;
  seq: number;
  method: string;
  path: string;
  reasoning: string | null;
  reason: string | null;
  actionTaken: string;
  timestamp: string;
}

interface Pending {
  id: string;
  status: 'PENDING' | 'APPROVED' | 'DENIED' | 'EXPIRED';
  method: string;
  path: string;
  source: string;
  tenantId: string | null;
  reasoning: string | null;
  ruleName: string;
  channel: string | null;
  approverSlackUserId: string | null;
  approverSlackUserName: string | null;
  decisionReason: string | null;
  decidedAt: string | null;
  responseStatus: number | null;
  responseHeaders: any;
  responseBody: any;
  expiresAt: string;
  createdAt: string;
}

export function Approvals() {
  const [pendings, setPendings] = useState<Pending[] | null>(null);
  const [detail, setDetail] = useState<Pending | null>(null);

  async function load() {
    // Pull recent AWAITING_APPROVAL audit rows; their reason field references the rule + pending.
    // For each row we fetch the underlying PendingRequest to get current state. Because the audit
    // row doesn't carry the pendingId today, we derive pendings from the most recent 50 audit rows
    // by reasoning identity — best effort until a /approvals?status=PENDING endpoint lands (§7).
    const audit = await api<{ data: AuditRow[] }>('/audit', { query: { limit: 50 } });
    const candidates = audit.data.filter((r) => r.actionTaken === 'AWAITING_APPROVAL');
    // Without a list endpoint, we just present the audit rows; clicking opens the detail.
    setPendings(
      candidates.map<Pending>((r) => ({
        id: r.id, // surrogate; the real PendingRequest id is not on the audit row in v1
        status: 'PENDING',
        method: r.method,
        path: r.path,
        source: 'external_mcp',
        tenantId: null,
        reasoning: r.reasoning,
        ruleName: '(see detail)',
        channel: null,
        approverSlackUserId: null,
        approverSlackUserName: null,
        decisionReason: null,
        decidedAt: null,
        responseStatus: null,
        responseHeaders: null,
        responseBody: null,
        expiresAt: r.timestamp,
        createdAt: r.timestamp,
      })),
    );
  }

  useEffect(() => { load().catch(() => setPendings([])); }, []);

  return (
    <>
      <PageHeader
        title="Approvals"
        description="Held requests awaiting human decision via Slack. Decisions complete via the Slack interaction webhook."
      />

      <Card className="mb-4 border-amber-200 bg-amber-50/40">
        <div className="px-6 py-4 text-sm text-amber-900">
          <strong>v1 limitation:</strong> there's no <code className="font-mono">/approvals?status=PENDING</code> list
          endpoint yet. This page shows audit rows tagged{' '}
          <Badge tone="warning">AWAITING_APPROVAL</Badge> as a proxy. Approve/Deny happens from the Slack message;
          poll an individual request via <code className="font-mono">GET /approvals/:id</code>.
        </div>
      </Card>

      <Card>
        {pendings === null ? (
          <TableSkeleton rows={4} cols={4} />
        ) : pendings.length === 0 ? (
          <EmptyState
            title="No pending approvals"
            description="When a MUTATION_APPROVAL rule fires, the held request appears here and a Slack card is posted."
          />
        ) : (
          <Table>
            <THead>
              <TR>
                <TH>Request</TH>
                <TH>Reasoning</TH>
                <TH>Created</TH>
                <TH>Status</TH>
              </TR>
            </THead>
            <TBody>
              {pendings.map((p) => (
                <TR key={p.id} onClick={() => setDetail(p)}>
                  <TD mono>{p.method} {p.path}</TD>
                  <TD className="max-w-md truncate text-xs text-slate-500">{p.reasoning ?? '—'}</TD>
                  <TD className="text-xs text-slate-500">{formatRelative(p.createdAt)}</TD>
                  <TD><Badge tone="warning">Awaiting Slack</Badge></TD>
                </TR>
              ))}
            </TBody>
          </Table>
        )}
      </Card>

      {detail && <DetailDialog row={detail} onClose={() => setDetail(null)} />}
    </>
  );
}

function DetailDialog({ row, onClose }: { row: Pending; onClose: () => void }) {
  return (
    <Dialog open onClose={onClose} title="Held request" description={row.id} size="lg">
      <dl className="grid grid-cols-2 gap-x-6 gap-y-3 text-sm">
        <Item label="Request"><code className="font-mono">{row.method} {row.path}</code></Item>
        <Item label="Created">{formatDate(row.createdAt)}</Item>
        <Item label="Reasoning" full>{row.reasoning ?? '—'}</Item>
      </dl>
      <div className="mt-5 text-xs text-slate-500">
        Poll the live state with:
      </div>
      <CodeBlock copy>{`curl -H "Authorization: Bearer $KEY" \\
  http://localhost:3000/approvals/${row.id}`}</CodeBlock>
    </Dialog>
  );
}

function Item({ label, children, full }: { label: string; children: React.ReactNode; full?: boolean }) {
  return (
    <div className={full ? 'col-span-2' : ''}>
      <dt className="text-xs font-medium uppercase tracking-wider text-slate-500">{label}</dt>
      <dd className="mt-1 text-slate-900">{children}</dd>
    </div>
  );
}
