import { useEffect, useState } from 'react';
import type { FormEvent } from 'react';
import { api } from '../lib/api';
import { PageHeader } from '../components/Layout';
import { Card, CardSection } from '../components/ui/Card';
import { Button } from '../components/ui/Button';
import { Badge } from '../components/ui/Badge';
import { Field } from '../components/ui/Field';
import { Input } from '../components/ui/Input';
import { Skeleton } from '../components/ui/Skeleton';

interface Org {
  id: string;
  name: string;
  authType: string;
  upstreamBaseUrl: string | null;
  upstreamTimeoutMs: number;
  slackDefaultChannel: string | null;
  hasUpstreamAuthHeader: boolean;
  hasSlackBotToken: boolean;
  hasSlackSigningSecret: boolean;
}

export function Organization() {
  const [org, setOrg] = useState<Org | null>(null);

  async function load() { setOrg(await api<Org>('/orgs/me')); }
  useEffect(() => { load().catch(() => setOrg(null)); }, []);

  return (
    <>
      <PageHeader
        title="Organization"
        description="Configure where the proxy forwards requests and the secrets it uses."
      />

      {!org ? (
        <Card><div className="p-6 space-y-3"><Skeleton className="h-4 w-1/3" /><Skeleton className="h-4 w-2/3" /></div></Card>
      ) : (
        <div className="space-y-6">
          {/* Identity */}
          <Card>
            <CardSection title="Identity">
              <dl className="grid grid-cols-3 gap-x-6 gap-y-3 text-sm">
                <Item label="Name">{org.name}</Item>
                <Item label="Auth type">{org.authType}</Item>
                <Item label="Org ID"><code className="font-mono text-xs">{org.id}</code></Item>
              </dl>
            </CardSection>
          </Card>

          {/* Upstream */}
          <UpstreamCard org={org} onSaved={load} />

          {/* Slack */}
          <SlackCard org={org} onSaved={load} />
        </div>
      )}
    </>
  );
}

function UpstreamCard({ org, onSaved }: { org: Org; onSaved: () => void }) {
  const [baseUrl, setBaseUrl] = useState(org.upstreamBaseUrl ?? '');
  const [timeout, setTimeout] = useState(org.upstreamTimeoutMs);
  const [authHeader, setAuthHeader] = useState('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null);

  async function save(e: FormEvent) {
    e.preventDefault();
    setBusy(true); setMsg(null);
    try {
      const body: any = { upstreamBaseUrl: baseUrl || null, upstreamTimeoutMs: timeout };
      if (authHeader.trim()) body.upstreamAuthHeader = authHeader.trim();
      await api('/orgs/me', { method: 'PATCH', body });
      setAuthHeader('');
      setMsg({ kind: 'ok', text: 'Saved' });
      onSaved();
    } catch (e: any) {
      setMsg({ kind: 'err', text: e?.message ?? 'Save failed' });
    } finally { setBusy(false); }
  }

  async function clearAuthHeader() {
    if (!confirm('Clear the stored upstream auth header? Future proxy calls will be sent without it.')) return;
    await api('/orgs/me', { method: 'PATCH', body: { upstreamAuthHeader: null } });
    onSaved();
  }

  return (
    <Card>
      <CardSection
        title="Upstream API"
        description="The downstream API the proxy forwards authorized requests to."
      />
      <form onSubmit={save} className="space-y-4 px-6 py-4">
        <Field label="Base URL" required hint="https or http; trailing slash optional">
          <Input value={baseUrl} onChange={(e) => setBaseUrl(e.target.value)} placeholder="https://api.stripe.com" />
        </Field>
        <Field label="Timeout (ms)" hint="100 – 120000. Default 30000.">
          <Input type="number" value={timeout} onChange={(e) => setTimeout(parseInt(e.target.value || '30000', 10))} />
        </Field>
        <Field
          label="Auth header value"
          hint={
            <>
              Encrypted at rest with AES-256-GCM. Pasted value is shown masked, sent once, then forgotten.
              {org.hasUpstreamAuthHeader && (
                <>
                  {' '}<button type="button" onClick={clearAuthHeader} className="font-medium text-red-600 hover:underline">Clear current</button>
                </>
              )}
            </>
          }
        >
          <Input
            type="password"
            value={authHeader}
            onChange={(e) => setAuthHeader(e.target.value)}
            placeholder={org.hasUpstreamAuthHeader ? '•••••••• (configured — type to replace)' : 'Bearer sk_test_…'}
          />
        </Field>
        <div className="flex items-center justify-between">
          <div className="text-xs">
            Status: {org.upstreamBaseUrl
              ? <Badge tone="success">Configured</Badge>
              : <Badge tone="warning">Not configured</Badge>}
            {org.hasUpstreamAuthHeader && <span className="ml-2"><Badge tone="brand">Auth header set</Badge></span>}
          </div>
          <div className="flex items-center gap-3">
            {msg && (
              <span className={`text-xs ${msg.kind === 'ok' ? 'text-emerald-600' : 'text-red-600'}`}>{msg.text}</span>
            )}
            <Button type="submit" loading={busy}>Save</Button>
          </div>
        </div>
      </form>
    </Card>
  );
}

function SlackCard({ org, onSaved }: { org: Org; onSaved: () => void }) {
  const [bot, setBot] = useState('');
  const [signing, setSigning] = useState('');
  const [channel, setChannel] = useState(org.slackDefaultChannel ?? '');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null);

  async function save(e: FormEvent) {
    e.preventDefault();
    setBusy(true); setMsg(null);
    try {
      const body: any = { slackDefaultChannel: channel || null };
      if (bot.trim()) body.slackBotToken = bot.trim();
      if (signing.trim()) body.slackSigningSecret = signing.trim();
      await api('/orgs/me', { method: 'PATCH', body });
      setBot(''); setSigning('');
      setMsg({ kind: 'ok', text: 'Saved' });
      onSaved();
    } catch (e: any) {
      setMsg({ kind: 'err', text: e?.message ?? 'Save failed' });
    } finally { setBusy(false); }
  }

  return (
    <Card>
      <CardSection
        title="Slack approvals"
        description="Required for MUTATION_APPROVAL rules. Both secrets are AES-256-GCM at rest."
      />
      <form onSubmit={save} className="space-y-4 px-6 py-4">
        <Field
          label="Bot token"
          hint={<>Slack OAuth bot token (xoxb-…). {org.hasSlackBotToken && <span className="text-emerald-600 font-medium">Configured</span>}</>}
        >
          <Input
            type="password"
            value={bot}
            onChange={(e) => setBot(e.target.value)}
            placeholder={org.hasSlackBotToken ? '•••••••• (configured — type to replace)' : 'xoxb-…'}
          />
        </Field>
        <Field
          label="Signing secret"
          hint={<>Used to verify Slack interaction callbacks. {org.hasSlackSigningSecret && <span className="text-emerald-600 font-medium">Configured</span>}</>}
        >
          <Input
            type="password"
            value={signing}
            onChange={(e) => setSigning(e.target.value)}
            placeholder={org.hasSlackSigningSecret ? '•••••••• (configured — type to replace)' : 'a3b…c92'}
          />
        </Field>
        <Field label="Default channel" hint="Used when a MUTATION_APPROVAL rule doesn't specify one">
          <Input value={channel} onChange={(e) => setChannel(e.target.value)} placeholder="#approvals" />
        </Field>
        <div className="flex items-center justify-between">
          <div className="text-xs">
            Status: {org.hasSlackBotToken && org.hasSlackSigningSecret
              ? <Badge tone="success">Connected</Badge>
              : <Badge tone="warning">Incomplete</Badge>}
          </div>
          <div className="flex items-center gap-3">
            {msg && (
              <span className={`text-xs ${msg.kind === 'ok' ? 'text-emerald-600' : 'text-red-600'}`}>{msg.text}</span>
            )}
            <Button type="submit" loading={busy}>Save</Button>
          </div>
        </div>
      </form>
    </Card>
  );
}

function Item({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <dt className="text-xs font-medium uppercase tracking-wider text-slate-500">{label}</dt>
      <dd className="mt-1 text-slate-900">{children}</dd>
    </div>
  );
}
