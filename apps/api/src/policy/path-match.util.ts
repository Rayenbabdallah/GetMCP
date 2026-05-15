// Path template matcher.
//   "*"               → match anything
//   "/v1/refunds"     → exact match
//   "/v1/users/:id"   → param segment, matches "/v1/users/abc" (no slashes inside)
//   "/v1/foo/*"       → prefix wildcard, matches "/v1/foo/anything/here"
//
// Trailing slashes are normalized away. Query strings are not part of the path
// here — strip them before calling.

const PARAM_RE = /:[A-Za-z_][A-Za-z0-9_]*/g;

function normalize(p: string): string {
  if (!p) return '';
  let out = p.split('?')[0];
  if (out.length > 1 && out.endsWith('/')) out = out.slice(0, -1);
  return out;
}

function templateToRegExp(template: string): RegExp {
  // Escape regex specials EXCEPT ":" and "*" and "/"
  let pattern = template.replace(/[.+?^${}()|[\]\\]/g, '\\$&');
  // /* (slash-star) → /.* , preserving any further suffix
  pattern = pattern.replace(/\/\*/g, '/.*');
  // bare * (no preceding slash) at start → .*
  if (pattern.startsWith('*')) pattern = '.*' + pattern.slice(1);
  // :param → match a single segment (no slashes)
  pattern = pattern.replace(PARAM_RE, '[^/]+');
  return new RegExp(`^${pattern}$`);
}

export function pathMatches(template: string, path: string): boolean {
  if (!template) return false;
  if (template === '*' || template === '**') return true;
  const t = normalize(template);
  const p = normalize(path);
  if (t === p) return true;
  return templateToRegExp(t).test(p);
}

export function methodMatches(template: string, method: string): boolean {
  if (!template || template === '*') return true;
  return template.toUpperCase() === method.toUpperCase();
}
