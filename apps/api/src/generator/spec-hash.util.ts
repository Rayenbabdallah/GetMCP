import { createHash } from 'crypto';

// Stable hash of the parts of a spec that determine classification: paths,
// methods, parameters, request body schema. We deliberately exclude `info`,
// `servers`, `description`, and example values — bumping the version string
// shouldn't invalidate the cache when no endpoint shape changed.
//
// Returns 64-char hex sha256.

interface MethodInfo {
  method: string;
  parameters?: any[];
  requestBody?: any;
  tags?: string[];
}

export function specHash(spec: any): string {
  if (!spec || typeof spec !== 'object') throw new Error('spec is not an object');

  const paths = spec.paths ?? {};
  const normalized: Array<[string, MethodInfo[]]> = [];

  for (const path of Object.keys(paths).sort()) {
    const methods = paths[path] ?? {};
    const methodInfos: MethodInfo[] = [];
    for (const method of Object.keys(methods).sort()) {
      const op = methods[method];
      if (!op || typeof op !== 'object') continue;
      methodInfos.push({
        method: method.toLowerCase(),
        parameters: normalizeParams(op.parameters),
        requestBody: normalizeRequestBody(op.requestBody),
        tags: Array.isArray(op.tags) ? [...op.tags].sort() : [],
      });
    }
    normalized.push([path, methodInfos]);
  }

  return createHash('sha256').update(canonical(normalized)).digest('hex');
}

function normalizeParams(params: any): any[] {
  if (!Array.isArray(params)) return [];
  return params
    .map((p) => ({
      name: String(p?.name ?? ''),
      in: String(p?.in ?? ''),
      required: Boolean(p?.required),
    }))
    .sort((a, b) => (a.name + a.in).localeCompare(b.name + b.in));
}

function normalizeRequestBody(rb: any): any {
  if (!rb || typeof rb !== 'object') return null;
  const required = Boolean(rb.required);
  const content = rb.content ?? {};
  const types = Object.keys(content).sort();
  return { required, contentTypes: types };
}

// Tiny canonical-JSON helper. Same rules as audit/canonical.util.ts but
// scoped to this file to avoid coupling.
function canonical(value: unknown): string {
  if (value === null || value === undefined) return 'null';
  if (typeof value === 'number' || typeof value === 'string' || typeof value === 'boolean') {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) return '[' + value.map(canonical).join(',') + ']';
  if (typeof value === 'object') {
    const keys = Object.keys(value as Record<string, unknown>).sort();
    return (
      '{' +
      keys.map((k) => JSON.stringify(k) + ':' + canonical((value as any)[k])).join(',') +
      '}'
    );
  }
  return 'null';
}
