import { createCipheriv, createDecipheriv, randomBytes } from 'crypto';

// AES-256-GCM at-rest encryption for secrets we must store reversibly
// (e.g. an upstream API's bearer token that the proxy needs to inject).
//
// Format: "gcm$<iv-hex>$<authTag-hex>$<ciphertext-hex>"
//
// Key sourced from KEY_ENCRYPTION_KEY env var (32 raw bytes, hex-encoded → 64 chars).

const ALGO = 'aes-256-gcm';
const IV_LEN = 12;
const KEY_LEN = 32;

function loadKey(): Buffer {
  const hex = process.env.KEY_ENCRYPTION_KEY;
  if (!hex) {
    throw new Error(
      'KEY_ENCRYPTION_KEY is not set. Generate one with: openssl rand -hex 32',
    );
  }
  const buf = Buffer.from(hex, 'hex');
  if (buf.length !== KEY_LEN) {
    throw new Error(`KEY_ENCRYPTION_KEY must be ${KEY_LEN} bytes (${KEY_LEN * 2} hex chars)`);
  }
  return buf;
}

export function encryptSecret(plaintext: string): string {
  const key = loadKey();
  const iv = randomBytes(IV_LEN);
  const cipher = createCipheriv(ALGO, key, iv);
  const ct = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `gcm$${iv.toString('hex')}$${tag.toString('hex')}$${ct.toString('hex')}`;
}

export function decryptSecret(stored: string): string {
  const key = loadKey();
  const parts = stored.split('$');
  if (parts.length !== 4 || parts[0] !== 'gcm') {
    throw new Error('Malformed ciphertext');
  }
  const iv = Buffer.from(parts[1], 'hex');
  const tag = Buffer.from(parts[2], 'hex');
  const ct = Buffer.from(parts[3], 'hex');
  const decipher = createDecipheriv(ALGO, key, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(ct), decipher.final()]).toString('utf8');
}
