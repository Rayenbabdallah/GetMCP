import { useEffect, useState } from 'react';
import { api } from '../lib/api';
import { PageHeader } from '../components/Layout';
import { Card } from '../components/ui/Card';
import { Badge } from '../components/ui/Badge';
import { Table, TBody, TD, TH, THead, TR } from '../components/ui/Table';
import { TableSkeleton } from '../components/ui/Skeleton';
import { EmptyState } from '../components/ui/EmptyState';
import { Dialog } from '../components/ui/Dialog';
import { formatDate, formatRelative } from '../lib/format';
import { Button } from '../components/ui/Button';

interface ApprovalVote {
  id: string;
  approverSlackUserId: string;
  approverSlackUserName: string;
  justification: string | null;
  decision: 'APPROVED' | 'DENIED';
  decidedAt: string;
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
  _count?: { approvals: number };
  approvals?: ApprovalVote[];
}

type StatusFilter = 'PENDING' | 'APPROVED' | 'DENIED' | 'EXPIRED' | 'ALL';

export function Approvals() {
  const [rows, setRows] = useState<Pending[] | null>(null);
  const [filter, setFilter] = useState<StatusFilter>('PENDING');
  const [detail, setDetail] = useState<Pending | null>(null);

  async function load() {
    const resp = await api<{ data: Pending[]; nextCursor: string | null }>('/approvals', {
      query: filter === 'ALL' ? { limit: 50 } : { status: filter, limit: 50 },
    });
    setRows(resp.data);
  }

  useEffect(() => { load().catch(() => setRows([])); /* eslint-disable-next-line */ }, [filter]);

  async function openDetail(p: Pending) {
    // Fetch the full row with approvals.
    try {
      const full = await api<Pending>(`/approvals/${p.id}`);
      setDetail(full);
    } catch {
      setDetail(p);
    }
  }

  return (
    <>
      <PageHeader
        title="Approvals"
        description="Held requests gated by MUTATION_APPROVAL rules. Decisions happen in Slack; this page shows the live state."
      />

      <Card className="mb-4">
        <div className="flex items-center gap-1 px-4 py-2">
          {(['PENDING', 'APPROVED', 'DENIED', 'EXPIRED', 'ALL'] as StatusFilter[]).map((s) => (
            <button
              key={s}
              onClick={() => setFilter(s)}
              className={`rounded-md px-3 py-1.5 text-sm font-medium transition-colors ${
                filter === s
                  ? 'bg-brand-50 text-brand-700'
                  : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900'
              }`}
            >
              {s.charAt(0) + s.slice(1).toLowerCase()}
            </button>
          ))}
        </div>
      </Card>

      <Card>
        {rows === null ? (
          <TableSkeleton rows={4} cols={5} />
        ) : rows.length === 0 ? (
          <EmptyState
            title={filter === 'PENDING' ? 'No pending approvals' : `No ${filter.toLowerCase()} approvals`}
            description={
              filter === 'PENDING'
                ? 'When a MUTATION_APPROVAL rule fires, the held request appears here and a Slack card is posted.'
                : 'Try a different status filter, or wait for traffic.'
            }
          />
        ) : (
          <Table>
            <THead>
              <TR>
                <TH>Request</TH>
                <TH>Reasoning</TH>
                <TH>Quorum</TH>
                <TH>Created</TH>
                <TH>Status</TH>
              </TR>
            </THead>
            <TBody>
              {rows.map((p) => (
                <TR key={p.id} onClick={() => openDetail(p)}>
                  <TD mono>{p.method} {p.path}</TD>
                  <TD className="max-w-md truncate text-xs text-slate-500">{p.reasoning ?? '—'}</TD>
                  <TD className="text-xs text-slate-500">
                    {p._count?.approvals ?? 0} {p.status === 'PENDING' ? 'vote(s)' : ''}
                  </TD>
                  <TD className="text-xs text-slate-500">{formatRelative(p.createdAt)}</TD>
                  <TD><StatusBadge status={p.status} /></TD>
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

function StatusBadge({ status }: { status: string }) {
  if (status === 'PENDING') return <Badge tone="warning">Pending</Badge>;
  if (status === 'APPROVED') return <Badge tone="success">Approved</Badge>;
  if (status === 'DENIED') return <Badge tone="danger">Denied</Badge>;
  if (status === 'EXPIRED') return <Badge tone="neutral">Expired</Badge>;
  return <Badge>{status}</Badge>;
}

function DetailDialog({ row, onClose }: { row: Pending; onClose: () => void }) {
  return (
    <Dialog
      open
      onClose={onClose}
      title={`${row.method} ${row.path}`}
      description={row.id}
      size="lg"
      footer={<Button variant="secondary" onClick={onClose}>Close</Button>}
    >
      <dl className="grid grid-cols-2 gap-x-6 gap-y-3 text-sm">
        <Item label="Status"><StatusBadge status={row.status} /></Item>
        <Item label="Rule">{row.ruleName}</Item>
        <Item label="Source">{row.source}</Item>
        <Item label="Tenant">{row.tenantId ?? '—'}</Item>
        <Item label="Created">{formatDate(row.createdAt)}</Item>
        <Item label="Expires">{formatDate(row.expiresAt)}</Item>
        <Item label="Reasoning" full>{row.reasoning ?? '—'}</Item>
      </dl>

      <div className="mt-6">
        <div className="mb-2 text-xs font-medium uppercase tracking-wider text-slate-500">
          Approval votes ({row.approvals?.length ?? 0})
        </div>
        {row.approvals && row.approvals.length > 0 ? (
          <ul className="divide-y divide-slate-100 rounded-md border border-slate-200">
            {row.approvals.map((v) => (
              <li key={v.id} className="px-4 py-3">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <Badge tone={v.decision === 'APPROVED' ? 'success' : 'danger'}>{v.decision}</Badge>
                    <span className="font-medium text-slate-900">@{v.approverSlackUserName}</span>
                    <code className="font-mono text-[11px] text-slate-400">{v.approverSlackUserId}</code>
                  </div>
                  <span className="text-xs text-slate-500">{formatRelative(v.decidedAt)}</span>
                </div>
                {v.justification && (
                  <div className="mt-2 rounded-md bg-slate-50 px-3 py-2 text-sm italic text-slate-700">
                    "{v.justification}"
                  </div>
                )}
              </li>
            ))}
          </ul>
        ) : (
          <div className="rounded-md border border-dashed border-slate-200 px-4 py-6 text-center text-sm text-slate-500">
            No votes yet. Approvers act from the Slack card.
          </div>
        )}
      </div>

      {row.status === 'APPROVED' && row.responseStatus !== null && (
        <div className="mt-6">
          <div className="mb-2 text-xs font-medium uppercase tracking-wider text-slate-500">
            Captured upstream response
          </div>
          <div className="rounded-md border border-slate-200">
            <div className="flex items-center justify-between border-b border-slate-200 bg-slate-50 px-4 py-2 text-xs">
              <span>HTTP <code className="font-mono">{row.responseStatus}</code></span>
            </div>
            <pre className="max-h-64 overflow-auto px-4 py-3 font-mono text-xs text-slate-800">
              {JSON.stringify(row.responseBody, null, 2)}
            </pre>
          </div>
        </div>
      )}
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
