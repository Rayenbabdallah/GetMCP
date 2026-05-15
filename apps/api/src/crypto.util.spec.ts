import { encryptSecret, decryptSecret } from './crypto.util';
import { randomBytes } from 'crypto';

describe('crypto.util', () => {
  beforeAll(() => {
    process.env.KEY_ENCRYPTION_KEY = randomBytes(32).toString('hex');
  });

  it('round-trips plaintext through encrypt/decrypt', () => {
    const ct = encryptSecret('Bearer sk_test_abc123');
    expect(ct).toMatch(/^gcm\$[0-9a-f]+\$[0-9a-f]+\$[0-9a-f]+$/);
    expect(decryptSecret(ct)).toBe('Bearer sk_test_abc123');
  });

  it('produces different ciphertext for the same input (random IV)', () => {
    const a = encryptSecret('same');
    const b = encryptSecret('same');
    expect(a).not.toEqual(b);
  });

  it('rejects tampered ciphertext (auth tag check)', () => {
    const ct = encryptSecret('hello');
    const parts = ct.split('$');
    parts[3] = parts[3].replace(/.$/, (c) => (c === '0' ? '1' : '0'));
    expect(() => decryptSecret(parts.join('$'))).toThrow();
  });

  it('rejects malformed ciphertext', () => {
    expect(() => decryptSecret('not-a-real-payload')).toThrow();
    expect(() => decryptSecret('aes$x$y$z')).toThrow();
  });

  it('throws when KEY_ENCRYPTION_KEY is missing', () => {
    const saved = process.env.KEY_ENCRYPTION_KEY;
    delete process.env.KEY_ENCRYPTION_KEY;
    try {
      expect(() => encryptSecret('x')).toThrow(/KEY_ENCRYPTION_KEY/);
    } finally {
      process.env.KEY_ENCRYPTION_KEY = saved;
    }
  });
});
