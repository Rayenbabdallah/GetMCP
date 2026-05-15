import { useState } from 'react';
import type { FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { api, ApiError } from '../lib/api';
import { setApiKey, setOrgName } from '../lib/auth';
import { Button } from '../components/ui/Button';
import { Input } from '../components/ui/Input';
import { Field } from '../components/ui/Field';
import { InlineCode } from '../components/ui/CodeBlock';

export function Auth() {
  const navigate = useNavigate();
  const [key, setKey] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      const trimmed = key.trim();
      // Validate against /orgs/me — the simplest authoritative probe.
      setApiKey(trimmed);
      const org = await api<{ name?: string }>('/orgs/me');
      if (org?.name) setOrgName(org.name);
      navigate('/app');
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) {
        setError('That key was rejected. Check it was copied in full and not revoked.');
      } else if (err instanceof Error) {
        setError(err.message);
      } else {
        setError('Something went wrong. Check the API is reachable.');
      }
      setBusy(false);
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-slate-50 p-4">
      <div className="w-full max-w-sm">
        <div className="mb-8 flex items-center justify-center gap-2">
          <div className="flex h-8 w-8 items-center justify-center rounded-md bg-brand-600 text-white text-base font-bold">
            G
          </div>
          <span className="text-lg font-semibold text-slate-900">GetMCP</span>
        </div>

        <div className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
          <h1 className="text-lg font-semibold text-slate-900">Sign in to your organization</h1>
          <p className="mt-1 text-sm text-slate-500">
            Paste an organization API key. Mint one with the seed script or via{' '}
            <InlineCode>POST /api-keys</InlineCode>.
          </p>

          <form onSubmit={onSubmit} className="mt-5 space-y-4">
            <Field label="API key" required hint="Format: gmcp_…">
              <Input
                type="password"
                value={key}
                onChange={(e) => setKey(e.target.value)}
                placeholder="gmcp_xxxxxxxxxxxxxxxxxxxxxxxx"
                autoComplete="off"
                autoFocus
              />
            </Field>
            {error && (
              <div className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
                {error}
              </div>
            )}
            <Button type="submit" loading={busy} disabled={!key.trim()} className="w-full">
              Continue
            </Button>
          </form>
        </div>

        <p className="mt-6 text-center text-xs text-slate-500">
          New to GetMCP? Run <InlineCode>./deploy/scripts/bootstrap.sh</InlineCode> to spin up a
          local instance and seed an org.
        </p>
      </div>
    </div>
  );
}
