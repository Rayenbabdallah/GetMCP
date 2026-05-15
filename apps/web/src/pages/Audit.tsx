import { useEffect, useState } from 'react';
import { api, downloadUrl } from '../lib/api';
import { PageHeader } from '../components/Layout';
import { Card } from '../components/ui/Card';
import { Button } from '../components/ui/Button';
import { Badge } from '../components/ui/Badge';
import { Table, TBody, TD, TH, THead, TR } from '../components/ui/Table';
import { TableSkeleton } from '../components/ui/Skeleton';
import { EmptyState } from '../components/ui/EmptyState';
import { Input } from '../components/ui/Input';
import { Field } from '../components/ui/Field';
import { Dialog } from '../components/ui/Dialog';
import { CodeBlock } from '../components/ui/CodeBlock';
import { formatBytes, formatLatency, formatDate, truncateId } from '../lib/format';
import { getApiKey } from '../lib/auth';

interface AuditRow {
  id: string;
  seq: number;
  organizationId: string;
  agentId: string | null;
  apiKeyId: string | null;
  method: string;
  path: string;
  source: string;
  tenantId: string | null;
  reasoning: string | null;
  reason: string | null;
  actionTaken: string;
  upstreamStatus: number | null;
  requestBytes: number;
  responseBytes: number | null;
  latencyMs: number;
  prevHash: string;
  hash: string;
  timestamp: string;
}

export function Audit() {
  const [rows, setRows] = useState<AuditRow[] | null>(null);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [pathFilter, setPathFilter] = useState('');
  const [verify, setVerify] = useState<any>(null);
  const [verifying, setVerifying] = useState(false);
  const [detail, setDetail] = useState<AuditRow | null>(null);

  async function load(opts: { cursor?: string; reset?: boolean } = {}) {
    if (opts.reset) setRows(null);
    const r = await api<{ data: AuditRow[]; nextCursor: string | null }>('/audit', {
      query: { limit: 50, path: pathFilter || undefined, cursor: opts.cursor },
    });
    setRows(opts.cursor ? (cur) => [...(cur ?? []), ...r.data] : r.data);
    setNextCursor(r.nextCursor);
  }

  useEffect(() => { load({ reset: true }).catch(() => setRows([])); /* eslint-disable-next-line */ }, []);

  async function runVerify() {
    setVerifying(true);
    try { setVerify(await api('/audit/verify')); }
    finally { setVerifying(false); }
  }

  async function applyFilter(e: React.FormEvent) {
    e.preventDefault();
    await load({ reset: true });
  }

  async function loadMore() {
    if (!nextCursor) return;
    await load({ cursor: nextCursor });
  }

  return (
    <>
      <PageHeader
        title="Audit log"
        description="Tamper-evident, hash-chained record of every proxied call"
        actions={
          <>
            <Button variant="secondary" onClick={runVerify} loading={verifying}>
              Verify chain
            </Button>
            <a
              href={downloadUrl('/audit/export')}
              onClick={(e) => {
                // Bearer header can't be sent via <a>. Append to URL via fetch + blob instead.
                e.preventDefault();
                fetch(downloadUrl('/audit/export'), {
                  headers: { Authorization: `Bearer ${getApiKey()}` },
                })
                  .then((r) => r.blob())
                  .then((blob) => {
                    const url = URL.createObjectURL(blob);
                    const a = document.createElement('a');
                    a.href = url;
                    a.download = 'audit.ndjson';
                    a.click();
                    URL.revokeObjectURL(url);
                  });
              }}
            >
              <Button variant="secondary">Export NDJSON</Button>
            </a>
          </>
        }
      />

      {verify && (
        <Card className={`mb-6 ${verify.valid ? 'border-emerald-200 bg-emerald-50/40' : 'border-red-200 bg-red-50/40'}`}>
          <div className="flex items-start gap-3 px-6 py-4">
            <span
              className={`mt-1 inline-block h-2 w-2 rounded-full ${verify.valid ? 'bg-emerald-500' : 'bg-red-500'}`}
            />
            <div className="flex-1">
              <div className="text-sm font-medium text-slate-900">
                {verify.valid ? 'Chain valid' : 'Chain BROKEN'}
              </div>
              <div className="mt-0.5 text-xs text-slate-600">
                {verify.valid ? (
                  <>
                    {verify.rowCount} rows verified. Head hash:{' '}
                    <code className="font-mono">{verify.lastHash.slice(0, 16)}…</code>
                  </>
                ) : (
                  <>
                    Broken at seq <code className="font-mono">{verify.brokenAtSeq}</code> —{' '}
                    {verify.reason}. Expected{' '}
                    <code className="font-mono">{String(verify.expected).slice(0, 16)}…</code>, got{' '}
                    <code className="font-mono">{String(verify.actual).slice(0, 16)}…</code>
                  </>
                )}
              </div>
            </div>
          </div>
        </Card>
      )}

      <Card className="mb-4">
        <form onSubmit={applyFilter} className="flex items-end gap-3 px-6 py-4">
          <Field label="Path contains">
            <Input
              value={pathFilter}
              onChange={(e) => setPathFilter(e.target.value)}
              placeholder="/v1/refunds"
              className="w-72"
            />
          </Field>
          <Button type="submit" variant="secondary">Filter</Button>
          {pathFilter && (
            <Button
              type="button"
              variant="ghost"
              onClick={() => { setPathFilter(''); load({ reset: true }); }}
            >
              Clear
            </Button>
          )}
        </form>
      </Card>

      <Card>
        {rows === null ? (
          <TableSkeleton rows={8} cols={6} />
        ) : rows.length === 0 ? (
          <EmptyState
            title="No audit rows"
            description="Make a call through /proxy/execute and a row will appear here."
          />
        ) : (
          <>
            <Table>
              <THead>
                <TR>
                  <TH className="w-12">#</TH>
                  <TH>When</TH>
                  <TH>Action</TH>
                  <TH>Method</TH>
                  <TH>Path</TH>
                  <TH>Status</TH>
                  <TH className="text-right">Latency</TH>
                  <TH className="text-right">Resp</TH>
                </TR>
              </THead>
              <TBody>
                {rows.map((r) => (
                  <TR key={r.id} onClick={() => setDetail(r)}>
                    <TD mono>{r.seq}</TD>
                    <TD className="text-xs text-slate-500">{formatDate(r.timestamp)}</TD>
                    <TD><ActionBadge action={r.actionTaken} /></TD>
                    <TD mono>{r.method}</TD>
                    <TD mono className="max-w-md truncate">{r.path}</TD>
                    <TD mono>{r.upstreamStatus ?? '—'}</TD>
                    <TD className="text-right text-xs">{formatLatency(r.latencyMs)}</TD>
                    <TD className="text-right text-xs">{formatBytes(r.responseBytes)}</TD>
                  </TR>
                ))}
              </TBody>
            </Table>
            {nextCursor && (
              <div className="flex justify-center border-t border-slate-100 px-6 py-4">
                <Button variant="secondary" size="sm" onClick={loadMore}>Load more</Button>
              </div>
            )}
          </>
        )}
      </Card>

      {detail && <DetailDialog row={detail} onClose={() => setDetail(null)} />}
    </>
  );
}

function ActionBadge({ action }: { action: string }) {
  if (action === 'EXECUTED') return <Badge tone="success">Executed</Badge>;
  if (action === 'BLOCKED') return <Badge tone="danger">Blocked</Badge>;
  if (action === 'AWAITING_APPROVAL') return <Badge tone="warning">Awaiting</Badge>;
  if (action === 'INCOMPLETE') return <Badge tone="neutral">Incomplete</Badge>;
  return <Badge>{action}</Badge>;
}

function DetailDialog({ row, onClose }: { row: any; onClose: () => void }) {
  return (
    <Dialog open onClose={onClose} title={`Audit row #${row.seq}`} description={row.id} size="lg">
      <dl className="grid grid-cols-3 gap-x-6 gap-y-3 text-sm">
        <Item label="Action"><ActionBadge action={row.actionTaken} /></Item>
        <Item label="Method"><code className="font-mono">{row.method}</code></Item>
        <Item label="Path"><code className="font-mono">{row.path}</code></Item>
        <Item label="Source">{row.source}</Item>
        <Item label="Tenant">{row.tenantId ?? '—'}</Item>
        <Item label="Agent">{truncateId(row.agentId, 18)}</Item>
        <Item label="Upstream status">{row.upstreamStatus ?? '—'}</Item>
        <Item label="Latency">{formatLatency(row.latencyMs)}</Item>
        <Item label="Bytes">{formatBytes(row.requestBytes)} → {formatBytes(row.responseBytes)}</Item>
        <Item label="Reasoning" full>{row.reasoning ?? '—'}</Item>
        <Item label="Reason" full>{row.reason ?? '—'}</Item>
      </dl>

      <div className="mt-5">
        <div className="text-xs font-medium uppercase tracking-wider text-slate-500">Hash chain</div>
        <CodeBlock copy>
{`prevHash  ${row.prevHash}
hash      ${row.hash}`}
        </CodeBlock>
      </div>
    </Dialog>
  );
}

function Item({ label, children, full }: { label: string; children: React.ReactNode; full?: boolean }) {
  return (
    <div className={full ? 'col-span-3' : ''}>
      <dt className="text-xs font-medium uppercase tracking-wider text-slate-500">{label}</dt>
      <dd className="mt-1 text-slate-900">{children}</dd>
    </div>
  );
}
