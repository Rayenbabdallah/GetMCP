import { specHash } from './spec-hash.util';

const baseSpec: any = {
  info: { title: 'X', version: '1.0' },
  paths: {
    '/v1/charges': {
      get: { summary: 'List charges', tags: ['charges'] },
      post: {
        summary: 'Create charge',
        parameters: [{ name: 'amount', in: 'query', required: true }],
        requestBody: { required: true, content: { 'application/json': {} } },
      },
    },
  },
};

describe('specHash', () => {
  it('produces stable hash regardless of key order', () => {
    const a = specHash(baseSpec);
    const reordered = {
      paths: {
        '/v1/charges': {
          post: { ...baseSpec.paths['/v1/charges'].post },
          get: { ...baseSpec.paths['/v1/charges'].get },
        },
      },
      info: { version: '1.0', title: 'X' },
    };
    expect(specHash(reordered)).toBe(a);
  });

  it('changes when an endpoint is added', () => {
    const a = specHash(baseSpec);
    const withMore = JSON.parse(JSON.stringify(baseSpec));
    withMore.paths['/v1/refunds'] = { post: {} };
    expect(specHash(withMore)).not.toBe(a);
  });

  it('changes when a parameter is added/removed', () => {
    const a = specHash(baseSpec);
    const mod = JSON.parse(JSON.stringify(baseSpec));
    mod.paths['/v1/charges'].post.parameters.push({ name: 'currency', in: 'query', required: false });
    expect(specHash(mod)).not.toBe(a);
  });

  it('does NOT change when only info.version changes', () => {
    const a = specHash(baseSpec);
    const mod = JSON.parse(JSON.stringify(baseSpec));
    mod.info.version = '2.0';
    expect(specHash(mod)).toBe(a);
  });

  it('does NOT change when only descriptions change', () => {
    const a = specHash(baseSpec);
    const mod = JSON.parse(JSON.stringify(baseSpec));
    mod.paths['/v1/charges'].get.description = 'long description here';
    expect(specHash(mod)).toBe(a);
  });

  it('hex sha256 — 64 chars', () => {
    expect(specHash(baseSpec)).toMatch(/^[0-9a-f]{64}$/);
  });
});
