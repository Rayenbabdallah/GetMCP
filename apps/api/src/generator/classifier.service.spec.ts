import { ClassifierService } from './classifier.service';
import axios from 'axios';

jest.mock('axios');
const mockedAxios = axios as jest.Mocked<typeof axios>;

function fakePrisma() {
  const rows: any[] = [];
  let nextId = 1;
  const prisma: any = {
    endpointClassification: {
      findMany: async ({ where }: any) =>
        rows.filter((r) => r.organizationId === where.organizationId && r.specHash === where.specHash),
      findFirst: async ({ where }: any) =>
        rows.find(
          (r) =>
            r.organizationId === where.organizationId &&
            r.specHash === where.specHash &&
            r.path === where.path &&
            r.method === where.method,
        ) ?? null,
      upsert: async ({ where, create, update }: any) => {
        const key = where.organizationId_specHash_path_method;
        const existing = rows.find(
          (r) =>
            r.organizationId === key.organizationId &&
            r.specHash === key.specHash &&
            r.path === key.path &&
            r.method === key.method,
        );
        if (existing) {
          Object.assign(existing, update);
          return existing;
        }
        const row = { id: `c-${nextId++}`, ...create, overrideExposeExternally: null };
        rows.push(row);
        return row;
      },
      update: async ({ where, data }: any) => {
        const r = rows.find((x) => x.id === where.id);
        if (!r) throw new Error('not found');
        Object.assign(r, data);
        return r;
      },
    },
    $transaction: async (ops: any[]) => Promise.all(ops),
  };
  return { prisma, rows };
}

const sampleSpec = {
  paths: {
    '/v1/charges': { get: { summary: 'list' } },
    '/admin/users': { delete: {} },
    '/v1/customers/{id}': {
      get: { parameters: [{ name: 'id', in: 'path', required: true }] },
    },
  },
};

describe('ClassifierService — heuristic path (no API key)', () => {
  beforeEach(() => {
    delete process.env.ANTHROPIC_API_KEY;
    jest.clearAllMocks();
  });

  it('classifies every endpoint and persists with classifierSource=heuristic', async () => {
    const { prisma, rows } = fakePrisma();
    const svc = new ClassifierService(prisma);
    const result = await svc.classify('org-A', sampleSpec);

    expect(result.cacheHit).toBe(false);
    expect(result.source).toBe('heuristic');
    expect(result.endpoints).toHaveLength(3);
    expect(result.endpoints.every((e) => e.classifierSource === 'heuristic')).toBe(true);
    expect(rows).toHaveLength(3);

    const adminDelete = result.endpoints.find((e) => e.path === '/admin/users')!;
    expect(adminDelete.exposeExternally).toBe(false);

    const tenantGet = result.endpoints.find((e) => e.path === '/v1/customers/{id}')!;
    expect(tenantGet.exposeExternally).toBe(true);
  });

  it('cache hit on second call with same spec — does not re-upsert', async () => {
    const { prisma } = fakePrisma();
    const svc = new ClassifierService(prisma);
    await svc.classify('org-A', sampleSpec);
    const upsertSpy = jest.spyOn(prisma.endpointClassification, 'upsert');
    const second = await svc.classify('org-A', sampleSpec);
    expect(second.cacheHit).toBe(true);
    expect(upsertSpy).not.toHaveBeenCalled();
  });

  it('per-org isolation — org B sees no cache from org A', async () => {
    const { prisma } = fakePrisma();
    const svc = new ClassifierService(prisma);
    await svc.classify('org-A', sampleSpec);
    const r = await svc.classify('org-B', sampleSpec);
    expect(r.cacheHit).toBe(false);
  });
});

describe('ClassifierService — overrides', () => {
  beforeEach(() => {
    delete process.env.ANTHROPIC_API_KEY;
  });

  it('setOverride flips effective verdict; passing null clears the override', async () => {
    const { prisma } = fakePrisma();
    const svc = new ClassifierService(prisma);
    const result = await svc.classify('org-A', sampleSpec);
    const original = result.endpoints.find((e) => e.path === '/admin/users')!;
    expect(original.exposeExternally).toBe(false);
    expect(svc.effectiveVerdict(original)).toBe(false);

    await svc.setOverride({
      organizationId: 'org-A',
      apiKeyId: 'k1',
      specHash: result.specHash,
      path: '/admin/users',
      method: 'delete',
      exposeExternally: true,
      reason: 'we audited it',
    });

    const after = await svc.classify('org-A', sampleSpec);
    const overridden = after.endpoints.find((e) => e.path === '/admin/users')!;
    expect(overridden.exposeExternally).toBe(false); // classifier verdict unchanged
    expect(overridden.overrideExposeExternally).toBe(true);
    expect(svc.effectiveVerdict(overridden)).toBe(true); // effective verdict flipped

    await svc.setOverride({
      organizationId: 'org-A',
      apiKeyId: 'k1',
      specHash: result.specHash,
      path: '/admin/users',
      method: 'delete',
      exposeExternally: null,
    });
    const cleared = await svc.classify('org-A', sampleSpec);
    const ce = cleared.endpoints.find((e) => e.path === '/admin/users')!;
    expect(ce.overrideExposeExternally).toBeNull();
    expect(svc.effectiveVerdict(ce)).toBe(false);
  });
});

describe('ClassifierService — LLM path', () => {
  beforeEach(() => {
    process.env.ANTHROPIC_API_KEY = 'test-key';
    jest.clearAllMocks();
  });
  afterEach(() => {
    delete process.env.ANTHROPIC_API_KEY;
  });

  it('parses Anthropic JSON response and persists with classifierSource=llm', async () => {
    const { prisma } = fakePrisma();
    const svc = new ClassifierService(prisma);
    mockedAxios.post.mockResolvedValue({
      data: {
        content: [
          {
            text: JSON.stringify({
              endpoints: [
                { path: '/v1/charges', method: 'get', dataSensitivity: 30, mutationImpact: 0, hasTenantScope: true, reversible: true, exposeExternally: true, reasoning: 'read-only tenant-scoped' },
                { path: '/admin/users', method: 'delete', dataSensitivity: 95, mutationImpact: 95, hasTenantScope: false, reversible: false, exposeExternally: false, reasoning: 'admin destructive' },
                { path: '/v1/customers/{id}', method: 'get', dataSensitivity: 40, mutationImpact: 0, hasTenantScope: true, reversible: true, exposeExternally: true, reasoning: 'tenant-scoped read' },
              ],
            }),
          },
        ],
      },
    } as any);

    const result = await svc.classify('org-A', sampleSpec);
    expect(result.source).toBe('llm');
    expect(result.endpoints.every((e) => e.classifierSource === 'llm')).toBe(true);
    const charges = result.endpoints.find((e) => e.path === '/v1/charges')!;
    expect(charges.dataSensitivity).toBe(30);
    expect(charges.exposeExternally).toBe(true);
  });

  it('extracts JSON from a markdown-fenced response', async () => {
    const { prisma } = fakePrisma();
    const svc = new ClassifierService(prisma);
    mockedAxios.post.mockResolvedValue({
      data: {
        content: [
          {
            text:
              '```json\n' +
              JSON.stringify({
                endpoints: [
                  { path: '/v1/charges', method: 'get', dataSensitivity: 0, mutationImpact: 0, hasTenantScope: true, reversible: true, exposeExternally: true, reasoning: 'ok' },
                  { path: '/admin/users', method: 'delete', dataSensitivity: 99, mutationImpact: 99, hasTenantScope: false, reversible: false, exposeExternally: false, reasoning: 'no' },
                  { path: '/v1/customers/{id}', method: 'get', dataSensitivity: 0, mutationImpact: 0, hasTenantScope: true, reversible: true, exposeExternally: true, reasoning: 'ok' },
                ],
              }) +
              '\n```',
          },
        ],
      },
    } as any);
    const result = await svc.classify('org-A', sampleSpec);
    expect(result.endpoints).toHaveLength(3);
  });

  it('falls back to heuristic when LLM call throws', async () => {
    const { prisma } = fakePrisma();
    const svc = new ClassifierService(prisma);
    mockedAxios.post.mockRejectedValue(new Error('Anthropic 503'));
    const result = await svc.classify('org-A', sampleSpec);
    expect(result.endpoints.every((e) => e.classifierSource === 'heuristic')).toBe(true);
  });

  it('clamps out-of-range scores from the model', async () => {
    const { prisma } = fakePrisma();
    const svc = new ClassifierService(prisma);
    mockedAxios.post.mockResolvedValue({
      data: {
        content: [
          {
            text: JSON.stringify({
              endpoints: [
                { path: '/v1/charges', method: 'get', dataSensitivity: 999, mutationImpact: -50, hasTenantScope: true, reversible: true, exposeExternally: true, reasoning: 'x' },
                { path: '/admin/users', method: 'delete', dataSensitivity: 100, mutationImpact: 100, hasTenantScope: false, reversible: false, exposeExternally: false, reasoning: 'x' },
                { path: '/v1/customers/{id}', method: 'get', dataSensitivity: 50, mutationImpact: 0, hasTenantScope: true, reversible: true, exposeExternally: true, reasoning: 'x' },
              ],
            }),
          },
        ],
      },
    } as any);
    const result = await svc.classify('org-A', sampleSpec);
    const charges = result.endpoints.find((e) => e.path === '/v1/charges')!;
    expect(charges.dataSensitivity).toBe(100);
    expect(charges.mutationImpact).toBe(0);
  });
});
