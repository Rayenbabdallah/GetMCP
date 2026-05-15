import { useState } from 'react';
import { api, downloadUrl } from '../lib/api';
import { PageHeader } from '../components/Layout';
import { Card, CardSection } from '../components/ui/Card';
import { Button } from '../components/ui/Button';
import { Badge } from '../components/ui/Badge';
import { Field } from '../components/ui/Field';
import { Input } from '../components/ui/Input';
import { Toggle } from '../components/ui/Toggle';
import { Table, TBody, TD, TH, THead, TR } from '../components/ui/Table';
import { EmptyState } from '../components/ui/EmptyState';
import { getApiKey } from '../lib/auth';

interface Endpoint {
  path: string;
  method: string;
  dataSensitivity: number;
  mutationImpact: number;
  hasTenantScope: boolean;
  reversible: boolean;
  exposeExternally: boolean;
  reasoning: string;
  classifierSource: 'llm' | 'heuristic';
  overrideExposeExternally: boolean | null;
}

interface ClassifyResult {
  specHash: string;
  source: 'llm' | 'heuristic';
  cacheHit: boolean;
  endpoints: Endpoint[];
}

export function Generator() {
  const [url, setUrl] = useState('https://petstore3.swagger.io/api/v3/openapi.json');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<ClassifyResult | null>(null);

  async function classify() {
    setBusy(true); setError(null);
    try {
      const r = await api<ClassifyResult>('/generator/classify', {
        method: 'POST', body: { openapiUrl: url },
      });
      setResult(r);
    } catch (e: any) {
      setError(e?.message ?? 'classify failed');
    } finally { setBusy(false); }
  }

  async function override(ep: Endpoint, exposeExternally: boolean | null) {
    if (!result) return;
    await api('/generator/override', {
      method: 'POST',
      body: { specHash: result.specHash, path: ep.path, method: ep.method, exposeExternally },
    });
    setResult({
      ...result,
      endpoints: result.endpoints.map((e) =>
        e.path === ep.path && e.method === ep.method
          ? { ...e, overrideExposeExternally: exposeExternally }
          : e,
      ),
    });
  }

  function effectiveExternal(ep: Endpoint): boolean {
    return ep.overrideExposeExternally ?? ep.exposeExternally;
  }

  function exportZip() {
    fetch(downloadUrl('/generator/export', { openapiUrl: url }), {
      headers: { Authorization: `Bearer ${getApiKey()}` },
    }).then((r) => r.blob()).then((blob) => {
      const u = URL.createObjectURL(blob);
      const a = document.createElement('a'); a.href = u; a.download = 'getmcp.zip'; a.click();
      URL.revokeObjectURL(u);
    });
  }

  const externalCount = result?.endpoints.filter(effectiveExternal).length ?? 0;
  const internalCount = result?.endpoints.length ?? 0;

  return (
    <>
      <PageHeader
        title="Generator"
        description="Classify an OpenAPI spec, review the verdict, override per endpoint, then export runnable MCP servers."
      />

      <Card className="mb-6">
        <CardSection title="Source spec" description="Public URL to an OpenAPI 3.x JSON document">
          <div className="flex items-end gap-3">
            <div className="flex-1">
              <Field label="OpenAPI URL" required>
                <Input value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://…/openapi.json" />
              </Field>
            </div>
            <Button onClick={classify} loading={busy} disabled={!url.trim()}>
              {result ? 'Re-classify' : 'Classify'}
            </Button>
          </div>
          {error && (
            <div className="mt-3 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{error}</div>
          )}
        </CardSection>
      </Card>

      {result && (
        <>
          <div className="mb-4 grid grid-cols-1 gap-4 sm:grid-cols-3">
            <SummaryTile label="Total endpoints" value={String(internalCount)} sub="Internal MCP" />
            <SummaryTile label="Customer-safe" value={String(externalCount)} sub="External MCP" tone="success" />
            <SummaryTile
              label="Classifier"
              value={result.source === 'llm' ? 'Claude' : 'Heuristic'}
              sub={result.cacheHit ? 'Cached for spec hash' : 'Fresh run'}
              tone={result.source === 'llm' ? 'brand' : 'neutral'}
            />
          </div>

          <div className="mb-6 flex items-center justify-end gap-2">
            <Button variant="secondary" onClick={exportZip}>Download MCP scaffold (.zip)</Button>
          </div>

          <Card>
            {result.endpoints.length === 0 ? (
              <EmptyState title="No endpoints" description="The spec has no paths to classify." />
            ) : (
              <Table>
                <THead>
                  <TR>
                    <TH>Endpoint</TH>
                    <TH>Risk</TH>
                    <TH>Reasoning</TH>
                    <TH className="text-right">Source</TH>
                    <TH className="text-right">Expose externally</TH>
                  </TR>
                </THead>
                <TBody>
                  {result.endpoints.map((ep) => {
                    const eff = effectiveExternal(ep);
                    return (
                      <TR key={`${ep.method} ${ep.path}`}>
                        <TD>
                          <code className="font-mono text-xs">
                            <span className="text-slate-400">{ep.method.toUpperCase()}</span> {ep.path}
                          </code>
                        </TD>
                        <TD>
                          <div className="flex gap-1">
                            <RiskPip label="Sens" value={ep.dataSensitivity} />
                            <RiskPip label="Mut" value={ep.mutationImpact} />
                            {!ep.hasTenantScope && <Badge tone="neutral">no tenant</Badge>}
                            {!ep.reversible && <Badge tone="warning">irreversible</Badge>}
                          </div>
                        </TD>
                        <TD className="max-w-sm text-xs text-slate-500">{ep.reasoning}</TD>
                        <TD className="text-right">
                          <Badge tone={ep.classifierSource === 'llm' ? 'brand' : 'neutral'}>
                            {ep.classifierSource}
                          </Badge>
                        </TD>
                        <TD className="text-right">
                          <div className="inline-flex items-center gap-2">
                            {ep.overrideExposeExternally !== null && (
                              <button
                                onClick={() => override(ep, null)}
                                className="text-[10px] uppercase tracking-wider text-slate-400 hover:text-slate-700"
                                title="Clear override"
                              >
                                clear
                              </button>
                            )}
                            <Toggle
                              checked={eff}
                              onChange={(next) => override(ep, next)}
                              label={`Toggle ${ep.method} ${ep.path}`}
                            />
                          </div>
                        </TD>
                      </TR>
                    );
                  })}
                </TBody>
              </Table>
            )}
          </Card>

          <div className="mt-6 text-xs text-slate-500">
            Spec hash: <code className="font-mono">{result.specHash}</code> — reusing the same spec will hit cache.
          </div>
        </>
      )}

      {!result && (
        <Card>
          <EmptyState
            title="Classify a spec to get started"
            description={
              <>
                Set <code className="font-mono">ANTHROPIC_API_KEY</code> on the API to get LLM classifications;
                without it, GetMCP falls back to keyword heuristics.
              </>
            }
          />
        </Card>
      )}
    </>
  );
}

function SummaryTile({ label, value, sub, tone = 'neutral' }: { label: string; value: string; sub: string; tone?: 'success' | 'brand' | 'neutral' }) {
  const ring = tone === 'success' ? 'ring-emerald-100' : tone === 'brand' ? 'ring-brand-100' : 'ring-slate-200';
  return (
    <Card className={`p-5 ring-1 ${ring}`}>
      <div className="text-xs font-medium uppercase tracking-wider text-slate-500">{label}</div>
      <div className="mt-1 text-2xl font-semibold text-slate-900">{value}</div>
      <div className="mt-1 text-xs text-slate-500">{sub}</div>
    </Card>
  );
}

function RiskPip({ label, value }: { label: string; value: number }) {
  const tone = value >= 70 ? 'danger' : value >= 40 ? 'warning' : 'success';
  return <Badge tone={tone}>{label} {value}</Badge>;
}
