// Loading an OpenAPI / Swagger document and the small helpers every other
// module needs: local $ref resolution, word splitting, text cleanup.

import { readFile } from 'node:fs/promises';
import { parse as parseYaml } from 'yaml';

export const METHODS = ['get', 'post', 'put', 'patch', 'delete'];

export async function loadSpec(source) {
  let text;
  if (/^https?:\/\//i.test(source)) {
    const res = await fetch(source, {
      headers: { Accept: 'application/json, application/yaml, text/yaml, */*' },
      signal: AbortSignal.timeout(60_000),
    });
    if (!res.ok) throw new Error(`could not fetch spec: HTTP ${res.status} from ${source}`);
    text = await res.text();
  } else {
    text = await readFile(source, 'utf8');
  }

  let spec;
  try {
    spec = JSON.parse(text);
  } catch {
    try {
      spec = parseYaml(text);
    } catch (e) {
      throw new Error(`spec is neither valid JSON nor YAML: ${e.message}`);
    }
  }
  if (!spec || typeof spec !== 'object' || !spec.paths) {
    throw new Error('this does not look like an OpenAPI document (no "paths" object)');
  }
  return spec;
}

/** Best-effort base URL: OpenAPI 3 `servers`, then Swagger 2 host/basePath. */
export function baseUrlOf(spec, source) {
  const server = Array.isArray(spec.servers) ? spec.servers[0] : null;
  if (server?.url) {
    let url = server.url.replace(/\{([^}]+)\}/g, (_, name) => server.variables?.[name]?.default ?? `{${name}}`);
    if (!/^https?:\/\//i.test(url) && /^https?:\/\//i.test(source)) {
      url = new URL(url, source).toString();
    }
    // A relative server URL with no spec URL to resolve it against is unusable.
    return /^https?:\/\//i.test(url) ? url.replace(/\/+$/, '') : null;
  }
  if (spec.host) {
    const scheme = (spec.schemes ?? ['https']).includes('https') ? 'https' : (spec.schemes?.[0] ?? 'https');
    return `${scheme}://${spec.host}${spec.basePath ?? ''}`.replace(/\/+$/, '');
  }
  return null;
}

/**
 * How does this API want its credential? Reads the spec's security schemes and
 * picks the simplest one, so the generated server can take a single API_KEY.
 *   bearer → Authorization: Bearer <key>     basic → Authorization: Basic base64(<key>)
 *   header → <name>: <key>                   query → ?<name>=<key>
 */
const AUTH_PREFERENCE = ['bearer', 'header', 'query', 'basic', 'oauth'];

export function authOf(spec) {
  const schemes = spec.components?.securitySchemes ?? spec.securityDefinitions ?? {};
  const required = new Set((Array.isArray(spec.security) ? spec.security : []).flatMap((r) => Object.keys(r ?? {})));
  const found = [];
  for (const [id, raw] of Object.entries(schemes)) {
    const s = deref(spec, raw);
    if (!s || typeof s !== 'object') continue;
    let auth = null;
    if (s.type === 'http' && /^bearer$/i.test(s.scheme ?? '')) auth = { kind: 'bearer' };
    else if ((s.type === 'http' && /^basic$/i.test(s.scheme ?? '')) || s.type === 'basic') auth = { kind: 'basic' };
    else if (s.type === 'apiKey' && s.in === 'header' && s.name) {
      auth = /^authorization$/i.test(s.name) ? { kind: 'bearer' } : { kind: 'header', name: s.name };
    } else if (s.type === 'apiKey' && s.in === 'query' && s.name) auth = { kind: 'query', name: s.name };
    else if (s.type === 'oauth2' || s.type === 'openIdConnect') auth = { kind: 'bearer', oauth: true };
    if (!auth) continue;
    const rank = (required.has(id) ? 0 : 10) + AUTH_PREFERENCE.indexOf(auth.oauth ? 'oauth' : auth.kind);
    found.push({ auth, rank });
  }
  if (!found.length) return { kind: 'bearer', declared: false };
  found.sort((a, b) => a.rank - b.rank);
  return { ...found[0].auth, declared: true };
}

/** Follow local `#/…` references. Anything else is returned untouched. */
export function deref(spec, node) {
  let cur = node;
  for (let i = 0; i < 12 && cur && typeof cur === 'object' && typeof cur.$ref === 'string'; i++) {
    if (!cur.$ref.startsWith('#/')) return {};
    let target = spec;
    for (const raw of cur.$ref.slice(2).split('/')) {
      const key = decodeURIComponent(raw).replace(/~1/g, '/').replace(/~0/g, '~');
      target = target?.[key];
    }
    cur = target;
  }
  return cur;
}

/** "listForRepo" / "issues/list-for-repo" → ["list","for","repo"] */
export function words(s) {
  return String(s ?? '')
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(Boolean);
}

/** Crude singular form: "repositories" → "repository", "branches" → "branch", "issues" → "issue". */
export function stem(w) {
  if (w.length <= 3) return w;
  if (w.endsWith('ies')) return w.slice(0, -3) + 'y';
  if (/(ch|sh|x|ss)es$/.test(w)) return w.slice(0, -2);
  if (w.endsWith('s') && !w.endsWith('ss') && !w.endsWith('us')) return w.slice(0, -1);
  return w;
}

/** First word in `ws` that is in `set` (plural-insensitive), or undefined. */
export function findWord(ws, set) {
  return ws.find((w) => set.has(w) || set.has(stem(w)));
}

/** Strip HTML / markdown noise and collapse whitespace. */
export function plain(text) {
  return String(text ?? '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
    .replace(/[`*_#>]+/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

export function clip(text, max) {
  return text.length <= max ? text : text.slice(0, max - 1).trimEnd() + '…';
}
