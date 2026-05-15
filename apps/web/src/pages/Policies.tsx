import { useEffect, useState } from 'react';
import { api } from '../lib/api';
import { PageHeader } from '../components/Layout';
import { Button } from '../components/ui/Button';
import { Card } from '../components/ui/Card';
import { Badge } from '../components/ui/Badge';
import { Table, TBody, TD, TH, THead, TR } from '../components/ui/Table';
import { Toggle } from '../components/ui/Toggle';
import { Dialog } from '../components/ui/Dialog';
import { Field } from '../components/ui/Field';
import { Input, Select, Textarea } from '../components/ui/Input';
import { EmptyState } from '../components/ui/EmptyState';
import { TableSkeleton } from '../components/ui/Skeleton';
import { InlineCode } from '../components/ui/CodeBlock';

type RuleType = 'ALLOWLIST' | 'BLOCK' | 'AUDIT' | 'RATE_LIMIT' | 'MUTATION_APPROVAL';

interface Policy {
  id: string;
  name: string;
  description: string;
  ruleType: RuleType;
  targetMethod: string;
  targetPath: string;
  actionConfig: any;
  priority: number;
  isActive: boolean;
  createdAt: string;
}

const TONE: Record<RuleType, 'success' | 'danger' | 'info' | 'warning' | 'brand'> = {
  ALLOWLIST: 'success',
  BLOCK: 'danger',
  AUDIT: 'info',
  RATE_LIMIT: 'warning',
  MUTATION_APPROVAL: 'brand',
};

export function Policies() {
  const [rows, setRows] = useState<Policy[] | null>(null);
  const [showCreate, setShowCreate] = useState(false);

  async function load() {
    const data = await api<Policy[]>('/policies');
    setRows(data);
  }
  useEffect(() => { load().catch(() => setRows([])); }, []);

  async function toggle(p: Policy) {
    await api(`/policies/${p.id}`, { method: 'PATCH', body: { isActive: !p.isActive } });
    setRows((cur) => cur && cur.map((r) => (r.id === p.id ? { ...r, isActive: !p.isActive } : r)));
  }
  async function remove(p: Policy) {
    if (!confirm(`Delete policy "${p.name}"? This cannot be undone.`)) return;
    await api(`/policies/${p.id}`, { method: 'DELETE' });
    setRows((cur) => cur && cur.filter((r) => r.id !== p.id));
  }

  return (
    <>
      <PageHeader
        title="Policies"
        description="Rules that gate every request through the proxy. Lower priority runs first; first terminal decision wins."
        actions={<Button onClick={() => setShowCreate(true)}>New policy</Button>}
      />

      <Card>
        {rows === null ? (
          <TableSkeleton rows={4} cols={5} />
        ) : rows.length === 0 ? (
          <EmptyState
            title="No policies yet"
            description="Without policies, every authenticated proxy call is allowed. Add at least an AUDIT rule to require reasoning."
            action={<Button onClick={() => setShowCreate(true)}>Create your first policy</Button>}
          />
        ) : (
          <Table>
            <THead>
              <TR>
                <TH>Name</TH>
                <TH>Type</TH>
                <TH>Target</TH>
                <TH className="text-right">Priority</TH>
                <TH className="text-right">Active</TH>
                <TH></TH>
              </TR>
            </THead>
            <TBody>
              {rows.map((p) => (
                <TR key={p.id}>
                  <TD>
                    <div className="font-medium text-slate-900">{p.name}</div>
                    <div className="mt-0.5 text-xs text-slate-500">{p.description}</div>
                  </TD>
                  <TD>
                    <Badge tone={TONE[p.ruleType]}>{p.ruleType.replace('_', ' ')}</Badge>
                  </TD>
                  <TD>
                    <code className="font-mono text-xs text-slate-700">
                      {p.targetMethod} {p.targetPath}
                    </code>
                    {p.actionConfig && Object.keys(p.actionConfig).length > 0 && (
                      <div className="mt-0.5 font-mono text-[11px] text-slate-400">
                        {JSON.stringify(p.actionConfig)}
                      </div>
                    )}
                  </TD>
                  <TD className="text-right font-mono text-xs">{p.priority}</TD>
                  <TD className="text-right">
                    <Toggle checked={p.isActive} onChange={() => toggle(p)} label={`Toggle ${p.name}`} />
                  </TD>
                  <TD className="text-right">
                    <button onClick={() => remove(p)} className="text-xs text-slate-400 hover:text-red-600">
                      Delete
                    </button>
                  </TD>
                </TR>
              ))}
            </TBody>
          </Table>
        )}
      </Card>

      {showCreate && (
        <CreatePolicyDialog
          onClose={() => setShowCreate(false)}
          onCreated={() => { setShowCreate(false); load(); }}
        />
      )}
    </>
  );
}

function CreatePolicyDialog({ onClose, onCreated }: { onClose: () => void; onCreated: () => void }) {
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [ruleType, setRuleType] = useState<RuleType>('AUDIT');
  const [targetMethod, setTargetMethod] = useState('*');
  const [targetPath, setTargetPath] = useState('*');
  const [priority, setPriority] = useState(100);
  const [actionConfig, setActionConfig] = useState('{}');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit() {
    setError(null);
    let parsed = {};
    try { parsed = JSON.parse(actionConfig || '{}'); }
    catch { setError('actionConfig must be valid JSON'); return; }
    setBusy(true);
    try {
      await api('/policies', {
        method: 'POST',
        body: { name, description, ruleType, targetMethod, targetPath, priority, actionConfig: parsed },
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
      title="New policy"
      description="Rules are evaluated in priority order. First terminal decision wins."
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>Cancel</Button>
          <Button onClick={submit} loading={busy} disabled={!name.trim()}>Create</Button>
        </>
      }
    >
      <div className="space-y-4">
        <Field label="Name" required>
          <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Refund approval" />
        </Field>
        <Field label="Description" hint="Shown in 403 messages and Slack approval cards">
          <Textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            rows={2}
            placeholder="POST /v1/refunds requires Slack approval from #finance-ops"
          />
        </Field>
        <div className="grid grid-cols-2 gap-4">
          <Field label="Rule type" required>
            <Select value={ruleType} onChange={(e) => setRuleType(e.target.value as RuleType)}>
              <option value="ALLOWLIST">ALLOWLIST — short-circuit allow</option>
              <option value="BLOCK">BLOCK — terminal deny</option>
              <option value="AUDIT">AUDIT — require non-trivial reasoning</option>
              <option value="RATE_LIMIT">RATE_LIMIT — token bucket per agent+tenant</option>
              <option value="MUTATION_APPROVAL">MUTATION_APPROVAL — Slack approval</option>
            </Select>
          </Field>
          <Field label="Priority" hint="Lower runs first. Default 100.">
            <Input
              type="number"
              value={priority}
              onChange={(e) => setPriority(parseInt(e.target.value || '100', 10))}
            />
          </Field>
        </div>
        <div className="grid grid-cols-2 gap-4">
          <Field label="Method" hint="Or * for any">
            <Input value={targetMethod} onChange={(e) => setTargetMethod(e.target.value)} placeholder="POST" />
          </Field>
          <Field label="Path pattern" hint="Exact, /v1/users/:id, /v1/foo/*, *">
            <Input value={targetPath} onChange={(e) => setTargetPath(e.target.value)} placeholder="/v1/refunds" />
          </Field>
        </div>
        <Field
          label="actionConfig (JSON)"
          hint={
            <>
              For RATE_LIMIT: <InlineCode>{`{"limit":50,"windowMs":60000,"scope":"agent+tenant"}`}</InlineCode>
              <br />
              For MUTATION_APPROVAL: <InlineCode>{`{"channel":"#finance-ops"}`}</InlineCode>
            </>
          }
        >
          <Textarea value={actionConfig} onChange={(e) => setActionConfig(e.target.value)} rows={3} />
        </Field>
        {error && (
          <div className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
            {error}
          </div>
        )}
      </div>
    </Dialog>
  );
}
