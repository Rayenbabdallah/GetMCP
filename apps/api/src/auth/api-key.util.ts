import { randomBytes, scrypt as scryptCb, timingSafeEqual } from 'crypto';
import { promisify } from 'util';

const scrypt = promisify(scryptCb) as (
  password: string | Buffer,
  salt: string | Buffer,
  keylen: number,
) => Promise<Buffer>;

const KEY_LEN = 64;
const PREFIX_LEN = 8;

export interface MintedKey {
  plaintext: string;
  prefix: string;
  hash: string;
}

// Plaintext format: gmcp_<24-byte base64url>. Prefix is the leading 8 chars.
export async function mintApiKey(): Promise<MintedKey> {
  const random = randomBytes(24).toString('base64url');
  const plaintext = `gmcp_${random}`;
  const prefix = plaintext.slice(0, PREFIX_LEN);
  const hash = await hashApiKey(plaintext);
  return { plaintext, prefix, hash };
}

export async function hashApiKey(plaintext: string): Promise<string> {
  const salt = randomBytes(16);
  const derived = await scrypt(plaintext, salt, KEY_LEN);
  return `scrypt$${salt.toString('hex')}$${derived.toString('hex')}`;
}

export async function verifyApiKey(plaintext: string, stored: string): Promise<boolean> {
  const parts = stored.split('$');
  if (parts.length !== 3 || parts[0] !== 'scrypt') return false;
  const salt = Buffer.from(parts[1], 'hex');
  const expected = Buffer.from(parts[2], 'hex');
  const derived = await scrypt(plaintext, salt, expected.length);
  if (derived.length !== expected.length) return false;
  return timingSafeEqual(derived, expected);
}

export function extractPrefix(plaintext: string): string {
  return plaintext.slice(0, PREFIX_LEN);
}
