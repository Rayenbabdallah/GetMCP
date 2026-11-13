import { test } from 'node:test';
import assert from 'node:assert/strict';
import { analyze, classify, compactSchema, listOperations } from '../src/analyze.mjs';

const spec = {
  openapi: '3.0.0',
  info: { title: 'Shop', version: '1' },
  servers: [{ url: 'https://api.shop.test' }],
  components: {
    schemas: {
      Node: { type: 'object', properties: { name: { type: 'string' }, child: { $ref: '#/components/schemas/Node' } } },
    },
  },
  paths: {
    '/orders': {
      get: { operationId: 'listOrders', summary: 'List orders' },
      post: {
        operationId: 'createOrder',
        requestBody: { required: true, content: { 'application/json': { schema: { $ref: '#/components/schemas/Node' } } } },
      },
    },
    '/orders/{id}': {
      parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
      get: { operationId: 'getOrder' },
      delete: { operationId: 'deleteOrder' },
    },
    '/orders/{id}/cancel': { post: { operationId: 'cancelOrder' } },
    '/orders/{id}/refunds': { post: { operationId: 'createRefund' } },
    '/admin/users': { get: { operationId: 'adminListUsers' } },
    '/api_keys': { get: { operationId: 'listApiKeys' } },
    '/webhooks': { post: { operationId: 'createWebhook' } },
    '/legacy': { get: { operationId: 'legacy', deprecated: true } },
    '/login': { post: { parameters: [{ name: 'password', in: 'query' }] } },
    '/files': { post: { requestBody: { content: { 'multipart/form-data': { schema: {} } } } } },
    '/catalogs': { get: { operationId: 'listCatalogs' } },
    '/pages': { get: { parameters: [{ name: 'page_token', in: 'query' }] } },
  },
};

const verdict = (method, path) => {
  const o = listOperations(spec).find((x) => x.method === method && x.path === path);
  return classify(spec, o).excluded?.category ?? null;
};

test('classifies each risk category', () => {
  assert.equal(verdict('delete', '/orders/{id}'), 'destructive');
  assert.equal(verdict('post', '/orders/{id}/cancel'), 'destructive');
  assert.equal(verdict('post', '/orders/{id}/refunds'), 'money');
  assert.equal(verdict('get', '/admin/users'), 'admin');
  assert.equal(verdict('get', '/api_keys'), 'credentials');
  assert.equal(verdict('post', '/webhooks'), 'webhooks');
  assert.equal(verdict('get', '/legacy'), 'deprecated');
  assert.equal(verdict('post', '/login'), 'credentials');
  assert.equal(verdict('post', '/files'), 'unsupported');
});

test('does not flag lookalikes', () => {
  assert.equal(verdict('get', '/orders'), null);
  assert.equal(verdict('post', '/orders'), null);
  assert.equal(verdict('get', '/catalogs'), null, '"catalogs" must not match "logs"-style keywords');
  assert.equal(verdict('get', '/pages'), null, 'a pagination token is not a credential');
});

test('analyze keeps only safe tools and honours --max, --read-only, --allow', () => {
  const r = analyze(spec, { max: 3 });
  assert.equal(r.tools.length, 3);
  assert.equal(r.counts.operations, 14);
  assert.equal(r.counts.excluded, 9);
  for (const t of r.tools) assert.ok(['/orders', '/orders/{id}', '/catalogs', '/pages'].includes(t.route.path));

  const ro = analyze(spec, { readOnly: true });
  assert.ok(ro.tools.every((t) => t.annotations.readOnlyHint));

  const allowed = analyze(spec, { allow: ['destructive'], all: true });
  assert.ok(allowed.tools.some((t) => t.route.method === 'DELETE'));
});

test('tool definitions are client-safe', () => {
  const long = { openapi: '3.0.0', info: {}, paths: { '/a': { get: { operationId: 'x'.repeat(40) + 'Y'.repeat(40) } }, '/b': { get: { operationId: 'x'.repeat(40) + 'Y'.repeat(40) } } } };
  const names = analyze(long).tools.map((t) => t.name);
  assert.equal(new Set(names).size, 2);
  for (const n of names) assert.match(n, /^[a-z0-9_]{1,64}$/);

  const create = analyze(spec, { all: true }).tools.find((t) => t.name === 'create_order');
  assert.deepEqual(create.route.body, { arg: 'body', encoding: 'json' });
  assert.deepEqual(create.inputSchema.required, ['body']);
});

test('compactSchema terminates on recursive schemas', () => {
  const out = compactSchema(spec, { $ref: '#/components/schemas/Node' }, 5);
  assert.equal(out.type, 'object');
  assert.deepEqual(out.properties.child, {});
});
