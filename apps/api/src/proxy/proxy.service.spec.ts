import 'reflect-metadata';
import { HttpException, HttpStatus } from '@nestjs/common';
import { Readable } from 'stream';
import axios from 'axios';
import { randomBytes } from 'crypto';
import { ProxyService, joinUrl, AgentRequest } from './proxy.service';
import { encryptSecret } from '../crypto.util';

jest.mock('axios');
const mockedAxios = axios as jest.Mocked<typeof axios>;

function makeService(orgRow: any, rules: any[] = []) {
  const prisma: any = {
    policyRule: { findMany: jest.fn().mockResolvedValue(rules) },
    organization: { findUnique: jest.fn().mockResolvedValue(orgRow) },
  };
  return { service: new ProxyService(prisma), prisma };
}

function streamOf(body: string): Readable {
  return Readable.from([Buffer.from(body)]);
}

const baseReq: AgentRequest = {
  organizationId: 'org-1',
  method: 'GET',
  path: '/v1/charges',
  source: 'internal_mcp',
  headers: {},
};

describe('joinUrl', () => {
  it('joins base + path with single slash', () => {
    expect(joinUrl('https://api.stripe.com', '/v1/charges')).toBe('https://api.stripe.com/v1/charges');
    expect(joinUrl('https://api.stripe.com/', '/v1/charges')).toBe('https://api.stripe.com/v1/charges');
    expect(joinUrl('https://api.stripe.com', 'v1/charges')).toBe('https://api.stripe.com/v1/charges');
    expect(joinUrl('https://api.stripe.com/', 'v1/charges')).toBe('https://api.stripe.com/v1/charges');
  });
});

describe('ProxyService.forwardUpstream', () => {
  beforeEach(() => {
    process.env.KEY_ENCRYPTION_KEY = randomBytes(32).toString('hex');
    jest.clearAllMocks();
  });

  it('rejects with 400 when org has no upstreamBaseUrl', async () => {
    const { service } = makeService({ upstreamBaseUrl: null });
    await expect(service.interceptAndExecute(baseReq)).rejects.toMatchObject({
      status: HttpStatus.BAD_REQUEST,
    });
  });

  it('forwards method, URL, query, body and returns upstream status faithfully (incl. 4xx)', async () => {
    const { service } = makeService({
      upstreamBaseUrl: 'https://api.example.com',
      upstreamAuthHeader: null,
      upstreamTimeoutMs: 5000,
    });
    mockedAxios.request.mockResolvedValue({
      status: 404,
      headers: { 'content-type': 'application/json' },
      data: streamOf('{"error":"not_found"}'),
    } as any);

    const out = await service.interceptAndExecute({
      ...baseReq,
      method: 'POST',
      path: '/v1/widgets',
      query: { limit: 10 },
      body: { name: 'x' },
    });

    expect(out.kind).toBe('proxied');
    if (out.kind !== 'proxied') return;
    expect(out.status).toBe(404);
    expect(out.headers['content-type']).toBe('application/json');

    const call = mockedAxios.request.mock.calls[0][0]!;
    expect(call.url).toBe('https://api.example.com/v1/widgets');
    expect(call.method).toBe('POST');
    expect(call.params).toEqual({ limit: 10 });
    expect(call.data).toEqual({ name: 'x' });
    expect(call.timeout).toBe(5000);
    expect(call.responseType).toBe('stream');
  });

  it('strips internal/hop-by-hop headers and never forwards the caller Authorization', async () => {
    const { service } = makeService({
      upstreamBaseUrl: 'https://api.example.com',
      upstreamAuthHeader: null,
      upstreamTimeoutMs: 5000,
    });
    mockedAxios.request.mockResolvedValue({ status: 200, headers: {}, data: streamOf('') } as any);

    await service.interceptAndExecute({
      ...baseReq,
      headers: {
        authorization: 'Bearer caller-token-MUST-NOT-LEAK',
        'x-agent-source': 'internal_mcp',
        'x-agent-reasoning': 'debugging',
        'x-tenant-id': 'tenant-A',
        'x-request-id': 'abc',
        host: 'getmcp.example.com',
        'content-length': '99',
        'transfer-encoding': 'chunked',
        accept: 'application/json',
        'x-custom-passthrough': 'keep-me',
      },
    });

    const sent = mockedAxios.request.mock.calls[0][0]!.headers as Record<string, string>;
    expect(sent.authorization).toBeUndefined();
    expect(sent['x-agent-source']).toBeUndefined();
    expect(sent['x-agent-reasoning']).toBeUndefined();
    expect(sent['x-tenant-id']).toBeUndefined();
    expect(sent['x-request-id']).toBeUndefined();
    expect(sent.host).toBeUndefined();
    expect(sent['content-length']).toBeUndefined();
    expect(sent['transfer-encoding']).toBeUndefined();
    expect(sent.accept).toBe('application/json');
    expect(sent['x-custom-passthrough']).toBe('keep-me');
  });

  it('injects the decrypted upstream Authorization header', async () => {
    const stored = encryptSecret('Bearer sk_test_real_upstream_token');
    const { service } = makeService({
      upstreamBaseUrl: 'https://api.example.com',
      upstreamAuthHeader: stored,
      upstreamTimeoutMs: 5000,
    });
    mockedAxios.request.mockResolvedValue({ status: 200, headers: {}, data: streamOf('') } as any);

    await service.interceptAndExecute(baseReq);

    const sent = mockedAxios.request.mock.calls[0][0]!.headers as Record<string, string>;
    expect(sent['Authorization']).toBe('Bearer sk_test_real_upstream_token');
  });

  it('maps timeouts to 504, not 500', async () => {
    const { service } = makeService({
      upstreamBaseUrl: 'https://api.example.com',
      upstreamAuthHeader: null,
      upstreamTimeoutMs: 100,
    });
    const err: any = new Error('timeout of 100ms exceeded');
    err.code = 'ECONNABORTED';
    err.isAxiosError = true;
    mockedAxios.request.mockRejectedValue(err);

    await expect(service.interceptAndExecute(baseReq)).rejects.toMatchObject({
      status: HttpStatus.GATEWAY_TIMEOUT,
    });
  });

  it('maps connection errors to 502 Bad Gateway', async () => {
    const { service } = makeService({
      upstreamBaseUrl: 'https://api.example.com',
      upstreamAuthHeader: null,
      upstreamTimeoutMs: 5000,
    });
    const err: any = new Error('connect ECONNREFUSED');
    err.code = 'ECONNREFUSED';
    err.isAxiosError = true;
    mockedAxios.request.mockRejectedValue(err);

    await expect(service.interceptAndExecute(baseReq)).rejects.toMatchObject({
      status: HttpStatus.BAD_GATEWAY,
    });
  });

  it('strips hop-by-hop response headers from the pass-through', async () => {
    const { service } = makeService({
      upstreamBaseUrl: 'https://api.example.com',
      upstreamAuthHeader: null,
      upstreamTimeoutMs: 5000,
    });
    mockedAxios.request.mockResolvedValue({
      status: 200,
      headers: {
        'content-type': 'application/json',
        'transfer-encoding': 'chunked',
        connection: 'keep-alive',
        'x-stripe-id': 'req_abc',
      },
      data: streamOf('{"ok":true}'),
    } as any);

    const out = await service.interceptAndExecute(baseReq);
    if (out.kind !== 'proxied') throw new Error();
    expect(out.headers['content-type']).toBe('application/json');
    expect(out.headers['x-stripe-id']).toBe('req_abc');
    expect(out.headers['transfer-encoding']).toBeUndefined();
    expect(out.headers['connection']).toBeUndefined();
  });
});

describe('ProxyService.interceptAndExecute — policy short-circuits remain', () => {
  beforeEach(() => {
    process.env.KEY_ENCRYPTION_KEY = randomBytes(32).toString('hex');
    jest.clearAllMocks();
  });

  it('MUTATION_APPROVAL returns a policy outcome and never calls upstream', async () => {
    const { service } = makeService(
      { upstreamBaseUrl: 'https://api.example.com', upstreamAuthHeader: null, upstreamTimeoutMs: 5000 },
      [
        {
          ruleType: 'MUTATION_APPROVAL',
          targetMethod: 'POST',
          targetPath: '/v1/refunds',
          name: 'r',
          description: 'd',
          actionConfig: { channel: '#ops' },
        },
      ],
    );
    const out = await service.interceptAndExecute({
      ...baseReq,
      source: 'external_mcp',
      method: 'POST',
      path: '/v1/refunds',
    });
    expect(out.kind).toBe('policy');
    if (out.kind !== 'policy') return;
    expect(out.status).toBe('AWAITING_APPROVAL');
    expect(mockedAxios.request).not.toHaveBeenCalled();
  });

  it('AUDIT rule blocks with 403 when reasoning header is missing', async () => {
    const { service } = makeService(
      { upstreamBaseUrl: 'https://api.example.com', upstreamAuthHeader: null, upstreamTimeoutMs: 5000 },
      [
        {
          ruleType: 'AUDIT',
          targetMethod: '*',
          targetPath: '*',
          name: 'audit',
          description: 'reasoning required',
          actionConfig: {},
        },
      ],
    );
    await expect(
      service.interceptAndExecute({ ...baseReq, source: 'external_mcp', headers: {} }),
    ).rejects.toMatchObject({ status: HttpStatus.FORBIDDEN });
    expect(mockedAxios.request).not.toHaveBeenCalled();
  });
});
