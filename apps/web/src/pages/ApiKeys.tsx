import { useEffect, useState } from 'react';
import { api } from '../lib/api';
import { PageHeader } from '../components/Layout';
import { Card } from '../components/ui/Card';
import { Button } from '../components/ui/Button';
import { Badge } from '../components/ui/Badge';
import { Table, TBody, TD, TH, THead, TR } from '../components/ui/Table';
import { Dialog } from '../components/ui/Dialog';
import { Field } from '../components/ui/Field';
import { Input } from '../components/ui/Input';
import { CodeBlock } from '../components/ui/CodeBlock';
import { TableSkeleton } from '../components/ui/Skeleton';
import { EmptyState } from '../components/ui/EmptyState';
import { formatRelative, formatDate } from '../lib/format';

interface ApiKey {
  id: string;
  name: string;
  prefix: string;
  lastUsedAt: string | null;
  revokedAt: string | null;
  createdAt: string;
}

export function ApiKeys() {
  const [rows, setRows] = useState<ApiKey[] | null>(null);
  const [showCreate, setShowCreate] = useState(false);
  const [revealed, setRevealed] = useState<{ name: string; key: string } | null>(null);

  async function load() { setRows(await api<ApiKey[]>('/api-keys')); }
  useEffect(() => { load().catch(() => setRows([])); }, []);

  async function revoke(k: ApiKey) {
    if (!confirm(`Revoke "${k.name}"? Anyone using this key will start getting 401s within 5 seconds.`)) return;
    await api(`/api-keys/${k.id}`, { method: 'DELETE' });
    load();
  }

  return (
    <>
      <PageHeader
        title="API keys"
        description="Bearer keys that authenticate operators to your organization. Each key is org-scoped and revocable."
        actions={<Button onClick={() => setShowCreate(true)}>New key</Button>}
      />

      <Card>
        {rows === null ? (
          <TableSkeleton rows={4} cols={5} />
        ) : rows.length === 0 ? (
          <EmptyState
            title="No keys yet"
            description="Mint a key for each operator, CI server, or service that needs to call the GetMCP API."
            action={<Button onClick={() => setShowCreate(true)}>Mint first key</Button>}
          />
        ) : (
          <Table>
            <THead>
              <TR>
                <TH>Name</TH>
                <TH>Prefix</TH>
                <TH>Status</TH>
                <TH>Last used</TH>
                <TH>Created</TH>
                <TH></TH>
              </TR>
            </THead>
            <TBody>
              {rows.map((k) => (
                <TR key={k.id}>
                  <TD><span className="font-medium text-slate-900">{k.name}</span></TD>
                  <TD mono>{k.prefix}…</TD>
                  <TD>
                    {k.revokedAt
                      ? <Badge tone="danger">Revoked</Badge>
                      : <Badge tone="success">Active</Badge>}
                  </TD>
                  <TD className="text-xs text-slate-500">{formatRelative(k.lastUsedAt)}</TD>
                  <TD className="text-xs text-slate-500">{formatDate(k.createdAt)}</TD>
                  <TD className="text-right">
                    {!k.revokedAt && (
                      <button onClick={() => revoke(k)} className="text-xs text-slate-400 hover:text-red-600">
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
        <CreateDialog
          onClose={() => setShowCreate(false)}
          onCreated={(name, key) => { setShowCreate(false); setRevealed({ name, key }); load(); }}
        />
      )}

      {revealed && (
        <Dialog
          open
          onClose={() => setRevealed(null)}
          title="Save this key now"
          description="The plaintext value is shown ONCE. After this dialog closes, you cannot retrieve it again."
          footer={<Button onClick={() => setRevealed(null)}>I've saved it</Button>}
        >
          <Field label={`API key — "${revealed.name}"`}>
            <CodeBlock copy>{revealed.key}</CodeBlock>
          </Field>
          <p className="mt-3 text-xs text-slate-500">
            Test it: <code className="font-mono">curl -H "Authorization: Bearer {revealed.key}" /orgs/me</code>
          </p>
        </Dialog>
      )}
    </>
  );
}

function CreateDialog({ onClose, onCreated }: { onClose: () => void; onCreated: (name: string, key: string) => void }) {
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    setBusy(true); setError(null);
    try {
      const r = await api<{ name: string; key: string }>('/api-keys', { method: 'POST', body: { name } });
      onCreated(r.name, r.key);
    } catch (e: any) {
      setError(e?.message ?? 'Failed to mint');
    } finally { setBusy(false); }
  }

  return (
    <Dialog
      open
      onClose={onClose}
      title="New API key"
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>Cancel</Button>
          <Button onClick={submit} loading={busy} disabled={!name.trim()}>Mint key</Button>
        </>
      }
    >
      <Field label="Name" required hint="Used for audit attribution. e.g. ci-server, dashboard, ops-bot.">
        <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="ci-server" />
      </Field>
      {error && (
        <div className="mt-3 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{error}</div>
      )}
    </Dialog>
  );
}
