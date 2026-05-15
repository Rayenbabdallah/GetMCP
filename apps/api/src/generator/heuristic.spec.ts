import { heuristicClassify } from './heuristic';

describe('heuristicClassify', () => {
  it('marks /admin paths as not-external regardless of verb', () => {
    const v = heuristicClassify('/admin/users', 'get', {});
    expect(v.exposeExternally).toBe(false);
    expect(v.dataSensitivity).toBeGreaterThanOrEqual(80);
  });

  it('marks DELETE as dangerous + irreversible', () => {
    const v = heuristicClassify('/v1/charges/{id}', 'delete', {});
    expect(v.exposeExternally).toBe(false);
    expect(v.reversible).toBe(false);
    expect(v.mutationImpact).toBeGreaterThanOrEqual(80);
  });

  it('treats GET on a tenant-scoped resource as exposable', () => {
    const v = heuristicClassify('/v1/customers/{customer_id}', 'get', {
      parameters: [{ name: 'customer_id', in: 'path', required: true }],
    });
    expect(v.exposeExternally).toBe(true);
    expect(v.hasTenantScope).toBe(true);
  });

  it('blocks POST without tenant scope as global mutation', () => {
    const v = heuristicClassify('/v1/transfers', 'post', { parameters: [] });
    expect(v.exposeExternally).toBe(false);
    expect(v.reasoning).toMatch(/tenant scope/i);
  });

  it('flags PII parameters as sensitive', () => {
    const v = heuristicClassify('/v1/lookup', 'get', {
      parameters: [{ name: 'ssn', in: 'query' }],
    });
    expect(v.exposeExternally).toBe(false);
    expect(v.dataSensitivity).toBeGreaterThanOrEqual(90);
  });

  it('output reasoning is human-readable', () => {
    const v = heuristicClassify('/admin/internal', 'delete', {});
    expect(v.reasoning).toMatch(/heuristic:/);
  });
});
