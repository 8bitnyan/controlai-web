/**
 * AES-256-GCM decrypt — mirrors packages/api/src/lib/crypto.ts.
 * Uses the same INSTANCE_TOKEN_KEY environment variable.
 */
import { createDecipheriv } from 'crypto';

function loadKey(): Buffer {
  const keyHex = process.env.INSTANCE_TOKEN_KEY;
  if (!keyHex) {
    throw new Error('INSTANCE_TOKEN_KEY is required for the simulator to decrypt PEMs');
  }
  const key = Buffer.from(keyHex, 'hex');
  if (key.length !== 32) {
    throw new Error(`INSTANCE_TOKEN_KEY must be 64 hex chars (32 bytes), got ${key.length}`);
  }
  return key;
}

let _key: Buffer | null = null;
function getKey(): Buffer {
  if (!_key) _key = loadKey();
  return _key;
}

export function decryptToken(ciphertext: string): string {
  const key = getKey();
  const parts = ciphertext.split(':');
  if (parts.length !== 3) throw new Error('Invalid ciphertext format');
  const [ivB64, encB64, tagB64] = parts as [string, string, string];
  const iv = Buffer.from(ivB64, 'base64');
  const encrypted = Buffer.from(encB64, 'base64');
  const authTag = Buffer.from(tagB64, 'base64');

  const decipher = createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(authTag);
  try {
    const dec = Buffer.concat([decipher.update(encrypted), decipher.final()]);
    return dec.toString('utf8');
  } catch {
    throw new Error('Decryption failed: ciphertext may have been tampered with');
  }
}
