import { useEffect, useState } from 'react';
import { api } from '../lib/api';
import { PageHeader } from '../components/Layout';
import { Button } from '../components/ui/Button';
import { Card } from '../components/ui/Card';
import { Badge } from '../components/ui/Badge';
import { Table, TBody, TD, TH, THead, TR } from '../components/ui/Table';
import { Dialog } from '../components/ui/Dialog';
import { Field } from '../components/ui/Field';
import { Input, Select } from '../components/ui/Input';
import { EmptyState } from '../components/ui/EmptyState';
import { TableSkeleton } from '../components/ui/Skeleton';
import { formatRelative } from '../lib/format';

interface Agent {
  id: string;
  name: string;
  source: 'internal_mcp' | 'external_mcp';
  tenantScope: string | null;
  enabled: boolean;
  revokedAt: string | null;
  lastUsedAt: string | null;
  createdAt: string;
}

export function Agents() {
  const [rows, setRows] = useState<Agent[] | null>(null);
  const [showCreate, setShowCreate] = useState(false);

  async function load() { setRows(await api<Agent[]>('/agents')); }
  useEffect(() => { load().catch(() => setRows([])); }, []);

  async function revoke(a: Agent) {
    if (!confirm(`Revoke agent "${a.name}"? Existing requests will start failing within 5 seconds.`)) return;
    await api(`/agents/${a.id}`, { method: 'DELETE' });
    load();
  }

  return (
    <>
      <PageHeader
        title="Agents"
        description="Identities the proxy recognizes via x-agent-id. Revocation propagates within 5 seconds."
        actions={<Button onClick={() => setShowCreate(true)}>New agent</Button>}
      />

      <Card>
        {rows === null ? (
          <TableSkeleton rows={4} cols={6} />
        ) : rows.length === 0 ? (
          <EmptyState
            title="No agents registered"
            description="Every proxy call must assert an agent identity via the x-agent-id header. Create one for each AI client."
            action={<Button onClick={() => setShowCreate(true)}>Register first agent</Button>}
          />
        ) : (
          <Table>
            <THead>
              <TR>
                <TH>Name</TH>
                <TH>Source</TH>
                <TH>Tenant scope</TH>
                <TH>Status</TH>
                <TH>Last used</TH>
                <TH>ID</TH>
                <TH></TH>
              </TR>
            </THead>
            <TBody>
              {rows.map((a) => (
                <TR key={a.id}>
                  <TD><span className="font-medium text-slate-900">{a.name}</span></TD>
                  <TD><Badge tone={a.source === 'internal_mcp' ? 'danger' : 'info'}>{a.source}</Badge></TD>
                  <TD><span className="font-mono text-xs">{a.tenantScope ?? '—'}</span></TD>
                  <TD>
                    {a.revokedAt ? (
                      <Badge tone="danger">Revoked</Badge>
                    ) : a.enabled ? (
                      <Badge tone="success">Active</Badge>
                    ) : (
                      <Badge tone="neutral">Disabled</Badge>
                    )}
                  </TD>
                  <TD className="text-xs text-slate-500">{formatRelative(a.lastUsedAt)}</TD>
                  <TD mono>{a.id}</TD>
                  <TD className="text-right">
                    {!a.revokedAt && (
                      <button onClick={() => revoke(a)} className="text-xs text-slate-400 hover:text-red-600">
                        Revoke
                      </button>
                    )}
                  </TD>
                </TR>
              ))}
            </TBody>
          </Table>
        )}
      </Card>

      {showCreate && (
        <CreateAgentDialog
          onClose={() => setShowCreate(false)}
          onCreated={() => { setShowCreate(false); load(); }}
        />
      )}
    </>
  );
}

function CreateAgentDialog({ onClose, onCreated }: { onClose: () => void; onCreated: () => void }) {
  const [name, setName] = useState('');
  const [source, setSource] = useState<'internal_mcp' | 'external_mcp'>('internal_mcp');
  const [tenantScope, setTenantScope] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    setBusy(true); setError(null);
    try {
      await api('/agents', {
        method: 'POST',
        body: { name, source, tenantScope: tenantScope.trim() || null },
      });
      onCreated();
    } catch (e: any) {
      setError(e?.message ?? 'Failed to create');
    } finally { setBusy(false); }
  }

  return (
    <Dialog
      open
      onClose={onClose}
      title="New agent"
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>Cancel</Button>
          <Button onClick={submit} loading={busy} disabled={!name.trim()}>Create</Button>
        </>
      }
    >
      <div className="space-y-4">
        <Field label="Name" required hint="Human-friendly identifier">
          <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="claude-desktop-customer-1" />
        </Field>
        <Field label="Source" required hint="internal = god mode; external = scoped subset">
          <Select value={source} onChange={(e) => setSource(e.target.value as any)}>
            <option value="internal_mcp">internal_mcp</option>
            <option value="external_mcp">external_mcp</option>
          </Select>
        </Field>
        <Field label="Tenant scope" hint="Optional. When set, x-tenant-id must match exactly.">
          <Input
            value={tenantScope}
            onChange={(e) => setTenantScope(e.target.value)}
            placeholder="customer-42 (leave blank for unscoped)"
          />
        </Field>
        {error && (
          <div className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{error}</div>
        )}
      </div>
    </Dialog>
  );
}
