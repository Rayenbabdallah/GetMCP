// End to end: generate a server from a spec, start it, and drive it with the
// real MCP client against a local echo API. Proves credentials, query params
// and request bodies go out the way the spec says.

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

const CLI = fileURLToPath(new URL('../bin/getmcp.mjs', import.meta.url));
// Inside cli/ so the generated server resolves the SDK from cli/node_modules.
const TMP = fileURLToPath(new URL('./.tmp-e2e', import.meta.url));

let echo;
let base;

before(async () => {
  rmSync(TMP, { recursive: true, force: true });
  mkdirSync(TMP, { recursive: true });
  echo = http.createServer((req, res) => {
    let body = '';
    req.on('data', (d) => (body += d));
    req.on('end', () => {
      res.setHeader('content-type', 'application/json');
      res.end(JSON.stringify({ method: req.method, url: req.url, headers: req.headers, body }));
    });
  });
  await new Promise((resolve) => echo.listen(0, '127.0.0.1', resolve));
  base = `http://127.0.0.1:${echo.address().port}`;
});

after(() => {
  echo.close();
  rmSync(TMP, { recursive: true, force: true });
});

const makeSpec = (securitySchemes) => ({
  openapi: '3.0.0',
  info: { title: 'Echo', version: '1' },
  servers: [{ url: base }],
  components: { securitySchemes },
  paths: {
    '/things/{id}': {
      get: {
        operationId: 'getThing',
        parameters: [
          { name: 'id', in: 'path', required: true, schema: { type: 'string' } },
          { name: 'tags', in: 'query', schema: { type: 'array', items: { type: 'string' } } },
          { name: 'created', in: 'query', style: 'deepObject', schema: { type: 'object', properties: { gte: { type: 'integer' } } } },
        ],
      },
      delete: { operationId: 'deleteThing' },
    },
    '/things': {
      post: {
        operationId: 'createThing',
        requestBody: { required: true, content: { 'application/json': { schema: { type: 'object', properties: { name: { type: 'string' } } } } } },
      },
    },
    '/forms': {
      post: {
        operationId: 'createForm',
        requestBody: {
          content: { 'application/x-www-form-urlencoded': { schema: { type: 'object', properties: { meta: { type: 'object' }, n: { type: 'integer' } } } } },
        },
      },
    },
  },
});

async function withServer(kind, securitySchemes, env, fn) {
  const dir = join(TMP, kind);
  mkdirSync(dir, { recursive: true });
  const specFile = join(dir, 'spec.json');
  writeFileSync(specFile, JSON.stringify(makeSpec(securitySchemes)));
  execFileSync(process.execPath, [CLI, specFile, '--out', join(dir, 'server'), '--all'], { stdio: 'ignore' });

  const client = new Client({ name: 'e2e', version: '0' });
  await client.connect(
    new StdioClientTransport({ command: process.execPath, args: [join(dir, 'server', 'server.mjs')], env: { ...process.env, ...env }, stderr: 'ignore' }),
  );
  const call = async (name, args = {}) => {
    const res = await client.callTool({ name, arguments: args });
    const text = res.content[0].text;
    return { isError: Boolean(res.isError), text, echoed: text.startsWith('HTTP ') ? JSON.parse(text.replace(/^HTTP \d+\n/, '')) : null };
  };
  try {
    await fn({ client, call });
  } finally {
    await client.close();
  }
}

test('lists only safe tools and forwards params and bodies correctly', async () => {
  await withServer('bearer', { a: { type: 'http', scheme: 'bearer' } }, { API_KEY: 'K3Y' }, async ({ client, call }) => {
    const { tools } = await client.listTools();
    assert.deepEqual(tools.map((t) => t.name).sort(), ['create_form', 'create_thing', 'get_thing']);
    assert.equal(tools.find((t) => t.name === 'get_thing').annotations.readOnlyHint, true);

    const get = (await call('get_thing', { id: 'a b', tags: ['x', 'y'], created: { gte: 5 } })).echoed;
    assert.equal(get.headers.authorization, 'Bearer K3Y');
    assert.ok(get.url.startsWith('/things/a%20b'));
    assert.ok(get.url.includes('tags=x&tags=y'));
    assert.ok(decodeURIComponent(get.url).includes('created[gte]=5'));

    const post = (await call('create_thing', { body: { name: 'n' } })).echoed;
    assert.equal(post.method, 'POST');
    assert.equal(post.body, '{"name":"n"}');
    assert.equal(post.headers['content-type'], 'application/json');

    const form = (await call('create_form', { body: { meta: { k: 'v' }, n: 2 } })).echoed;
    assert.equal(decodeURIComponent(form.body), 'meta[k]=v&n=2');

    const unknown = await call('delete_thing');
    assert.equal(unknown.isError, true);
  });
});

test('sends the API key the way each security scheme asks', async () => {
  await withServer('header', { a: { type: 'apiKey', in: 'header', name: 'X-Api-Key' } }, { API_KEY: 'K3Y' }, async ({ call }) => {
    const { headers } = (await call('get_thing', { id: '1' })).echoed;
    assert.equal(headers['x-api-key'], 'K3Y');
    assert.equal(headers.authorization, undefined);
  });
  await withServer('query', { a: { type: 'apiKey', in: 'query', name: 'api_key' } }, { API_KEY: 'K3Y' }, async ({ call }) => {
    assert.ok((await call('get_thing', { id: '1' })).echoed.url.includes('api_key=K3Y'));
  });
  await withServer('basic', { a: { type: 'http', scheme: 'basic' } }, { API_KEY: 'K3Y' }, async ({ call }) => {
    const expected = 'Basic ' + Buffer.from('K3Y:').toString('base64');
    assert.equal((await call('get_thing', { id: '1' })).echoed.headers.authorization, expected);
  });
});

test('GETMCP_READ_ONLY hides and refuses writes', async () => {
  await withServer('readonly', {}, { GETMCP_READ_ONLY: '1' }, async ({ client, call }) => {
    const { tools } = await client.listTools();
    assert.deepEqual(tools.map((t) => t.name), ['get_thing']);
    const refused = await call('create_thing', { body: { name: 'n' } });
    assert.equal(refused.isError, true);
    assert.match(refused.text, /Refused/);
  });
});
