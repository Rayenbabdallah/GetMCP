// The three decisions GetMCP makes about every operation in a spec:
//   1. classify — is it safe to hand to an agent at all, and if not, why?
//   2. curate   — of the safe ones, which few are worth an agent's context?
//   3. describe — what does the MCP tool definition look like?
//
// Everything here is deterministic and offline: no LLM, no network.

import { METHODS, deref, words, stem, findWord, plain, clip } from './spec.mjs';

// ───────────────────────────── 1. classify ─────────────────────────────

export const CATEGORIES = {
  destructive: 'destructive or irreversible',
  money: 'moves money',
  admin: 'admin / internal',
  credentials: 'credentials & secrets',
  webhooks: 'webhooks (data can be redirected out)',
  deprecated: 'deprecated',
  unsupported: 'binary upload (not callable as a JSON tool)',
};

const ADMIN_WORDS = new Set([
  'admin', 'administrator', 'internal', 'sudo', 'superuser', 'impersonate', 'impersonation', 'scim', 'debug', 'audit',
]);
const CREDENTIAL_WORDS = new Set([
  'password', 'passwd', 'secret', 'token', 'credential', 'key', 'apikey', 'oauth', 'otp', 'mfa', 'sso', 'saml',
]);
const WEBHOOK_WORDS = new Set(['webhook', 'hook']);
const DESTRUCTIVE_WORDS = new Set([
  'delete', 'remove', 'destroy', 'purge', 'revoke', 'cancel', 'void', 'archive', 'transfer', 'disable', 'suspend',
  'block', 'ban', 'lock', 'reset', 'rotate', 'terminate', 'wipe', 'erase', 'expire', 'merge', 'force',
]);
const MONEY_WORDS = new Set([
  'refund', 'payout', 'capture', 'pay', 'charge', 'payment', 'topup', 'withdraw', 'withdrawal', 'debit', 'credit',
]);
const SECRET_PARAMS = new Set([
  'password', 'secret', 'ssn', 'socialsecurity', 'socialsecuritynumber', 'cardnumber', 'creditcard', 'cvc', 'cvv',
  'privatekey', 'clientsecret', 'apikey', 'accesstoken', 'refreshtoken',
]);

const isParam = (seg) => /^\{.*\}$/.test(seg) || seg.startsWith(':');
const VERSIONISH = /^(v\d+(\.\d+)*|api|rest|\d{4}-\d{2}-\d{2})$/i;

export function staticSegments(path) {
  return path.split('/').filter((s) => s && !isParam(s) && !VERSIONISH.test(s));
}

/** Every callable operation in the spec, with path-level parameters merged in. */
export function listOperations(spec) {
  const ops = [];
  for (const [path, rawItem] of Object.entries(spec.paths ?? {})) {
    const item = deref(spec, rawItem);
    if (!item || typeof item !== 'object') continue;
    for (const method of METHODS) {
      const op = item[method];
      if (!op || typeof op !== 'object') continue;
      const byKey = new Map();
      for (const p of [...(item.parameters ?? []), ...(op.parameters ?? [])]) {
        const param = deref(spec, p);
        if (param?.name && param.in) byKey.set(`${param.in}:${param.name}`, param);
      }
      ops.push({ path, method, op, params: [...byKey.values()] });
    }
  }
  return ops;
}

/** Which request body, if any, can we send? */
export function bodyOf(spec, o) {
  if (o.method === 'get' || o.method === 'delete') return null;

  const rb = deref(spec, o.op.requestBody);
  if (rb?.content && typeof rb.content === 'object') {
    const types = Object.keys(rb.content);
    const json = types.find((t) => /json/i.test(t));
    const form = types.find((t) => /x-www-form-urlencoded/i.test(t));
    const picked = json ?? form;
    if (picked) {
      return { encoding: json ? 'json' : 'form', schema: rb.content[picked].schema, required: Boolean(rb.required) };
    }
    if (types.length) return { encoding: 'unsupported', required: Boolean(rb.required), types };
  }

  // Swagger 2
  const bodyParam = o.params.find((p) => p.in === 'body');
  if (bodyParam) return { encoding: 'json', schema: bodyParam.schema, required: Boolean(bodyParam.required) };
  const formParams = o.params.filter((p) => p.in === 'formData');
  if (formParams.length) {
    if (formParams.some((p) => p.type === 'file')) {
      return { encoding: 'unsupported', required: formParams.some((p) => p.type === 'file' && p.required), types: ['multipart/form-data'] };
    }
    const properties = {};
    for (const p of formParams) properties[p.name] = { type: p.type ?? 'string', description: p.description };
    return {
      encoding: 'form',
      schema: { type: 'object', properties, required: formParams.filter((p) => p.required).map((p) => p.name) },
      required: formParams.some((p) => p.required),
    };
  }
  return null;
}

/**
 * tier:      'read' | 'write'
 * excluded:  null, or { category, reason } explaining why an agent should not get this.
 */
export function classify(spec, o) {
  const tier = o.method === 'get' ? 'read' : 'write';
  const segs = staticSegments(o.path);
  const pathWords = segs.flatMap(words);
  const idWords = words(o.op.operationId);
  const tagWords = (Array.isArray(o.op.tags) ? o.op.tags : []).flatMap(words);
  const context = [...pathWords, ...idWords, ...tagWords];
  const out = (category, reason) => ({ tier, excluded: { category, reason } });

  if (o.op.deprecated) return out('deprecated', 'marked deprecated in the spec');

  let hit = findWord(context, ADMIN_WORDS);
  if (hit) return out('admin', `"${hit}" in path, operation id or tags`);

  hit = findWord(context, CREDENTIAL_WORDS);
  if (hit) return out('credentials', `"${hit}" in path, operation id or tags`);

  hit = findWord(context, WEBHOOK_WORDS);
  if (hit) return out('webhooks', `"${hit}" in path, operation id or tags`);

  if (o.method === 'delete') return out('destructive', 'DELETE request');

  if (tier === 'write') {
    const action = [...words(segs[segs.length - 1]), ...idWords];
    hit = findWord(action, DESTRUCTIVE_WORDS);
    if (hit) return out('destructive', `"${hit}" action`);

    hit = findWord(context, MONEY_WORDS);
    if (hit) return out('money', `write to a "${hit}" resource`);
  }

  const secretParam = o.params.find((p) => SECRET_PARAMS.has(String(p.name).toLowerCase().replace(/[^a-z]/g, '')));
  if (secretParam) return out('credentials', `takes a "${secretParam.name}" parameter`);

  const body = bodyOf(spec, o);
  if (body?.encoding === 'unsupported') {
    return out('unsupported', `request body is ${body.types.join(', ')}`);
  }

  return { tier, excluded: null };
}

// ───────────────────────────── 2. curate ─────────────────────────────

const NOISE_WORDS = new Set([
  'health', 'healthz', 'ping', 'status', 'version', 'meta', 'zen', 'emoji', 'feed', 'octocat', 'openapi', 'swagger',
  'docs', 'known', 'ratelimit', 'rate', 'robots', 'favicon', 'metrics',
]);

export function groupOf(o) {
  const tag = Array.isArray(o.op.tags) ? o.op.tags[0] : null;
  return String(tag ?? staticSegments(o.path)[0] ?? 'root').toLowerCase();
}

function shapeOf(o) {
  const segs = o.path.split('/').filter(Boolean);
  const endsOnItem = segs.length > 0 && isParam(segs[segs.length - 1]);
  if (o.method === 'get') return endsOnItem ? 'get' : 'list';
  if (o.method === 'post') return endsOnItem ? 'update' : 'create';
  return 'update';
}

/**
 * Score how useful an operation is likely to be to an agent, using only the
 * shape of the API:
 *   - hub-ness: a path that many other paths hang off is a core resource
 *   - shallowness: /issues beats /repos/x/actions/runs/y/jobs/z/logs
 *   - CRUD shape: list / get / create / update / search over odd one-offs
 */
export function scoreOperations(candidates, allPaths) {
  const descendants = new Map();
  const unique = [...new Set(allPaths)];
  for (const p of new Set(candidates.map((c) => c.path))) {
    const prefix = p.endsWith('/') ? p : p + '/';
    let n = 0;
    for (const q of unique) if (q.startsWith(prefix)) n++;
    descendants.set(p, n);
  }

  return candidates.map((c) => {
    const segs = staticSegments(c.path);
    const pathWords = segs.flatMap(words);
    const shape = shapeOf(c);
    let score = { list: 3, get: 3, create: 3, update: 1 }[shape];
    const isSearch = pathWords.includes('search') || words(c.op.operationId).includes('search');
    if (isSearch) score += 3;
    if (segs.length === 0) {
      score -= 6; // the API root is an index page, not a resource
    } else {
      // Editing a hub resource is a settings change, so it earns less of the hub bonus.
      const hub = Math.min(10, 1.3 * Math.log2(1 + (descendants.get(c.path) ?? 0)));
      score += shape === 'update' ? 0.4 * hub : hub;
    }
    score -= 1.5 * Math.max(0, segs.length - 2);
    if (c.op.summary || c.op.description) score += 0.5;
    if (c.tier === 'read') score += 1;
    if (findWord(pathWords, NOISE_WORDS)) score -= 6;
    return { ...c, shape, score, isSearch };
  });
}

/**
 * Greedy pick of the top `max`. Three things keep the set balanced:
 *   - diminishing returns per resource group, with a hard cap
 *   - a cap on search endpoints, which otherwise crowd everything out
 *   - a nudge so roughly a third of the tools can act, not just read
 */
export function curate(scored, max, { group = groupOf, cap = Math.max(2, Math.ceil(max / 4)) } = {}) {
  const pool = [...scored];
  const picked = [];
  const perGroup = new Map();
  const searchCap = Math.max(2, Math.round(max / 6));
  let searches = 0;
  let writes = 0;

  while (picked.length < max && pool.length) {
    let best = -1;
    let bestScore = -Infinity;
    for (let i = 0; i < pool.length; i++) {
      const c = pool[i];
      const used = perGroup.get(group(c)) ?? 0;
      if (used >= cap) continue;
      if (c.isSearch && searches >= searchCap) continue;
      let adjusted = c.score - 1.25 * used;
      if (c.tier === 'write' && writes < 0.3 * (picked.length + 1)) adjusted += 3;
      if (adjusted > bestScore) {
        bestScore = adjusted;
        best = i;
      }
    }
    if (best < 0) break;
    const [choice] = pool.splice(best, 1);
    perGroup.set(group(choice), (perGroup.get(group(choice)) ?? 0) + 1);
    if (choice.isSearch) searches++;
    if (choice.tier === 'write') writes++;
    picked.push(choice);
  }
  return picked;
}

/** `--only issues,pulls` → keep operations whose tags or path mention one of them. */
export function matchesOnly(o, only) {
  if (!only.length) return true;
  const haystack = new Set(
    [...staticSegments(o.path).flatMap(words), ...(Array.isArray(o.op.tags) ? o.op.tags : []).flatMap(words)].map(stem),
  );
  return only.some((term) => words(term).every((w) => haystack.has(stem(w))));
}

// ───────────────────────────── 3. describe ─────────────────────────────

const SCHEMA_BUDGET = 5000; // characters of JSON per tool input schema
const ARG_NAME = /^[a-zA-Z0-9_.-]{1,64}$/;

/** Shrink a (possibly huge, possibly recursive) schema to something an agent can read. */
export function compactSchema(spec, schema, depth, seen = new Set()) {
  if (schema && typeof schema === 'object' && typeof schema.$ref === 'string') {
    if (seen.has(schema.$ref)) return {};
    seen = new Set(seen).add(schema.$ref);
    schema = deref(spec, schema);
  }
  if (!schema || typeof schema !== 'object') return {};

  const out = {};
  if (schema.type) out.type = schema.type;
  if (schema.description) out.description = clip(plain(schema.description), 160);
  if (Array.isArray(schema.enum)) out.enum = schema.enum.slice(0, 40);
  if (schema.format) out.format = schema.format;
  if (['string', 'number', 'boolean'].includes(typeof schema.default)) out.default = schema.default;

  if (Array.isArray(schema.allOf)) {
    for (const part of schema.allOf) {
      const merged = compactSchema(spec, part, depth, seen);
      if (merged.properties) out.properties = { ...(out.properties ?? {}), ...merged.properties };
      if (merged.required) out.required = [...new Set([...(out.required ?? []), ...merged.required])];
      for (const k of ['type', 'description', 'enum', 'items']) if (merged[k] !== undefined && out[k] === undefined) out[k] = merged[k];
    }
  }

  if (schema.properties && typeof schema.properties === 'object') {
    if (!out.type) out.type = 'object';
    if (depth > 0) {
      out.properties = { ...(out.properties ?? {}) };
      for (const [name, prop] of Object.entries(schema.properties).slice(0, 40)) {
        out.properties[name] = compactSchema(spec, prop, depth - 1, seen);
      }
      if (Array.isArray(schema.required)) {
        const required = schema.required.filter((r) => r in out.properties);
        if (required.length) out.required = [...new Set([...(out.required ?? []), ...required])];
      }
    }
  }
  if (schema.items) {
    if (!out.type) out.type = 'array';
    if (depth > 0) out.items = compactSchema(spec, schema.items, depth - 1, seen);
  }
  for (const key of ['oneOf', 'anyOf']) {
    if (Array.isArray(schema[key]) && depth > 0) {
      const variants = schema[key].slice(0, 4).map((v) => compactSchema(spec, v, depth - 1, seen));
      if (variants.some((v) => Object.keys(v).length)) out[key] = variants;
    }
  }
  return out;
}

function toolNameFor(o, taken) {
  const fromId = words(o.op.operationId).join('_');
  let name = fromId || [o.method, ...staticSegments(o.path).flatMap(words)].join('_') || o.method;
  if (name.length > 64) {
    // Deterministic short hash keeps long names unique after truncation.
    let h = 0;
    for (const ch of name) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
    name = name.slice(0, 57).replace(/_+$/, '') + '_' + h.toString(36).slice(0, 6);
  }
  let unique = name;
  for (let i = 2; taken.has(unique); i++) unique = `${name.slice(0, 61)}_${i}`;
  taken.add(unique);
  return unique;
}

function descriptionFor(o) {
  const summary = plain(o.op.summary);
  const detail = plain(o.op.description);
  const firstSentence = detail.split(/(?<=[.!?])\s/)[0] ?? '';
  let text = summary || firstSentence || `${o.method.toUpperCase()} ${o.path}`;
  if (summary && firstSentence && !firstSentence.toLowerCase().startsWith(summary.toLowerCase().slice(0, 20))) {
    text = `${summary.replace(/\.$/, '')}. ${firstSentence}`;
  }
  return clip(text, 280);
}

function buildInput(spec, o, depth) {
  const properties = {};
  const required = [];
  const params = [];
  const usedArgs = new Set();
  const argFor = (name) => {
    let arg = ARG_NAME.test(name) ? name : name.replace(/[^a-zA-Z0-9_.-]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 64) || 'arg';
    while (usedArgs.has(arg)) arg = `${arg.slice(0, 62)}_`;
    usedArgs.add(arg);
    return arg;
  };

  for (const p of o.params) {
    if (p.in !== 'path' && p.in !== 'query') continue;
    const arg = argFor(p.name);
    const schema = compactSchema(spec, p.schema ?? { type: p.type, enum: p.enum, items: p.items }, depth);
    if (!schema.type && !schema.oneOf && !schema.anyOf) schema.type = 'string';
    if (p.description && !schema.description) schema.description = clip(plain(p.description), 160);
    properties[arg] = schema;
    if (p.required || p.in === 'path') required.push(arg);
    params.push({ arg, name: p.name, in: p.in, ...(p.style === 'deepObject' ? { style: 'deepObject' } : {}) });
  }

  let body = null;
  const b = bodyOf(spec, o);
  if (b && b.encoding !== 'unsupported') {
    const schema = compactSchema(spec, b.schema, depth);
    const empty = !schema.properties || Object.keys(schema.properties).length === 0;
    if (!empty || b.required) {
      const arg = argFor('body');
      properties[arg] = { type: 'object', ...schema, description: schema.description ?? 'Request body' };
      if (b.required) required.push(arg);
      body = { arg, encoding: b.encoding };
    }
  }

  return { inputSchema: { type: 'object', properties, ...(required.length ? { required } : {}) }, params, body };
}

/** The MCP tool definition plus the routing info the generated server needs. */
export function buildTool(spec, o, taken) {
  let built;
  for (let depth = 3; depth >= 0; depth--) {
    built = buildInput(spec, o, depth);
    if (JSON.stringify(built.inputSchema).length <= SCHEMA_BUDGET) break;
  }
  const readOnly = o.method === 'get';
  return {
    name: toolNameFor(o, taken),
    description: descriptionFor(o),
    inputSchema: built.inputSchema,
    annotations: { readOnlyHint: readOnly, destructiveHint: false, openWorldHint: true },
    route: { method: o.method.toUpperCase(), path: o.path, params: built.params, body: built.body },
  };
}

/** Rough token cost of a tool definition as an agent sees it (≈ 4 characters per token). */
export function tokensOf(tool) {
  const { name, description, inputSchema } = tool;
  return Math.ceil(JSON.stringify({ name, description, inputSchema }).length / 4);
}

// ───────────────────────────── the whole pipeline ─────────────────────────────

export function analyze(spec, { max = 25, readOnly = false, all = false, only = [], allow = [] } = {}) {
  const allowed = new Set(allow);
  const operations = listOperations(spec);
  const excluded = [];
  const candidates = [];

  for (const o of operations) {
    const verdict = classify(spec, o);
    if (verdict.excluded && !allowed.has(verdict.excluded.category)) {
      excluded.push({ method: o.method.toUpperCase(), path: o.path, ...verdict.excluded });
    } else {
      candidates.push({ ...o, tier: verdict.tier });
    }
  }

  const eligible = candidates.filter((c) => (!readOnly || c.tier === 'read') && matchesOnly(c, only));
  const scored = scoreOperations(eligible, operations.map((o) => o.path));
  // With --only, balance across the user's terms instead of across the API's own groups.
  const curateOpts = only.length
    ? { group: (c) => only.find((term) => matchesOnly(c, [term])), cap: Math.ceil(max / only.length) + 1 }
    : {};
  const chosen = all ? [...scored].sort((a, b) => b.score - a.score) : curate(scored, max, curateOpts);

  const taken = new Set();
  const tools = chosen.map((c) => ({ ...buildTool(spec, c, taken), tier: c.tier, group: groupOf(c) }));

  // What a one-tool-per-endpoint converter would put in the agent's context.
  const takenAll = new Set();
  const tokensAll = operations.reduce((sum, o) => sum + tokensOf(buildTool(spec, o, takenAll)), 0);

  const byCategory = {};
  for (const e of excluded) (byCategory[e.category] ??= []).push(e);

  return {
    title: spec.info?.title ?? 'API',
    version: spec.info?.version ?? '',
    counts: {
      operations: operations.length,
      excluded: excluded.length,
      candidates: candidates.length,
      candidateReads: candidates.filter((c) => c.tier === 'read').length,
      candidateWrites: candidates.filter((c) => c.tier === 'write').length,
      eligible: eligible.length,
      selected: tools.length,
    },
    tokens: { all: tokensAll, selected: tools.reduce((sum, t) => sum + tokensOf(t), 0) },
    tools,
    excluded,
    byCategory,
  };
}
