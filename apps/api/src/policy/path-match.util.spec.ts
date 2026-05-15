import { methodMatches, pathMatches } from './path-match.util';

describe('pathMatches', () => {
  it('exact match', () => {
    expect(pathMatches('/v1/refunds', '/v1/refunds')).toBe(true);
    expect(pathMatches('/v1/refunds', '/v1/refunds-undo')).toBe(false);
    expect(pathMatches('/v1/refunds', '/v1/refunds/abc')).toBe(false);
  });

  it('wildcard "*" matches anything', () => {
    expect(pathMatches('*', '/v1/refunds')).toBe(true);
    expect(pathMatches('*', '/')).toBe(true);
    expect(pathMatches('**', '/v1/x/y/z')).toBe(true);
  });

  it(':param matches a single segment, no slashes', () => {
    expect(pathMatches('/v1/users/:id', '/v1/users/abc')).toBe(true);
    expect(pathMatches('/v1/users/:id', '/v1/users/123-xyz')).toBe(true);
    expect(pathMatches('/v1/users/:id', '/v1/users/abc/orders')).toBe(false);
    expect(pathMatches('/v1/users/:id/orders', '/v1/users/abc/orders')).toBe(true);
  });

  it('/foo/* prefix matches deep paths', () => {
    expect(pathMatches('/v1/foo/*', '/v1/foo/bar')).toBe(true);
    expect(pathMatches('/v1/foo/*', '/v1/foo/bar/baz')).toBe(true);
    expect(pathMatches('/v1/foo/*', '/v1/foo')).toBe(false); // no segment after
    expect(pathMatches('/v1/foo/*', '/v1/foobar')).toBe(false); // not a slash boundary
  });

  it('normalizes trailing slashes and ignores query strings', () => {
    expect(pathMatches('/v1/refunds', '/v1/refunds/')).toBe(true);
    expect(pathMatches('/v1/refunds/', '/v1/refunds')).toBe(true);
    expect(pathMatches('/v1/refunds', '/v1/refunds?foo=1')).toBe(true);
  });

  it('does NOT do String.includes (the old, broken behavior)', () => {
    // Old code: '/v1/refunds-undo'.includes('/v1/refunds') === true
    // New: must be false.
    expect(pathMatches('/v1/refunds', '/v1/refunds-undo')).toBe(false);
    expect(pathMatches('/v1/users', '/v1/users-archive/123')).toBe(false);
  });
});

describe('methodMatches', () => {
  it('* matches anything', () => {
    expect(methodMatches('*', 'GET')).toBe(true);
    expect(methodMatches('*', 'DELETE')).toBe(true);
  });
  it('case-insensitive exact match', () => {
    expect(methodMatches('post', 'POST')).toBe(true);
    expect(methodMatches('POST', 'post')).toBe(true);
    expect(methodMatches('POST', 'GET')).toBe(false);
  });
});
